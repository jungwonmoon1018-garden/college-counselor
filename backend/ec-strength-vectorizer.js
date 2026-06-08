// ═══════════════════════════════════════════════════════════════════════
// EC STRENGTH VECTORIZER — 4-factor strength + coarse tier label
// ═══════════════════════════════════════════════════════════════════════
// Runs alongside the existing 5-factor ec-vectorizer.js. Adds:
//
//   1. EVIDENCE: consumes uploaded file text (certificates, award letters,
//      resumes) in addition to what the student types in the EC tab.
//   2. NARRATIVE ALIGNMENT: uses the student's cached self-presentation
//      to score whether each EC strengthens or dilutes that narrative.
//   3. TIER BATCHING: emits a coarse tier label (tier_1_distinctive →
//      tier_4_foundational) so planners can ask "which 2-3 ECs should lead
//      this application?" without re-ranking a dense 5-factor vector.
//
// Factor independence is preserved — no single composite score. The
// tier label is the only coarse external surface.
// ═══════════════════════════════════════════════════════════════════════

import crypto from "node:crypto";

import {
  LEXICON,
  countHits,
  extractNumericImpact,
  detectCompetitiveActivity,
  competitionLevelToScore,
  getCompetitionMajorRelevance,
  matchMajorBucket,
  normalizeText,
  clamp01,
  round2,
} from "./ec-vectorizer.js";

import {
  callHaikuForNarrativeFit,
  hashText,
} from "./narrative-fit-llm.js";

import {
  researchCompetitionPrestige,
  computePrestigeCacheKey,
} from "./competition-research.js";

import { COMPETITIVE_ACTIVITY_BENCHMARKS } from "./baseline-data.js";

// ─── Constants / shape ──────────────────────────────────────
// Order matters for vector output. Prestige sits *before* narrative_fit
// because narrative_fit is the most LLM-volatile factor and stays last.
export const STRENGTH_FACTORS = Object.freeze([
  "dedication",
  "achievement",
  "leadership",
  "prestige",
  "major_spike",
  "narrative_fit",
]);

// Valid values for the prestige_source column.
export const PRESTIGE_SOURCES = Object.freeze({
  RESEARCH: "research",
  BENCHMARK: "benchmark",
  LEGACY: "legacy",
  OVERRIDE: "override",
  UNAVAILABLE: "unavailable",
  RESEARCH_FAILED: "research_failed",
});

export const TIERS = Object.freeze({
  TIER_1: "tier_1_distinctive",
  TIER_2: "tier_2_strong",
  TIER_3: "tier_3_developing",
  TIER_4: "tier_4_foundational",
});

const TIER_SET = new Set(Object.values(TIERS));

const MAX_EC_TEXT_CHARS = 2500;
const MAX_COMBINED_FILE_CHARS = 15_000;

// ─── Schema ─────────────────────────────────────────────────
export function initECStrengthTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ec_strength_vectors (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      ec_name TEXT NOT NULL,
      description TEXT,

      dedication REAL DEFAULT 0,
      achievement REAL DEFAULT 0,
      leadership REAL DEFAULT 0,
      prestige REAL DEFAULT 0,
      prestige_source TEXT,
      major_spike REAL DEFAULT 0,
      narrative_fit REAL DEFAULT 0,
      tier_label TEXT,

      hours_per_week REAL,
      weeks_per_year REAL,
      years_active REAL,
      lifetime_hours REAL,

      is_overridden INTEGER DEFAULT 0,
      override_json TEXT,

      reasoning_json TEXT,
      file_refs_json TEXT,
      narrative_version_id TEXT,

      computed_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(student_id, ec_name)
    );
    CREATE INDEX IF NOT EXISTS idx_ec_strength_student
      ON ec_strength_vectors(student_id, ec_name);
    CREATE INDEX IF NOT EXISTS idx_ec_strength_tier
      ON ec_strength_vectors(student_id, tier_label);

    CREATE TABLE IF NOT EXISTS ec_attachments (
      id TEXT PRIMARY KEY,
      student_id TEXT,
      ec_name TEXT,
      filename TEXT,
      mime_type TEXT,
      size_bytes INTEGER,
      storage_path TEXT NOT NULL,
      extracted_text TEXT,
      extracted_text_hash TEXT,
      extracted_chars INTEGER DEFAULT 0,
      extraction_status TEXT DEFAULT 'pending',
      extraction_error TEXT,
      uploaded_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ec_attachments_student_ec
      ON ec_attachments(student_id, ec_name);
  `);

  // In-place migration — older installs may not have prestige / prestige_source.
  const cols = db.prepare(`PRAGMA table_info(ec_strength_vectors)`).all().map((r) => r.name);
  if (!cols.includes("prestige")) {
    db.exec(`ALTER TABLE ec_strength_vectors ADD COLUMN prestige REAL DEFAULT 0`);
  }
  if (!cols.includes("prestige_source")) {
    db.exec(`ALTER TABLE ec_strength_vectors ADD COLUMN prestige_source TEXT`);
    // Mark pre-existing rows so callers can distinguish "never researched" from
    // "researched as zero".
    db.exec(`UPDATE ec_strength_vectors SET prestige_source = 'legacy' WHERE prestige_source IS NULL`);
  }
  if (!cols.includes("major_spike")) {
    db.exec(`ALTER TABLE ec_strength_vectors ADD COLUMN major_spike REAL DEFAULT 0`);
  }
}

export function prepareECStrengthStatements(db) {
  return {
    upsert: db.prepare(`
      INSERT INTO ec_strength_vectors
        (id, student_id, ec_name, description,
         dedication, achievement, leadership, prestige, prestige_source, major_spike,
         narrative_fit, tier_label,
         hours_per_week, weeks_per_year, years_active, lifetime_hours,
         is_overridden, override_json,
         reasoning_json, file_refs_json, narrative_version_id,
         computed_at, updated_at)
      VALUES (?,?,?,?, ?,?,?,?,?, ?,?, ?,?,?,?, ?,?, ?,?,?,?,
              datetime('now'), datetime('now'))
      ON CONFLICT(student_id, ec_name) DO UPDATE SET
        description = excluded.description,
        dedication = excluded.dedication,
        achievement = excluded.achievement,
        leadership = excluded.leadership,
        prestige = excluded.prestige,
        prestige_source = excluded.prestige_source,
        major_spike = excluded.major_spike,
        narrative_fit = excluded.narrative_fit,
        tier_label = excluded.tier_label,
        hours_per_week = excluded.hours_per_week,
        weeks_per_year = excluded.weeks_per_year,
        years_active = excluded.years_active,
        lifetime_hours = excluded.lifetime_hours,
        is_overridden = excluded.is_overridden,
        override_json = excluded.override_json,
        reasoning_json = excluded.reasoning_json,
        file_refs_json = excluded.file_refs_json,
        narrative_version_id = excluded.narrative_version_id,
        updated_at = datetime('now')
    `),
    getByStudent: db.prepare(`
      SELECT * FROM ec_strength_vectors
      WHERE student_id = ?
      ORDER BY
        CASE tier_label
          WHEN 'tier_1_distinctive' THEN 1
          WHEN 'tier_2_strong' THEN 2
          WHEN 'tier_3_developing' THEN 3
          WHEN 'tier_4_foundational' THEN 4
          ELSE 5
        END,
        ec_name ASC
    `),
    getByStudentAndName: db.prepare(`
      SELECT * FROM ec_strength_vectors
      WHERE student_id = ? AND ec_name = ?
    `),
    deleteByStudentAndName: db.prepare(`
      DELETE FROM ec_strength_vectors
      WHERE student_id = ? AND ec_name = ?
    `),
    applyOverride: db.prepare(`
      UPDATE ec_strength_vectors
      SET dedication = COALESCE(?, dedication),
          achievement = COALESCE(?, achievement),
          leadership = COALESCE(?, leadership),
          prestige = COALESCE(?, prestige),
          prestige_source = CASE WHEN ? IS NOT NULL THEN 'override' ELSE prestige_source END,
          major_spike = COALESCE(?, major_spike),
          narrative_fit = COALESCE(?, narrative_fit),
          tier_label = ?,
          is_overridden = 1,
          override_json = ?,
          updated_at = datetime('now')
      WHERE student_id = ? AND ec_name = ?
    `),

    // Attachment statements
    insertAttachment: db.prepare(`
      INSERT INTO ec_attachments
        (id, student_id, ec_name, filename, mime_type, size_bytes,
         storage_path, extracted_text, extracted_text_hash, extracted_chars,
         extraction_status, extraction_error, uploaded_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
    `),
    getAttachmentById: db.prepare(`SELECT * FROM ec_attachments WHERE id = ?`),
    getAttachmentsForStudent: db.prepare(`
      SELECT * FROM ec_attachments WHERE student_id = ? ORDER BY uploaded_at DESC
    `),
    getAttachmentsForEC: db.prepare(`
      SELECT * FROM ec_attachments
      WHERE student_id = ? AND ec_name = ? AND extraction_status = 'ok'
      ORDER BY uploaded_at ASC
    `),
    linkAttachmentToEC: db.prepare(`
      UPDATE ec_attachments SET ec_name = ? WHERE id = ? AND student_id = ?
    `),
  };
}

// ─── Core: vectorize one EC ─────────────────────────────────
/**
 * @param {object} params
 * @param {object} params.ec                 - activity record
 * @param {string} [params.description]      - overrides ec.description
 * @param {string} [params.fileText]         - concatenated extracted text
 * @param {string} [params.narrative]        - active student narrative
 * @param {Array}  [params.narrativeThemes]  - from extractNarrativeThemes
 * @param {string} [params.narrativeHash]
 * @param {string} [params.narrativeId]
 * @param {string} [params.majorInterest]
 * @param {object} [params.llmClient]        - { call({...}), prestige? } —
 *                                             prestige is an optional function
 *                                             that returns a prestige result;
 *                                             when absent, we fall back to
 *                                             researchCompetitionPrestige using
 *                                             params.prestigeAdapter.
 * @param {object} [params.prestigeAdapter]  - {provider, apiKey, baseUrl, model}
 *                                             used for web_search research;
 *                                             when null, prestige falls back
 *                                             to benchmark-only.
 * @param {object} [params.ragStmts]         - rag-engine statements (reads
 *                                             ec_prestige_cache, writes via
 *                                             upsertPrestigeCache + the
 *                                             ec_component_cache family).
 * @returns {Promise<{factors, tier_label, reasoning, lifetime_hours,
 *   prestige_source, narrative_version_id}>}
 */
export async function vectorizeECStrength({
  ec = {},
  description,
  fileText = "",
  narrative = null,
  narrativeThemes = [],
  narrativeHash = null,
  narrativeId = null,
  majorInterest = null,
  llmClient = null,
  prestigeAdapter = null,
  ragStmts = null,
} = {}) {
  const desc = normalizeText([
    ec.name, ec.role, description ?? ec.description, ec.category,
    Array.isArray(ec.awards) ? ec.awards.join(" ") : ec.awards,
    Array.isArray(ec.outputs) ? ec.outputs.join(" ") : ec.outputs,
  ].filter(Boolean).join(" "));
  const fileNorm = normalizeText(fileText || "");
  const combined = (desc + " " + fileNorm).trim();
  const combinedHash = crypto.createHash("sha256").update(combined).digest("hex");
  const ecNameForCache = String(ec.name || ec.role || "unnamed_ec");

  const reasoning = {
    dedication: [],
    achievement: [],
    leadership: [],
    prestige: null,
    major_spike: [],
    narrative_fit: null,
  };

  // ─── 1. Dedication ───
  const hoursPerWeek = Number(ec.hoursPerWeek || 0);
  const weeksPerYear = Number(ec.weeksPerYear || 40);
  const years = Number(ec.yearsOfParticipation || ec.years || 0);
  const lifetimeHours = hoursPerWeek * weeksPerYear * Math.max(years, 1);

  const dedicationResult = await computeWithCache({
    factor: "dedication",
    ragStmts,
    inputs: {
      ecName: ecNameForCache,
      combinedHash,
      hoursPerWeek,
      weeksPerYear,
      years,
    },
    compute: async () => {
      const notes = [];
      let score = 0;
      if (lifetimeHours >= 800) { score = 0.55; notes.push(`~${Math.round(lifetimeHours)} lifetime hours`); }
      else if (lifetimeHours >= 500) { score = 0.45; notes.push(`~${Math.round(lifetimeHours)} lifetime hours`); }
      else if (lifetimeHours >= 300) { score = 0.35; notes.push(`~${Math.round(lifetimeHours)} lifetime hours`); }
      else if (lifetimeHours >= 150) { score = 0.22; notes.push(`~${Math.round(lifetimeHours)} lifetime hours`); }
      else if (lifetimeHours >= 50)  { score = 0.12; notes.push(`~${Math.round(lifetimeHours)} lifetime hours`); }
      else { score = 0.04; }

      if (years >= 4) { score += 0.25; notes.push(`${years}+ years active`); }
      else if (years >= 3) { score += 0.18; notes.push(`${years} years active`); }
      else if (years >= 2) { score += 0.10; notes.push(`${years} years active`); }
      else if (years >= 1) { score += 0.04; notes.push("1 year active"); }

      const consistencyPool = [...LEXICON.passion.time_phrases, ...LEXICON.passion.output];
      const consistencyHits = countHits(combined, consistencyPool);
      if (consistencyHits > 0) {
        const bump = Math.min(0.15, 0.06 * consistencyHits);
        score += bump;
        notes.push(`Consistency/output signals: ${consistencyHits}`);
      }
      return { score: clamp01(score), reasoning: notes, source: "heuristic" };
    },
  });
  const dedication = clamp01(Number(dedicationResult.score));
  reasoning.dedication = Array.isArray(dedicationResult.reasoning)
    ? dedicationResult.reasoning
    : [];

  // ─── 2. Achievement ───
  const competition = detectCompetitiveActivity(combined);
  const achievementResult = await computeWithCache({
    factor: "achievement",
    ragStmts,
    inputs: {
      ecName: ecNameForCache,
      combinedHash,
      competition,
      awardsCount: Array.isArray(ec.awards) ? ec.awards.length : 0,
    },
    compute: async () => {
      const notes = [];
      let score = 0;
      let lexiconTier = null;
      if (LEXICON.awards.international.some((k) => combined.includes(k))) { lexiconTier = "international"; score = 0.70; }
      else if (LEXICON.awards.national.some((k) => combined.includes(k)))  { lexiconTier = "national"; score = 0.55; }
      else if (LEXICON.awards.state.some((k) => combined.includes(k)))     { lexiconTier = "state"; score = 0.35; }
      else if (LEXICON.awards.regional.some((k) => combined.includes(k)))  { lexiconTier = "regional"; score = 0.20; }
      if (lexiconTier) notes.push(`${lexiconTier}-level recognition`);

      if (competition) {
        const compScore = competitionLevelToScore(competition.activityId, competition.levelIndex);
        if (compScore > score) {
          score = compScore;
          notes.push(
            `Competition: ${competition.activityId} level ${competition.levelIndex} (score ${round2(compScore)})`,
          );
        }
      }

      const recogHits = countHits(combined, LEXICON.awards.recognition);
      if (recogHits > 0 && score < 0.55) {
        const bump = Math.min(0.2, 0.06 * recogHits);
        score += bump;
        notes.push(`Recognition verbs: ${recogHits}`);
      }

      const numeric = extractNumericImpact(combined);
      if (numeric.people >= 1000) { score += 0.12; notes.push(`Reach ~${numeric.people} people`); }
      else if (numeric.people >= 100) { score += 0.06; notes.push(`Reach ~${numeric.people} people`); }
      if (numeric.dollars >= 10000) { score += 0.10; notes.push(`Raised $${numeric.dollars}+`); }
      else if (numeric.dollars >= 1000) { score += 0.05; notes.push(`Raised $${numeric.dollars}+`); }

      if (Array.isArray(ec.awards) && ec.awards.length > 0) {
        const bump = Math.min(0.2, 0.07 * ec.awards.length);
        score += bump;
        notes.push(`${ec.awards.length} listed award(s)`);
      }
      return { score: clamp01(score), reasoning: notes, source: "heuristic" };
    },
  });
  const achievement = clamp01(Number(achievementResult.score));
  reasoning.achievement = Array.isArray(achievementResult.reasoning)
    ? achievementResult.reasoning
    : [];

  // ─── 3. Leadership ───
  const roleNorm = normalizeText(ec.role || "");
  const leadershipResult = await computeWithCache({
    factor: "leadership",
    ragStmts,
    inputs: { ecName: ecNameForCache, combinedHash, roleNorm },
    compute: async () => {
      const notes = [];
      let score = 0;
      if (LEXICON.leadership.founder.some((k) => combined.includes(k) || roleNorm.includes(k))) {
        score += 0.55;
        notes.push("Founder / creator signal");
      }
      if (LEXICON.leadership.top_rank.some((k) => roleNorm.includes(k) || combined.includes(k))) {
        score += 0.35;
        notes.push("Top-rank role");
      } else if (LEXICON.leadership.mid_rank.some((k) => roleNorm.includes(k) || combined.includes(k))) {
        score += 0.20;
        notes.push("Mid-rank role");
      }
      const initiativeHits = countHits(combined, LEXICON.leadership.initiative);
      if (initiativeHits > 0) {
        score += Math.min(0.25, 0.08 * initiativeHits);
        notes.push(`Initiative verbs: ${initiativeHits}`);
      }
      if (LEXICON.leadership.rank_progression.some((k) => combined.includes(k))) {
        score += 0.15;
        notes.push("Rank progression signal");
      }
      return { score: clamp01(score), reasoning: notes, source: "heuristic" };
    },
  });
  const leadership = clamp01(Number(leadershipResult.score));
  reasoning.leadership = Array.isArray(leadershipResult.reasoning)
    ? leadershipResult.reasoning
    : [];

  // ─── 4. Prestige ───
  // Draws from:
  //   a) baseline_ec_competitive row when the EC matches a seeded activity
  //      id + qualifier level (short-circuits web_search),
  //   b) ec_prestige_cache (30-day TTL) for previously-researched contests,
  //   c) Anthropic web_search research via competition-research.js.
  //
  // When no adapter/stmts are available, prestige defaults to 0 with
  // source="unavailable" so tier labels still compute.
  const benchmarkHit = resolveBenchmarkHit({ combined, competition });
  const prestigeResult = await computeWithCache({
    factor: "prestige",
    ragStmts,
    inputs: {
      activityName: ecNameForCache,
      benchmarkLevel: benchmarkHit?.level || null,
      benchmarkScore: benchmarkHit?.prestige_score ?? null,
      provider: prestigeAdapter?.provider || (llmClient?.prestige ? "llmClient" : null),
      model: prestigeAdapter?.model || null,
    },
    compute: async () => {
      let score = 0;
      let source = "unavailable";
      let details = null;
      if (llmClient && typeof llmClient.prestige === "function") {
        try {
          const r = await llmClient.prestige({
            activityName: ec.name || ec.role || "",
            levelHint: benchmarkHit?.level || null,
            benchmarkHit,
          });
          if (r && Number.isFinite(r.score)) {
            score = clamp01(Number(r.score));
            source = r.source || "research";
            details = r;
          }
        } catch {
          // Fall through to 0/unavailable.
        }
      } else if (ragStmts && ec.name) {
        try {
          const r = await researchCompetitionPrestige({
            activityName: ec.name,
            levelHint: benchmarkHit?.level || null,
            benchmarkHit,
            stmts: ragStmts,
            adapter: prestigeAdapter,
          });
          if (r && Number.isFinite(r.score)) {
            score = clamp01(Number(r.score));
            source = r.source || "research";
            details = r;
          }
        } catch {
          // Fall through.
        }
      }
      return {
        score,
        source,
        reasoning: details
          ? {
              source,
              rationale: details.rationale || null,
              sourcesCited: details.sourcesCited || [],
              cached: Boolean(details.cached),
              catalogMatch: details.catalogMatch || null,
            }
          : { source, rationale: null, sourcesCited: [], cached: false },
        provider: prestigeAdapter?.provider || null,
        model: prestigeAdapter?.model || null,
      };
    },
  });
  const prestige = clamp01(Number(prestigeResult.score));
  const prestige_source = prestigeResult.source || "unavailable";
  reasoning.prestige = prestigeResult.reasoning || {
    source: prestige_source,
    rationale: null,
    sourcesCited: [],
    cached: false,
  };
  reasoning.prestige.component_cache_hit = Boolean(prestigeResult.cacheHit);

  const majorSpikeResult = await computeWithCache({
    factor: "major_spike",
    ragStmts,
    inputs: {
      ecName: ecNameForCache,
      combinedHash,
      majorInterest: majorInterest || null,
      competition,
      achievement,
      leadership,
      prestige,
      years,
      lifetimeHours,
    },
    compute: async () => {
      const notes = [];
      if (!majorInterest) {
        notes.push("No intended major declared yet");
        return { score: 0.2, reasoning: notes, source: "no_major" };
      }

      const bucket = matchMajorBucket(majorInterest);
      const majorKeywords = bucket ? (LEXICON.majorBuckets[bucket] || []) : [];
      const majorHits = countHits(combined, majorKeywords);
      let score = 0;

      if (majorHits >= 5) {
        score += 0.5;
        notes.push(`Heavy ${majorInterest} overlap (${majorHits} signals)`);
      } else if (majorHits >= 3) {
        score += 0.38;
        notes.push(`Strong ${majorInterest} overlap (${majorHits} signals)`);
      } else if (majorHits >= 1) {
        score += 0.22;
        notes.push(`Visible ${majorInterest} overlap`);
      } else {
        score += 0.05;
        notes.push(`Limited direct overlap with ${majorInterest}`);
      }

      if (competition) {
        const compRelevance = getCompetitionMajorRelevance(competition.activityId, majorInterest);
        if (compRelevance >= 0.85) {
          score += 0.22;
          notes.push(`${competition.activityId} is highly aligned to ${majorInterest}`);
        } else if (compRelevance >= 0.65) {
          score += 0.14;
          notes.push(`${competition.activityId} supports ${majorInterest}`);
        } else if (compRelevance >= 0.45) {
          score += 0.08;
          notes.push(`${competition.activityId} has partial relevance to ${majorInterest}`);
        }
      }

      const builderSignals = countHits(combined, [
        "research",
        "independent study",
        "prototype",
        "app",
        "algorithm",
        "dataset",
        "lab",
        "portfolio",
        "paper",
        "publication",
        "startup",
        "intern",
        "policy brief",
      ]);
      if (builderSignals > 0 && majorHits > 0) {
        score += Math.min(0.14, 0.05 * builderSignals);
        notes.push(`Output/build signals: ${builderSignals}`);
      }

      if (majorHits > 0) {
        if (years >= 3) {
          score += 0.16;
          notes.push("Sustained major-related depth over multiple years");
        } else if (years >= 2) {
          score += 0.1;
          notes.push("Major-related work sustained beyond one year");
        }
        if (lifetimeHours >= 300) {
          score += 0.08;
          notes.push("Meaningful time investment in major-related work");
        }
      }

      if (majorHits > 0 && leadership >= 0.45) {
        score += 0.08;
        notes.push("Leadership reinforces the major story");
      }
      if (majorHits > 0 && Math.max(achievement, prestige) >= 0.45) {
        score += 0.1;
        notes.push("External validation reinforces the spike");
      }

      const numeric = extractNumericImpact(combined);
      if (majorHits > 0 && (numeric.people >= 100 || numeric.dollars >= 1000)) {
        score += 0.05;
        notes.push("Major-related work shows real-world reach");
      }

      return { score: clamp01(score), reasoning: notes, source: "heuristic" };
    },
  });
  const major_spike = clamp01(Number(majorSpikeResult.score));
  reasoning.major_spike = Array.isArray(majorSpikeResult.reasoning)
    ? majorSpikeResult.reasoning
    : [];

  // ─── 5. Narrative fit ───
  const narrativeTextForScore = truncate(`${desc}\n${fileNorm}`, MAX_EC_TEXT_CHARS);
  const narrativeFitCached = await computeWithCache({
    factor: "narrative_fit",
    ragStmts,
    inputs: {
      ecName: ecNameForCache,
      ecHash: crypto.createHash("sha256").update(narrativeTextForScore).digest("hex"),
      narrativeHash: narrativeHash || null,
      themesHash: crypto.createHash("sha256").update(JSON.stringify(narrativeThemes || [])).digest("hex"),
    },
    compute: async () => {
      const result = await scoreNarrativeFit({
        narrative,
        narrativeThemes,
        narrativeHash,
        ecText: narrativeTextForScore,
        llmClient,
      });
      return {
        score: round2(result.score),
        reasoning: result,
        source: result.source || "computed",
      };
    },
  });
  const narrative_fit = round2(narrativeFitCached.score);
  reasoning.narrative_fit = narrativeFitCached.reasoning || { source: narrativeFitCached.source };
  reasoning.narrative_fit.component_cache_hit = Boolean(narrativeFitCached.cacheHit);

  const factors = {
    dedication: round2(dedication),
    achievement: round2(achievement),
    leadership: round2(leadership),
    prestige: round2(prestige),
    major_spike: round2(major_spike),
    narrative_fit,
  };

  const tier_label = computeTierLabel(factors);

  return {
    factors,
    tier_label,
    reasoning,
    lifetime_hours: round2(lifetimeHours),
    prestige_source,
    narrative_version_id: narrativeId || null,
  };
}

// ─── Benchmark lookup helper ────────────────────────────────
/**
 * Build a qualifier_level-shaped descriptor from detectCompetitiveActivity
 * output. Returns the object consumed by researchCompetitionPrestige — must
 * carry a `prestige_score` key for the short-circuit to fire. When no seeded
 * level matches, returns null and the prestige path falls through to web
 * research.
 */
function resolveBenchmarkHit({ combined, competition }) {
  if (!competition) return null;

  // Map competition.activityId → the matching baseline row and pick the
  // qualifier_level at the resolved levelIndex (or the closest available).
  const row = COMPETITIVE_ACTIVITY_BENCHMARKS.find(
    (r) => r.activity_id === competition.activityId,
  );
  if (!row || !Array.isArray(row.qualifier_levels)) return null;

  const idx = Math.min(
    Math.max(0, Number(competition.levelIndex) || 0),
    row.qualifier_levels.length - 1,
  );
  const q = row.qualifier_levels[idx];
  if (!q || typeof q.prestige_score !== "number") return null;

  return {
    activity_id: row.activity_id,
    level: q.level,
    selectivity: q.selectivity,
    admissions_weight: q.admissions_weight,
    prestige_score: q.prestige_score,
  };
}

// ─── Narrative fit scoring (hybrid) ─────────────────────────
/**
 * Keyword-first. LLM fallback only if keyword overlap is inconclusive
 * AND the EC text is long enough to be worth a second opinion.
 */
export async function scoreNarrativeFit({
  narrative,
  narrativeThemes,
  narrativeHash,
  ecText,
  llmClient,
}) {
  if (!narrative || !Array.isArray(narrativeThemes) || narrativeThemes.length === 0) {
    return {
      score: 0.2,
      source: "no_narrative",
      reason: "No active narrative — neutral baseline.",
      matched_themes: [],
      llm_cached: false,
    };
  }

  const ecLower = normalizeText(ecText || "");
  const matched = [];
  let hitSum = 0;
  let thetaMax = 0;
  for (const t of narrativeThemes) {
    if (!t?.theme) continue;
    const theme = String(t.theme).toLowerCase().trim();
    if (!theme) continue;
    const w = Number(t.weight || 0.5);
    if (w > thetaMax) thetaMax = w;
    if (ecLower.includes(theme)) {
      matched.push({ theme, weight: w });
      hitSum += w;
    }
  }

  const denominator = Math.max(1.5, thetaMax * 0.4);
  const overlapScore = clamp01(hitSum / denominator);
  const distinctMatches = new Set(matched.map((m) => m.theme)).size;

  const shouldAcceptKeyword = distinctMatches >= 2 || ecLower.length < 200;
  if (shouldAcceptKeyword) {
    return {
      score: round2(overlapScore),
      source: "keyword",
      reason: distinctMatches >= 2
        ? `Matched ${distinctMatches} narrative themes via keyword overlap.`
        : "EC text too short for LLM fallback — using keyword score.",
      matched_themes: matched.map((m) => m.theme).slice(0, 10),
      llm_cached: false,
    };
  }

  // Inconclusive — call Haiku if available
  if (llmClient && typeof llmClient.call === "function") {
    try {
      const ecHash = hashText(ecText);
      const llmResult = await llmClient.call({
        narrative,
        ecText,
        narrativeHash: narrativeHash || hashText(narrative),
        ecTextHash: ecHash,
      });
      if (llmResult && Number.isFinite(llmResult.score)) {
        return {
          score: round2(clamp01(llmResult.score)),
          source: "llm",
          reason: String(llmResult.reason || "").slice(0, 240),
          matched_themes: matched.map((m) => m.theme).slice(0, 10),
          llm_cached: Boolean(llmResult.cached),
        };
      }
    } catch {
      // fall through to keyword fallback below
    }
  }

  // LLM unavailable / failed — fall back to keyword overlap with a small floor
  return {
    score: round2(Math.max(overlapScore, 0.1)),
    source: "keyword_llm_fallback",
    reason: "LLM unavailable; using keyword overlap with conservative floor.",
    matched_themes: matched.map((m) => m.theme).slice(0, 10),
    llm_cached: false,
  };
}

// ─── Tier label (rules-based, 5-factor) ─────────────────────
/**
 * @param {{dedication:number, achievement:number, leadership:number,
 *   prestige:number, major_spike:number, narrative_fit:number}} v
 * @returns {string} one of TIERS
 */
export function computeTierLabel(v) {
  const ded = Number(v?.dedication || 0);
  const ach = Number(v?.achievement || 0);
  const lea = Number(v?.leadership || 0);
  const pre = Number(v?.prestige || 0);
  const fit = Number(v?.narrative_fit || 0);
  const spike = Number(v?.major_spike ?? fit ?? 0);
  const arr = [ded, ach, lea, pre, spike, fit];

  // tier_1: all ≥ 0.75  OR  any ≥ 0.90 with ≥ 3 others ≥ 0.70 AND prestige ≥ 0.70.
  if (arr.every((x) => x >= 0.75)) return TIERS.TIER_1;
  const anchorIdx = arr.findIndex((x) => x >= 0.9);
  if (anchorIdx >= 0) {
    const othersHigh = arr.filter((x, i) => i !== anchorIdx && x >= 0.7).length;
    if (othersHigh >= 4 && pre >= 0.6 && spike >= 0.65) return TIERS.TIER_1;
  }

  const countAbove = (thr) => arr.filter((x) => x >= thr).length;

  // tier_2: at least 3 of 5 ≥ 0.60 AND all ≥ 0.40 AND prestige ≥ 0.40.
  if (countAbove(0.6) >= 3 && arr.every((x) => x >= 0.35) && pre >= 0.35 && spike >= 0.35) {
    return TIERS.TIER_2;
  }

  // tier_3: at least 2 of 5 ≥ 0.50 AND no factor < 0.20.
  if (countAbove(0.5) >= 2 && arr.every((x) => x >= 0.2) && Math.max(spike, fit, ach) >= 0.45) {
    return TIERS.TIER_3;
  }

  return TIERS.TIER_4;
}

// ─── Batch recompute ────────────────────────────────────────
/**
 * @param {object} stmts - prepareECStrengthStatements output
 * @param {string} studentId
 * @param {object} params
 * @param {Array}  params.activities
 * @param {string} [params.narrative]
 * @param {Array}  [params.narrativeThemes]
 * @param {string} [params.narrativeHash]
 * @param {string} [params.narrativeId]
 * @param {string} [params.majorInterest]
 * @param {object} [params.llmClient]
 * @returns {Promise<{count:number, vectors:Array}>}
 */
export async function recomputeStudentECStrengthVectors(stmts, studentId, {
  activities = [],
  narrative = null,
  narrativeThemes = [],
  narrativeHash = null,
  narrativeId = null,
  majorInterest = null,
  llmClient = null,
  prestigeAdapter = null,
  ragStmts = null,
} = {}) {
  const existingRows = stmts.getByStudent.all(studentId);
  const existingByName = new Map(existingRows.map((r) => [r.ec_name, r]));
  const seen = new Set();
  const results = [];

  for (const ec of activities) {
    if (!ec?.name) continue;
    seen.add(ec.name);

    // Pull attached file text
    const attachments = stmts.getAttachmentsForEC.all(studentId, ec.name) || [];
    const fileText = concatAttachmentText(attachments, MAX_COMBINED_FILE_CHARS);
    const fileRefs = attachments.map((a) => a.id);

    const computed = await vectorizeECStrength({
      ec,
      description: ec.description,
      fileText,
      narrative,
      narrativeThemes,
      narrativeHash,
      narrativeId,
      majorInterest,
      llmClient,
      prestigeAdapter,
      ragStmts,
    });

    // Apply overrides (pin per-factor values) and recompute tier label
    const prev = existingByName.get(ec.name);
    let factors = computed.factors;
    let prestige_source = computed.prestige_source || "unavailable";
    let isOverridden = 0;
    let overrideJson = null;
    if (prev && prev.is_overridden) {
      isOverridden = 1;
      overrideJson = prev.override_json || null;
      const overrides = safeJSON(overrideJson, {}) || {};
      factors = {
        dedication: overrides.dedication ?? factors.dedication,
        achievement: overrides.achievement ?? factors.achievement,
        leadership: overrides.leadership ?? factors.leadership,
        prestige: overrides.prestige ?? factors.prestige,
        major_spike: overrides.major_spike ?? factors.major_spike,
        narrative_fit: overrides.narrative_fit ?? factors.narrative_fit,
      };
      if (overrides.prestige !== undefined) prestige_source = "override";
    }
    const tier_label = computeTierLabel(factors);

    const id = prev?.id || crypto.randomUUID();
    stmts.upsert.run(
      id, studentId, ec.name, ec.description || null,
      factors.dedication, factors.achievement, factors.leadership,
      factors.prestige, prestige_source, factors.major_spike,
      factors.narrative_fit,
      tier_label,
      Number(ec.hoursPerWeek || 0) || null,
      Number(ec.weeksPerYear || 0) || null,
      Number(ec.yearsOfParticipation || ec.years || 0) || null,
      computed.lifetime_hours,
      isOverridden, overrideJson,
      JSON.stringify(computed.reasoning),
      JSON.stringify(fileRefs),
      narrativeId || null,
    );

    results.push({
      id, ecName: ec.name, factors, tier_label,
      prestigeSource: prestige_source,
      reasoning: computed.reasoning,
      lifetimeHours: computed.lifetime_hours,
      isOverridden: Boolean(isOverridden),
      fileRefs,
    });
  }

  // Remove strength rows for ECs the student deleted
  for (const row of existingRows) {
    if (!seen.has(row.ec_name)) {
      stmts.deleteByStudentAndName.run(studentId, row.ec_name);
    }
  }

  return { count: results.length, vectors: results };
}

/**
 * Pin one or more factors for a given EC. Overrides survive subsequent
 * automatic recomputes; the tier label is recomputed from the merged
 * (override + fresh) vector.
 */
export function applyStrengthOverride(stmts, studentId, ecName, overrides = {}) {
  const existing = stmts.getByStudentAndName.get(studentId, ecName);
  if (!existing) {
    throw new Error(`No strength vector for student=${studentId} ec_name=${ecName}`);
  }

  const merged = {
    dedication: overrides.dedication ?? existing.dedication,
    achievement: overrides.achievement ?? existing.achievement,
    leadership: overrides.leadership ?? existing.leadership,
    prestige: overrides.prestige ?? existing.prestige,
    major_spike: overrides.major_spike ?? existing.major_spike,
    narrative_fit: overrides.narrative_fit ?? existing.narrative_fit,
  };
  const tier = computeTierLabel(merged);

  // Normalize to {factor: value} snapshot of pinned values.
  // Only include factors the caller pinned; preserve prior overrides.
  const prior = safeJSON(existing.override_json, {}) || {};
  const next = { ...prior };
  for (const k of STRENGTH_FACTORS) {
    if (overrides[k] !== undefined) next[k] = clamp01(Number(overrides[k]));
  }

  const prestigeOverride =
    overrides.prestige !== undefined ? clamp01(Number(overrides.prestige)) : null;

  stmts.applyOverride.run(
    overrides.dedication !== undefined ? clamp01(Number(overrides.dedication)) : null,
    overrides.achievement !== undefined ? clamp01(Number(overrides.achievement)) : null,
    overrides.leadership !== undefined ? clamp01(Number(overrides.leadership)) : null,
    prestigeOverride,
    prestigeOverride,                           // flags prestige_source = 'override'
    overrides.major_spike !== undefined ? clamp01(Number(overrides.major_spike)) : null,
    overrides.narrative_fit !== undefined ? clamp01(Number(overrides.narrative_fit)) : null,
    tier,
    JSON.stringify(next),
    studentId, ecName,
  );

  return {
    factors: merged,
    tier_label: tier,
    overrideJson: next,
  };
}

// ─── Default LLM client factory ─────────────────────────────
/**
 * Binds the module-level narrative-fit LLM shim to prepared cache
 * statements. Returns an object with shape { call({...}) => Promise }.
 *
 * `options` is forwarded verbatim to callHaikuForNarrativeFit — callers
 * that want narrative-fit to run against the student's BYOK key instead
 * of the operator's server key should pass a `byokLookup` callback:
 *
 *   buildDefaultLLMClient(cacheStmts, {
 *     byokLookup: () => lookupStudentBYOK(piiStmts, studentId),
 *   })
 *
 * The lookup runs lazily per-call so BYOK key rotations take effect
 * without rebuilding the client.
 */
export function buildDefaultLLMClient(cacheStmts, options = {}) {
  if (!cacheStmts) return null;
  const client = {
    async call({ narrative, ecText, narrativeHash, ecTextHash }) {
      return callHaikuForNarrativeFit({
        narrative, ecText, narrativeHash, ecTextHash,
        stmts: cacheStmts,
        options,
      });
    },
  };

  // Optional: if the caller passes `prestigeAdapter` + `ragStmts`, expose a
  // prestige() method so vectorizeECStrength can invoke it the same way it
  // invokes narrative-fit. When either is absent, the caller should pass the
  // adapter/stmts directly to vectorizeECStrength via the prestigeAdapter /
  // ragStmts params and we skip wiring a method here.
  if (options.prestigeAdapter && options.ragStmts) {
    client.prestige = async ({ activityName, levelHint, benchmarkHit }) => {
      return researchCompetitionPrestige({
        activityName,
        levelHint,
        benchmarkHit,
        stmts: options.ragStmts,
        adapter: options.prestigeAdapter,
        options: { fetchImpl: options.fetchImpl },
      });
    };
  }

  return client;
}

// ─── Component cache helper ─────────────────────────────────
/**
 * Uniform write-through cache helper for the five per-factor computes. The
 * cache key is sha256(factor || "|" || JSON.stringify(inputs)) — stable as
 * long as the caller passes its inputs with a deterministic key order.
 *
 * `compute()` must resolve to { score, reasoning?, source?, provider?, model? }
 * where reasoning is any JSON-serializable diagnostic payload.
 *
 * Returns { score, reasoning, source, cacheHit }. When ragStmts is missing
 * (tests with no DB), compute runs uncached and we return cacheHit=false.
 */
export async function computeWithCache({ factor, inputs, compute, ragStmts }) {
  const inputSig = JSON.stringify(inputs ?? {});
  if (!ragStmts || typeof ragStmts.getComponentCache?.get !== "function") {
    const res = await compute();
    return { ...res, cacheHit: false };
  }
  const key = crypto
    .createHash("sha256")
    .update(`${factor}|${inputSig}`)
    .digest("hex");
  const hit = ragStmts.getComponentCache.get(key);
  if (hit) {
    return {
      score: Number(hit.score),
      reasoning: safeJSON(hit.reasoning_json, null),
      source: hit.source,
      provider: hit.provider || null,
      model: hit.model || null,
      cacheHit: true,
    };
  }
  const res = await compute();
  try {
    ragStmts.upsertComponentCache?.run(
      key,
      factor,
      Number(res.score) || 0,
      JSON.stringify(res.reasoning ?? null),
      res.source || "computed",
      res.provider || null,
      res.model || null,
      String(inputSig).slice(0, 500),
    );
  } catch {
    // Cache write is non-fatal.
  }
  return { ...res, cacheHit: false };
}

// ─── Helpers ───────────────────────────────────────────────
export function isValidTier(label) {
  return TIER_SET.has(String(label));
}

function truncate(text, max) {
  const s = String(text || "");
  if (s.length <= max) return s;
  return s.slice(0, max);
}

function concatAttachmentText(rows, cap) {
  if (!Array.isArray(rows) || rows.length === 0) return "";
  const chunks = [];
  let total = 0;
  for (const r of rows) {
    const t = String(r?.extracted_text || "");
    if (!t) continue;
    if (total + t.length > cap) {
      chunks.push(t.slice(0, cap - total));
      break;
    }
    chunks.push(t);
    total += t.length;
  }
  return chunks.join("\n\n---\n\n");
}

function safeJSON(v, fallback) {
  if (!v) return fallback;
  if (typeof v !== "string") return v;
  try {
    const p = JSON.parse(v);
    return p ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Public-shape renderer for API responses — no PII, just numeric/categorical.
 */
export function toPublicShape(row) {
  if (!row) return null;
  return {
    id: row.id,
    ecName: row.ec_name,
    factors: {
      dedication: row.dedication,
      achievement: row.achievement,
      leadership: row.leadership,
      prestige: row.prestige ?? 0,
      major_spike: row.major_spike ?? 0,
      narrative_fit: row.narrative_fit,
    },
    tierLabel: row.tier_label,
    prestigeSource: row.prestige_source || "legacy",
    lifetimeHours: row.lifetime_hours,
    hoursPerWeek: row.hours_per_week,
    weeksPerYear: row.weeks_per_year,
    yearsActive: row.years_active,
    isOverridden: Boolean(row.is_overridden),
    fileRefs: safeJSON(row.file_refs_json, []),
    narrativeVersionId: row.narrative_version_id || null,
    updatedAt: row.updated_at,
  };
}

export function projectStrengthToLegacyVector(factors = {}) {
  const dedication = clamp01(Number(factors.dedication || 0));
  const achievement = clamp01(Number(factors.achievement || 0));
  const leadership = clamp01(Number(factors.leadership || 0));
  const prestige = clamp01(Number(factors.prestige || 0));
  const majorSpike = clamp01(Number(factors.major_spike || 0));
  const narrativeFit = clamp01(Number(factors.narrative_fit || 0));

  const vector = {
    impact_and_scope: round2(clamp01((achievement * 0.55) + (leadership * 0.2) + (prestige * 0.25))),
    leadership_and_initiative: round2(leadership),
    passion_and_consistency: round2(dedication),
    talents_and_awards: round2(clamp01((achievement * 0.6) + (prestige * 0.4))),
    relevance_to_intended_major: round2(clamp01((majorSpike * 0.8) + (narrativeFit * 0.2))),
  };

  const composite =
    (vector.impact_and_scope * 0.22) +
    (vector.leadership_and_initiative * 0.22) +
    (vector.passion_and_consistency * 0.22) +
    (vector.talents_and_awards * 0.18) +
    (vector.relevance_to_intended_major * 0.16);

  let label = "early_stage";
  if (composite >= 0.8) label = "exceptional";
  else if (composite >= 0.65) label = "strong";
  else if (composite >= 0.45) label = "developing";
  else if (composite >= 0.25) label = "emerging";

  return {
    vector,
    composite: round2(composite),
    label,
  };
}

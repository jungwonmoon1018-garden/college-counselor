// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??// RAG ENGINE ??Retrieval-Augmented Generation (redesigned)
// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??// REDESIGNED: Small-context retrieval, no PII in context, rules-first.
//
// Changes from original:
//   - Student PII lives in pii-vault.js, NOT here
//   - BYOK / API key management moved to pii-vault.js
//   - Percentile computation delegates to rules-engine.js
//   - Context assembly returns structured summaries (100-200 tokens)
//     instead of raw data dumps
//   - Only latest snapshot by default (history only when trends requested)
//   - Student identity replaced with [STUDENT] placeholder in context
//   - Baseline tables remain here (operational data, not PII)
// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??
import crypto from "node:crypto";
import { computePercentile, computeAPRigorIndex } from "./rules-engine.js";
import { getCollegeHistory, summarizeCollegeHistory } from "./college-scorecard.js";
import {
  initDirectionalityTable,
  prepareDirectionalityStatements,
  recomputeStudentDirectionality,
} from "./ec-vectorizer.js";
import {
  initAPConceptTables,
  prepareAPConceptStatements,
  seedAPConceptCatalog,
  processStudentInputForConcepts,
  recomputeAllSubjectVectors,
} from "./ap-concept-vectorizer.js";
import {
  initECStrengthTables,
  prepareECStrengthStatements,
  recomputeStudentECStrengthVectors,
  buildDefaultLLMClient,
  toPublicShape as toStrengthPublicShape,
} from "./ec-strength-vectorizer.js";
import {
  initNarrativeTables,
  prepareNarrativeStatements,
  getActiveNarrative,
} from "./narrative-store.js";
import {
  initNarrativeFitCacheTable,
  prepareNarrativeFitCacheStatements,
} from "./narrative-fit-llm.js";

// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??// DATABASE SCHEMA ??operational tables (no PII)
// Database schema: operational tables (no PII)
export function initRAGTables(db) {
  db.exec(`
    -- Versioned profile snapshots (PII-free: student_id is opaque UUID)
    CREATE TABLE IF NOT EXISTS profile_snapshots (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      snapshot_type TEXT NOT NULL,
      gpa_unweighted REAL,
      gpa_weighted REAL,
      courses_json TEXT,
      ap_scores_json TEXT,
      test_scores_json TEXT,
      activities_json TEXT,
      major_interest TEXT,
      goals_json TEXT,
      trigger TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_snap_student ON profile_snapshots(student_id, created_at DESC);

    -- Milestone events (achievements, changes, progress markers)
    CREATE TABLE IF NOT EXISTS milestones (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      data_json TEXT,
      academic_year TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_mile_student ON milestones(student_id, created_at DESC);

    -- Capability timeline (numerical metrics over time for trend analysis)
    CREATE TABLE IF NOT EXISTS capability_timeline (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      metric TEXT NOT NULL,
      value REAL NOT NULL,
      percentile_national REAL,
      percentile_cohort REAL,
      computed_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cap_student ON capability_timeline(student_id, metric, computed_at DESC);

    -- Baseline: GPA distributions
    CREATE TABLE IF NOT EXISTS baseline_gpa (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      year INTEGER NOT NULL,
      percentile INTEGER NOT NULL,
      gpa_unweighted REAL,
      gpa_weighted REAL,
      source TEXT NOT NULL,
      UNIQUE(scope, year, percentile)
    );

    -- Baseline: SAT distributions
    CREATE TABLE IF NOT EXISTS baseline_sat (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      year INTEGER NOT NULL,
      percentile INTEGER NOT NULL,
      score INTEGER NOT NULL,
      source TEXT NOT NULL,
      UNIQUE(scope, year, percentile)
    );

    -- Baseline: ACT distributions
    CREATE TABLE IF NOT EXISTS baseline_act (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      year INTEGER NOT NULL,
      percentile INTEGER NOT NULL,
      score INTEGER NOT NULL,
      source TEXT NOT NULL,
      UNIQUE(scope, year, percentile)
    );

    -- Baseline: EC benchmarks
    CREATE TABLE IF NOT EXISTS baseline_ec (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      participation_pct REAL,
      avg_hours REAL,
      leadership_pct REAL,
      impact_tier INTEGER,
      target_major TEXT,
      source TEXT,
      data_year INTEGER,
      UNIQUE(category, target_major, data_year)
    );

    -- Baseline: Expanded college profiles
    CREATE TABLE IF NOT EXISTS baseline_colleges (
      unit_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      state TEXT,
      sat_25 INTEGER, sat_75 INTEGER,
      act_25 INTEGER, act_75 INTEGER,
      acceptance_rate REAL,
      enrollment INTEGER,
      tuition_in INTEGER, tuition_out INTEGER,
      avg_gpa_admitted REAL,
      ap_courses_valued_json TEXT,
      top_majors_json TEXT,
      ec_emphasis_json TEXT,
      yield_rate REAL,
      retention_rate REAL,
      grad_rate_6yr REAL,
      median_earnings_10yr INTEGER,
      data_year INTEGER,
      source TEXT DEFAULT 'NCES IPEDS'
    );

    -- API usage log (per-student, per-call tracking ??no PII, just opaque IDs)
    CREATE TABLE IF NOT EXISTS api_usage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      key_source TEXT NOT NULL DEFAULT 'shared',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_usage_student ON api_usage_log(student_id, created_at DESC);

    -- ─── Chat history (multi-thread per student) ────────────────────────
    CREATE TABLE IF NOT EXISTS chat_threads (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      title TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      message_count INTEGER DEFAULT 0,
      archived_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_threads_student ON chat_threads(student_id, archived_at, updated_at DESC);

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
      content TEXT NOT NULL,
      attachment_name TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_messages_thread ON chat_messages(thread_id, id);
    CREATE INDEX IF NOT EXISTS idx_messages_content_search ON chat_messages(thread_id);

    -- ─── College core values cache ──────────────────────────────────────
    -- Once a student asks about "Stanford" once, we extract Stanford's
    -- stated values from its official admissions/about page and cache
    -- them for everyone. TTL: 90 days.
    CREATE TABLE IF NOT EXISTS college_values (
      slug TEXT PRIMARY KEY,                 -- normalized lower-case
      display_name TEXT NOT NULL,
      source_url TEXT,
      values_json TEXT NOT NULL,             -- [{theme, summary, evidence}]
      extracted_at TEXT DEFAULT (datetime('now')),
      extracted_by_student_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_values_extracted ON college_values(extracted_at DESC);

    -- Competitive activity benchmarks (granular, with qualifier levels)
    CREATE TABLE IF NOT EXISTS baseline_ec_competitive (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_id TEXT NOT NULL,
      activity_name TEXT NOT NULL,
      category TEXT NOT NULL,
      participation_rate REAL,
      source TEXT,
      data_year INTEGER,
      target_majors_json TEXT,
      qualifier_levels_json TEXT,
      keywords_json TEXT,
      UNIQUE(activity_id, data_year)
    );
    CREATE INDEX IF NOT EXISTS idx_ec_comp_category ON baseline_ec_competitive(category);
    CREATE INDEX IF NOT EXISTS idx_ec_comp_activity ON baseline_ec_competitive(activity_id);

    -- ?? College Scorecard live cache ??????????????????????????????????????????
    -- Stores the most recent full normalized school record from the Scorecard
    -- API. Keyed by unit_id. Refreshed if older than 7 days.
    CREATE TABLE IF NOT EXISTS scorecard_cache (
      unit_id    TEXT PRIMARY KEY,
      name       TEXT,
      data_json  TEXT NOT NULL,
      fetched_at TEXT DEFAULT (datetime('now'))
    );

    -- Generic query cache for repeated Scorecard requests whose cache key is
    -- not just a single unit_id (search filters, compare matrices, aid views).
    CREATE TABLE IF NOT EXISTS scorecard_query_cache (
      cache_key   TEXT PRIMARY KEY,
      cache_kind  TEXT NOT NULL,
      query_json  TEXT NOT NULL,
      data_json   TEXT NOT NULL,
      fetched_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_scorecard_query_kind ON scorecard_query_cache(cache_kind, fetched_at DESC);

    -- ?? College Scorecard historical data ?????????????????????????????????????
    -- One row per school per academic-year label (e.g. 2019 = AY 2019-2020).
    -- Populated on demand when a student's goal list includes a school with a
    -- known unitId. The AI context pipeline reads these rows to surface
    -- multi-year admission-rate and cost trends for each target school.
    CREATE TABLE IF NOT EXISTS scorecard_history (
      unit_id         TEXT    NOT NULL,
      year            INTEGER NOT NULL,
      name            TEXT,
      admission_rate  REAL,    -- percent (e.g. 8.4 means 8.4%)
      sat_25          INTEGER, -- combined CR+Math 25th pctile
      sat_75          INTEGER, -- combined CR+Math 75th pctile
      act_25          INTEGER,
      act_75          INTEGER,
      tuition_in      INTEGER,
      tuition_out     INTEGER,
      avg_net_price   INTEGER,
      enrollment      INTEGER,
      grad_rate       REAL,    -- percent
      median_earnings INTEGER,
      fetched_at      TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (unit_id, year)
    );
    CREATE INDEX IF NOT EXISTS idx_scorecard_hist_unit ON scorecard_history(unit_id, year DESC);

    -- ?? EC prestige research cache ?????????????????????????????????????????
    -- Stores prestige scores produced by the competition-research module.
    -- Keyed by sha256(normalizedActivityName || "|" || levelHint). TTL = 30d.
    -- source is one of "benchmark" | "catalog" | "research" | "research_failed".
    CREATE TABLE IF NOT EXISTS ec_prestige_cache (
      cache_key      TEXT PRIMARY KEY,
      activity_name  TEXT,
      level_hint     TEXT,
      score          REAL NOT NULL,
      rationale      TEXT,
      sources_json   TEXT,
      source         TEXT,
      provider       TEXT,
      model          TEXT,
      result_json    TEXT,
      created_at     TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ec_prestige_activity ON ec_prestige_cache(activity_name);

    -- ?? EC subvector component cache (all 5 factors) ???????????????????????
    -- Write-through cache for dedication/achievement/leadership/prestige/
    -- narrative_fit components. Keyed by sha256(factor || "|" || inputSig)
    -- so the per-factor recompute path short-circuits when inputs match.
    CREATE TABLE IF NOT EXISTS ec_component_cache (
      cache_key      TEXT PRIMARY KEY,
      factor         TEXT NOT NULL,
      score          REAL NOT NULL,
      reasoning_json TEXT,
      source         TEXT,
      provider       TEXT,
      model          TEXT,
      input_sig      TEXT NOT NULL,
      created_at     TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ec_component_cache_factor ON ec_component_cache(factor);

    -- Student-entered deadlines (F7 from Jiyeon UX audit). The backend
    -- already knows generic admissions dates (data/admissions-deadlines.json)
    -- but a scared kid also tracks personal milestones: "finish MIT essay",
    -- "mail certificate to dad", "AP BioChem registration". Those live here.
    CREATE TABLE IF NOT EXISTS student_deadlines (
      id           TEXT PRIMARY KEY,
      student_id   TEXT NOT NULL,
      title        TEXT NOT NULL,
      due_at       TEXT NOT NULL,           -- ISO-8601 date or datetime
      category     TEXT DEFAULT 'personal', -- personal | admissions | financial_aid | test | other
      notes        TEXT,
      college_ids_json TEXT,                -- optional list of unit_ids this deadline pertains to
      status       TEXT DEFAULT 'open',     -- open | done | snoozed
      created_at   TEXT DEFAULT (datetime('now')),
      updated_at   TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_student_deadlines_student ON student_deadlines(student_id, due_at);
    CREATE INDEX IF NOT EXISTS idx_student_deadlines_status  ON student_deadlines(student_id, status);

    -- ─── Common Data Set records (school-level CDS ground truth) ─────
    -- Persists a fully-parsed + validated CDS record per institution,
    -- keyed by slug (e.g. "princeton-university"). The positioning engine
    -- reads from this table for school-level signals: admit rate, SAT/ACT
    -- bands, GPA bands, C7 factor importance ratings, test policy.
    --
    -- Provenance: cds-search.js + cds-pdf-parser.js fetch and parse the PDF;
    -- cds-validator.js cross-checks against authoritative sources and
    -- writes overrides into cds_validations rather than mutating the
    -- record itself, so the ingestion path stays auditable.
    CREATE TABLE IF NOT EXISTS cds_records (
      slug                TEXT PRIMARY KEY,
      school_name         TEXT NOT NULL,
      year_label          TEXT,                 -- "2023-24"
      year                INTEGER,              -- 2024 (calendar year of CDS reporting)
      tier                TEXT,                 -- T20 | Sub-Ivy | T50 | T100 | LAC | Other
      overall_admit_rate  REAL,
      yield_rate          REAL,
      enrolled_sat_p25    INTEGER,
      enrolled_sat_p75    INTEGER,
      enrolled_act_p25    INTEGER,
      enrolled_act_p75    INTEGER,
      enrolled_gpa_p25    REAL,
      enrolled_gpa_p75    REAL,
      test_policy         TEXT,                 -- test_required | test_optional | test_blind
      c7_json             TEXT,                 -- {"gpa":"very_important",...}
      b1_json             TEXT,                 -- {"applied":...,"admitted":...,"enrolled":...}
      majors_json         TEXT,                 -- per-major capped/direct-admit overlays (CIP code level)
      priorities_json     TEXT,                 -- institutional strategic priorities for fit-bonus
      source_url          TEXT,                 -- URL of the original CDS PDF
      source_kind         TEXT,                 -- pdf_text | pdf_form | pdf_merged | xlsx
      parser_version      INTEGER DEFAULT 1,
      parser_notes_json   TEXT,
      ingested_at         TEXT DEFAULT (datetime('now')),
      updated_at          TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cds_records_tier ON cds_records(tier);
    CREATE INDEX IF NOT EXISTS idx_cds_records_admit ON cds_records(overall_admit_rate);

    -- ─── CDS validation log ─────────────────────────────────────────
    -- Append-only history of every validation pass: discrepancies found,
    -- overrides applied, ground-truth source URLs. The latest row per
    -- slug is what cds-validator.js::loadValidatedRecord() consults
    -- before returning a record to the positioning engine.
    --
    -- Severity vocabulary:
    --   critical → scope mismatch (PDF is for wrong institution)
    --   high     → admit-rate drift > 0.5pp, SAT mis-parse, parser miss
    --   medium   → SAT band drift 30-60 points, GPA band drift
    --   low      → cosmetic / metadata drift
    CREATE TABLE IF NOT EXISTS cds_validations (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      slug            TEXT NOT NULL,
      status          TEXT NOT NULL,            -- ok | discrepancies | scope_mismatch | no_truth
      scope_from_pdf  TEXT,
      discrepancies_json TEXT,                  -- [{severity,field,parsed,expected,note}]
      overrides_json     TEXT,                  -- {overallAdmitRate,enrolledSAT,...}
      sources_json       TEXT,                  -- ground-truth URLs cited
      validated_at    TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cds_validations_slug ON cds_validations(slug, validated_at);
  `);

  // ─── Additive migrations on cds_records (idempotent) ─────────────
  // Columns added after the initial release land here so existing
  // SQLite files upgrade without manual intervention. Pattern mirrors
  // ec-strength-vectorizer.js::initECStrengthTables.
  try {
    const cdsCols = db.prepare(`PRAGMA table_info(cds_records)`).all().map((r) => r.name);
    if (!cdsCols.includes("enrolled_gpa_avg")) {
      db.exec(`ALTER TABLE cds_records ADD COLUMN enrolled_gpa_avg REAL`);
    }
    if (!cdsCols.includes("c1_breakdown_json")) {
      db.exec(`ALTER TABLE cds_records ADD COLUMN c1_breakdown_json TEXT`);
    }
  } catch (err) {
    console.warn("[RAG] cds_records migration warning:", err.message);
  }

  // Directionality vectors (overall academic trajectory and fit)
  initDirectionalityTable(db);

  // AP concept components ??subject vectors are decomposed into weighted
  // concept components. LAZY-populated: rows appear only once the student's
  // own prompts/files reference the subject. See ap-concept-vectorizer.js.
  initAPConceptTables(db);

  // Unified EC strength vectors + uploaded attachment metadata.
  initECStrengthTables(db);

  // Student self-written narratives (versioned). Feeds the narrative_fit
  // factor of the 4-factor strength vector.
  initNarrativeTables(db);

  // Haiku-backed narrative_fit LLM cache (only hit when keyword overlap
  // is inconclusive).
  initNarrativeFitCacheTable(db);
}


// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??// SEED BASELINE DATA
export function seedBaselines(db, { GPA_BASELINES, SAT_BASELINES, ACT_BASELINES, EC_BENCHMARKS, COLLEGE_PROFILES, COMPETITIVE_ACTIVITY_BENCHMARKS }) {
  const normalizeRate = (value) => {
    if (value == null || value === "") return null;
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return num > 1 ? num / 100 : num;
  };

  const tx = db.transaction(() => {
    const gpaStmt = db.prepare(`INSERT OR REPLACE INTO baseline_gpa (scope, year, percentile, gpa_unweighted, gpa_weighted, source) VALUES (?,?,?,?,?,?)`);
    for (const g of GPA_BASELINES) gpaStmt.run(g.scope, g.year, g.percentile, g.gpa_unweighted, g.gpa_weighted, g.source);

    const satStmt = db.prepare(`INSERT OR REPLACE INTO baseline_sat (scope, year, percentile, score, source) VALUES (?,?,?,?,?)`);
    for (const s of SAT_BASELINES) satStmt.run(s.scope, s.year, s.percentile, s.score, s.source);

    const actStmt = db.prepare(`INSERT OR REPLACE INTO baseline_act (scope, year, percentile, score, source) VALUES (?,?,?,?,?)`);
    for (const a of ACT_BASELINES) actStmt.run(a.scope, a.year, a.percentile, a.score, a.source);

    const ecStmt = db.prepare(`INSERT OR REPLACE INTO baseline_ec (category, participation_pct, avg_hours, leadership_pct, impact_tier, target_major, source, data_year) VALUES (?,?,?,?,?,?,?,?)`);
    for (const e of EC_BENCHMARKS) ecStmt.run(e.category, e.participation_pct, e.avg_hours, e.leadership_pct, e.impact_tier, e.target_major, e.source, e.year);

    const colStmt = db.prepare(`INSERT OR REPLACE INTO baseline_colleges (unit_id, name, state, sat_25, sat_75, act_25, act_75, acceptance_rate, enrollment, tuition_in, tuition_out, avg_gpa_admitted, ap_courses_valued_json, top_majors_json, ec_emphasis_json, yield_rate, retention_rate, grad_rate_6yr, median_earnings_10yr, data_year) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const c of COLLEGE_PROFILES) {
      colStmt.run(
        c.unitId, c.name, c.state, c.sat25, c.sat75, c.act25, c.act75,
        normalizeRate(c.acceptance), c.enrollment, c.tuitionIn, c.tuitionOut,
        c.avgGpaAdmitted,
        JSON.stringify(c.apCoursesValued || []),
        JSON.stringify(c.topMajors || []),
        JSON.stringify(c.ecEmphasis || []),
        normalizeRate(c.yieldRate), normalizeRate(c.retentionRate),
        normalizeRate(c.gradRate6yr), c.medianEarnings10yr, c.dataYear
      );
    }

    // Competitive activity benchmarks (granular)
    if (COMPETITIVE_ACTIVITY_BENCHMARKS?.length) {
      const compStmt = db.prepare(`INSERT OR REPLACE INTO baseline_ec_competitive (activity_id, activity_name, category, participation_rate, source, data_year, target_majors_json, qualifier_levels_json, keywords_json) VALUES (?,?,?,?,?,?,?,?,?)`);
      for (const c of COMPETITIVE_ACTIVITY_BENCHMARKS) {
        compStmt.run(c.activity_id, c.activity_name, c.category, c.participation_rate, c.source, c.year, JSON.stringify(c.target_majors), JSON.stringify(c.qualifier_levels), JSON.stringify(c.keywords));
      }
    }
  });
  tx();
  console.log(`[RAG] Baselines seeded: ${GPA_BASELINES.length} GPA, ${SAT_BASELINES.length} SAT, ${ACT_BASELINES.length} ACT, ${EC_BENCHMARKS.length} EC, ${COLLEGE_PROFILES.length} colleges, ${COMPETITIVE_ACTIVITY_BENCHMARKS?.length || 0} competitive`);
}


// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??// PREPARED STATEMENTS
export function prepareRAGStatements(db) {
  return {
    // Snapshots
    insertSnapshot: db.prepare(`INSERT INTO profile_snapshots (id, student_id, snapshot_type, gpa_unweighted, gpa_weighted, courses_json, ap_scores_json, test_scores_json, activities_json, major_interest, goals_json, trigger) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`),
    getLatestSnapshot: db.prepare(`SELECT * FROM profile_snapshots WHERE student_id = ? ORDER BY datetime(created_at) DESC, rowid DESC LIMIT 1`),
    getSnapshotHistory: db.prepare(`SELECT id, snapshot_type, gpa_unweighted, gpa_weighted, major_interest, trigger, created_at FROM profile_snapshots WHERE student_id = ? ORDER BY datetime(created_at) DESC, rowid DESC LIMIT ?`),

    // Milestones
    insertMilestone: db.prepare(`INSERT INTO milestones (id, student_id, type, title, data_json, academic_year) VALUES (?,?,?,?,?,?)`),
    getMilestones: db.prepare(`SELECT * FROM milestones WHERE student_id = ? ORDER BY created_at DESC LIMIT ?`),
    getMilestonesByType: db.prepare(`SELECT * FROM milestones WHERE student_id = ? AND type = ? ORDER BY created_at DESC LIMIT ?`),

    // Capability timeline
    insertCapability: db.prepare(`INSERT INTO capability_timeline (id, student_id, metric, value, percentile_national, percentile_cohort) VALUES (?,?,?,?,?,?)`),
    getLatestCapabilities: db.prepare(`SELECT DISTINCT metric, value, percentile_national, percentile_cohort, computed_at FROM capability_timeline WHERE student_id = ? AND computed_at = (SELECT MAX(computed_at) FROM capability_timeline c2 WHERE c2.student_id = capability_timeline.student_id AND c2.metric = capability_timeline.metric)`),
    getCapabilityTrend: db.prepare(`SELECT metric, value, percentile_national, computed_at FROM capability_timeline WHERE student_id = ? AND metric = ? ORDER BY computed_at ASC`),

    // Baselines
    getGPABaseline: db.prepare(`SELECT * FROM baseline_gpa WHERE scope = ? ORDER BY percentile ASC`),
    getSATBaseline: db.prepare(`SELECT * FROM baseline_sat WHERE scope = ? ORDER BY percentile ASC`),
    getACTBaseline: db.prepare(`SELECT * FROM baseline_act WHERE scope = ? ORDER BY percentile ASC`),
    getECBaseline: db.prepare(`SELECT * FROM baseline_ec WHERE target_major = ? OR target_major = 'General' ORDER BY impact_tier DESC`),
    getCollegeProfile: db.prepare(`SELECT * FROM baseline_colleges WHERE unit_id = ?`),
    searchColleges: db.prepare(`SELECT * FROM baseline_colleges ORDER BY acceptance_rate ASC`),
    getCollegesByState: db.prepare(`SELECT * FROM baseline_colleges WHERE state = ?`),

    // API usage log
    insertUsage: db.prepare(`INSERT INTO api_usage_log (student_id, model, input_tokens, output_tokens, key_source) VALUES (?,?,?,?,?)`),
    getUsageToday: db.prepare(`SELECT SUM(input_tokens) as input_total, SUM(output_tokens) as output_total, COUNT(*) as call_count FROM api_usage_log WHERE student_id = ? AND created_at >= datetime('now', '-24 hours')`),
    getUsageMonth: db.prepare(`SELECT SUM(input_tokens) as input_total, SUM(output_tokens) as output_total, COUNT(*) as call_count FROM api_usage_log WHERE student_id = ? AND created_at >= datetime('now', '-30 days')`),
    getUsageHistory: db.prepare(`SELECT date(created_at) as day, SUM(input_tokens) as input_total, SUM(output_tokens) as output_total, COUNT(*) as call_count, key_source FROM api_usage_log WHERE student_id = ? GROUP BY day, key_source ORDER BY day DESC LIMIT ?`),
    // Per-model rollup over the last 30 days — used by the budget tracker.
    getUsageHistoryByModel: db.prepare(`SELECT model, SUM(input_tokens) as input_total, SUM(output_tokens) as output_total FROM api_usage_log WHERE student_id = ? AND created_at >= datetime('now', '-30 days') GROUP BY model`),

    // ─── Chat threads ───
    createThread: db.prepare(`INSERT INTO chat_threads (id, student_id, title) VALUES (?, ?, ?)`),
    listThreads: db.prepare(`SELECT id, title, created_at, updated_at, message_count FROM chat_threads WHERE student_id = ? AND archived_at IS NULL ORDER BY updated_at DESC LIMIT ?`),
    getThread: db.prepare(`SELECT * FROM chat_threads WHERE id = ? AND student_id = ?`),
    updateThreadTitle: db.prepare(`UPDATE chat_threads SET title = ?, updated_at = datetime('now') WHERE id = ? AND student_id = ?`),
    touchThread: db.prepare(`UPDATE chat_threads SET updated_at = datetime('now'), message_count = message_count + ? WHERE id = ?`),
    archiveThread: db.prepare(`UPDATE chat_threads SET archived_at = datetime('now') WHERE id = ? AND student_id = ?`),
    deleteThreadHard: db.prepare(`DELETE FROM chat_threads WHERE id = ? AND student_id = ?`),
    deleteThreadMessages: db.prepare(`DELETE FROM chat_messages WHERE thread_id IN (SELECT id FROM chat_threads WHERE id = ? AND student_id = ?)`),
    insertMessage: db.prepare(`INSERT INTO chat_messages (thread_id, role, content, attachment_name) VALUES (?, ?, ?, ?)`),
    listMessages: db.prepare(`SELECT id, role, content, attachment_name, created_at FROM chat_messages WHERE thread_id = ? ORDER BY id ASC LIMIT ?`),
    searchMessages: db.prepare(`
      SELECT m.id, m.thread_id, m.role, m.content, m.created_at, t.title
      FROM chat_messages m JOIN chat_threads t ON m.thread_id = t.id
      WHERE t.student_id = ? AND t.archived_at IS NULL AND lower(m.content) LIKE lower(?)
      ORDER BY m.id DESC LIMIT 30
    `),

    // ─── College values ───
    getCollegeValues:    db.prepare(`SELECT slug, display_name, source_url, values_json, extracted_at FROM college_values WHERE slug = ?`),
    // Clear every cache entry this student created — used by the
    // /api/colleges/values DELETE endpoint. Leaves entries that were
    // extracted by other students untouched.
    deleteCollegeValuesByStudent: db.prepare(`DELETE FROM college_values WHERE extracted_by_student_id = ?`),
    upsertCollegeValues: db.prepare(`
      INSERT INTO college_values (slug, display_name, source_url, values_json, extracted_at, extracted_by_student_id)
      VALUES (?, ?, ?, ?, datetime('now'), ?)
      ON CONFLICT(slug) DO UPDATE SET
        display_name = excluded.display_name,
        source_url   = excluded.source_url,
        values_json  = excluded.values_json,
        extracted_at = datetime('now')
    `),

    // Competitive activity benchmarks
    getCompetitiveBenchmark: db.prepare(`SELECT * FROM baseline_ec_competitive WHERE activity_id = ?`),
    getAllCompetitiveBenchmarks: db.prepare(`SELECT * FROM baseline_ec_competitive ORDER BY activity_id`),

    // Scorecard live cache
    upsertScorecardCache:   db.prepare(`INSERT OR REPLACE INTO scorecard_cache (unit_id, name, data_json, fetched_at) VALUES (?,?,?,datetime('now'))`),
    getScorecardCache:      db.prepare(`SELECT * FROM scorecard_cache WHERE unit_id = ? AND fetched_at >= datetime('now','-7 days')`),
    getScorecardCacheAny:   db.prepare(`SELECT * FROM scorecard_cache WHERE unit_id = ?`),
    upsertScorecardQueryCache: db.prepare(`INSERT OR REPLACE INTO scorecard_query_cache (cache_key, cache_kind, query_json, data_json, fetched_at) VALUES (?,?,?,?,datetime('now'))`),
    getScorecardQueryCache:    db.prepare(`SELECT * FROM scorecard_query_cache WHERE cache_key = ? AND fetched_at >= datetime('now','-7 days')`),
    getScorecardQueryCacheAny: db.prepare(`SELECT * FROM scorecard_query_cache WHERE cache_key = ?`),
    deleteScorecardQueryCacheOlderThan: db.prepare(`DELETE FROM scorecard_query_cache WHERE fetched_at < datetime('now', ?)`),

    // Scorecard historical rows
    upsertScorecardHistory: db.prepare(`INSERT OR REPLACE INTO scorecard_history (unit_id, year, name, admission_rate, sat_25, sat_75, act_25, act_75, tuition_in, tuition_out, avg_net_price, enrollment, grad_rate, median_earnings) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
    getScorecardHistory:    db.prepare(`SELECT * FROM scorecard_history WHERE unit_id = ? ORDER BY year DESC`),
    getLatestScorecardYear: db.prepare(`SELECT fetched_at FROM scorecard_history WHERE unit_id = ? ORDER BY fetched_at DESC LIMIT 1`),

    // EC prestige research cache (30-day TTL; check via created_at).
    getPrestigeCache:     db.prepare(`SELECT * FROM ec_prestige_cache WHERE cache_key = ?`),
    getPrestigeCacheByName: db.prepare(`SELECT * FROM ec_prestige_cache WHERE activity_name = ? ORDER BY created_at DESC LIMIT 1`),
    listPrestigeCacheRecent: db.prepare(`SELECT * FROM ec_prestige_cache ORDER BY datetime(created_at) DESC, activity_name ASC LIMIT ?`),
    countPrestigeCache:   db.prepare(`SELECT COUNT(*) AS total FROM ec_prestige_cache`),
    upsertPrestigeCache:  db.prepare(`INSERT OR REPLACE INTO ec_prestige_cache (cache_key, activity_name, level_hint, score, rationale, sources_json, source, provider, model, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`),
    deletePrestigeCache:  db.prepare(`DELETE FROM ec_prestige_cache WHERE cache_key = ?`),
    deletePrestigeByName: db.prepare(`DELETE FROM ec_prestige_cache WHERE activity_name = ?`),

    // EC subvector component cache (all 5 factors).
    getComponentCache:    db.prepare(`SELECT * FROM ec_component_cache WHERE cache_key = ?`),
    listComponentCacheRecentByFactor: db.prepare(`SELECT * FROM ec_component_cache WHERE factor = ? ORDER BY datetime(created_at) DESC, cache_key ASC LIMIT ?`),
    countComponentCache:  db.prepare(`SELECT COUNT(*) AS total FROM ec_component_cache`),
    countComponentCacheByFactor: db.prepare(`SELECT COUNT(*) AS total FROM ec_component_cache WHERE factor = ?`),
    upsertComponentCache: db.prepare(`INSERT OR REPLACE INTO ec_component_cache (cache_key, factor, score, reasoning_json, source, provider, model, input_sig, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`),
    deleteComponentCacheByFactor: db.prepare(`DELETE FROM ec_component_cache WHERE factor = ?`),
    deleteComponentCacheOlderThan: db.prepare(`DELETE FROM ec_component_cache WHERE factor = ? AND created_at < datetime('now', ?)`),

    // ─── Common Data Set records + validations ──────────────────────
    // The cds object groups read/write paths. The positioning engine and
    // server endpoints use `cds.getBySlug` for runtime lookups; the
    // ingester pipeline uses `cds.upsert` after PDF parse + validation.
    cds: {
      getBySlug: db.prepare(`SELECT * FROM cds_records WHERE slug = ?`),
      listAll: db.prepare(`SELECT * FROM cds_records ORDER BY school_name`),
      listByTier: db.prepare(`SELECT * FROM cds_records WHERE tier = ? ORDER BY overall_admit_rate ASC`),
      countAll: db.prepare(`SELECT COUNT(*) AS total FROM cds_records`),
      upsert: db.prepare(`
        INSERT OR REPLACE INTO cds_records
          (slug, school_name, year_label, year, tier,
           overall_admit_rate, yield_rate,
           enrolled_sat_p25, enrolled_sat_p75,
           enrolled_act_p25, enrolled_act_p75,
           enrolled_gpa_p25, enrolled_gpa_p75, enrolled_gpa_avg,
           test_policy, c7_json, b1_json, c1_breakdown_json,
           majors_json, priorities_json,
           source_url, source_kind, parser_version, parser_notes_json,
           ingested_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                COALESCE((SELECT ingested_at FROM cds_records WHERE slug = ?), datetime('now')),
                datetime('now'))
      `),
      delete: db.prepare(`DELETE FROM cds_records WHERE slug = ?`),
      // Validation history (append-only)
      insertValidation: db.prepare(`
        INSERT INTO cds_validations (slug, status, scope_from_pdf, discrepancies_json, overrides_json, sources_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `),
      latestValidation: db.prepare(`
        SELECT * FROM cds_validations WHERE slug = ?
        ORDER BY datetime(validated_at) DESC, id DESC LIMIT 1
      `),
      listValidationsRecent: db.prepare(`
        SELECT * FROM cds_validations ORDER BY datetime(validated_at) DESC, id DESC LIMIT ?
      `),
    },

    // Student personal deadlines (F7 from Jiyeon UX audit).
    deadlines: {
      insert: db.prepare(`INSERT INTO student_deadlines (id, student_id, title, due_at, category, notes, college_ids_json, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
      getById: db.prepare(`SELECT * FROM student_deadlines WHERE id = ? AND student_id = ?`),
      listByStudent: db.prepare(`SELECT * FROM student_deadlines WHERE student_id = ? ORDER BY datetime(due_at) ASC, created_at ASC`),
      listOpenByStudent: db.prepare(`SELECT * FROM student_deadlines WHERE student_id = ? AND status = 'open' ORDER BY datetime(due_at) ASC`),
      updateStatus: db.prepare(`UPDATE student_deadlines SET status = ?, updated_at = datetime('now') WHERE id = ? AND student_id = ?`),
      updateFields: db.prepare(`UPDATE student_deadlines SET title = COALESCE(?, title), due_at = COALESCE(?, due_at), category = COALESCE(?, category), notes = COALESCE(?, notes), college_ids_json = COALESCE(?, college_ids_json), updated_at = datetime('now') WHERE id = ? AND student_id = ?`),
      delete: db.prepare(`DELETE FROM student_deadlines WHERE id = ? AND student_id = ?`),
      countOpenUpcoming: db.prepare(`SELECT COUNT(*) AS total FROM student_deadlines WHERE student_id = ? AND status = 'open' AND date(due_at) >= date('now')`),
    },

    // Directionality vector statements
    directionality: prepareDirectionalityStatements(db),

    // AP concept statements (per-subject concept components).
    // These drive lazy initialization: rows are inserted only when the
    // student's own evidence references the subject.
    apConcepts: prepareAPConceptStatements(db),

    // EC strength (4-factor) statements + attachment metadata.
    strength: prepareECStrengthStatements(db),

    // Versioned narrative store (self-presentation).
    narrative: prepareNarrativeStatements(db),

    // narrative_fit LLM result cache.
    narrativeFitCache: prepareNarrativeFitCacheStatements(db),
  };
}


// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??// COLLEGE SCORECARD ??historical data helpers
// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??
/**
 * For each unitId in the list, fetch ~10 years of Scorecard history and
 * persist it in `scorecard_history` + `scorecard_cache`. Schools whose
 * cached data is still fresh (< 7 days) are skipped.
 *
 * This is intentionally async and fire-and-forgetable from the sync endpoint:
 *   fetchAndPersistCollegeHistory(db, ragStmts, apiKey, unitIds).catch(console.warn)
 *
 * @param {import('better-sqlite3').Database} db
 * @param {ReturnType<typeof prepareRAGStatements>} stmts
 * @param {string} apiKey  - SCORECARD_API_KEY
 * @param {string[]} unitIds
 * @returns {Promise<{ fetched: number, skipped: number, errors: number }>}
 */
export async function fetchAndPersistCollegeHistory(db, stmts, apiKey, unitIds) {
  if (!apiKey || !unitIds?.length) return { fetched: 0, skipped: 0, errors: 0 };

  let fetched = 0, skipped = 0, errors = 0;

  for (const unitId of unitIds) {
    if (!unitId) continue;

    // Skip if we have a fresh cache row (< 7 days old)
    const cached = stmts.getScorecardCache?.get(unitId);
    if (cached) { skipped++; continue; }

    const result = await getCollegeHistory(apiKey, unitId, 10);
    if (result.error || !result.history?.length) { errors++; continue; }

    // Persist everything in a single transaction
    try {
      db.transaction(() => {
        // Full-response cache (for quick re-reads without re-fetching)
        stmts.upsertScorecardCache.run(unitId, result.name, JSON.stringify(result));

        // Year-keyed rows for SQL queries and trend assembly
        for (const yr of result.history) {
          stmts.upsertScorecardHistory.run(
            unitId, yr.year, result.name,
            yr.admissionRate, yr.sat25, yr.sat75,
            yr.act25, yr.act75,
            yr.tuitionIn, yr.tuitionOut, yr.avgNetPrice,
            yr.enrollment, yr.gradRate, yr.medianEarnings
          );
        }
      })();
      fetched++;
      console.log(`[SCORECARD] Persisted ${result.history.length} years of history for ${result.name} (${unitId})`);
    } catch (txErr) {
      console.warn(`[SCORECARD] DB write failed for ${unitId}:`, txErr.message);
      errors++;
    }
  }

  return { fetched, skipped, errors };
}

/**
 * Build a college context block for the AI context bundle.
 * For each unitId, assembles latest stats + year-over-year trend summary
 * from the cached `scorecard_history` rows.
 *
 * @param {ReturnType<typeof prepareRAGStatements>} stmts
 * @param {string[]} unitIds
 * @returns {CollegeContextEntry[]}
 */
export function buildCollegeHistoryContext(stmts, unitIds) {
  if (!unitIds?.length) return [];

  return unitIds.map(unitId => {
    const rows = stmts.getScorecardHistory?.all(unitId) || [];
    if (!rows.length) return { unitId, available: false };

    const sorted = [...rows].sort((a, b) => a.year - b.year);
    const latest = sorted[sorted.length - 1];
    const name   = latest.name || unitId;

    // Map DB rows back to the shape summarizeCollegeHistory() expects
    const historyForSummary = sorted.map(r => ({
      year:           r.year,
      admissionRate:  r.admission_rate,
      sat25:          r.sat_25,
      sat75:          r.sat_75,
      act25:          r.act_25,
      act75:          r.act_75,
      tuitionIn:      r.tuition_in,
      tuitionOut:     r.tuition_out,
      avgNetPrice:    r.avg_net_price,
      enrollment:     r.enrollment,
      gradRate:       r.grad_rate,
      medianEarnings: r.median_earnings,
    }));

    return {
      unitId,
      name,
      available: true,
      latestYear: latest.year,
      latest: {
        admissionRate:  latest.admission_rate,
        sat25:          latest.sat_25,
        sat75:          latest.sat_75,
        act25:          latest.act_25,
        act75:          latest.act_75,
        tuitionIn:      latest.tuition_in,
        tuitionOut:     latest.tuition_out,
        avgNetPrice:    latest.avg_net_price,
        enrollment:     latest.enrollment,
        gradRate:       latest.grad_rate,
        medianEarnings: latest.median_earnings,
      },
      // Full year series (oldest-first) for LLM trend reasoning
      yearSeries: historyForSummary,
      // Compact human-readable trend summary (~80 tokens)
      trendSummary: summarizeCollegeHistory(name, historyForSummary),
    };
  }).filter(Boolean);
}

/**
 * Extract unit IDs from a goals array of mixed shape:
 *   [ "MIT", { name: "Stanford", unitId: "243744" }, { id: "166683" }, ... ]
 * Only objects with a numeric-string unitId or id are returned.
 */
export function extractGoalUnitIds(goals) {
  if (!Array.isArray(goals)) return [];
  const ids = [];
  for (const g of goals) {
    if (!g || typeof g !== "object") continue;
    const raw = g.unitId ?? g.unit_id ?? g.id ?? null;
    if (raw && /^\d{6,7}$/.test(String(raw))) ids.push(String(raw));
  }
  return [...new Set(ids)];
}


// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??// STUDENT SYNC + CHANGE DETECTION
// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??
export function syncStudentData(stmts, studentId, profile, activities, goals, majorInterest, trigger = "user_update") {
  const prev = stmts.getLatestSnapshot.get(studentId);
  const changes = detectChanges(prev, profile, activities, majorInterest);
  const academicYear = getAcademicYear();

  stmts.insertSnapshot.run(
    crypto.randomUUID(), studentId, changes.length > 0 ? "update" : "sync",
    profile?.gpa?.unweighted ?? null,
    profile?.gpa?.weighted ?? null,
    JSON.stringify(profile?.courses || []),
    JSON.stringify(profile?.apScores || []),
    JSON.stringify(profile?.testScores || []),
    JSON.stringify(activities || []),
    majorInterest || null,
    JSON.stringify(goals || []),
    trigger
  );

  for (const change of changes) {
    stmts.insertMilestone.run(
      crypto.randomUUID(), studentId, change.type, change.title,
      JSON.stringify(change.data), academicYear
    );
  }

  recomputeCapabilities(stmts, studentId, profile, activities);

  // Recompute EC strength vectors on every profile update.
  // Per policy: whenever a student edits any EC, the unified strength
  // vector is refreshed and legacy compatibility views are projected
  // from that canonical result.
  // Recompute the unified EC strength vectors. Legacy EC vector surfaces
  // are compatibility projections from this canonical table.
  // the 5-factor recompute so both systems see the same inputs. Errors
  // are logged but never fail the sync (match the resilience pattern
  // above). Awaiting isn't practical here because syncStudentData is
  // synchronous ??we fire-and-track, and the next sync or an explicit
  // POST /api/ec/strength/recompute will pick up any failure.
  let ecStrengthRecomputePromise = null;
  try {
    if (stmts.strength && stmts.narrative) {
      const active = getActiveNarrative(stmts.narrative, studentId);
      const llmClient = stmts.narrativeFitCache
        ? buildDefaultLLMClient(stmts.narrativeFitCache)
        : null;
      ecStrengthRecomputePromise = recomputeStudentECStrengthVectors(
        stmts.strength, studentId,
        {
          activities: activities || [],
          narrative: active?.narrativeText || null,
          narrativeThemes: active?.themes || [],
          narrativeHash: active?.hash || null,
          narrativeId: active?.id || null,
          majorInterest: majorInterest || null,
          llmClient,
          ragStmts: stmts,
        },
      ).catch((err) => {
        console.error("[RAG] EC strength recompute failed:", err);
        return { count: 0, vectors: [] };
      });
    }
  } catch (err) {
    console.error("[RAG] EC strength recompute setup failed:", err);
  }

  // Recompute student directionality (overall academic trajectory).
  let dirRecompute = null;
  try {
    if (stmts.directionality) {
      const currentSnapshot = stmts.getLatestSnapshot.get(studentId);
      const snapshotHistory = stmts.getSnapshotHistory.all(studentId, 2) || [];
      const priorSnapshot = snapshotHistory.length > 1 ? snapshotHistory[1] : null;
      const allSnapshots = stmts.getSnapshotHistory.all(studentId, 10) || [];
      const gpaBaselines = stmts.getGPABaseline.all("t20_admitted") || [];
      const satBaselines = stmts.getSATBaseline.all("t20_admitted") || [];
      const actBaselines = stmts.getACTBaseline.all("t20_admitted") || [];
      const collegeProfiles = stmts.searchColleges.all() || [];

      dirRecompute = recomputeStudentDirectionality(
        stmts.directionality, studentId, currentSnapshot, priorSnapshot,
        allSnapshots, gpaBaselines, satBaselines, actBaselines, collegeProfiles
      );
    }
  } catch (err) {
    console.error("[RAG] Directionality vector recompute failed:", err);
  }

  return {
    synced: true,
    changesDetected: changes.length,
    changes,
    ecVectors: {
      count: Array.isArray(activities) ? activities.filter((a) => a?.name).length : 0,
      recomputedAt: new Date().toISOString(),
      sourceSystem: "ec_strength_vectors",
    },
    directionality: dirRecompute ? {
      id: dirRecompute.id,
      factors: dirRecompute.factors,
      label: dirRecompute.label,
      recomputedAt: dirRecompute.computedAt,
    } : null,
  };
}

function detectChanges(prevSnapshot, profile, activities, majorInterest) {
  const changes = [];
  if (!prevSnapshot) {
    changes.push({ type: "profile_created", title: "Profile created", data: {}, significant: true });
    return changes;
  }

  // GPA change
  const prevGpa = prevSnapshot.gpa_unweighted;
  const newGpa = profile?.gpa?.unweighted;
  if (prevGpa != null && newGpa != null && Math.abs(newGpa - prevGpa) >= 0.05) {
    const direction = newGpa > prevGpa ? "improved" : "changed";
    changes.push({
      type: "gpa_change", significant: true,
      title: `GPA ${direction}: ${prevGpa.toFixed(2)} ??${newGpa.toFixed(2)}`,
      data: { previous: prevGpa, current: newGpa, delta: +(newGpa - prevGpa).toFixed(2) }
    });
  } else if (prevGpa == null && newGpa != null) {
    changes.push({ type: "gpa_set", significant: true, title: `GPA recorded: ${newGpa.toFixed(2)}`, data: { value: newGpa } });
  }

  // Test score changes
  const prevTests = safeParseJSON(prevSnapshot.test_scores_json, []);
  const newTests = profile?.testScores || [];
  for (const nt of newTests) {
    const existing = prevTests.find(pt => pt.test === nt.test && pt.subject === nt.subject);
    if (!existing) {
      changes.push({
        type: "test_score_added", significant: true,
        title: `${(nt.test || "").toUpperCase()}${nt.subject ? ` ${nt.subject}` : ""}: ${nt.totalScore}`,
        data: nt
      });
    } else if (existing.totalScore !== nt.totalScore) {
      changes.push({
        type: "test_score_updated", significant: true,
        title: `${(nt.test || "").toUpperCase()} updated: ${existing.totalScore} ??${nt.totalScore}`,
        data: { previous: existing.totalScore, current: nt.totalScore, test: nt.test }
      });
    }
  }

  // AP score changes
  const prevAP = safeParseJSON(prevSnapshot.ap_scores_json, []);
  const newAP = profile?.apScores || [];
  for (const na of newAP) {
    if (!prevAP.some(pa => pa.exam === na.exam && pa.year === na.year)) {
      changes.push({
        type: "ap_score_added", significant: true,
        title: `AP ${na.exam}: Score ${na.score} (${na.year})`,
        data: na
      });
    }
  }

  // EC changes
  const prevECs = safeParseJSON(prevSnapshot.activities_json, []);
  const newECs = activities || [];
  for (const ne of newECs) {
    const existing = prevECs.find(pe => pe.name === ne.name);
    if (!existing) {
      changes.push({
        type: "ec_added", significant: true,
        title: `New activity: ${ne.name} (${ne.role || ne.category})`,
        data: ne
      });
    } else {
      const leadershipRoles = ["president", "founder", "captain", "head", "director", "lead", "chief", "editor", "chair"];
      const wasLeader = leadershipRoles.some(r => (existing.role || "").toLowerCase().includes(r));
      const isLeader = leadershipRoles.some(r => (ne.role || "").toLowerCase().includes(r));
      if (!wasLeader && isLeader) {
        changes.push({
          type: "ec_leadership", significant: true,
          title: `Leadership promotion: ${ne.name} ??${ne.role}`,
          data: { activity: ne.name, previousRole: existing.role, newRole: ne.role }
        });
      }
    }
  }

  // Course changes (additions + grade/type updates). Courses drive the
  // major-aligned narrative + course recommender, so adding one is a
  // first-class event that should refresh an auto-generated narrative.
  const prevCourses = safeParseJSON(prevSnapshot.courses_json, []);
  const newCourses = profile?.courses || [];
  const courseKey = (c) => String(c?.name || c?.title || "").trim().toLowerCase();
  for (const nc of newCourses) {
    const key = courseKey(nc);
    if (!key) continue;
    const existing = prevCourses.find((pc) => courseKey(pc) === key);
    if (!existing) {
      changes.push({
        type: "course_added", significant: true,
        title: `New course: ${nc.name || nc.title}${nc.type ? ` [${nc.type}]` : ""}`,
        data: nc,
      });
    } else if ((existing.grade || existing.grade_earned) !== (nc.grade || nc.grade_earned) || (existing.type || existing.level) !== (nc.type || nc.level)) {
      changes.push({
        type: "course_updated", significant: false,
        title: `Course updated: ${nc.name || nc.title}`,
        data: { name: nc.name || nc.title, previous: existing, current: nc },
      });
    }
  }

  // Major interest change
  const prevMajor = prevSnapshot.major_interest;
  if (majorInterest && prevMajor && majorInterest !== prevMajor) {
    changes.push({
      type: "major_changed", significant: true,
      title: `Major interest changed: ${prevMajor} ??${majorInterest}`,
      data: { previous: prevMajor, current: majorInterest }
    });
  }

  return changes;
}


// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??// CAPABILITY COMPUTATION ??delegates to rules-engine.js
// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??
function recomputeCapabilities(stmts, studentId, profile, activities) {
  const metrics = [];

  // GPA percentile (delegated to rules-engine.js computePercentile)
  if (profile?.gpa?.unweighted) {
    const natl = computePercentile(stmts.getGPABaseline.all("national"), profile.gpa.unweighted, "gpa_unweighted");
    const cohort = computePercentile(stmts.getGPABaseline.all("college_bound"), profile.gpa.unweighted, "gpa_unweighted");
    metrics.push({ metric: "gpa_uw", value: profile.gpa.unweighted, pNat: natl, pCoh: cohort });
  }
  if (profile?.gpa?.weighted) {
    const natl = computePercentile(stmts.getGPABaseline.all("national"), profile.gpa.weighted, "gpa_weighted");
    const cohort = computePercentile(stmts.getGPABaseline.all("college_bound"), profile.gpa.weighted, "gpa_weighted");
    metrics.push({ metric: "gpa_w", value: profile.gpa.weighted, pNat: natl, pCoh: cohort });
  }

  // SAT percentile
  const satScore = (profile?.testScores || []).find(t => t.test === "sat");
  if (satScore?.totalScore) {
    const natl = computePercentile(stmts.getSATBaseline.all("national"), satScore.totalScore, "score");
    const cohort = computePercentile(stmts.getSATBaseline.all("college_bound"), satScore.totalScore, "score");
    metrics.push({ metric: "sat_total", value: satScore.totalScore, pNat: natl, pCoh: cohort });
  }

  // ACT percentile
  const actScore = (profile?.testScores || []).find(t => t.test === "act");
  if (actScore?.totalScore) {
    const natl = computePercentile(stmts.getACTBaseline.all("national"), actScore.totalScore, "score");
    metrics.push({ metric: "act_total", value: actScore.totalScore, pNat: natl, pCoh: null });
  }

  // EC count
  const ecCount = (activities || []).length;
  metrics.push({ metric: "ec_count", value: ecCount, pNat: null, pCoh: null });

  // AP rigor index (delegated to rules-engine.js computeAPRigorIndex)
  const courses = profile?.courses || [];
  const apResult = computeAPRigorIndex(courses, null);
  if (apResult.index > 0) {
    metrics.push({ metric: "ap_rigor_index", value: apResult.index, pNat: null, pCoh: null });
  }

  for (const m of metrics) {
    stmts.insertCapability.run(crypto.randomUUID(), studentId, m.metric, m.value, m.pNat, m.pCoh);
  }
}


// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??// RAG CONTEXT ASSEMBLY ??small-context, PII-free
// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??// Returns a structured summary (100-200 tokens for model context)
// instead of raw data dumps. Student identity is [STUDENT].

export function assembleRAGContext(stmts, studentId, queryFocus, options = {}) {
  const latestSnap = stmts.getLatestSnapshot.get(studentId);
  if (!latestSnap) return { error: "No profile data", studentContext: null, baselineContext: null };

  // Only latest snapshot by default
  const includeTrends = options.includeTrends || false;
  const capabilities = stmts.getLatestCapabilities.all(studentId);
  const structuredData = getDirectStructuredStudentData(stmts, studentId, {
    snapshot: latestSnap,
    capabilities,
  });

  const studentContext = buildStudentSummary(latestSnap, capabilities, includeTrends ? stmts : null, studentId);
  studentContext.structuredData = structuredData;

  // Attach numeric/categorical vectors ??closes the EC+AP+GPA integration
  // gap. All values here are scores or tiers (no raw activity names, no
  // PII). EC names go through a lightweight screening pass before
  // inclusion.
  try {
    studentContext.vectors = buildVectorsBlock(stmts, studentId);
  } catch (err) {
    console.error("[RAG] vectors assembly failed:", err);
    studentContext.vectors = null;
  }

  // Fold top-3 EC tier labels into the compact text summary so downstream
  // prompts can reason about distinctive ECs without additional retrieval.
  if (studentContext.vectors?.ec_strength?.length) {
    const topTiers = studentContext.vectors.ec_strength
      .slice(0, 3)
      .map((v) => v.tierLabel)
      .filter(Boolean);
    if (topTiers.length > 0) {
      studentContext.textSummary = (studentContext.textSummary || "")
        + ` | Top EC tiers: ${topTiers.join(", ")}`;
    }
  }

  // Small-context baseline: only what's relevant to the query
  const baselineContext = assembleBaselineForQuery(stmts, queryFocus, studentContext);

  // Comparisons
  const comparisons = buildComparisons(capabilities);

  // ?? College history context ?????????????????????????????????????????????
  // Pull cached Scorecard history rows for each goal school that has a
  // known unitId. This is read-only ??the background fetch is triggered
  // separately (on sync or on explicit /api/colleges/history/:id call).
  let collegeContext = null;
  try {
    const goals      = safeParseJSON(latestSnap.goals_json, []);
    const goalIds    = extractGoalUnitIds(goals);
    if (goalIds.length > 0 && stmts.getScorecardHistory) {
      const entries = buildCollegeHistoryContext(stmts, goalIds);
      if (entries.length > 0) {
        collegeContext = {
          goalSchools: entries,
          source: "U.S. Department of Education College Scorecard API",
          note: "Historical data (up to 10 years). Admission-rate trend shows selectivity direction.",
        };
      }
    }
  } catch (err) {
    console.warn("[RAG] College history context failed:", err.message);
  }

  return {
    studentContext,
    baselineContext,
    comparisons,
    collegeContext,
    retrievedAt: new Date().toISOString(),
  };
}

// Assemble the numeric vectors block ??no PII, just scores + tiers.
// EC names are screened and replaced with `activity_N` for any token
// that resembles a personal name (all-cap initials, honorifics). This
// is intentionally conservative ??the point is the tier/factor shape,
// not the EC label.
function buildVectorsBlock(stmts, studentId) {
  const out = { ec_strength: [], ap_subjects: [], directionality: null };

  if (stmts.strength?.getByStudent) {
    const rows = stmts.strength.getByStudent.all(studentId) || [];
    out.ec_strength = rows.map((r, idx) => {
      const shape = toStrengthPublicShape(r);
      if (!shape) return null;
      shape.ecName = screenECName(shape.ecName, idx);
      return shape;
    }).filter(Boolean);
  }

  if (stmts.apConcepts?.getAllSubjectVectors) {
    try {
      out.ap_subjects = stmts.apConcepts.getAllSubjectVectors.all(studentId) || [];
    } catch { /* getAllSubjectVectors is optional */ }
  }

  if (stmts.directionality?.getByStudent) {
    try {
      out.directionality = stmts.directionality.getByStudent.get(studentId) || null;
    } catch { /* stmt signature may differ across versions */ }
  }

  return out;
}

// Structured academic metrics come straight from the relational DB:
// profile_snapshots for raw student-entered values and capability_timeline
// for precomputed percentiles. This path intentionally bypasses vector /
// unstructured retrieval.
export function getDirectStructuredStudentData(stmts, studentId, options = {}) {
  const snapshot = options.snapshot || stmts.getLatestSnapshot?.get(studentId);
  if (!snapshot) return null;

  const capabilities = Array.isArray(options.capabilities)
    ? options.capabilities
    : (stmts.getLatestCapabilities?.all(studentId) || []);

  const courses = safeParseJSON(snapshot.courses_json, []);
  const apScores = safeParseJSON(snapshot.ap_scores_json, []);
  const testScores = safeParseJSON(snapshot.test_scores_json, []);
  const activities = safeParseJSON(snapshot.activities_json, []);

  const sat = testScores.find((t) => String(t?.test || "").toLowerCase() === "sat");
  const act = testScores.find((t) => String(t?.test || "").toLowerCase() === "act");
  const apCourses = courses.filter((c) => {
    const type = String(c?.type || c?.level || "").toLowerCase();
    return type === "ap" || /^ap\b/i.test(String(c?.name || ""));
  });
  const apAverage = apScores.length > 0
    ? Math.round(
      (apScores.reduce((sum, exam) => sum + (Number(exam?.score) || 0), 0) / apScores.length) * 10,
    ) / 10
    : null;

  const metrics = {};
  for (const row of capabilities) {
    if (!row?.metric) continue;
    metrics[row.metric] = {
      value: Number.isFinite(Number(row.value)) ? Number(row.value) : null,
      percentileNational: Number.isFinite(Number(row.percentile_national))
        ? Number(row.percentile_national)
        : null,
      percentileCohort: Number.isFinite(Number(row.percentile_cohort))
        ? Number(row.percentile_cohort)
        : null,
      computedAt: row.computed_at || null,
    };
  }

  return {
    retrieval: "direct_db",
    sourceTables: [
      "profile_snapshots",
      "capability_timeline",
      "baseline_gpa",
      "baseline_sat",
      "baseline_act",
    ],
    snapshotCreatedAt: snapshot.created_at || null,
    profile: {
      gpaUnweighted: Number.isFinite(Number(snapshot.gpa_unweighted)) ? Number(snapshot.gpa_unweighted) : null,
      gpaWeighted: Number.isFinite(Number(snapshot.gpa_weighted)) ? Number(snapshot.gpa_weighted) : null,
      satTotal: Number.isFinite(Number(sat?.totalScore)) ? Number(sat.totalScore) : null,
      actComposite: Number.isFinite(Number(act?.totalScore)) ? Number(act.totalScore) : null,
      courseCount: courses.length,
      apCourseCount: apCourses.length,
      apExamCount: apScores.length,
      apAverageScore: apAverage,
      activitiesCount: activities.length,
      majorInterest: snapshot.major_interest || null,
    },
    metrics,
  };
}

// Replace probable personal-name tokens inside an EC label. Conservative:
// (1) initials like "J. Smith", (2) honorifics ("Mr.", "Ms.", "Dr."),
// (3) double-initials like "J.P. Morgan". When any of those patterns fire,
// we fall back to a positional token so prompts never see a name.
function screenECName(name, idx) {
  const s = String(name || "").trim();
  if (!s) return `activity_${idx + 1}`;
  const looksLikeName =
    /\b(Mr|Mrs|Ms|Dr|Prof)\.?\b/i.test(s)
    || /\b[A-Z]\.\s?[A-Z][a-z]+/.test(s)
    || /\b[A-Z]\.[A-Z]\./.test(s);
  return looksLikeName ? `activity_${idx + 1}` : s;
}

// Build a structured student summary ??NO PII, NO raw dumps
function buildStudentSummary(snapshot, capabilities, stmts, studentId) {
  const profile = {
    gpa: { unweighted: snapshot.gpa_unweighted, weighted: snapshot.gpa_weighted },
    courses: safeParseJSON(snapshot.courses_json, []),
    apScores: safeParseJSON(snapshot.ap_scores_json, []),
    testScores: safeParseJSON(snapshot.test_scores_json, []),
    activities: safeParseJSON(snapshot.activities_json, []),
    goals: safeParseJSON(snapshot.goals_json, []),
  };

  const summary = {
    currentProfile: profile,
    majorInterest: snapshot.major_interest,
    metrics: capabilities.map(c => ({
      metric: c.metric, value: c.value,
      percentileNational: c.percentile_national,
      percentileCohort: c.percentile_cohort,
    })),
    // Compact text summary for model context (keeps token count low)
    textSummary: buildTextSummary(profile, capabilities, snapshot.major_interest),
  };

  // Only include trend data if explicitly requested
  if (stmts && studentId) {
    summary.trends = {};
    for (const metric of ["gpa_uw", "sat_total"]) {
      const data = stmts.getCapabilityTrend.all(studentId, metric);
      if (data.length >= 2) {
        const latest = data[data.length - 1];
        const previous = data[data.length - 2];
        summary.trends[metric] = {
          current: latest.value,
          previous: previous.value,
          direction: latest.value > previous.value ? "improving" : latest.value < previous.value ? "declining" : "stable",
        };
      }
    }
  }

  return summary;
}

// Generate compact text for model context (100-200 tokens)
function buildTextSummary(profile, capabilities, majorInterest) {
  const parts = [];

  if (profile.gpa?.unweighted) parts.push(`GPA: ${profile.gpa.unweighted}`);

  const sat = profile.testScores?.find(t => t.test === "sat");
  if (sat?.totalScore) parts.push(`SAT: ${sat.totalScore}`);

  const act = profile.testScores?.find(t => t.test === "act");
  if (act?.totalScore) parts.push(`ACT: ${act.totalScore}`);

  const apCount = (profile.courses || []).filter(c => c.type === "ap").length;
  if (apCount > 0) parts.push(`AP courses: ${apCount}`);

  const apScoreCount = (profile.apScores || []).length;
  if (apScoreCount > 0) {
    const avgScore = profile.apScores.reduce((sum, a) => sum + (a.score || 0), 0) / apScoreCount;
    parts.push(`AP scores: ${apScoreCount} exams (avg ${avgScore.toFixed(1)})`);
  }

  const ecCount = (profile.activities || []).length;
  if (ecCount > 0) parts.push(`Activities: ${ecCount}`);

  if (majorInterest) parts.push(`Major interest: ${majorInterest}`);

  // Add percentile context
  for (const cap of capabilities) {
    if (cap.percentile_national != null) {
      parts.push(`${cap.metric} percentile: ${cap.percentile_national}th nationally`);
    }
  }

  return parts.join(" | ");
}


// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??// BASELINE ASSEMBLY ??query-focused, small context
// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??
function assembleBaselineForQuery(stmts, focus, studentCtx) {
  const baseline = {
    source: "NCES IPEDS, CollegeBoard, ACT.org, NACAC",
    retrieval: "direct_db",
    sourceTables: ["baseline_gpa", "baseline_sat", "baseline_act", "baseline_ec", "baseline_colleges"],
  };

  // Always include GPA baselines (compact)
  baseline.gpaDistributions = {
    national: stmts.getGPABaseline.all("national"),
    collegeBound: stmts.getGPABaseline.all("college_bound"),
  };

  if (focus === "academics" || focus === "holistic") {
    baseline.satDistributions = {
      national: stmts.getSATBaseline.all("national"),
      collegeBound: stmts.getSATBaseline.all("college_bound"),
    };
    baseline.actDistributions = {
      national: stmts.getACTBaseline.all("national"),
    };
  }

  if (focus === "extracurriculars" || focus === "holistic") {
    const major = studentCtx?.majorInterest || "General";
    baseline.ecBenchmarks = stmts.getECBaseline.all(major);
  }

  if (focus === "college_fit" || focus === "holistic") {
    // Only top-level stats, not full profiles ??keep context small
    baseline.collegeProfiles = stmts.searchColleges.all().map(c => ({
      unitId: c.unit_id, name: c.name, state: c.state,
      sat25: c.sat_25, sat75: c.sat_75,
      acceptance: c.acceptance_rate,
      avgGpaAdmitted: c.avg_gpa_admitted,
      topMajors: safeParseJSON(c.top_majors_json, []),
    }));
  }

  if (focus === "strategy") {
    baseline.satDistributions = { national: stmts.getSATBaseline.all("national") };
    const major = studentCtx?.majorInterest || "General";
    baseline.ecBenchmarks = stmts.getECBaseline.all(major);
  }

  return baseline;
}

function buildComparisons(capabilities) {
  return capabilities.map(cap => {
    const comp = { metric: cap.metric, value: cap.value };
    if (cap.percentile_national != null) {
      comp.vsNational = { percentile: cap.percentile_national, interpretation: interpretPercentile(cap.percentile_national) };
    }
    if (cap.percentile_cohort != null) {
      comp.vsCollegeBound = { percentile: cap.percentile_cohort, interpretation: interpretPercentile(cap.percentile_cohort) };
    }
    return comp;
  });
}

function interpretPercentile(p) {
  if (p >= 95) return "Exceptional ??top 5% nationally";
  if (p >= 90) return "Excellent ??top 10%";
  if (p >= 75) return "Above average ??top 25%";
  if (p >= 50) return "At or above the median";
  if (p >= 25) return "Below median ??room for improvement";
  return "Below average ??focus on strengthening this area";
}


// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??// TREND ANALYSIS
// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??
export function getStudentTrends(stmts, studentId) {
  const trends = {};
  for (const metric of ["gpa_uw", "gpa_w", "sat_total", "act_total", "ec_count", "ap_rigor_index"]) {
    const data = stmts.getCapabilityTrend.all(studentId, metric);
    if (data.length > 0) {
      trends[metric] = {
        current: data[data.length - 1].value,
        history: data.map(d => ({ value: d.value, percentile: d.percentile_national, date: d.computed_at })),
        dataPoints: data.length,
        direction: data.length >= 2
          ? data[data.length - 1].value > data[data.length - 2].value ? "improving"
            : data[data.length - 1].value < data[data.length - 2].value ? "declining" : "stable"
          : "insufficient_data"
      };
    }
  }

  return { studentId, trends, computedAt: new Date().toISOString() };
}


// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??// COLLEGE FIT SCORING ??enhanced with baseline data
// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??
export function enhancedCollegeMatch(stmts, studentId, filters) {
  const snap = stmts.getLatestSnapshot.get(studentId);
  if (!snap) return { error: "No profile data", results: [] };

  const testScores = safeParseJSON(snap.test_scores_json, []);
  const satEntry = testScores.find(t => t.test === "sat");
  const actEntry = testScores.find(t => t.test === "act");
  const sat = satEntry?.totalScore || (actEntry ? actToSat(actEntry.totalScore) : null);
  const gpa = snap.gpa_unweighted;
  const apCourses = safeParseJSON(snap.courses_json, []).filter(c => c.type === "ap");
  const activities = safeParseJSON(snap.activities_json, []);
  const major = snap.major_interest || filters?.majorKeyword;

  // Jiyeon UX audit F4 ??the narrative was never weighted into college fit.
  // If we have an active narrative, pull its majorBuckets + themes and use
  // them as a 4th signal alongside SAT / GPA / AP / EC. This is what makes
  // "MIT for computational biology" actually outscore "MIT for anything"
  // in a student whose narrative is about genomic research.
  let narrativeMajorBuckets = [];
  let narrativeThemes = [];
  try {
    const active = getActiveNarrative(stmts.narrative, studentId);
    if (active) {
      narrativeMajorBuckets = (active.majorBuckets || []).map(String);
      narrativeThemes = (active.themes || [])
        .map((t) => (typeof t === "string" ? t : t?.theme))
        .filter(Boolean)
        .map((t) => t.toLowerCase());
    }
  } catch {
    narrativeMajorBuckets = [];
    narrativeThemes = [];
  }

  let colleges = stmts.searchColleges.all();

  // Apply filters
  if (filters?.states?.length) colleges = colleges.filter(c => filters.states.includes(c.state));
  if (filters?.maxTuition) colleges = colleges.filter(c => c.tuition_in <= filters.maxTuition || c.tuition_out <= filters.maxTuition);
  if (filters?.majorKeyword) {
    const kw = filters.majorKeyword.toLowerCase();
    colleges = colleges.filter(c => {
      const majors = safeParseJSON(c.top_majors_json, []);
      return majors.some(m => m.toLowerCase().includes(kw));
    });
  }

  const results = colleges.map(c => {
    const scores = {};

    // SAT fit (0-100)
    if (sat) {
      const mid = (c.sat_25 + c.sat_75) / 2;
      scores.satFit = Math.max(0, Math.round(100 - Math.abs(sat - mid) / 5));
      scores.satPosition = sat >= c.sat_75 ? "above_75th" : sat >= c.sat_25 ? "within_range" : "below_25th";
    }

    // GPA fit (0-100)
    if (gpa && c.avg_gpa_admitted) {
      const diff = gpa - c.avg_gpa_admitted;
      scores.gpaFit = Math.max(0, Math.round(100 - Math.abs(diff) * 50));
      scores.gpaPosition = diff >= 0.1 ? "above_avg" : diff >= -0.1 ? "at_avg" : "below_avg";
    }

    // AP alignment (0-100)
    const apValued = safeParseJSON(c.ap_courses_valued_json, []);
    if (apCourses.length > 0 && apValued.length > 0) {
      const matching = apCourses.filter(ac => apValued.some(av => ac.name && ac.name.includes(av)));
      scores.apAlignment = Math.round((matching.length / Math.max(apValued.length, 1)) * 100);
    }

    // EC alignment (0-100)
    const ecEmphasis = safeParseJSON(c.ec_emphasis_json, []);
    if (activities.length > 0 && ecEmphasis.length > 0) {
      const matching = activities.filter(a =>
        ecEmphasis.some(em => (a.name || "").toLowerCase().includes(em.toLowerCase().split(/[\s/]/)[0]))
      );
      scores.ecAlignment = Math.round((matching.length / Math.max(3, activities.length)) * 100);
    }

    // Narrative alignment (0-100). Two signals:
    //   1. Major bucket match ??does any of the student's detected major
    //      buckets (from narrative_store) appear in this college's top_majors?
    //      Worth up to 70 points.
    //   2. Theme co-occurrence ??do the student's written themes appear in
    //      the college's top_majors list (loose substring match)?
    //      Worth up to 30 points.
    // If the student has no narrative, we leave narrativeFit undefined so
    // the composite falls back to the legacy weights. F4 from UX audit.
    if (narrativeMajorBuckets.length > 0 || narrativeThemes.length > 0) {
      const topMajorsLower = safeParseJSON(c.top_majors_json, []).map((m) => String(m).toLowerCase());
      let bucketHit = false;
      for (const bucket of narrativeMajorBuckets) {
        const bucketNorm = String(bucket).toLowerCase().replace(/_/g, " ");
        if (topMajorsLower.some((m) => m.includes(bucketNorm) || bucketNorm.includes(m))) {
          bucketHit = true;
          break;
        }
      }
      let themeHits = 0;
      for (const theme of narrativeThemes) {
        if (theme.length < 4) continue;
        if (topMajorsLower.some((m) => m.includes(theme))) {
          themeHits += 1;
          if (themeHits >= 3) break;
        }
      }
      const themeScore = Math.min(30, themeHits * 10);
      scores.narrativeFit = (bucketHit ? 70 : 0) + themeScore;
      scores.narrativeHitBucket = bucketHit;
      scores.narrativeHitThemeCount = themeHits;
    }

    // Composite fit score. Keep legacy weights when narrativeFit is absent.
    const weights = scores.narrativeFit != null
      ? { satFit: 0.25, gpaFit: 0.20, apAlignment: 0.15, ecAlignment: 0.20, narrativeFit: 0.20 }
      : { satFit: 0.30, gpaFit: 0.25, apAlignment: 0.20, ecAlignment: 0.25 };
    let totalWeight = 0;
    let weightedSum = 0;
    for (const [key, weight] of Object.entries(weights)) {
      if (scores[key] != null) {
        weightedSum += scores[key] * weight;
        totalWeight += weight;
      }
    }
    const compositeScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 50;

    // Classify reach/match/safety
    const category = compositeScore >= 75 ? "safety" : compositeScore >= 45 ? "match" : "reach";

    return {
      unitId: c.unit_id, name: c.name, state: c.state,
      sat25: c.sat_25, sat75: c.sat_75,
      acceptance: c.acceptance_rate, enrollment: c.enrollment,
      tuitionIn: c.tuition_in, tuitionOut: c.tuition_out,
      avgGpaAdmitted: c.avg_gpa_admitted,
      gradRate: c.grad_rate_6yr, medianEarnings: c.median_earnings_10yr,
      topMajors: safeParseJSON(c.top_majors_json, []),
      fitScores: scores,
      compositeFit: compositeScore,
      category,
      source: "NCES IPEDS + Common Data Sets"
    };
  });

  results.sort((a, b) => b.compositeFit - a.compositeFit);

  return {
    results: results.slice(0, 15),
    studentMetrics: { sat, gpa, apCount: apCourses.length, ecCount: activities.length, major },
    source: "NCES IPEDS, Common Data Set aggregates"
  };
}


// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??// UTILITIES
// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??
function safeParseJSON(str, fallback) {
  try { return str ? JSON.parse(str) : fallback; }
  catch { return fallback; }
}

function getAcademicYear() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  return month >= 7 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

const ACT_TO_SAT = {36:1590,35:1570,34:1550,33:1520,32:1500,31:1480,30:1450,29:1420,28:1390,27:1360,26:1330,25:1300,24:1260,23:1230,22:1200,21:1160,20:1130,19:1100,18:1060,17:1030,16:990,15:960,14:920,13:880,12:840,11:800,10:760,9:720};
function actToSat(act) {
  const clamped = Math.max(9, Math.min(36, Math.round(act)));
  return ACT_TO_SAT[clamped] || 1000;
}



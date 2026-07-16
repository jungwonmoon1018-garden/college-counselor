// ═══════════════════════════════════════════════════════════════════════
// EVIDENCE GRAPH — Typed evidence: official, preparation, inferred
// ═══════════════════════════════════════════════════════════════════════
// Three evidence types that must NEVER be merged:
//   Type 1: Official explicit signals (from universities/programs)
//   Type 2: Program-preparation signals (coursework, portfolios, etc.)
//   Type 3: Inferred/non-official patterns (ALWAYS labeled, NEVER merged with Type 1)
//
// Vectorization applies to evidence DIMENSIONS, not desirability scores.
// ═══════════════════════════════════════════════════════════════════════

import crypto from "node:crypto";

// ─── Evidence types ───
export const EVIDENCE_TYPES = {
  OFFICIAL: 1,       // Published by universities/programs
  PREPARATION: 2,    // Objective program prerequisites and preparation
  INFERRED: 3,       // Patterns, heuristics, historical trends
};

// ─── Evidence dimensions (for vectorization) ───
export const EVIDENCE_DIMENSIONS = [
  "leadership",
  "service",
  "sustained_commitment",
  "field_preparation",
  "research_creative_output",
  "work_family_responsibility",
  "context_opportunity_constraints",
  "major_specific_evidence",
  "mission_fit",
];

function normalizeIdentityPart(value) {
  return String(value ?? "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

export function semanticEvidenceKey(evidence) {
  const identity = [
    evidence.evidence_type,
    evidence.entity_type,
    evidence.entity_id,
    evidence.claim_category,
    evidence.dimension,
    evidence.source_domain,
    evidence.academic_year,
    evidence.claim,
  ].map(normalizeIdentityPart).join("|");
  return crypto.createHash("sha256").update(identity).digest("hex");
}

function ensureEvidenceColumn(db, name, definition) {
  const columns = db.prepare("PRAGMA table_info(evidence_items)").all().map((row) => row.name);
  if (!columns.includes(name)) db.exec("ALTER TABLE evidence_items ADD COLUMN " + name + " " + definition);
}

export function deduplicateEvidenceGraph(db) {
  const rows = db.prepare("SELECT * FROM evidence_items ORDER BY updated_at DESC, created_at DESC").all();
  const update = db.prepare("UPDATE evidence_items SET semantic_key = ? WHERE id = ?");
  const remove = db.prepare("DELETE FROM evidence_items WHERE id = ?");
  const seen = new Map();
  let removed = 0;
  const tx = db.transaction(() => {
    for (const row of rows) {
      const key = semanticEvidenceKey(row);
      if (seen.has(key)) {
        remove.run(row.id);
        removed++;
      } else {
        seen.set(key, row.id);
        update.run(key, row.id);
      }
    }
  });
  tx();
  return { removed, remaining: seen.size };
}

// ─── Schema ───
export function initEvidenceGraph(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS evidence_items (
      id TEXT PRIMARY KEY,
      semantic_key TEXT,
      evidence_type INTEGER NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      entity_name TEXT,
      claim TEXT NOT NULL,
      claim_category TEXT,
      dimension TEXT,
      source_url TEXT,
      source_domain TEXT,
      source_title TEXT,
      source_accessed_at TEXT,
      source_snapshot_hash TEXT,
      trust_level TEXT NOT NULL DEFAULT 'inferred',
      confidence REAL DEFAULT 0.5,
      verified_at TEXT,
      verified_by TEXT,
      expires_at TEXT,
      superseded_by TEXT,
      academic_year TEXT,
      provenance_type TEXT NOT NULL DEFAULT 'external_source',
      seed_version TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_evidence_entity
      ON evidence_items(entity_type, entity_id, evidence_type);
    CREATE INDEX IF NOT EXISTS idx_evidence_category
      ON evidence_items(claim_category, evidence_type);
    CREATE INDEX IF NOT EXISTS idx_evidence_trust
      ON evidence_items(trust_level, expires_at);
    CREATE INDEX IF NOT EXISTS idx_evidence_dimension
      ON evidence_items(dimension, evidence_type);
  `);
  ensureEvidenceColumn(db, "semantic_key", "TEXT");
  ensureEvidenceColumn(db, "provenance_type", "TEXT NOT NULL DEFAULT 'external_source'");
  ensureEvidenceColumn(db, "seed_version", "TEXT");
  deduplicateEvidenceGraph(db);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_semantic_unique ON evidence_items(semantic_key)");
}

// ─── Prepared statements ───
export function prepareEvidenceStatements(db) {
  return {
    insertEvidence: db.prepare(`
      INSERT INTO evidence_items
        (id, semantic_key, evidence_type, entity_type, entity_id, entity_name, claim, claim_category, dimension,
         source_url, source_domain, source_title, source_accessed_at, source_snapshot_hash,
         trust_level, confidence, verified_at, verified_by, expires_at, superseded_by, academic_year,
         provenance_type, seed_version)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(semantic_key) DO UPDATE SET
        entity_name = excluded.entity_name,
        claim = excluded.claim,
        source_url = excluded.source_url,
        source_title = excluded.source_title,
        source_accessed_at = excluded.source_accessed_at,
        source_snapshot_hash = excluded.source_snapshot_hash,
        trust_level = excluded.trust_level,
        confidence = excluded.confidence,
        verified_at = excluded.verified_at,
        verified_by = excluded.verified_by,
        expires_at = excluded.expires_at,
        superseded_by = excluded.superseded_by,
        academic_year = excluded.academic_year,
        provenance_type = excluded.provenance_type,
        seed_version = excluded.seed_version,
        updated_at = CASE WHEN evidence_items.claim != excluded.claim
          OR COALESCE(evidence_items.source_snapshot_hash, '') != COALESCE(excluded.source_snapshot_hash, '')
          THEN datetime('now') ELSE evidence_items.updated_at END
    `),
    getBySemantic: db.prepare(`SELECT * FROM evidence_items WHERE semantic_key = ?`),

    getByEntity: db.prepare(`
      SELECT * FROM evidence_items
      WHERE entity_type = ? AND entity_id = ?
        AND trust_level NOT IN ('expired', 'stale', 'superseded')
        AND (expires_at IS NULL OR expires_at > datetime('now'))
      ORDER BY evidence_type ASC, claim_category ASC
    `),

    getByEntityAndType: db.prepare(`
      SELECT * FROM evidence_items
      WHERE entity_type = ? AND entity_id = ? AND evidence_type = ?
        AND trust_level NOT IN ('expired', 'stale', 'superseded')
        AND (expires_at IS NULL OR expires_at > datetime('now'))
      ORDER BY claim_category ASC
    `),

    getByDimension: db.prepare(`
      SELECT * FROM evidence_items
      WHERE dimension = ? AND entity_id = ?
        AND trust_level NOT IN ('expired', 'stale', 'superseded')
        AND (expires_at IS NULL OR expires_at > datetime('now'))
      ORDER BY evidence_type ASC
    `),

    getOfficialSignals: db.prepare(`
      SELECT * FROM evidence_items
      WHERE evidence_type = 1 AND entity_id = ?
        AND trust_level IN ('official', 'verified')
        AND verified_at IS NOT NULL
        AND (expires_at IS NULL OR expires_at > datetime('now'))
      ORDER BY claim_category ASC
    `),

    searchEvidence: db.prepare(`
      SELECT * FROM evidence_items
      WHERE (instr(lower(COALESCE(entity_name, '')), ?) > 0 OR instr(lower(claim), ?) > 0)
        AND trust_level NOT IN ('expired', 'stale', 'superseded')
        AND (expires_at IS NULL OR expires_at > datetime('now'))
      ORDER BY evidence_type ASC, confidence DESC
      LIMIT ?
    `),

    updateTrust: db.prepare(`
      UPDATE evidence_items
      SET trust_level = ?, verified_at = datetime('now'), verified_by = ?, updated_at = datetime('now')
      WHERE id = ?
    `),

    supersede: db.prepare(`
      UPDATE evidence_items
      SET superseded_by = ?, trust_level = 'superseded', updated_at = datetime('now')
      WHERE id = ?
    `),

    deleteEvidence: db.prepare(`DELETE FROM evidence_items WHERE id = ?`),

    countByType: db.prepare(`
      SELECT evidence_type, COUNT(*) as count FROM evidence_items
      WHERE trust_level != 'expired'
      GROUP BY evidence_type
    `),
  };
}

// ─── Insert evidence ───
export function insertEvidence(stmts, evidence) {
  const semanticKey = evidence.semantic_key || semanticEvidenceKey(evidence);
  const id = evidence.id || "evidence_" + semanticKey.slice(0, 32);
  const result = stmts.insertEvidence.run(
    id,
    semanticKey,
    evidence.evidence_type,
    evidence.entity_type,
    evidence.entity_id || null,
    evidence.entity_name || null,
    evidence.claim,
    evidence.claim_category || null,
    evidence.dimension || null,
    evidence.source_url || null,
    evidence.source_domain || null,
    evidence.source_title || null,
    evidence.source_accessed_at || null,
    evidence.source_snapshot_hash || null,
    evidence.trust_level || (evidence.evidence_type === 1 ? "official" : evidence.evidence_type === 2 ? "verified" : "inferred"),
    evidence.confidence ?? 0.5,
    evidence.verified_at || null,
    evidence.verified_by || null,
    evidence.expires_at || null,
    evidence.superseded_by || null,
    evidence.academic_year || null,
    evidence.provenance_type || "external_source",
    evidence.seed_version || null,
  );
  const stored = stmts.getBySemantic.get(semanticKey);
  return { id: stored?.id || id, inserted: result.changes > 0, semanticKey };
}

// ─── Query evidence for a college with type separation ───
export function getEvidenceProfile(stmts, entityType, entityId) {
  const all = stmts.getByEntity.all(entityType, entityId);

  return {
    items: all,
    official: all.filter((e) => e.evidence_type === EVIDENCE_TYPES.OFFICIAL),
    preparation: all.filter((e) => e.evidence_type === EVIDENCE_TYPES.PREPARATION),
    inferred: all.filter((e) => e.evidence_type === EVIDENCE_TYPES.INFERRED),
    totalCount: all.length,
    disclaimer: "Type 3 (inferred) evidence reflects observed patterns and should never be treated as institutional requirements or official policy.",
  };
}

export function searchEvidence(stmts, query, limit = 20) {
  const tokens = [...new Set(
    String(query || "").normalize("NFKC").toLowerCase()
      .match(/[a-z0-9][a-z0-9.-]{1,}|[\u3131-\uD79D]{2,}/g) || []
  )].slice(0, 8);
  if (!tokens.length) return [];
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
  const results = new Map();
  for (const token of tokens) {
    for (const row of stmts.searchEvidence.all(token, token, safeLimit * 2)) {
      const current = results.get(row.id) || { row, score: 0 };
      current.score += 1;
      results.set(row.id, current);
    }
  }
  return [...results.values()]
    .sort((left, right) => right.score - left.score || Number(right.row.confidence) - Number(left.row.confidence))
    .slice(0, safeLimit)
    .map((entry) => entry.row);
}

// ─── Build dimension profile for a student ───
export function buildStudentDimensionProfile(studentContext) {
  if (!studentContext?.currentProfile) return null;

  const profile = studentContext.currentProfile;
  const activities = profile.activities || [];
  const courses = profile.courses || [];

  const dimensions = {};

  // Leadership
  const leadershipRoles = ["president", "founder", "captain", "head", "director", "lead", "chief", "editor", "chair"];
  const leadershipActivities = activities.filter((a) =>
    leadershipRoles.some((r) => (a.role || "").toLowerCase().includes(r))
  );
  dimensions.leadership = {
    score: leadershipActivities.length,
    evidence: leadershipActivities.map((a) => `${a.role} of ${a.name}`),
  };

  // Service
  const serviceActivities = activities.filter((a) =>
    ["community_service", "volunteer", "service", "nonprofit"].some((k) =>
      (a.category || "").toLowerCase().includes(k) || (a.name || "").toLowerCase().includes(k)
    )
  );
  dimensions.service = {
    score: serviceActivities.length,
    evidence: serviceActivities.map((a) => a.name),
  };

  // Sustained commitment (activities with 2+ years)
  const sustained = activities.filter((a) => {
    const years = a.years || a.yearsOfParticipation || 0;
    return years >= 2;
  });
  dimensions.sustained_commitment = {
    score: sustained.length,
    evidence: sustained.map((a) => `${a.name} (${a.years || a.yearsOfParticipation}yr)`),
  };

  // Field preparation (AP/IB courses related to major)
  const major = studentContext.majorInterest || "";
  const fieldCourses = courses.filter((c) =>
    c.type === "ap" || c.type === "ib" || c.level === "AP" || c.level === "IB"
  );
  dimensions.field_preparation = {
    score: fieldCourses.length,
    evidence: fieldCourses.map((c) => c.name || c.exam),
    major,
  };

  // Research / creative output
  const research = activities.filter((a) =>
    ["research", "publication", "paper", "science fair", "journal"].some((k) =>
      (a.category || "").toLowerCase().includes(k) || (a.name || "").toLowerCase().includes(k)
    )
  );
  dimensions.research_creative_output = {
    score: research.length,
    evidence: research.map((a) => a.name),
  };

  // Work / family responsibility
  const work = activities.filter((a) =>
    ["work", "job", "employment", "family", "caregiv"].some((k) =>
      (a.category || "").toLowerCase().includes(k) || (a.name || "").toLowerCase().includes(k)
    )
  );
  dimensions.work_family_responsibility = {
    score: work.length,
    evidence: work.map((a) => a.name),
  };

  return { dimensions, computedAt: new Date().toISOString() };
}

// ─── Seed evidence from baseline EC benchmarks (Type 3 — always inferred) ───
export function seedECBenchmarkEvidence(stmts, ecBenchmarks, db) {
  const tx = db.transaction(() => {
    for (const bench of ecBenchmarks) {
      insertEvidence(stmts, {
        evidence_type: EVIDENCE_TYPES.INFERRED,
        entity_type: "major_field",
        entity_id: bench.target_major.toLowerCase().replace(/[^a-z0-9]/g, "_"),
        entity_name: bench.target_major,
        claim: `College-bound students targeting ${bench.target_major}: ${bench.participation_pct}% participate in ${bench.category} (avg ${bench.avg_hours}hr/wk, ${bench.leadership_pct}% in leadership).`,
        claim_category: "participation_pattern",
        dimension: bench.category === "research" ? "research_creative_output"
          : bench.category === "community_service" ? "service"
            : bench.category === "varsity" ? "sustained_commitment"
              : bench.category === "work" ? "work_family_responsibility"
                : "field_preparation",
        source_domain: "nces.ed.gov",
        source_title: bench.source,
        trust_level: "inferred",
        confidence: 0.6,
        academic_year: `${bench.year - 1}-${bench.year}`,
      });
    }
  });
  tx();
}

// ─── Seed evidence from college profiles (Type 1 for CDS data, Type 3 for EC emphasis) ───
export function seedCollegeEvidence(stmts, collegeProfiles, db) {
  const tx = db.transaction(() => {
    for (const c of collegeProfiles) {
      const entityId = c.unitId || c.unit_id;
      const entityName = c.name;

      // Bundled profiles mix generated IPEDS fields with manual overrides.
      // Without a field-level source URL they remain inferred baseline data.
      if (c.topMajors || c.top_majors_json) {
        const majors = c.topMajors || safeParseJSON(c.top_majors_json, []);
        if (majors.length > 0) {
          insertEvidence(stmts, {
            evidence_type: EVIDENCE_TYPES.INFERRED,
            entity_type: "university",
            entity_id: entityId,
            entity_name: entityName,
            claim: `Top majors at ${entityName}: ${majors.join(", ")}.`,
            claim_category: "program_offerings",
            source_domain: "bundled-baseline.local",
            source_title: "Bundled college profile baseline",
            trust_level: "inferred",
            confidence: 0.5,
            source_accessed_at: String(c.dataYear || c.data_year || 1970) + "-12-31T00:00:00.000Z",
            academic_year: String(c.dataYear || c.data_year || ""),
            provenance_type: "bundled_baseline",
            seed_version: "college_evidence_v1",
          });
        }
      }

      // Manual AP preference lists are coaching heuristics, not school policy.
      if (c.apCoursesValued || c.ap_courses_valued_json) {
        const apCourses = c.apCoursesValued || safeParseJSON(c.ap_courses_valued_json, []);
        if (apCourses.length > 0) {
          insertEvidence(stmts, {
            evidence_type: EVIDENCE_TYPES.INFERRED,
            entity_type: "university",
            entity_id: entityId,
            entity_name: entityName,
            claim: `AP courses commonly valued by ${entityName} applicants: ${apCourses.join(", ")}.`,
            claim_category: "coursework_preparation",
            dimension: "field_preparation",
            source_domain: "bundled-baseline.local",
            source_title: "Bundled college profile baseline",
            trust_level: "inferred",
            confidence: 0.5,
            source_accessed_at: String(c.dataYear || c.data_year || 1970) + "-12-31T00:00:00.000Z",
            academic_year: String(c.dataYear || c.data_year || ""),
            provenance_type: "bundled_baseline",
            seed_version: "college_evidence_v1",
          });
        }
      }

      // Type 3: EC emphasis (ALWAYS inferred — never merge with official claims)
      if (c.ecEmphasis || c.ec_emphasis_json) {
        const ecs = c.ecEmphasis || safeParseJSON(c.ec_emphasis_json, []);
        if (ecs.length > 0) {
          insertEvidence(stmts, {
            evidence_type: EVIDENCE_TYPES.INFERRED,
            entity_type: "university",
            entity_id: entityId,
            entity_name: entityName,
            claim: `Activities commonly associated with successful ${entityName} applicants: ${ecs.join(", ")}. Note: This is an observed pattern, NOT an institutional requirement.`,
            claim_category: "ec_pattern",
            source_domain: "counselor_heuristics",
            source_title: "Bundled counselor heuristic",
            trust_level: "inferred",
            confidence: 0.5,
            source_accessed_at: String(c.dataYear || c.data_year || 1970) + "-12-31T00:00:00.000Z",
            academic_year: String(c.dataYear || c.data_year || ""),
            provenance_type: "bundled_baseline",
            seed_version: "college_evidence_v1",
          });
        }
      }
    }
  });
  tx();
}

// ─── Seed evidence from competitive activity benchmarks (Type 3 — always inferred) ───
export function seedCompetitiveActivityEvidence(stmts, competitiveBenchmarks, db) {
  const tx = db.transaction(() => {
    for (const bench of competitiveBenchmarks) {
      for (const tm of bench.target_majors) {
        const topLevel = bench.qualifier_levels[bench.qualifier_levels.length - 1];
        insertEvidence(stmts, {
          evidence_type: EVIDENCE_TYPES.INFERRED,
          entity_type: "major_field",
          entity_id: tm.major.toLowerCase().replace(/[^a-z0-9]/g, "_"),
          entity_name: tm.major,
          claim: `${bench.activity_name}: ${bench.participation_rate}% of college-bound students participate. ` +
                 `Impact tier ${tm.impact_tier} for ${tm.major}. ` +
                 `Highest level: ${topLevel.level} (selectivity: ${(topLevel.selectivity * 100).toFixed(3)}%, ` +
                 `admissions weight: ${topLevel.admissions_weight}).`,
          claim_category: "competitive_activity_benchmark",
          dimension: "major_specific_evidence",
          source_domain: bench.source.toLowerCase().includes("maa") ? "maa.org"
            : bench.source.toLowerCase().includes("nsda") ? "speechanddebate.org"
            : bench.source.toLowerCase().includes("first") ? "firstinspires.org"
            : "competition_statistics",
          source_title: bench.source,
          trust_level: "inferred",
          confidence: 0.65,
          academic_year: `${bench.year - 1}-${bench.year}`,
        });
      }
    }
  });
  tx();
}

function safeParseJSON(str, fallback) {
  try { return JSON.parse(str || "null") || fallback; } catch { return fallback; }
}

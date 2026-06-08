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

// ─── Schema ───
export function initEvidenceGraph(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS evidence_items (
      id TEXT PRIMARY KEY,
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
}

// ─── Prepared statements ───
export function prepareEvidenceStatements(db) {
  return {
    insertEvidence: db.prepare(`
      INSERT INTO evidence_items
        (id, evidence_type, entity_type, entity_id, entity_name, claim, claim_category, dimension,
         source_url, source_domain, source_title, source_accessed_at, source_snapshot_hash,
         trust_level, confidence, verified_at, verified_by, expires_at, superseded_by, academic_year)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `),

    getByEntity: db.prepare(`
      SELECT * FROM evidence_items
      WHERE entity_type = ? AND entity_id = ?
        AND trust_level != 'expired'
      ORDER BY evidence_type ASC, claim_category ASC
    `),

    getByEntityAndType: db.prepare(`
      SELECT * FROM evidence_items
      WHERE entity_type = ? AND entity_id = ? AND evidence_type = ?
        AND trust_level != 'expired'
      ORDER BY claim_category ASC
    `),

    getByDimension: db.prepare(`
      SELECT * FROM evidence_items
      WHERE dimension = ? AND entity_id = ?
        AND trust_level != 'expired'
      ORDER BY evidence_type ASC
    `),

    getOfficialSignals: db.prepare(`
      SELECT * FROM evidence_items
      WHERE evidence_type = 1 AND entity_id = ?
        AND trust_level IN ('official', 'verified')
      ORDER BY claim_category ASC
    `),

    searchEvidence: db.prepare(`
      SELECT * FROM evidence_items
      WHERE (entity_name LIKE ? OR claim LIKE ?)
        AND trust_level != 'expired'
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
  const id = evidence.id || crypto.randomUUID();
  stmts.insertEvidence.run(
    id,
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
  );
  return { id, inserted: true };
}

// ─── Query evidence for a college with type separation ───
export function getEvidenceProfile(stmts, entityType, entityId) {
  const all = stmts.getByEntity.all(entityType, entityId);

  return {
    official: all.filter((e) => e.evidence_type === EVIDENCE_TYPES.OFFICIAL),
    preparation: all.filter((e) => e.evidence_type === EVIDENCE_TYPES.PREPARATION),
    inferred: all.filter((e) => e.evidence_type === EVIDENCE_TYPES.INFERRED),
    totalCount: all.length,
    disclaimer: "Type 3 (inferred) evidence reflects observed patterns and should never be treated as institutional requirements or official policy.",
  };
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

      // Type 1: Official data from CDS / IPEDS
      if (c.topMajors || c.top_majors_json) {
        const majors = c.topMajors || safeParseJSON(c.top_majors_json, []);
        if (majors.length > 0) {
          insertEvidence(stmts, {
            evidence_type: EVIDENCE_TYPES.OFFICIAL,
            entity_type: "university",
            entity_id: entityId,
            entity_name: entityName,
            claim: `Top majors at ${entityName}: ${majors.join(", ")}.`,
            claim_category: "program_offerings",
            source_domain: "nces.ed.gov",
            source_title: "NCES IPEDS",
            trust_level: "official",
            confidence: 0.9,
          });
        }
      }

      // Type 2: AP courses valued (program preparation signal)
      if (c.apCoursesValued || c.ap_courses_valued_json) {
        const apCourses = c.apCoursesValued || safeParseJSON(c.ap_courses_valued_json, []);
        if (apCourses.length > 0) {
          insertEvidence(stmts, {
            evidence_type: EVIDENCE_TYPES.PREPARATION,
            entity_type: "university",
            entity_id: entityId,
            entity_name: entityName,
            claim: `AP courses commonly valued by ${entityName} applicants: ${apCourses.join(", ")}.`,
            claim_category: "coursework_preparation",
            dimension: "field_preparation",
            source_domain: "nces.ed.gov",
            source_title: "Common Data Set / institutional reports",
            trust_level: "verified",
            confidence: 0.75,
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
            source_title: "Aggregated counselor observations and class profiles",
            trust_level: "inferred",
            confidence: 0.5,
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

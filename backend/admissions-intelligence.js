import crypto from "node:crypto";
import { matchMajorBucket } from "./ec-vectorizer.js";

export const OFFICIAL_CIP_MAJOR_MAP = Object.freeze([
  { cipCode: "11", cipTitle: "Computer and Information Sciences and Support Services", majorBucket: "computer_science", source: "nces.ed.gov/ipeds/cipcode" },
  { cipCode: "11.08", cipTitle: "Computer Software and Media Applications", majorBucket: "computer_science", source: "nces.ed.gov/ipeds/cipcode" },
  { cipCode: "11.07", cipTitle: "Computer Science", majorBucket: "computer_science", source: "nces.ed.gov/ipeds/cipcode" },
  { cipCode: "11.0701", cipTitle: "Computer Science", majorBucket: "computer_science", source: "nces.ed.gov/ipeds/cipcode" },
  { cipCode: "11.04", cipTitle: "Information Sciences", majorBucket: "data_science", source: "nces.ed.gov/ipeds/cipcode" },
  { cipCode: "14", cipTitle: "Engineering", majorBucket: "engineering", source: "nces.ed.gov/ipeds/cipcode" },
  { cipCode: "14.05", cipTitle: "Biomedical/Medical Engineering", majorBucket: "biomedical_engineering", source: "nces.ed.gov/ipeds/cipcode" },
  { cipCode: "14.18", cipTitle: "Materials Engineering", majorBucket: "materials_science", source: "nces.ed.gov/ipeds/cipcode" },
  { cipCode: "26", cipTitle: "Biological and Biomedical Sciences", majorBucket: "biology", source: "nces.ed.gov/ipeds/cipcode" },
  { cipCode: "26.11", cipTitle: "Biochemistry, Biophysics and Molecular Biology", majorBucket: "computational_biology", source: "nces.ed.gov/ipeds/cipcode" },
  { cipCode: "26.15", cipTitle: "Neurobiology and Neurosciences", majorBucket: "neuroscience", source: "nces.ed.gov/ipeds/cipcode" },
  { cipCode: "27", cipTitle: "Mathematics and Statistics", majorBucket: "mathematics", source: "nces.ed.gov/ipeds/cipcode" },
  { cipCode: "27.05", cipTitle: "Statistics", majorBucket: "data_science", source: "nces.ed.gov/ipeds/cipcode" },
  { cipCode: "40", cipTitle: "Physical Sciences", majorBucket: "physics", source: "nces.ed.gov/ipeds/cipcode" },
  { cipCode: "40.05", cipTitle: "Chemistry", majorBucket: "chemistry", source: "nces.ed.gov/ipeds/cipcode" },
  { cipCode: "42", cipTitle: "Psychology", majorBucket: "psychology", source: "nces.ed.gov/ipeds/cipcode" },
  { cipCode: "45.06", cipTitle: "Economics", majorBucket: "economics", source: "nces.ed.gov/ipeds/cipcode" },
  { cipCode: "45.10", cipTitle: "Political Science and Government", majorBucket: "political_science", source: "nces.ed.gov/ipeds/cipcode" },
  { cipCode: "51.22", cipTitle: "Public Health", majorBucket: "public_health", source: "nces.ed.gov/ipeds/cipcode" },
  { cipCode: "52", cipTitle: "Business, Management, Marketing, and Related Support Services", majorBucket: "business", source: "nces.ed.gov/ipeds/cipcode" },
]);

export function initAdmissionsIntelligenceTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cip_major_map (
      cip_code TEXT PRIMARY KEY,
      cip_title TEXT NOT NULL,
      major_bucket TEXT NOT NULL,
      source_url TEXT NOT NULL,
      source_title TEXT NOT NULL DEFAULT 'NCES CIP taxonomy',
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ipeds_completions_growth (
      id TEXT PRIMARY KEY,
      unit_id TEXT,
      cip_code TEXT NOT NULL,
      award_level TEXT,
      year_start INTEGER NOT NULL,
      year_end INTEGER NOT NULL,
      completions_start INTEGER,
      completions_end INTEGER,
      growth_rate REAL,
      source_url TEXT NOT NULL,
      source_title TEXT NOT NULL DEFAULT 'NCES IPEDS completions',
      source_type TEXT NOT NULL DEFAULT 'official',
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(unit_id, cip_code, award_level, year_start, year_end)
    );
    CREATE INDEX IF NOT EXISTS idx_ipeds_growth_unit ON ipeds_completions_growth(unit_id, cip_code);
    CREATE INDEX IF NOT EXISTS idx_ipeds_growth_cip ON ipeds_completions_growth(cip_code, year_end DESC);

    CREATE TABLE IF NOT EXISTS school_major_policies (
      id TEXT PRIMARY KEY,
      unit_id TEXT,
      school_name TEXT NOT NULL,
      policy_scope TEXT NOT NULL DEFAULT 'major',
      subject_key TEXT NOT NULL,
      policy_type TEXT NOT NULL,
      internal_transfer_difficulty TEXT,
      capacity_expansion_offset REAL DEFAULT 0,
      evidence_strength TEXT DEFAULT 'official',
      source_url TEXT NOT NULL,
      source_domain TEXT NOT NULL,
      source_title TEXT,
      source_excerpt TEXT,
      policy_year TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(unit_id, subject_key, policy_type, source_url)
    );
    CREATE INDEX IF NOT EXISTS idx_major_policy_unit ON school_major_policies(unit_id, subject_key);

    CREATE TABLE IF NOT EXISTS strategic_focus_signals (
      id TEXT PRIMARY KEY,
      unit_id TEXT,
      school_name TEXT NOT NULL,
      signal_type TEXT NOT NULL,
      subject_key TEXT,
      signal_title TEXT NOT NULL,
      signal_summary TEXT,
      evidence_strength REAL DEFAULT 0.7,
      recency_score REAL DEFAULT 0.7,
      source_url TEXT NOT NULL,
      source_domain TEXT NOT NULL,
      source_title TEXT,
      published_at TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(unit_id, signal_type, signal_title, source_url)
    );
    CREATE INDEX IF NOT EXISTS idx_strategic_focus_unit ON strategic_focus_signals(unit_id, subject_key);
  `);
}

export function seedOfficialCipMappings(db) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO cip_major_map
      (cip_code, cip_title, major_bucket, source_url, source_title, updated_at)
    VALUES (?, ?, ?, ?, 'NCES CIP taxonomy', datetime('now'))
  `);
  const tx = db.transaction(() => {
    for (const row of OFFICIAL_CIP_MAJOR_MAP) {
      stmt.run(row.cipCode, row.cipTitle, row.majorBucket, row.source);
    }
  });
  tx();
  return OFFICIAL_CIP_MAJOR_MAP.length;
}

export function prepareAdmissionsIntelStatements(db) {
  return {
    getCipMajorMapByCode: db.prepare(`SELECT * FROM cip_major_map WHERE cip_code = ?`),
    getCipMajorMapByBucket: db.prepare(`SELECT * FROM cip_major_map WHERE major_bucket = ? ORDER BY length(cip_code) DESC, cip_code ASC`),
    listCipMajorMap: db.prepare(`SELECT * FROM cip_major_map ORDER BY major_bucket ASC, cip_code ASC`),

    upsertIpedsGrowth: db.prepare(`
      INSERT OR REPLACE INTO ipeds_completions_growth
        (id, unit_id, cip_code, award_level, year_start, year_end, completions_start, completions_end, growth_rate, source_url, source_title, source_type, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `),
    getIpedsGrowthByUnitAndBucket: db.prepare(`
      SELECT g.*, m.major_bucket
      FROM ipeds_completions_growth g
      JOIN cip_major_map m ON m.cip_code = g.cip_code
      WHERE g.unit_id = ? AND m.major_bucket = ?
      ORDER BY g.year_end DESC, abs(length(g.cip_code) - 5) ASC
      LIMIT 1
    `),
    getIpedsGrowthByBucketNational: db.prepare(`
      SELECT m.major_bucket,
             AVG(g.growth_rate) AS avg_growth_rate,
             COUNT(*) AS sample_size
      FROM ipeds_completions_growth g
      JOIN cip_major_map m ON m.cip_code = g.cip_code
      WHERE m.major_bucket = ?
      GROUP BY m.major_bucket
    `),

    upsertMajorPolicy: db.prepare(`
      INSERT OR REPLACE INTO school_major_policies
        (id, unit_id, school_name, policy_scope, subject_key, policy_type, internal_transfer_difficulty, capacity_expansion_offset, evidence_strength, source_url, source_domain, source_title, source_excerpt, policy_year, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `),
    getMajorPolicyByUnitAndSubject: db.prepare(`
      SELECT * FROM school_major_policies
      WHERE unit_id = ? AND subject_key = ?
      ORDER BY
        CASE evidence_strength WHEN 'official' THEN 1 WHEN 'verified' THEN 2 ELSE 3 END,
        datetime(updated_at) DESC
      LIMIT 1
    `),
    getMajorPolicyBySchoolAndSubject: db.prepare(`
      SELECT * FROM school_major_policies
      WHERE lower(school_name) = lower(?) AND subject_key = ?
      ORDER BY
        CASE evidence_strength WHEN 'official' THEN 1 WHEN 'verified' THEN 2 ELSE 3 END,
        datetime(updated_at) DESC
      LIMIT 1
    `),

    upsertStrategicFocus: db.prepare(`
      INSERT OR REPLACE INTO strategic_focus_signals
        (id, unit_id, school_name, signal_type, subject_key, signal_title, signal_summary, evidence_strength, recency_score, source_url, source_domain, source_title, published_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `),
    getStrategicSignalsByUnitAndSubject: db.prepare(`
      SELECT * FROM strategic_focus_signals
      WHERE unit_id = ? AND (subject_key = ? OR subject_key IS NULL)
      ORDER BY evidence_strength DESC, recency_score DESC, datetime(updated_at) DESC
      LIMIT ?
    `),
  };
}

export function normalizeSubjectKey(subject) {
  return matchMajorBucket(subject || "");
}

export function upsertIpedsGrowth(stmts, row) {
  const id = row.id || crypto.randomUUID();
  stmts.upsertIpedsGrowth.run(
    id,
    row.unitId || null,
    row.cipCode,
    row.awardLevel || null,
    row.yearStart,
    row.yearEnd,
    row.completionsStart ?? null,
    row.completionsEnd ?? null,
    row.growthRate ?? null,
    row.sourceUrl,
    row.sourceTitle || "NCES IPEDS completions",
    row.sourceType || "official",
  );
  return { id, ok: true };
}

export function upsertMajorPolicy(stmts, row) {
  const id = row.id || crypto.randomUUID();
  const subjectKey = row.subjectKey || normalizeSubjectKey(row.subject);
  stmts.upsertMajorPolicy.run(
    id,
    row.unitId || null,
    row.schoolName,
    row.policyScope || "major",
    subjectKey,
    row.policyType,
    row.internalTransferDifficulty || null,
    row.capacityExpansionOffset ?? 0,
    row.evidenceStrength || "official",
    row.sourceUrl,
    row.sourceDomain,
    row.sourceTitle || null,
    row.sourceExcerpt || null,
    row.policyYear || null,
  );
  return { id, ok: true, subjectKey };
}

export function upsertStrategicFocus(stmts, row) {
  const id = row.id || crypto.randomUUID();
  const subjectKey = row.subjectKey || (row.subject ? normalizeSubjectKey(row.subject) : null);
  stmts.upsertStrategicFocus.run(
    id,
    row.unitId || null,
    row.schoolName,
    row.signalType,
    subjectKey,
    row.signalTitle,
    row.signalSummary || null,
    row.evidenceStrength ?? 0.7,
    row.recencyScore ?? 0.7,
    row.sourceUrl,
    row.sourceDomain,
    row.sourceTitle || null,
    row.publishedAt || null,
  );
  return { id, ok: true, subjectKey };
}

export function resolveIpedsGrowthForMajor(stmts, { unitId = null, major }) {
  const bucket = normalizeSubjectKey(major);
  if (unitId) {
    const schoolSpecific = stmts.getIpedsGrowthByUnitAndBucket.get(unitId, bucket);
    if (schoolSpecific) {
      return { scope: "school", bucket, growthRate: Number(schoolSpecific.growth_rate), cipCode: schoolSpecific.cip_code };
    }
  }
  const national = stmts.getIpedsGrowthByBucketNational.get(bucket);
  if (national?.avg_growth_rate != null) {
    return { scope: "national", bucket, growthRate: Number(national.avg_growth_rate), sampleSize: national.sample_size };
  }
  return { scope: "unavailable", bucket, growthRate: null };
}

export function resolveMajorPolicyForSchool(stmts, { unitId = null, schoolName = null, major }) {
  const subjectKey = normalizeSubjectKey(major);
  let row = null;
  if (unitId) row = stmts.getMajorPolicyByUnitAndSubject.get(unitId, subjectKey);
  if (!row && schoolName) row = stmts.getMajorPolicyBySchoolAndSubject.get(schoolName, subjectKey);
  if (!row) return null;
  return {
    policyType: row.policy_type,
    internalTransferDifficulty: row.internal_transfer_difficulty,
    capacityExpansionOffset: Number(row.capacity_expansion_offset || 0),
    evidenceStrength: row.evidence_strength,
    sourceUrl: row.source_url,
    sourceTitle: row.source_title,
    sourceExcerpt: row.source_excerpt,
    subjectKey,
  };
}

export function resolveStrategicFocusForSchool(stmts, { unitId = null, major, limit = 5 }) {
  if (!unitId) return [];
  const subjectKey = normalizeSubjectKey(major);
  return stmts.getStrategicSignalsByUnitAndSubject.all(unitId, subjectKey, limit).map((row) => ({
    signalType: row.signal_type,
    signalTitle: row.signal_title,
    signalSummary: row.signal_summary,
    evidenceStrength: Number(row.evidence_strength || 0),
    recencyScore: Number(row.recency_score || 0),
    sourceUrl: row.source_url,
    sourceTitle: row.source_title,
    publishedAt: row.published_at,
  }));
}

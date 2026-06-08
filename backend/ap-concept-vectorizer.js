// ═══════════════════════════════════════════════════════════════════════
// AP CONCEPT VECTORIZER
// ═══════════════════════════════════════════════════════════════════════
// Decomposes each AP subject vector into weighted concept components.
//
// KEY INVARIANTS
//   • Concept weights within a subject sum to ~1.0.
//     AP_vector(subject) = Σ (mastery_i × weight_i)   →  value in [0, 1]
//   • LAZY INITIALIZATION: no concept rows are written for a student until
//     their first textual/file evidence mentions the subject. This avoids
//     seeding students with default 0-masteries (which would bias the
//     directionality vector as a confounding variable).
//   • IMMEDIATE UPDATE: every incoming student prompt/file is re-classified
//     and any concept whose signal strength changed is re-upserted.
//   • OVERRIDES: students may correct any concept mastery; overrides are
//     preserved across automatic recomputations (same pattern as EC vectors
//     and directionality vectors).
//   • KOREA AI BASIC ACT: factors are independent; we never collapse them
//     into a single "desirability score" — only into a sum-per-subject that
//     is transparent and fully decomposable.
// ═══════════════════════════════════════════════════════════════════════

import crypto from "node:crypto";
import {
  AP_CONCEPT_CATALOG,
  detectAPSubject,
  detectConceptsInText,
  getConceptsForSubject,
  getAllAPSubjects,
} from "./ap-concept-catalog.js";

// ───────────────────────────────────────────────────────────────────────
// Database schema
// ───────────────────────────────────────────────────────────────────────

export function initAPConceptTables(db) {
  db.exec(`
    -- Catalog seed (read-only reference for frontend / reporting).
    -- The source of truth remains ap-concept-catalog.js; this mirror exists
    -- so that diff-based consumers can see the currently-applied weights.
    CREATE TABLE IF NOT EXISTS ap_concept_catalog (
      subject_id    TEXT NOT NULL,
      concept_id    TEXT NOT NULL,
      concept_name  TEXT NOT NULL,
      description   TEXT,
      weight        REAL NOT NULL,
      keywords_json TEXT,
      updated_at    TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (subject_id, concept_id)
    );

    -- Per-student concept mastery rows. LAZY-populated: we only INSERT rows
    -- once the student's own evidence references the subject.
    CREATE TABLE IF NOT EXISTS ap_student_concepts (
      id                TEXT PRIMARY KEY,
      student_id        TEXT NOT NULL,
      subject_id        TEXT NOT NULL,
      concept_id        TEXT NOT NULL,

      -- Mastery in [0, 1]. Multiplied by catalog weight to form the
      -- concept's contribution to the subject vector.
      mastery           REAL NOT NULL DEFAULT 0,

      -- Last observed classification signal in [0, 1] (before smoothing).
      last_signal       REAL DEFAULT 0,

      -- Cumulative evidence count (number of prompts/files that mentioned
      -- this concept). Lets us decay over time and weight fresh evidence.
      evidence_count    INTEGER DEFAULT 0,

      -- Provenance (matched keywords + snippet origin) for the evidence panel.
      evidence_json     TEXT,

      -- Student override support.
      is_overridden     INTEGER DEFAULT 0,
      override_mastery  REAL,

      first_seen_at     TEXT DEFAULT (datetime('now')),
      updated_at        TEXT DEFAULT (datetime('now')),

      UNIQUE (student_id, subject_id, concept_id)
    );
    CREATE INDEX IF NOT EXISTS idx_ap_student_concepts_student
      ON ap_student_concepts(student_id, subject_id);
    CREATE INDEX IF NOT EXISTS idx_ap_student_concepts_subject
      ON ap_student_concepts(subject_id, concept_id);

    -- Per-student rolled-up subject vector (cached; always recomputable
    -- from ap_student_concepts).
    CREATE TABLE IF NOT EXISTS ap_subject_vectors (
      id               TEXT PRIMARY KEY,
      student_id       TEXT NOT NULL,
      subject_id       TEXT NOT NULL,

      subject_vector   REAL NOT NULL DEFAULT 0,   -- Σ(mastery × weight)
      weighted_total   REAL NOT NULL DEFAULT 0,   -- Σ of weights that have evidence
      concept_count    INTEGER NOT NULL DEFAULT 0,

      components_json  TEXT,    -- [{concept_id, mastery, weight, contribution}]
      reasoning_json   TEXT,    -- per-concept evidence summaries

      computed_at      TEXT DEFAULT (datetime('now')),
      updated_at       TEXT DEFAULT (datetime('now')),

      UNIQUE (student_id, subject_id)
    );
    CREATE INDEX IF NOT EXISTS idx_ap_subject_vectors_student
      ON ap_subject_vectors(student_id, subject_id);
  `);
}

// ───────────────────────────────────────────────────────────────────────
// Prepared statements
// ───────────────────────────────────────────────────────────────────────

export function prepareAPConceptStatements(db) {
  return {
    // Catalog mirror
    upsertCatalogEntry: db.prepare(`
      INSERT INTO ap_concept_catalog
        (subject_id, concept_id, concept_name, description, weight, keywords_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(subject_id, concept_id) DO UPDATE SET
        concept_name  = excluded.concept_name,
        description   = excluded.description,
        weight        = excluded.weight,
        keywords_json = excluded.keywords_json,
        updated_at    = datetime('now')
    `),
    listCatalogForSubject: db.prepare(`
      SELECT * FROM ap_concept_catalog WHERE subject_id = ?
      ORDER BY weight DESC
    `),

    // Per-student concept mastery
    getStudentConcept: db.prepare(`
      SELECT * FROM ap_student_concepts
      WHERE student_id = ? AND subject_id = ? AND concept_id = ?
    `),
    getStudentConceptsForSubject: db.prepare(`
      SELECT * FROM ap_student_concepts
      WHERE student_id = ? AND subject_id = ?
      ORDER BY concept_id
    `),
    getAllStudentConcepts: db.prepare(`
      SELECT * FROM ap_student_concepts
      WHERE student_id = ?
      ORDER BY subject_id, concept_id
    `),
    upsertStudentConcept: db.prepare(`
      INSERT INTO ap_student_concepts
        (id, student_id, subject_id, concept_id,
         mastery, last_signal, evidence_count, evidence_json,
         is_overridden, override_mastery, first_seen_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, datetime('now'), datetime('now'))
      ON CONFLICT(student_id, subject_id, concept_id) DO UPDATE SET
        mastery        = CASE WHEN is_overridden = 1
                              THEN COALESCE(override_mastery, mastery)
                              ELSE excluded.mastery END,
        last_signal    = excluded.last_signal,
        evidence_count = ap_student_concepts.evidence_count + 1,
        evidence_json  = excluded.evidence_json,
        updated_at     = datetime('now')
    `),
    applyStudentConceptOverride: db.prepare(`
      UPDATE ap_student_concepts
      SET is_overridden    = 1,
          override_mastery = ?,
          mastery          = ?,
          updated_at       = datetime('now')
      WHERE student_id = ? AND subject_id = ? AND concept_id = ?
    `),
    clearStudentConceptOverride: db.prepare(`
      UPDATE ap_student_concepts
      SET is_overridden    = 0,
          override_mastery = NULL,
          updated_at       = datetime('now')
      WHERE student_id = ? AND subject_id = ? AND concept_id = ?
    `),
    deleteStudentConceptsForSubject: db.prepare(`
      DELETE FROM ap_student_concepts
      WHERE student_id = ? AND subject_id = ?
    `),
    deleteAllStudentConcepts: db.prepare(`
      DELETE FROM ap_student_concepts WHERE student_id = ?
    `),

    // Rolled-up subject vector cache
    upsertSubjectVector: db.prepare(`
      INSERT INTO ap_subject_vectors
        (id, student_id, subject_id,
         subject_vector, weighted_total, concept_count,
         components_json, reasoning_json,
         computed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(student_id, subject_id) DO UPDATE SET
        subject_vector   = excluded.subject_vector,
        weighted_total   = excluded.weighted_total,
        concept_count    = excluded.concept_count,
        components_json  = excluded.components_json,
        reasoning_json   = excluded.reasoning_json,
        updated_at       = datetime('now')
    `),
    getSubjectVector: db.prepare(`
      SELECT * FROM ap_subject_vectors
      WHERE student_id = ? AND subject_id = ?
    `),
    getAllSubjectVectors: db.prepare(`
      SELECT * FROM ap_subject_vectors
      WHERE student_id = ?
      ORDER BY subject_id
    `),
    deleteSubjectVector: db.prepare(`
      DELETE FROM ap_subject_vectors
      WHERE student_id = ? AND subject_id = ?
    `),
  };
}

// ───────────────────────────────────────────────────────────────────────
// Catalog seed (idempotent)
// ───────────────────────────────────────────────────────────────────────

export function seedAPConceptCatalog(stmts) {
  if (!stmts?.upsertCatalogEntry) return 0;
  let count = 0;
  for (const subjectId of getAllAPSubjects()) {
    const concepts = getConceptsForSubject(subjectId);
    for (const c of concepts) {
      stmts.upsertCatalogEntry.run(
        subjectId,
        c.concept_id,
        c.concept_name,
        c.description || "",
        Number(c.weight) || 0,
        JSON.stringify(c.keywords || []),
      );
      count++;
    }
  }
  return count;
}

// ───────────────────────────────────────────────────────────────────────
// Classifier: map raw student text (prompt / parsed file) to AP concepts
// ───────────────────────────────────────────────────────────────────────

/**
 * Classify a piece of student-produced text into (subject, concept) signals.
 *
 * @param {string} text - Student prompt or extracted file text.
 * @param {object} opts
 * @param {string} [opts.hintSubject] - Optional pre-known subject (e.g., from
 *   the file's metadata). Narrows detection to that subject.
 * @returns {Array<{subject_id, concepts: Array}>}
 */
export function classifyInputToAPConcepts(text, opts = {}) {
  const out = [];
  if (!text || typeof text !== "string") return out;

  let subjects;
  if (opts.hintSubject && AP_CONCEPT_CATALOG[opts.hintSubject]) {
    subjects = [opts.hintSubject];
  } else {
    subjects = detectAPSubject(text) || [];
  }
  if (subjects.length === 0) return out;

  for (const subjectId of subjects) {
    const concepts = detectConceptsInText(subjectId, text);
    if (concepts.length === 0) continue;
    out.push({ subject_id: subjectId, concepts });
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────
// Per-student mastery update (lazy row creation)
// ───────────────────────────────────────────────────────────────────────

/**
 * Blend a new classification signal into the student's mastery value.
 * Uses an EMA-style smoother so one-off mentions don't dominate, but a
 * repeated strong signal does pull the value up quickly.
 *
 *   new_mastery = prev * (1 - α) + signal * α
 *   α grows with signal strength (0.25 → 0.60).
 */
function blendMastery(prevMastery, signalStrength) {
  const s = clamp01(Number(signalStrength) || 0);
  const p = clamp01(Number(prevMastery) || 0);
  const alpha = 0.25 + 0.35 * s;  // 0.25 min, 0.60 at full signal
  return clamp01(p * (1 - alpha) + s * alpha);
}

/**
 * Upsert a single concept mastery for a student. Respects override flag:
 * if the row has is_overridden = 1, mastery is held at override_mastery and
 * only evidence_count / evidence_json / last_signal are refreshed.
 *
 * Creates the row on first evidence (LAZY INIT).
 */
export function upsertStudentAPConcept(stmts, {
  studentId,
  subjectId,
  conceptId,
  signalStrength,
  matchedKeywords = [],
  evidenceSnippet = null,
}) {
  if (!stmts?.upsertStudentConcept || !studentId || !subjectId || !conceptId) return null;

  const existing = stmts.getStudentConcept.get(studentId, subjectId, conceptId);
  const prevMastery = existing ? Number(existing.mastery) : 0;
  const blended = blendMastery(prevMastery, signalStrength);

  // Build evidence payload; cap the accumulated list so row sizes stay small.
  let evidence = [];
  if (existing?.evidence_json) {
    try { evidence = JSON.parse(existing.evidence_json) || []; } catch { evidence = []; }
  }
  evidence.unshift({
    at: new Date().toISOString(),
    signal: round2(signalStrength),
    keywords: matchedKeywords,
    snippet: evidenceSnippet ? truncate(evidenceSnippet, 240) : null,
  });
  if (evidence.length > 8) evidence = evidence.slice(0, 8);

  const id = existing?.id || crypto.randomUUID();
  stmts.upsertStudentConcept.run(
    id,
    studentId,
    subjectId,
    conceptId,
    round2(blended),
    round2(signalStrength),
    1,  // starting evidence_count for first insert; upsert branch adds +1
    JSON.stringify(evidence),
  );

  return {
    id,
    subject_id: subjectId,
    concept_id: conceptId,
    mastery: round2(blended),
    prev_mastery: round2(prevMastery),
    signal_strength: round2(signalStrength),
    is_new: !existing,
    is_overridden: Boolean(existing?.is_overridden),
  };
}

// ───────────────────────────────────────────────────────────────────────
// Subject vector recomputation (Σ mastery × weight)
// ───────────────────────────────────────────────────────────────────────

/**
 * Recompute the cached subject vector from the current per-concept rows.
 * Only concepts with evidence contribute — concepts the student has never
 * encountered are simply absent (per the lazy-init contract).
 */
export function recomputeSubjectVector(stmts, studentId, subjectId) {
  if (!stmts?.getStudentConceptsForSubject) return null;
  const catalog = getConceptsForSubject(subjectId);
  if (!catalog.length) return null;

  const weightBySlug = new Map(catalog.map(c => [c.concept_id, Number(c.weight) || 0]));
  const rows = stmts.getStudentConceptsForSubject.all(studentId, subjectId) || [];

  let subjectVector = 0;
  let weightedTotal = 0;
  const components = [];
  const reasoning = [];

  for (const row of rows) {
    const weight = weightBySlug.get(row.concept_id) ?? 0;
    const effectiveMastery = row.is_overridden
      ? Number(row.override_mastery ?? row.mastery)
      : Number(row.mastery);
    const contribution = clamp01(effectiveMastery) * weight;

    subjectVector += contribution;
    weightedTotal += weight;
    components.push({
      concept_id: row.concept_id,
      mastery: round2(effectiveMastery),
      weight: round2(weight),
      contribution: round3(contribution),
      is_overridden: Boolean(row.is_overridden),
      evidence_count: row.evidence_count,
    });
    reasoning.push({
      concept_id: row.concept_id,
      summary: `${row.concept_id} mastery ${round2(effectiveMastery)} × weight ${round2(weight)} = ${round3(contribution)}${row.is_overridden ? ' (overridden)' : ''}`,
    });
  }

  const id = crypto.randomUUID();
  stmts.upsertSubjectVector.run(
    id,
    studentId,
    subjectId,
    round3(clamp01(subjectVector)),
    round3(weightedTotal),
    components.length,
    JSON.stringify(components),
    JSON.stringify(reasoning),
  );

  return {
    id,
    subject_id: subjectId,
    subject_vector: round3(clamp01(subjectVector)),
    weighted_total: round3(weightedTotal),
    concept_count: components.length,
    components,
    reasoning,
    computed_at: new Date().toISOString(),
  };
}

// ───────────────────────────────────────────────────────────────────────
// Top-level entry point: "a student typed/uploaded something"
// ───────────────────────────────────────────────────────────────────────

/**
 * Main entry point called by rag-engine / server on every student input.
 *
 *   1. Classify text → (subject, concepts with signal strength)
 *   2. For each (subject, concept) → LAZY upsert student concept row
 *   3. For each touched subject → recompute cached subject vector
 *
 * @param {object} stmts - prepared statements from prepareAPConceptStatements
 * @param {string} studentId - opaque UUID
 * @param {string|string[]} textOrTexts - one prompt, or many (files+prompt)
 * @param {object} [opts]
 * @param {string} [opts.hintSubject] - force a particular subject bucket
 * @param {string} [opts.source] - "prompt" | "file" | "transcript" for audit
 * @returns {{ touchedSubjects, conceptUpdates, subjectVectors }}
 */
export function processStudentInputForConcepts(stmts, studentId, textOrTexts, opts = {}) {
  if (!stmts || !studentId) {
    return { touchedSubjects: [], conceptUpdates: [], subjectVectors: [] };
  }
  const texts = Array.isArray(textOrTexts) ? textOrTexts : [textOrTexts];
  const touchedSubjects = new Set();
  const conceptUpdates = [];

  for (const text of texts) {
    if (!text || typeof text !== "string") continue;
    const classifications = classifyInputToAPConcepts(text, opts);

    for (const { subject_id, concepts } of classifications) {
      touchedSubjects.add(subject_id);
      for (const c of concepts) {
        const update = upsertStudentAPConcept(stmts, {
          studentId,
          subjectId: subject_id,
          conceptId: c.concept_id,
          signalStrength: c.signal_strength,
          matchedKeywords: c.matched_keywords,
          evidenceSnippet: text,
        });
        if (update) {
          update.source = opts.source || "input";
          conceptUpdates.push(update);
        }
      }
    }
  }

  // Recompute cached subject vectors for every touched subject.
  const subjectVectors = [];
  for (const subjectId of touchedSubjects) {
    const vec = recomputeSubjectVector(stmts, studentId, subjectId);
    if (vec) subjectVectors.push(vec);
  }

  return {
    touchedSubjects: [...touchedSubjects],
    conceptUpdates,
    subjectVectors,
  };
}

/**
 * Force recomputation of every cached subject vector for a student.
 * Useful after a bulk override or catalog weight change.
 */
export function recomputeAllSubjectVectors(stmts, studentId) {
  if (!stmts?.getAllStudentConcepts) return [];
  const rows = stmts.getAllStudentConcepts.all(studentId) || [];
  const subjects = new Set(rows.map(r => r.subject_id));
  const out = [];
  for (const subjectId of subjects) {
    const vec = recomputeSubjectVector(stmts, studentId, subjectId);
    if (vec) out.push(vec);
  }
  return out;
}

/**
 * Apply a student override to a single concept mastery. Creates the concept
 * row if it does not yet exist (overrides can precede evidence — e.g., a
 * student self-reports "I already know this").
 */
export function overrideStudentConcept(stmts, {
  studentId, subjectId, conceptId, mastery,
}) {
  if (!stmts || !studentId || !subjectId || !conceptId) return null;
  const clamped = clamp01(Number(mastery));

  // Ensure the row exists (lazy init may not have fired yet).
  const existing = stmts.getStudentConcept.get(studentId, subjectId, conceptId);
  if (!existing) {
    stmts.upsertStudentConcept.run(
      crypto.randomUUID(),
      studentId,
      subjectId,
      conceptId,
      clamped,
      0,
      0,
      JSON.stringify([{ at: new Date().toISOString(), note: "seeded by override" }]),
    );
  }
  stmts.applyStudentConceptOverride.run(clamped, clamped, studentId, subjectId, conceptId);

  // Refresh cached subject vector.
  const vec = recomputeSubjectVector(stmts, studentId, subjectId);
  return { subject_id: subjectId, concept_id: conceptId, mastery: clamped, subject_vector: vec };
}

// ───────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function round2(x) {
  return Math.round((Number(x) || 0) * 100) / 100;
}

function round3(x) {
  return Math.round((Number(x) || 0) * 1000) / 1000;
}

function truncate(s, n) {
  if (typeof s !== "string") return s;
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

// ═══════════════════════════════════════════════════════════════════════
// TESTS: AP Concept Vectorizer
// ═══════════════════════════════════════════════════════════════════════
// Covers:
//   - Catalog integrity (weights sum to ~1.0 per subject)
//   - Subject + concept classification from raw text
//   - Lazy initialization contract (no rows before evidence)
//   - Mastery blending across repeated signals
//   - Subject vector recomputation (Σ mastery × weight)
//   - Override persistence across automatic recomputes
//   - Concept updates propagate to subject vectors immediately
// ═══════════════════════════════════════════════════════════════════════

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  AP_CONCEPT_CATALOG,
  detectAPSubject,
  detectConceptsInText,
  getConceptsForSubject,
  getAllAPSubjects,
} from "../ap-concept-catalog.js";
import {
  initAPConceptTables,
  prepareAPConceptStatements,
  seedAPConceptCatalog,
  classifyInputToAPConcepts,
  upsertStudentAPConcept,
  recomputeSubjectVector,
  recomputeAllSubjectVectors,
  processStudentInputForConcepts,
  overrideStudentConcept,
} from "../ap-concept-vectorizer.js";

function makeTestDb() {
  const db = new Database(":memory:");
  initAPConceptTables(db);
  const stmts = prepareAPConceptStatements(db);
  seedAPConceptCatalog(stmts);
  return { db, stmts };
}

// ───────────────────────────────────────────────────────────────────────
// Catalog integrity
// ───────────────────────────────────────────────────────────────────────

describe("AP_CONCEPT_CATALOG integrity", () => {
  it("contains at least 20 AP subjects", () => {
    assert.ok(getAllAPSubjects().length >= 20);
  });

  it("every concept has required fields", () => {
    for (const [subjectId, concepts] of Object.entries(AP_CONCEPT_CATALOG)) {
      assert.ok(Array.isArray(concepts), `${subjectId} must be an array`);
      assert.ok(concepts.length >= 5, `${subjectId} should have ≥5 concepts`);
      for (const c of concepts) {
        assert.ok(c.concept_id, `${subjectId} missing concept_id`);
        assert.ok(c.concept_name, `${subjectId}/${c.concept_id} missing concept_name`);
        assert.equal(typeof c.weight, "number", `${subjectId}/${c.concept_id} weight must be number`);
        assert.ok(c.weight > 0 && c.weight <= 1, `${subjectId}/${c.concept_id} weight out of range`);
        assert.ok(Array.isArray(c.keywords) && c.keywords.length > 0,
          `${subjectId}/${c.concept_id} must have keywords`);
      }
    }
  });

  it("concept weights sum to ~1.0 within each subject", () => {
    for (const [subjectId, concepts] of Object.entries(AP_CONCEPT_CATALOG)) {
      const sum = concepts.reduce((s, c) => s + c.weight, 0);
      // Allow 0.05 tolerance because catalog values are editorial.
      assert.ok(Math.abs(sum - 1.0) <= 0.05,
        `${subjectId} weights sum = ${sum.toFixed(3)} (expected ~1.0)`);
    }
  });

  it("concept_ids are unique within a subject", () => {
    for (const [subjectId, concepts] of Object.entries(AP_CONCEPT_CATALOG)) {
      const ids = concepts.map((c) => c.concept_id);
      assert.equal(new Set(ids).size, ids.length, `${subjectId} has duplicate concept_ids`);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────
// Classifier
// ───────────────────────────────────────────────────────────────────────

describe("detectAPSubject", () => {
  it("detects AP Calculus AB from natural text", () => {
    const r = detectAPSubject("I'm struggling with my ap calculus ab homework");
    assert.ok(r?.includes("AP_CALCULUS_AB"));
  });

  it("detects AP Biology", () => {
    const r = detectAPSubject("Studying for ap biology tomorrow");
    assert.ok(r?.includes("AP_BIOLOGY"));
  });

  it("detects APUSH", () => {
    const r = detectAPSubject("apush essay tips?");
    assert.ok(r?.includes("AP_US_HISTORY"));
  });

  it("returns null for unrelated text", () => {
    assert.equal(detectAPSubject("what's the weather today"), null);
  });
});

describe("detectConceptsInText", () => {
  it("finds derivative concept in calculus text", () => {
    const out = detectConceptsInText("AP_CALCULUS_AB", "find the derivative and slope of this function");
    const ids = out.map((c) => c.concept_id);
    assert.ok(ids.includes("derivatives_and_rates"));
    // Signal strength is in [0, 1]
    for (const c of out) {
      assert.ok(c.signal_strength >= 0 && c.signal_strength <= 1);
    }
  });

  it("returns empty array when no keywords match", () => {
    const out = detectConceptsInText("AP_CALCULUS_AB", "hello world");
    assert.deepEqual(out, []);
  });

  it("returns empty for unknown subject", () => {
    const out = detectConceptsInText("AP_NONSENSE", "anything");
    assert.deepEqual(out, []);
  });
});

describe("classifyInputToAPConcepts", () => {
  it("produces subject + concept pairs for a rich prompt", () => {
    const r = classifyInputToAPConcepts(
      "In ap calculus ab I need help with derivatives and optimization problems"
    );
    assert.ok(r.length > 0);
    const calc = r.find((x) => x.subject_id === "AP_CALCULUS_AB");
    assert.ok(calc);
    assert.ok(calc.concepts.length > 0);
  });

  it("narrows to hintSubject when provided", () => {
    const r = classifyInputToAPConcepts(
      "derivative", { hintSubject: "AP_CALCULUS_AB" }
    );
    assert.equal(r.length, 1);
    assert.equal(r[0].subject_id, "AP_CALCULUS_AB");
  });

  it("returns empty array for non-AP text", () => {
    assert.deepEqual(classifyInputToAPConcepts("hello friend"), []);
  });
});

// ───────────────────────────────────────────────────────────────────────
// DB schema + prepared statements
// ───────────────────────────────────────────────────────────────────────

describe("DB schema + seed", () => {
  it("creates expected tables", () => {
    const { db } = makeTestDb();
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all().map((r) => r.name);
    assert.ok(tables.includes("ap_concept_catalog"));
    assert.ok(tables.includes("ap_student_concepts"));
    assert.ok(tables.includes("ap_subject_vectors"));
  });

  it("seedAPConceptCatalog is idempotent", () => {
    const { stmts } = makeTestDb();
    const first = seedAPConceptCatalog(stmts);
    const second = seedAPConceptCatalog(stmts);
    assert.equal(first, second);
    assert.ok(first > 100);
  });
});

// ───────────────────────────────────────────────────────────────────────
// Lazy initialization contract
// ───────────────────────────────────────────────────────────────────────

describe("Lazy initialization", () => {
  it("creates NO student concept rows until evidence arrives", () => {
    const { db, stmts } = makeTestDb();
    const studentId = "student-lazy-1";

    const rowsBefore = stmts.getAllStudentConcepts.all(studentId);
    assert.equal(rowsBefore.length, 0);

    const vectorsBefore = stmts.getAllSubjectVectors.all(studentId);
    assert.equal(vectorsBefore.length, 0);
  });

  it("creates rows only for subjects mentioned in the student's input", () => {
    const { stmts } = makeTestDb();
    const studentId = "student-lazy-2";

    processStudentInputForConcepts(
      stmts, studentId,
      "I'm working on ap calculus ab derivatives and optimization"
    );

    const rows = stmts.getAllStudentConcepts.all(studentId);
    // Should have calc rows but nothing else
    const subjects = new Set(rows.map((r) => r.subject_id));
    assert.ok(subjects.has("AP_CALCULUS_AB"));
    assert.ok(!subjects.has("AP_BIOLOGY"));
    assert.ok(!subjects.has("AP_CHEMISTRY"));
  });
});

// ───────────────────────────────────────────────────────────────────────
// Mastery blending (multiple signals)
// ───────────────────────────────────────────────────────────────────────

describe("Mastery blending over repeated evidence", () => {
  it("increases mastery when repeated strong signals arrive", () => {
    const { stmts } = makeTestDb();
    const studentId = "student-blend-1";

    processStudentInputForConcepts(
      stmts, studentId,
      "ap calculus ab derivative rate of change slope tangent differentiate"
    );
    const after1 = stmts.getStudentConcept.get(studentId, "AP_CALCULUS_AB", "derivatives_and_rates");
    assert.ok(after1);
    const m1 = after1.mastery;

    processStudentInputForConcepts(
      stmts, studentId,
      "more ap calculus ab derivative rate of change slope tangent differentiate practice"
    );
    const after2 = stmts.getStudentConcept.get(studentId, "AP_CALCULUS_AB", "derivatives_and_rates");
    assert.ok(after2.mastery >= m1, "mastery should monotonically rise on repeated strong signals");
    assert.equal(after2.evidence_count, 2);
  });

  it("mastery stays within [0, 1]", () => {
    const { stmts } = makeTestDb();
    const studentId = "student-blend-2";
    for (let i = 0; i < 20; i++) {
      processStudentInputForConcepts(
        stmts, studentId,
        "ap calculus ab derivative rate of change slope tangent differentiate"
      );
    }
    const row = stmts.getStudentConcept.get(studentId, "AP_CALCULUS_AB", "derivatives_and_rates");
    assert.ok(row.mastery >= 0 && row.mastery <= 1);
  });
});

// ───────────────────────────────────────────────────────────────────────
// Subject vector recomputation
// ───────────────────────────────────────────────────────────────────────

describe("recomputeSubjectVector", () => {
  it("equals Σ(mastery × weight) across evidenced concepts", () => {
    const { stmts } = makeTestDb();
    const studentId = "student-vec-1";

    processStudentInputForConcepts(
      stmts, studentId,
      "ap calculus ab derivative rate of change slope tangent differentiate"
    );
    processStudentInputForConcepts(
      stmts, studentId,
      "ap calculus ab integral antiderivative FTC riemann accumulation"
    );

    const rows = stmts.getStudentConceptsForSubject.all(studentId, "AP_CALCULUS_AB");
    const catalog = getConceptsForSubject("AP_CALCULUS_AB");
    const weightBy = new Map(catalog.map((c) => [c.concept_id, c.weight]));
    const expected = rows.reduce((s, r) => s + r.mastery * (weightBy.get(r.concept_id) ?? 0), 0);

    const vec = recomputeSubjectVector(stmts, studentId, "AP_CALCULUS_AB");
    assert.ok(Math.abs(vec.subject_vector - expected) < 0.005);
    assert.ok(vec.subject_vector >= 0 && vec.subject_vector <= 1);
    assert.ok(vec.components.length === rows.length);
  });

  it("subject vector updates immediately when a new signal arrives", () => {
    const { stmts } = makeTestDb();
    const studentId = "student-vec-2";

    processStudentInputForConcepts(
      stmts, studentId,
      "ap calculus ab derivative rate of change"
    );
    const vec1 = stmts.getSubjectVector.get(studentId, "AP_CALCULUS_AB");
    const before = vec1.subject_vector;

    processStudentInputForConcepts(
      stmts, studentId,
      "ap calculus ab integral antiderivative accumulation riemann"
    );
    const vec2 = stmts.getSubjectVector.get(studentId, "AP_CALCULUS_AB");
    const after = vec2.subject_vector;

    // Adding evidence for a new concept should strictly increase the vector.
    assert.ok(after > before, `expected ${after} > ${before}`);
  });
});

// ───────────────────────────────────────────────────────────────────────
// Overrides
// ───────────────────────────────────────────────────────────────────────

describe("Student overrides", () => {
  it("override pins mastery across automatic recomputes", () => {
    const { stmts } = makeTestDb();
    const studentId = "student-override-1";

    processStudentInputForConcepts(
      stmts, studentId,
      "ap calculus ab derivative rate of change slope tangent"
    );

    overrideStudentConcept(stmts, {
      studentId, subjectId: "AP_CALCULUS_AB",
      conceptId: "derivatives_and_rates", mastery: 0.95,
    });
    const pinned = stmts.getStudentConcept.get(studentId, "AP_CALCULUS_AB", "derivatives_and_rates");
    assert.equal(pinned.is_overridden, 1);
    assert.equal(pinned.override_mastery, 0.95);
    assert.equal(pinned.mastery, 0.95);

    // Flood with more evidence — override should remain pinned.
    for (let i = 0; i < 5; i++) {
      processStudentInputForConcepts(
        stmts, studentId,
        "ap calculus ab derivative rate of change"
      );
    }
    const after = stmts.getStudentConcept.get(studentId, "AP_CALCULUS_AB", "derivatives_and_rates");
    assert.equal(after.mastery, 0.95, "override should persist across subsequent classifications");
    assert.equal(after.is_overridden, 1);
  });

  it("override can precede any evidence (seeded row)", () => {
    const { stmts } = makeTestDb();
    const studentId = "student-override-2";

    const result = overrideStudentConcept(stmts, {
      studentId, subjectId: "AP_BIOLOGY",
      conceptId: "cell_biology", mastery: 0.7,
    });
    assert.ok(result);
    const row = stmts.getStudentConcept.get(studentId, "AP_BIOLOGY", "cell_biology");
    assert.ok(row);
    assert.equal(row.is_overridden, 1);
    assert.equal(row.mastery, 0.7);
  });
});

// ───────────────────────────────────────────────────────────────────────
// Cross-cutting integration
// ───────────────────────────────────────────────────────────────────────

describe("Multi-subject processing", () => {
  it("processes multiple subjects mentioned in a single prompt", () => {
    const { stmts } = makeTestDb();
    const studentId = "student-multi-1";

    const r = processStudentInputForConcepts(
      stmts, studentId,
      "I have ap calculus ab derivative questions and ap biology cell membrane questions"
    );
    assert.ok(r.touchedSubjects.includes("AP_CALCULUS_AB"));
    assert.ok(r.touchedSubjects.includes("AP_BIOLOGY"));

    const vecCalc = stmts.getSubjectVector.get(studentId, "AP_CALCULUS_AB");
    const vecBio = stmts.getSubjectVector.get(studentId, "AP_BIOLOGY");
    assert.ok(vecCalc);
    assert.ok(vecBio);
  });

  it("recomputeAllSubjectVectors covers every evidenced subject", () => {
    const { stmts } = makeTestDb();
    const studentId = "student-multi-2";

    processStudentInputForConcepts(stmts, studentId, "ap calculus ab derivative slope");
    processStudentInputForConcepts(stmts, studentId, "ap chemistry enthalpy entropy gibbs");

    const all = recomputeAllSubjectVectors(stmts, studentId);
    const subjects = all.map((v) => v.subject_id).sort();
    assert.deepEqual(subjects, ["AP_CALCULUS_AB", "AP_CHEMISTRY"]);
  });
});

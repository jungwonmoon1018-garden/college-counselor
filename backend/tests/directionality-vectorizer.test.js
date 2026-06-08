// ═══════════════════════════════════════════════════════════
// TESTS: Student Directionality Vectorization
// ═══════════════════════════════════════════════════════════

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  vectorizeDirectionality,
  recomputeStudentDirectionality,
  initDirectionalityTable,
  prepareDirectionalityStatements,
} from "../ec-vectorizer.js";
import Database from "better-sqlite3";
import crypto from "node:crypto";

describe("vectorizeDirectionality", () => {
  it("computes directionality for strong student with high GPA + high SAT", () => {
    const result = vectorizeDirectionality({
      academics: {
        gpaUnweighted: 3.95,
        apCourses: [
          { name: "Calculus BC" },
          { name: "Computer Science A" },
          { name: "Physics C" },
          { name: "Chemistry" },
          { name: "English Language" },
          { name: "US History" },
        ],
        courses: [],
      },
      testScores: [{ test: "sat", totalScore: 1520 }],
      majorInterest: "Computer Science",
    });

    assert.ok(result.factors);
    assert.ok(result.factors.academic_momentum > 0.7);
    assert.ok(result.factors.test_score_strength > 0.8);
    assert.ok(result.factors.major_academic_fit > 0.6);
    assert.ok(result.factors.rigor_and_challenge > 0.8);
    assert.ok(result.factors.overall_academic_standing > 0.7);
    assert.equal(result.label, "strong_upward");
    assert.ok(Array.isArray(result.reasoning));
  });

  it("computes directionality for student with improving GPA trend", () => {
    const result = vectorizeDirectionality({
      academics: {
        gpaUnweighted: 3.7,
        apCourses: [{ name: "Calculus BC" }, { name: "Physics" }],
        courses: [],
      },
      testScores: [],
      majorInterest: "Engineering",
      priorSnapshot: { gpa_unweighted: 3.5 }, // improvement from 3.5 to 3.7
    });

    assert.ok(result.factors.academic_momentum > 0.5);
    assert.ok(result.reasoning.some(r => r.includes("Academic momentum")));
  });

  it("computes directionality for student with declining GPA", () => {
    const result = vectorizeDirectionality({
      academics: {
        gpaUnweighted: 3.1,
        apCourses: [{ name: "Biology" }],
        courses: [],
      },
      testScores: [],
      majorInterest: "Biology",
      priorSnapshot: { gpa_unweighted: 3.5 }, // decline from 3.5 to 3.1
    });

    assert.ok(result.factors.academic_momentum < 0.5);
    assert.equal(result.label, "declining");
  });

  it("returns neutral defaults when no test scores yet", () => {
    const result = vectorizeDirectionality({
      academics: {
        gpaUnweighted: 3.5,
        apCourses: [{ name: "Calculus" }],
        courses: [],
      },
      testScores: [],
      majorInterest: "Mathematics",
    });

    assert.ok(result.factors.test_score_strength === 0.5); // neutral
    assert.ok(result.reasoning.some(r => r.includes("no tests yet")));
  });

  it("computes directionality for student with 0 APs", () => {
    const result = vectorizeDirectionality({
      academics: {
        gpaUnweighted: 3.6,
        apCourses: [],
        courses: [],
      },
      testScores: [{ test: "sat", totalScore: 1350 }],
      majorInterest: "Business",
    });

    assert.ok(result.factors.rigor_and_challenge < 0.5); // low rigor
    assert.equal(result.label, "early_stage");
  });

  it("detects major mismatch (CS interest but no CS APs)", () => {
    const result = vectorizeDirectionality({
      academics: {
        gpaUnweighted: 3.8,
        apCourses: [
          { name: "Biology" },
          { name: "Chemistry" },
          { name: "Psychology" },
        ],
        courses: [],
      },
      testScores: [{ test: "sat", totalScore: 1400 }],
      majorInterest: "Computer Science",
    });

    // Major fit should be lower because no CS APs
    assert.ok(result.factors.major_academic_fit < 0.7);
  });

  it("computes high SAT percentile correctly", () => {
    const result = vectorizeDirectionality({
      academics: {
        gpaUnweighted: 3.5,
        apCourses: [{ name: "Calculus" }],
        courses: [],
      },
      testScores: [{ test: "sat", totalScore: 1500 }],
      majorInterest: "Mathematics",
    });

    assert.ok(result.metrics.satPercentileT20 > 0.8); // 1500+ is 90th percentile
  });

  it("handles ACT score and converts to percentile", () => {
    const result = vectorizeDirectionality({
      academics: {
        gpaUnweighted: 3.6,
        apCourses: [{ name: "Calculus" }],
        courses: [],
      },
      testScores: [{ test: "act", totalScore: 34 }],
      majorInterest: "Engineering",
    });

    assert.ok(result.factors.test_score_strength > 0.8); // ACT 34 is high
    assert.ok(result.metrics.actPercentileT20 > 0.8);
  });

  it("all factors are in [0, 1] range", () => {
    const result = vectorizeDirectionality({
      academics: {
        gpaUnweighted: 4.1, // above normal, should be clamped
        apCourses: Array(12).fill({ name: "AP Course" }), // many APs
        courses: [],
      },
      testScores: [{ test: "sat", totalScore: 1600 }], // perfect
      majorInterest: "Computer Science",
    });

    assert.ok(result.factors.academic_momentum >= 0 && result.factors.academic_momentum <= 1);
    assert.ok(result.factors.test_score_strength >= 0 && result.factors.test_score_strength <= 1);
    assert.ok(result.factors.major_academic_fit >= 0 && result.factors.major_academic_fit <= 1);
    assert.ok(result.factors.rigor_and_challenge >= 0 && result.factors.rigor_and_challenge <= 1);
    assert.ok(result.factors.overall_academic_standing >= 0 && result.factors.overall_academic_standing <= 1);
  });

  it("label reflects strong upward trajectory", () => {
    const result = vectorizeDirectionality({
      academics: {
        gpaUnweighted: 3.85,
        apCourses: [
          { name: "Calculus BC" },
          { name: "Physics C" },
          { name: "Chemistry" },
          { name: "Biology" },
        ],
        courses: [],
      },
      testScores: [{ test: "sat", totalScore: 1480 }],
      majorInterest: "Biology",
      priorSnapshot: { gpa_unweighted: 3.6 }, // improving
    });

    assert.equal(result.label, "strong_upward");
  });

  it("label reflects stable strong performance", () => {
    const result = vectorizeDirectionality({
      academics: {
        gpaUnweighted: 3.8,
        apCourses: [
          { name: "Calculus BC" },
          { name: "Physics" },
          { name: "Chemistry" },
        ],
        courses: [],
      },
      testScores: [{ test: "sat", totalScore: 1450 }],
      majorInterest: "Engineering",
      priorSnapshot: { gpa_unweighted: 3.8 }, // stable, no change
    });

    assert.equal(result.label, "stable_strong");
  });

  it("returns reasoning explanations for each factor", () => {
    const result = vectorizeDirectionality({
      academics: {
        gpaUnweighted: 3.7,
        apCourses: [{ name: "Calculus" }, { name: "Physics" }],
        courses: [],
      },
      testScores: [{ test: "sat", totalScore: 1400 }],
      majorInterest: "Physics",
    });

    assert.ok(result.reasoning.length >= 5); // at least one per factor
    assert.ok(result.reasoning.some(r => r.includes("Academic momentum")));
    assert.ok(result.reasoning.some(r => r.includes("Test score strength")));
    assert.ok(result.reasoning.some(r => r.includes("Major-academic fit")));
    assert.ok(result.reasoning.some(r => r.includes("Rigor & challenge")));
    assert.ok(result.reasoning.some(r => r.includes("Overall academic standing")));
  });
});

describe("recomputeStudentDirectionality", () => {
  it("preserves student overrides across recompute", () => {
    // Create in-memory DB for testing
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE student_directionality (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL,
        academic_momentum REAL,
        test_score_strength REAL,
        major_academic_fit REAL,
        rigor_and_challenge REAL,
        overall_academic_standing REAL,
        directionality_label TEXT,
        gpa_unweighted REAL,
        gpa_percentile_t20 REAL,
        ap_count INTEGER,
        sat_total INTEGER,
        sat_percentile_t20 REAL,
        act_total INTEGER,
        act_percentile_t20 REAL,
        major_interest TEXT,
        is_overridden INTEGER,
        override_json TEXT,
        reasoning_json TEXT,
        computed_at TEXT,
        updated_at TEXT
      );
    `);

    const stmts = prepareDirectionalityStatements(db);
    const studentId = crypto.randomUUID();

    // First compute
    const snapshot1 = {
      gpa_unweighted: 3.6,
      ap_scores_json: '[]',
      courses_json: '[]',
      test_scores_json: '[]',
      major_interest: "Engineering",
    };

    const result1 = recomputeStudentDirectionality(
      stmts, studentId, snapshot1, null, [], [], [], [], []
    );

    assert.ok(result1.id);
    assert.equal(result1.isOverridden, false);

    // Simulate student override
    const overrides = {
      academic_momentum: 0.9,
      test_score_strength: 0.85,
    };
    stmts.applyOverride.run(
      0.9, 0.85, null, null, null,
      JSON.stringify(overrides),
      studentId
    );

    // Recompute with new profile data
    const snapshot2 = {
      gpa_unweighted: 3.8, // changed
      ap_scores_json: '[{"exam": "Calculus BC", "score": 5}]',
      courses_json: '[]',
      test_scores_json: '[]',
      major_interest: "Engineering",
    };

    const result2 = recomputeStudentDirectionality(
      stmts, studentId, snapshot2, null, [], [], [], [], []
    );

    // Overridden values should be preserved
    assert.equal(result2.isOverridden, true);
    assert.equal(result2.factors.academic_momentum, 0.9);
    assert.equal(result2.factors.test_score_strength, 0.85);

    db.close();
  });

  it("computes directionality for new student with no prior data", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE student_directionality (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL,
        academic_momentum REAL,
        test_score_strength REAL,
        major_academic_fit REAL,
        rigor_and_challenge REAL,
        overall_academic_standing REAL,
        directionality_label TEXT,
        gpa_unweighted REAL,
        gpa_percentile_t20 REAL,
        ap_count INTEGER,
        sat_total INTEGER,
        sat_percentile_t20 REAL,
        act_total INTEGER,
        act_percentile_t20 REAL,
        major_interest TEXT,
        is_overridden INTEGER,
        override_json TEXT,
        reasoning_json TEXT,
        computed_at TEXT,
        updated_at TEXT
      );
    `);

    const stmts = prepareDirectionalityStatements(db);
    const studentId = crypto.randomUUID();

    const snapshot = {
      gpa_unweighted: 3.7,
      ap_scores_json: '[]',
      courses_json: '[]',
      test_scores_json: '[]',
      major_interest: "Computer Science",
    };

    const result = recomputeStudentDirectionality(
      stmts, studentId, snapshot, null, [], [], [], [], []
    );

    assert.ok(result.id);
    assert.ok(result.factors);
    assert.ok(result.label);
    assert.ok(result.computedAt);
    assert.equal(result.isOverridden, false);

    db.close();
  });
});

describe("initDirectionalityTable & prepareDirectionalityStatements", () => {
  it("creates directionality table with correct schema", () => {
    const db = new Database(":memory:");
    initDirectionalityTable(db);

    // Verify table exists
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='student_directionality'").all();
    assert.ok(tables.length === 1);

    // Verify indexes exist
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='student_directionality'").all();
    assert.ok(indexes.length > 0);

    db.close();
  });

  it("prepares all required statements without error", () => {
    const db = new Database(":memory:");
    initDirectionalityTable(db);

    const stmts = prepareDirectionalityStatements(db);

    assert.ok(stmts.upsertDirectionality);
    assert.ok(stmts.getByStudent);
    assert.ok(stmts.getByStudentHistory);
    assert.ok(stmts.deleteByStudent);
    assert.ok(stmts.applyOverride);

    db.close();
  });

  it("upsert statement correctly stores directionality vector", () => {
    const db = new Database(":memory:");
    initDirectionalityTable(db);

    const stmts = prepareDirectionalityStatements(db);
    const studentId = crypto.randomUUID();

    stmts.upsertDirectionality.run(
      crypto.randomUUID(), studentId,
      0.75, 0.82, 0.68, 0.88, 0.79,
      "stable_strong",
      3.8, 0.85, 6,
      1450, 0.9, null, null,
      "Computer Science",
      '["reasoning 1", "reasoning 2"]',
      0, null
    );

    const row = stmts.getByStudent.get(studentId);
    assert.ok(row);
    assert.equal(row.academic_momentum, 0.75);
    assert.equal(row.test_score_strength, 0.82);
    assert.equal(row.directionality_label, "stable_strong");

    db.close();
  });

  it("getByStudentHistory retrieves multiple recent vectors", () => {
    const db = new Database(":memory:");
    initDirectionalityTable(db);

    const stmts = prepareDirectionalityStatements(db);
    const studentId = crypto.randomUUID();

    // Insert 3 vectors with slight delays
    for (let i = 0; i < 3; i++) {
      stmts.upsertDirectionality.run(
        crypto.randomUUID(), studentId,
        0.5 + i * 0.1, 0.5, 0.5, 0.5, 0.5,
        "stable_developing",
        3.5, null, i + 1,
        null, null, null, null,
        "Mathematics",
        '[]',
        0, null
      );
    }

    const history = stmts.getByStudentHistory.all(studentId);
    assert.ok(history.length > 0);
    assert.ok(history.length <= 10);

    db.close();
  });
});

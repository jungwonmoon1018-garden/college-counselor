// Tests for narrative-store.js
// Uses an in-memory sqlite DB so we can exercise the save/versioning
// path end-to-end without touching disk.

import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  initNarrativeTables,
  prepareNarrativeStatements,
  saveNarrative,
  getActiveNarrative,
  softDeleteNarrative,
  extractNarrativeThemes,
  validateNarrativeText,
  NarrativeValidationError,
  NARRATIVE_MIN_CHARS,
  NARRATIVE_MAX_CHARS,
} from "../narrative-store.js";

// Short helper to stand up a fresh in-memory DB.
function freshDb() {
  const db = new Database(":memory:");
  initNarrativeTables(db);
  return { db, stmts: prepareNarrativeStatements(db) };
}

// A 400-char narrative used across multiple tests.
const SAMPLE_CS_CLIMATE = [
  "I am a systems-thinking computer scientist focused on climate policy.",
  "I build open-source software tools that help researchers track carbon emissions",
  "across energy grids and help city councils design better environmental policy.",
  "My work sits at the intersection of programming, data science, and public policy,",
  "and I hope to continue this path through college and beyond into graduate research.",
].join(" ");

// ─── validateNarrativeText ───
test("validateNarrativeText rejects too-short text", () => {
  assert.throws(
    () => validateNarrativeText("too short"),
    (err) => err instanceof NarrativeValidationError && err.code === "too_short",
  );
});

test("validateNarrativeText rejects too-long text", () => {
  const tooLong = "a".repeat(NARRATIVE_MAX_CHARS + 1);
  assert.throws(
    () => validateNarrativeText(tooLong),
    (err) => err instanceof NarrativeValidationError && err.code === "too_long",
  );
});

test("validateNarrativeText rejects too-few-words text even if char count passes", () => {
  // 150 chars but only one "word"
  const lumped = "a".repeat(150);
  assert.throws(
    () => validateNarrativeText(lumped),
    (err) => err instanceof NarrativeValidationError && err.code === "too_few_words",
  );
});

test("validateNarrativeText accepts well-formed text", () => {
  assert.equal(validateNarrativeText(SAMPLE_CS_CLIMATE), true);
});

// ─── extractNarrativeThemes ───
test("extractNarrativeThemes finds at least 5 themes in a 400-char narrative", () => {
  const { themes } = extractNarrativeThemes(SAMPLE_CS_CLIMATE);
  assert.ok(themes.length >= 5, `expected ≥5 themes, got ${themes.length}`);
  // Should include core content words, not stopwords
  const flat = themes.map((t) => t.theme).join(" ");
  assert.ok(flat.includes("climate") || flat.includes("policy") || flat.includes("software"));
  assert.ok(!themes.some((t) => ["and", "the", "of", "is"].includes(t.theme)));
});

test("extractNarrativeThemes detects relevant major buckets", () => {
  const { majorBuckets } = extractNarrativeThemes(SAMPLE_CS_CLIMATE);
  // "code", "software", "data", "python" etc. from the text should flag CS,
  // and "climate"/"environmental" should flag environmental_science.
  assert.ok(
    majorBuckets.includes("computer_science") ||
      majorBuckets.includes("environmental_science") ||
      majorBuckets.includes("political_science"),
    `expected a relevant bucket, got ${JSON.stringify(majorBuckets)}`,
  );
});

test("extractNarrativeThemes handles empty input gracefully", () => {
  const { themes, majorBuckets } = extractNarrativeThemes("");
  assert.deepEqual(themes, []);
  assert.deepEqual(majorBuckets, []);
});

test("extractNarrativeThemes captures bigrams", () => {
  const { themes } = extractNarrativeThemes(SAMPLE_CS_CLIMATE);
  const bigramThemes = themes.filter((t) => t.theme.includes(" "));
  assert.ok(bigramThemes.length >= 2, "expected at least 2 bigram themes");
});

// ─── saveNarrative / getActiveNarrative ───
test("saveNarrative stores row and returns id + themes", () => {
  const { stmts } = freshDb();
  const result = saveNarrative(stmts, "student_a", SAMPLE_CS_CLIMATE);
  assert.ok(result.id);
  assert.ok(result.hash);
  assert.ok(result.themes.length >= 5);
});

test("getActiveNarrative returns the latest active row", () => {
  const { stmts } = freshDb();
  saveNarrative(stmts, "student_b", SAMPLE_CS_CLIMATE);
  const active = getActiveNarrative(stmts, "student_b");
  assert.ok(active);
  assert.ok(active.narrativeText.includes("climate policy"));
  assert.ok(Array.isArray(active.themes));
});

test("saving a new narrative deactivates the prior active row", () => {
  const { db, stmts } = freshDb();
  const first = saveNarrative(stmts, "student_c", SAMPLE_CS_CLIMATE);
  const revised = SAMPLE_CS_CLIMATE + " I also care deeply about affordable housing and transit equity.";
  const second = saveNarrative(stmts, "student_c", revised);
  assert.notEqual(first.id, second.id);

  const countActive = db.prepare(
    "SELECT COUNT(*) AS n FROM student_narratives WHERE student_id = ? AND is_active = 1",
  ).get("student_c").n;
  assert.equal(countActive, 1);

  const active = getActiveNarrative(stmts, "student_c");
  assert.equal(active.id, second.id);
});

// ─── softDeleteNarrative ───
test("softDeleteNarrative flips is_active to 0", () => {
  const { db, stmts } = freshDb();
  saveNarrative(stmts, "student_d", SAMPLE_CS_CLIMATE);
  softDeleteNarrative(stmts, "student_d");
  assert.equal(getActiveNarrative(stmts, "student_d"), null);

  const activeCount = db.prepare(
    "SELECT COUNT(*) AS n FROM student_narratives WHERE student_id = ? AND is_active = 1",
  ).get("student_d").n;
  assert.equal(activeCount, 0);

  // Soft-delete should preserve history (not actually delete rows)
  const totalCount = db.prepare(
    "SELECT COUNT(*) AS n FROM student_narratives WHERE student_id = ?",
  ).get("student_d").n;
  assert.equal(totalCount, 1);
});

test("saveNarrative throws NarrativeValidationError for invalid text", () => {
  const { stmts } = freshDb();
  assert.throws(
    () => saveNarrative(stmts, "student_e", "too short"),
    (err) => err instanceof NarrativeValidationError,
  );
});

test("saveNarrative requires studentId", () => {
  const { stmts } = freshDb();
  assert.throws(
    () => saveNarrative(stmts, null, SAMPLE_CS_CLIMATE),
    /studentId/,
  );
});

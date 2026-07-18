// Explicit Council eligibility (course_planning), deadline cascade-by-school, and the
// crisis-safe guard shared by the autoname path. Offline unit tests.

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  classifyTopic,
  routeRequest,
  isCrisisText,
  STRATEGY_COUNCIL_SUBINTENTS,
} from "../policy-router.js";

// ── Feature 3: course-planning routes to the Strategy Council ──

test("course-planning questions classify correctly and require explicit Council action", () => {
  const qs = [
    "what courses should I take next year",
    "which APs should I take junior year?",
    "help me with course selection for senior year",
    "what classes next semester for a CS major",
  ];
  for (const q of qs) {
    const cls = classifyTopic(q);
    assert.equal(cls.topicType, "coaching", `topicType for "${q}"`);
    assert.equal(cls.subIntent, "course_planning", `subIntent for "${q}"`);
    assert.notEqual(routeRequest(q).action, "strategy_council", `ordinary action for "${q}"`);
    assert.equal(routeRequest(q, { explicitCouncil: true }).action, "strategy_council");
  }
});

test("existing Council sub-intents remain eligible but do not auto-convene", () => {
  assert.ok(STRATEGY_COUNCIL_SUBINTENTS.has("course_planning"));
  assert.notEqual(routeRequest("help me build my college list").action, "strategy_council");
  assert.equal(routeRequest("help me build my college list", { explicitCouncil: true }).action, "strategy_council");
  assert.equal(routeRequest("rank my activities for admissions", { explicitCouncil: true }).action, "strategy_council");
});

test("ordinary coaching does NOT trigger the council", () => {
  // A plain factual/benchmark question stays off the expensive council path.
  assert.notEqual(routeRequest("how does my GPA compare to admitted students").action, "strategy_council");
  assert.notEqual(routeRequest("what is a good SAT score").action, "strategy_council");
});

// ── Crisis guard shared by the autoname route (never send crisis text to a model) ──

test("crisis text is detected so autoname keeps the neutral title", () => {
  assert.equal(isCrisisText("i want to kill myself"), true);
  assert.equal(isCrisisText("which courses should I take"), false);
});

// ── Feature 2: cascade-delete deadlines by school (statement behavior) ──

function seedDeadlineDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE student_deadlines (
    id TEXT PRIMARY KEY, student_id TEXT NOT NULL, title TEXT NOT NULL,
    due_at TEXT NOT NULL, category TEXT DEFAULT 'personal', notes TEXT,
    college_ids_json TEXT, status TEXT DEFAULT 'open',
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));`);
  const ins = db.prepare(`INSERT INTO student_deadlines (id, student_id, title, due_at, college_ids_json) VALUES (?,?,?,?,?)`);
  ins.run("d1", "stu1", "MIT — Regular Decision", "2026-01-01", '["166683"]');
  ins.run("d2", "stu1", "MIT — Financial Aid (CSS)", "2026-02-01", '["166683"]');
  ins.run("d3", "stu1", "Stanford — Early Action", "2025-11-01", '["243744"]');
  ins.run("d4", "stu1", "Study for calc quiz", "2025-12-01", null); // unrelated personal
  ins.run("d5", "stu2", "MIT — Regular Decision", "2026-01-01", '["166683"]'); // other student
  const deleteBySchool = db.prepare(`
    DELETE FROM student_deadlines
    WHERE student_id = ?
      AND ( LOWER(title) LIKE ?
         OR (? IS NOT NULL AND college_ids_json LIKE ?) )`);
  return { db, deleteBySchool };
}

test("deleteBySchool removes title-named AND unitId-tagged rows, nothing else", () => {
  const { db, deleteBySchool } = seedDeadlineDb();
  const info = deleteBySchool.run("stu1", "%mit%", "166683", "%166683%");
  assert.equal(info.changes, 2, "both MIT rows for stu1 deleted");
  const remaining = db.prepare("SELECT id FROM student_deadlines WHERE student_id = 'stu1' ORDER BY id").all().map((r) => r.id);
  assert.deepEqual(remaining, ["d3", "d4"], "Stanford + personal row survive");
  const otherStudent = db.prepare("SELECT COUNT(*) c FROM student_deadlines WHERE student_id = 'stu2'").get().c;
  assert.equal(otherStudent, 1, "another student's identical-title row is untouched");
});

test("deleteBySchool matches by unitId even when the title doesn't name the school", () => {
  const { db, deleteBySchool } = seedDeadlineDb();
  // A no-title-match pattern, but the unitId still catches the tagged rows.
  const info = deleteBySchool.run("stu1", "% no-match %", "166683", "%166683%");
  assert.equal(info.changes, 2);
});

test("deleteBySchool with a null unitId only title-matches (no accidental broad delete)", () => {
  const { db, deleteBySchool } = seedDeadlineDb();
  const info = deleteBySchool.run("stu1", "%stanford%", null, null);
  assert.equal(info.changes, 1);
});

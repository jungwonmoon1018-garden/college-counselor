import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  initRAGTables,
  prepareRAGStatements,
  getDirectStructuredStudentData,
} from "../rag-engine.js";

function freshStmts() {
  const db = new Database(":memory:");
  initRAGTables(db);
  return prepareRAGStatements(db);
}

test("getDirectStructuredStudentData reads GPA/test scores directly from DB tables", () => {
  const stmts = freshStmts();

  stmts.insertSnapshot.run(
    "snap_1",
    "student_1",
    "sync",
    3.92,
    4.41,
    JSON.stringify([
      { name: "AP Calculus BC", type: "ap" },
      { name: "AP Physics C", type: "ap" },
      { name: "English 11 Honors", type: "honors" },
    ]),
    JSON.stringify([
      { exam: "Calculus BC", score: 5 },
      { exam: "Physics C", score: 4 },
    ]),
    JSON.stringify([
      { test: "sat", totalScore: 1540 },
      { test: "act", totalScore: 34 },
    ]),
    JSON.stringify([
      { name: "Science Olympiad" },
      { name: "Robotics" },
    ]),
    "Engineering",
    JSON.stringify([]),
    "test",
  );

  stmts.insertCapability.run("cap_1", "student_1", "gpa_uw", 3.92, 96, 93);
  stmts.insertCapability.run("cap_2", "student_1", "sat_total", 1540, 99, 98);
  stmts.insertCapability.run("cap_3", "student_1", "act_total", 34, 98, null);

  const data = getDirectStructuredStudentData(stmts, "student_1");
  assert.equal(data.retrieval, "direct_db");
  assert.deepEqual(data.sourceTables, [
    "profile_snapshots",
    "capability_timeline",
    "baseline_gpa",
    "baseline_sat",
    "baseline_act",
  ]);

  assert.equal(data.profile.gpaUnweighted, 3.92);
  assert.equal(data.profile.gpaWeighted, 4.41);
  assert.equal(data.profile.satTotal, 1540);
  assert.equal(data.profile.actComposite, 34);
  assert.equal(data.profile.apCourseCount, 2);
  assert.equal(data.profile.apExamCount, 2);
  assert.equal(data.profile.apAverageScore, 4.5);
  assert.equal(data.profile.activitiesCount, 2);
  assert.equal(data.profile.majorInterest, "Engineering");

  assert.equal(data.metrics.gpa_uw.value, 3.92);
  assert.equal(data.metrics.gpa_uw.percentileNational, 96);
  assert.equal(data.metrics.sat_total.value, 1540);
  assert.equal(data.metrics.act_total.percentileNational, 98);
});

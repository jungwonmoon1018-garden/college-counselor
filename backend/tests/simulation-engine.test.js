import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  initSimulationStore,
  closeSimulationStore,
  createSimulation,
  getSimulation,
  deleteSimulation,
  cleanupExpiredSimulations,
  exportStudentSimulations,
  deleteAllStudentSimulations,
} from "../simulation-engine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, "..");
const TEST_DIR = path.join(PROJECT_ROOT, "data", "simulation-engine-tests");

function cleanupFiles() {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
}

function makeRequest() {
  return {
    studentId: "student-sim-1",
    scenarioName: "More rigorous senior year",
    baseProfile: {
      gpa: { unweighted: 3.7, weighted: 4.1 },
      courses: [{ name: "AP Calculus AB", type: "ap", grade: "A" }],
      testScores: [{ test: "sat", totalScore: 1420 }],
      activities: [{ name: "Debate", role: "Member", description: "Weekly debate club." }],
      goals: ["Example Tech"],
      majorInterest: "Computer Science",
    },
    profilePatch: {
      gpa: { unweighted: 3.92 },
      activities: [{ name: "AI Research", role: "Lead", description: "Published an ML project." }],
    },
    targets: [{
      collegeContext: {
        name: "Example Tech",
        acceptanceRate: 18,
        avgGpaAdmitted: 3.85,
        sat25: 1400,
        sat75: 1530,
        topMajors: ["Computer Science"],
        source: "test",
      },
      cdsResult: {
        schoolName: "Example Tech",
        source: "test",
        fetchStatus: "simulated",
        parsed: { admitRatePercent: 18, gpaAverage: 3.85, c7: { academicGpa: 1, rigor: 0.7 } },
      },
    }],
  };
}

test("simulation store creates, fetches, and deletes isolated simulations", async () => {
  cleanupFiles();
  const store = initSimulationStore(TEST_DIR);
  try {
    const created = await createSimulation(store, makeRequest(), { ttlDays: 7 });
    assert.equal(created.simulation, true);
    assert.equal(created.basedOnStudentId, "student-sim-1");
    assert.equal(created.profile.gpa.unweighted, 3.92);
    assert.ok(created.profilePath === undefined);
    assert.ok(created.vectors.length >= 1);
    assert.ok(created.positioning.targets.length === 1);
    assert.ok(store.profilePath.endsWith("simulated-profiles.db"));
    assert.ok(store.vectorPath.endsWith("simulated-vectors.db"));

    const fetched = getSimulation(store, "student-sim-1", created.simulationId);
    assert.equal(fetched.simulationId, created.simulationId);
    assert.equal(fetched.profile.activities[0].name, "AI Research");

    const deleted = deleteSimulation(store, "student-sim-1", created.simulationId);
    assert.equal(deleted.deleted, true);
    assert.equal(getSimulation(store, "student-sim-1", created.simulationId), null);
  } finally {
    closeSimulationStore(store);
    cleanupFiles();
  }
});

test("simulation cleanup destroys expired profiles and vectors", async () => {
  cleanupFiles();
  const store = initSimulationStore(TEST_DIR);
  try {
    const created = await createSimulation(store, makeRequest(), { ttlDays: 1 });
    store.profileDb.prepare("UPDATE simulated_profiles SET expires_at = datetime('now', '-1 minute') WHERE id = ?").run(created.simulationId);
    store.vectorDb.prepare("UPDATE simulated_vectors SET expires_at = datetime('now', '-1 minute') WHERE simulation_id = ?").run(created.simulationId);
    const cleanup = cleanupExpiredSimulations(store);
    assert.equal(cleanup.profiles, 1);
    assert.ok(cleanup.vectors >= 1);
    assert.equal(store.profileStmts.count.get().count, 0);
    assert.equal(store.vectorStmts.count.get().count, 0);
  } finally {
    closeSimulationStore(store);
    cleanupFiles();
  }
});

test("simulation patch rejects unsupported profile fields", async () => {
  cleanupFiles();
  const store = initSimulationStore(TEST_DIR);
  try {
    await assert.rejects(
      () => createSimulation(store, { ...makeRequest(), profilePatch: { studentId: "bad" } }),
      /Unsupported simulation patch field/,
    );
  } finally {
    closeSimulationStore(store);
    cleanupFiles();
  }
});

test("simulation store rejects DB paths that could target production stores", () => {
  cleanupFiles();
  assert.throws(
    () => initSimulationStore(TEST_DIR, {
      profilePath: path.join(TEST_DIR, "counselor.db"),
      vectorPath: path.join(TEST_DIR, "simulated-vectors.db"),
    }),
    /simulated-profiles/,
  );
  assert.throws(
    () => initSimulationStore(TEST_DIR, {
      profilePath: path.join(TEST_DIR, "simulated-profiles.db"),
      vectorPath: path.join(TEST_DIR, "vectors.db"),
    }),
    /simulated-vectors/,
  );
  cleanupFiles();
});

test("simulation export and erasure are exact-student, complete, and idempotent", async () => {
  cleanupFiles();
  const store = initSimulationStore(TEST_DIR);
  try {
    const first = await createSimulation(store, {
      ...makeRequest(),
      scenarioName: "Student A first scenario",
      scenario: { name: "Student A first scenario", note: "export this scenario" },
    });
    const second = await createSimulation(store, {
      ...makeRequest(),
      scenarioName: "Student A second scenario",
      profilePatch: { gpa: { unweighted: 4 } },
    });
    const other = await createSimulation(store, {
      ...makeRequest(),
      studentId: "student-sim-2",
      scenarioName: "Student B private scenario",
    });

    // Even a malformed cross-tenant vector with A's simulation ID must never
    // appear in A's export because both ownership columns are constrained.
    store.vectorStmts.insert.run(
      "cross-tenant-vector",
      first.simulationId,
      "student-sim-2",
      "ec_strength",
      "Student B private vector",
      JSON.stringify({ private: true }),
      new Date(Date.now() + 86_400_000).toISOString(),
    );

    const exported = exportStudentSimulations(store, "student-sim-1");
    assert.equal(exported.format, "College Counselor Simulation Export v1");
    assert.equal(exported.studentId, "student-sim-1");
    assert.deepEqual(
      exported.simulations.map((simulation) => simulation.simulationId).sort(),
      [first.simulationId, second.simulationId].sort(),
    );
    assert.ok(exported.simulations.every(
      (simulation) => simulation.basedOnStudentId === "student-sim-1"));
    const exportedFirst = exported.simulations.find(
      (simulation) => simulation.simulationId === first.simulationId);
    assert.equal(exportedFirst.baseProfile.gpa.unweighted, 3.7);
    assert.equal(exportedFirst.scenario.note, "export this scenario");
    assert.ok(exported.simulations.flatMap((simulation) => simulation.vectors)
      .every((vector) => vector.name !== "Student B private vector"));

    const vectorsBeforeRollback = store.vectorDb.prepare(
      "SELECT COUNT(*) AS count FROM simulated_vectors WHERE student_id = ?",
    ).get("student-sim-1").count;
    store.profileDb.exec(`CREATE TRIGGER reject_test_erasure
      BEFORE DELETE ON simulated_profiles
      WHEN OLD.student_id = 'student-sim-1'
      BEGIN SELECT RAISE(ABORT, 'test rollback'); END`);
    assert.throws(
      () => deleteAllStudentSimulations(store, "student-sim-1"),
      /test rollback/,
    );
    assert.equal(exportStudentSimulations(store, "student-sim-1").simulations.length, 2);
    assert.equal(store.vectorDb.prepare(
      "SELECT COUNT(*) AS count FROM simulated_vectors WHERE student_id = ?",
    ).get("student-sim-1").count, vectorsBeforeRollback);
    store.profileDb.exec("DROP TRIGGER reject_test_erasure");

    const erased = deleteAllStudentSimulations(store, "student-sim-1");
    assert.equal(erased.deleted, true);
    assert.equal(erased.studentId, "student-sim-1");
    assert.equal(erased.deletedRows.profiles, 2);
    assert.ok(erased.deletedRows.vectors >= 2);
    assert.deepEqual(exportStudentSimulations(store, "student-sim-1").simulations, []);

    const otherExport = exportStudentSimulations(store, "student-sim-2");
    assert.equal(otherExport.simulations.length, 1);
    assert.equal(otherExport.simulations[0].simulationId, other.simulationId);

    const repeated = deleteAllStudentSimulations(store, "student-sim-1");
    assert.deepEqual(repeated.deletedRows, { profiles: 0, vectors: 0 });
    assert.equal(repeated.deleted, true);
  } finally {
    closeSimulationStore(store);
    cleanupFiles();
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, "..");
const BASE = "http://localhost:3101";
const SIM_BASE = "http://localhost:3102";
const TEST_DATA_DIR = path.join(PROJECT_ROOT, "data", "simulations-endpoint-test");
const TEST_DB_PATH = path.join(TEST_DATA_DIR, "counselor.db");
const TEST_SIM_PROFILE_DB = path.join(TEST_DATA_DIR, "simulated-profiles.endpoint.test.db");
const TEST_SIM_VECTOR_DB = path.join(TEST_DATA_DIR, "simulated-vectors.endpoint.test.db");

function clean() {
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
}

async function waitFor(url, proc, outputRef) {
  for (let i = 0; i < 50; i++) {
    if (proc.exitCode != null) throw new Error(`Process exited before ${url}\n${outputRef()}`);
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${url}\n${outputRef()}`);
}

async function req(method, urlPath, body = null, headers = {}) {
  const opts = { method, headers: { "Content-Type": "application/json", ...headers } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${urlPath}`, opts);
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function simReq(method, urlPath, body = null, token = "endpoint-sim-token") {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["x-simulation-internal-token"] = token;
  const res = await fetch(`${SIM_BASE}${urlPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function withServers(fn) {
  clean();
  let sidecarOutput = "";
  let serverOutput = "";
  const sidecar = spawn(process.execPath, ["simulation-sidecar.js"], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      NODE_ENV: "test",
      DATA_DIR: TEST_DATA_DIR,
      SIM_PORT: "3102",
      SIM_INTERNAL_TOKEN: "endpoint-sim-token",
      SIM_PROFILE_DB_PATH: TEST_SIM_PROFILE_DB,
      SIM_VECTOR_DB_PATH: TEST_SIM_VECTOR_DB,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  sidecar.stdout.on("data", c => { sidecarOutput += c.toString(); });
  sidecar.stderr.on("data", c => { sidecarOutput += c.toString(); });
  try {
    await waitFor(`${SIM_BASE}/health`, sidecar, () => sidecarOutput);

    const server = spawn(process.execPath, ["server.js"], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        PORT: "3101",
        NODE_ENV: "test",
        DATA_DIR: TEST_DATA_DIR,
        DB_PATH: TEST_DB_PATH,
        COUNSELOR_PASS: "testpass",
        SCORECARD_API_KEY: "",
        SIM_URL: SIM_BASE,
        SIM_INTERNAL_TOKEN: "endpoint-sim-token",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout.on("data", c => { serverOutput += c.toString(); });
    server.stderr.on("data", c => { serverOutput += c.toString(); });
    try {
      await waitFor(`${BASE}/api/health`, server, () => serverOutput);
      await fn({ server, sidecar });
    } finally {
      if (server.exitCode == null && server.signalCode == null) {
        server.kill("SIGTERM");
        await new Promise(resolve => server.once("exit", resolve));
      }
    }
  } finally {
    if (sidecar.exitCode == null && sidecar.signalCode == null) {
      sidecar.kill("SIGTERM");
      await new Promise(resolve => sidecar.once("exit", resolve));
    }
    clean();
  }
}

test("simulation proxy creates temporary vectors without changing actual profile", async () => {
  await withServers(async () => {
    const register = await req("POST", "/api/students/register", {
      email: "sim-endpoint@example.com",
      majorInterest: "Computer Science",
      grade: "11",
      password: "simulation endpoint test password",
    });
    assert.equal(register.status, 201);
    const token = register.data.token;
    await delay(1100);

    const sync = await req("POST", "/api/students/sync", {
      profile: {
        gpa: { unweighted: 3.8, weighted: 4.2 },
        courses: [{ name: "AP Calculus AB", type: "ap", grade: "A" }],
        testScores: [{ test: "sat", totalScore: 1450 }],
      },
      activities: [{ name: "Coding Club", role: "Member", description: "Built web apps." }],
      goals: ["Example Tech"],
      majorInterest: "Computer Science",
    }, { Authorization: `Bearer ${token}` });
    assert.equal(sync.status, 200);

    const created = await req("POST", "/api/simulations", {
      profilePatch: {
        gpa: { unweighted: 3.95 },
        testScores: [{ test: "sat", totalScore: 1560 }],
        activities: [{ name: "AI Research", role: "Lead", description: "Published a model evaluation project." }],
      },
    }, { Authorization: `Bearer ${token}` });
    assert.equal(created.status, 201);
    assert.equal(created.data.simulation, true);
    assert.equal(created.data.profile.gpa.unweighted, 3.95);
    assert.ok(created.data.vectors.length >= 1);
    assert.ok(fs.existsSync(TEST_SIM_PROFILE_DB));
    assert.ok(fs.existsSync(TEST_SIM_VECTOR_DB));

    const actual = await req("GET", "/api/students/profile", null, { Authorization: `Bearer ${token}` });
    assert.equal(actual.status, 200);
    assert.equal(actual.data.profile.gpa.unweighted, 3.8);
    assert.equal(actual.data.profile.testScores[0].totalScore, 1450);

    const fetched = await req("GET", `/api/simulations/${created.data.simulationId}`, null, { Authorization: `Bearer ${token}` });
    assert.equal(fetched.status, 200);
    assert.equal(fetched.data.simulationId, created.data.simulationId);

    const exported = await req("GET", "/api/students/export", null, { Authorization: `Bearer ${token}` });
    assert.equal(exported.status, 200);
    assert.equal(exported.data.exportMeta.format, "College Counselor Student Data Export v4");
    assert.equal(exported.data.simulations.length, 1);
    assert.equal(exported.data.simulations[0].simulationId, created.data.simulationId);

    const erased = await req("DELETE", "/api/students", null, { Authorization: `Bearer ${token}` });
    assert.equal(erased.status, 200);
    assert.equal(erased.data.deleted, true);
    assert.ok(erased.data.jobId);

    const staleSession = await req("GET", "/api/students/profile", null, { Authorization: `Bearer ${token}` });
    assert.equal(staleSession.status, 401);
    const simulationsAfterErasure = await simReq(
      "POST",
      "/internal/simulations/export",
      { studentId: register.data.studentId },
    );
    assert.equal(simulationsAfterErasure.status, 200);
    assert.deepEqual(simulationsAfterErasure.data.simulations, []);
  });
});

test("internal simulation export and delete-all routes isolate the exact student", async () => {
  await withServers(async () => {
    const request = {
      studentId: "opaque-student-a",
      scenarioName: "Private A scenario",
      baseProfile: {
        gpa: { unweighted: 3.8 },
        activities: [{ name: "A private activity", description: "A only" }],
        majorInterest: "History",
      },
      profilePatch: { gpa: { unweighted: 3.9 } },
    };
    const first = await simReq("POST", "/simulations", request);
    const second = await simReq("POST", "/simulations", {
      ...request,
      scenarioName: "Second A scenario",
    });
    const other = await simReq("POST", "/simulations", {
      ...request,
      studentId: "opaque-student-b",
      scenarioName: "Private B scenario",
    });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(other.status, 201);

    const unauthorized = await simReq(
      "POST",
      "/internal/simulations/export",
      { studentId: "opaque-student-a" },
      null,
    );
    assert.equal(unauthorized.status, 401);

    const exported = await simReq(
      "POST",
      "/internal/simulations/export?studentId=opaque-student-b",
      { studentId: "opaque-student-a" },
    );
    assert.equal(exported.status, 200);
    assert.equal(exported.data.studentId, "opaque-student-a");
    assert.equal(exported.data.simulations.length, 2);
    assert.deepEqual(
      exported.data.simulations.map((simulation) => simulation.simulationId).sort(),
      [first.data.simulationId, second.data.simulationId].sort(),
    );
    assert.ok(exported.data.simulations.every(
      (simulation) => simulation.basedOnStudentId === "opaque-student-a"));
    assert.ok(exported.data.simulations.every(
      (simulation) => simulation.scenarioName !== "Private B scenario"));

    const erased = await simReq(
      "POST",
      "/internal/simulations/delete-all",
      { studentId: "opaque-student-a" },
    );
    assert.equal(erased.status, 200);
    assert.equal(erased.data.deleted, true);
    assert.equal(erased.data.deletedRows.profiles, 2);
    assert.ok(erased.data.deletedRows.vectors >= 2);

    const repeated = await simReq(
      "POST",
      "/internal/simulations/delete-all",
      { studentId: "opaque-student-a" },
    );
    assert.equal(repeated.status, 200);
    assert.deepEqual(repeated.data.deletedRows, { profiles: 0, vectors: 0 });

    const otherExport = await simReq(
      "POST",
      "/internal/simulations/export",
      { studentId: "opaque-student-b" },
    );
    assert.equal(otherExport.status, 200);
    assert.equal(otherExport.data.simulations.length, 1);
    assert.equal(otherExport.data.simulations[0].simulationId, other.data.simulationId);
  });
});

test("account erasure fails closed and persists a retry job when the sidecar is unavailable", async () => {
  await withServers(async ({ sidecar }) => {
    const register = await req("POST", "/api/students/register", {
      email: "sim-erasure-retry@example.com",
      majorInterest: "History",
      grade: "11",
      password: "simulation erasure retry test password",
    });
    assert.equal(register.status, 201);
    const seeded = await simReq("POST", "/simulations", {
      studentId: register.data.studentId,
      scenarioName: "Residual simulation until retry",
      baseProfile: { gpa: { unweighted: 3.7 }, majorInterest: "History" },
      profilePatch: { gpa: { unweighted: 3.8 } },
    });
    assert.equal(seeded.status, 201);

    sidecar.kill("SIGKILL");
    await new Promise(resolve => sidecar.once("exit", resolve));

    const erased = await req("DELETE", "/api/students", null, {
      Authorization: `Bearer ${register.data.token}`,
    });
    assert.equal(erased.status, 202);
    assert.equal(erased.data.deleted, false);
    assert.equal(erased.data.deletionPending, true);
    assert.ok(erased.data.jobId);

    const staleSession = await req("GET", "/api/students/profile", null, {
      Authorization: `Bearer ${register.data.token}`,
    });
    assert.equal(staleSession.status, 401);

    const operational = new Database(TEST_DB_PATH, { readonly: true });
    const profileStore = new Database(TEST_SIM_PROFILE_DB, { readonly: true });
    try {
      const job = operational.prepare(`
        SELECT status, attempts, last_error_code
        FROM student_erasure_jobs WHERE id = ?
      `).get(erased.data.jobId);
      assert.equal(job.status, "failed");
      assert.equal(job.attempts, 1);
      assert.equal(job.last_error_code, "erasure_incomplete_simulations");
      assert.equal(
        profileStore.prepare("SELECT COUNT(*) AS count FROM simulated_profiles WHERE student_id = ?")
          .get(register.data.studentId).count,
        1,
      );
    } finally {
      operational.close();
      profileStore.close();
    }
  });
});

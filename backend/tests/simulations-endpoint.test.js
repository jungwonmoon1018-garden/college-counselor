import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, "..");
const BASE = "http://localhost:3101";
const SIM_BASE = "http://localhost:3102";
const TEST_DB_PATH = path.join(PROJECT_ROOT, "data", "counselor.sim-endpoint.test.db");
const TEST_SIM_PROFILE_DB = path.join(PROJECT_ROOT, "data", "simulated-profiles.endpoint.test.db");
const TEST_SIM_VECTOR_DB = path.join(PROJECT_ROOT, "data", "simulated-vectors.endpoint.test.db");

function clean() {
  for (const file of [TEST_DB_PATH, TEST_SIM_PROFILE_DB, TEST_SIM_VECTOR_DB]) {
    for (const suffix of ["", "-shm", "-wal"]) fs.rmSync(`${file}${suffix}`, { force: true });
  }
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

async function withServers(fn) {
  clean();
  let sidecarOutput = "";
  let serverOutput = "";
  const sidecar = spawn(process.execPath, ["simulation-sidecar.js"], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      NODE_ENV: "test",
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
      await fn();
    } finally {
      if (server.exitCode == null) {
        server.kill("SIGTERM");
        await new Promise(resolve => server.once("exit", resolve));
      }
    }
  } finally {
    if (sidecar.exitCode == null) {
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
    });
    assert.equal(register.status, 200);
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

    const deleted = await req("DELETE", `/api/simulations/${created.data.simulationId}`, null, { Authorization: `Bearer ${token}` });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.data.deleted, true);
  });
});

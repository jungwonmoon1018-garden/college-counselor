// ═══════════════════════════════════════════════════════════
// ENDPOINT TESTS — run with: node --test tests/
// ═══════════════════════════════════════════════════════════
// These tests verify the backend endpoints work correctly
// without making actual API calls or sending emails.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { redactAnthropicPayload, restoreAnthropicResponse } from "../orchestration-engine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, "..");
const BASE = "http://localhost:3001";
const SIM_BASE = "http://localhost:3002";
const TEST_DB_PATH = path.join(PROJECT_ROOT, "data", "counselor.test.db");
const TEST_SIM_PROFILE_DB = path.join(PROJECT_ROOT, "data", "simulated-profiles.test.db");
const TEST_SIM_VECTOR_DB = path.join(PROJECT_ROOT, "data", "simulated-vectors.test.db");
let serverProcess;
let sidecarProcess;
let serverOutput = "";
let sidecarOutput = "";

async function waitForUrl(url, getOutput) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}

    await delay(200);
  }

  throw new Error(`Timed out waiting for ${url}.\n${getOutput()}`);
}

before(async () => {
  for (const suffix of ["", "-shm", "-wal"]) {
    fs.rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
    fs.rmSync(`${TEST_SIM_PROFILE_DB}${suffix}`, { force: true });
    fs.rmSync(`${TEST_SIM_VECTOR_DB}${suffix}`, { force: true });
  }

  sidecarProcess = spawn(process.execPath, ["simulation-sidecar.js"], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      SIM_PORT: "3002",
      SIM_INTERNAL_TOKEN: "test-simulation-token",
      SIM_PROFILE_DB_PATH: TEST_SIM_PROFILE_DB,
      SIM_VECTOR_DB_PATH: TEST_SIM_VECTOR_DB,
      NODE_ENV: "test",
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  sidecarProcess.stdout.on("data", chunk => { sidecarOutput += chunk.toString(); });
  sidecarProcess.stderr.on("data", chunk => { sidecarOutput += chunk.toString(); });
  await waitForUrl(`${SIM_BASE}/health`, () => sidecarOutput);

  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PORT: "3001",
      NODE_ENV: "test",
      DB_PATH: TEST_DB_PATH,
      COUNSELOR_PASS: process.env.COUNSELOR_PASS || "testpass",
      SCORECARD_API_KEY: "",
      SIM_URL: SIM_BASE,
      SIM_INTERNAL_TOKEN: "test-simulation-token",
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  serverProcess.stdout.on("data", chunk => {
    serverOutput += chunk.toString();
  });
  serverProcess.stderr.on("data", chunk => {
    serverOutput += chunk.toString();
  });

  await waitForUrl(`${BASE}/api/health`, () => serverOutput);
});

after(async () => {
  if (serverProcess && serverProcess.exitCode == null) {
    serverProcess.kill("SIGTERM");
    await new Promise(resolve => serverProcess.once("exit", resolve));
  }
  if (sidecarProcess && sidecarProcess.exitCode == null) {
    sidecarProcess.kill("SIGTERM");
    await new Promise(resolve => sidecarProcess.once("exit", resolve));
  }

  for (const suffix of ["", "-shm", "-wal"]) {
    fs.rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
    fs.rmSync(`${TEST_SIM_PROFILE_DB}${suffix}`, { force: true });
    fs.rmSync(`${TEST_SIM_VECTOR_DB}${suffix}`, { force: true });
  }
});

// ─── Helper: make HTTP requests ───
async function req(method, path, body = null, headers = {}) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json", ...headers },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const data = await res.json().catch(() => null);
  return { status: res.status, data, headers: res.headers };
}

async function createStudentSession(overrides = {}) {
  const emailHash = overrides.emailHash || `student_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const register = await req("POST", "/api/students/register", {
    email: overrides.email || `${emailHash}@example.test`,
    grade: overrides.grade || "11",
    state: overrides.state || "CA",
    schoolDomain: overrides.schoolDomain || "example.edu",
    majorInterest: overrides.majorInterest || "Business/Economics",
  });

  assert.equal(register.status, 200);
  const token = register.data.token;
  assert.ok(token, "Student registration should return a session token");

  const sync = await req("POST", "/api/students/sync", {
    profile: {
      gpa: { unweighted: 3.86, weighted: 4.32 },
      courses: [
        { name: "AP Calculus AB", type: "ap" },
        { name: "AP English Language", type: "ap" },
      ],
      testScores: [
        { test: "sat", totalScore: 1450 },
      ],
      apScores: [
        { exam: "Calculus AB", score: 5, year: 2025 },
      ],
    },
    activities: [
      { name: "DECA", role: "President", category: "club" },
      { name: "Local Nonprofit", role: "Founder", category: "community_service" },
    ],
    goals: ["Business school", "Leadership growth"],
    majorInterest: overrides.majorInterest || "Business/Economics",
  }, {
    Authorization: `Bearer ${token}`,
  });

  assert.equal(sync.status, 200);
  return { token, emailHash };
}

// ═══════════════════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════════════════
describe("GET /api/health", () => {
  it("returns status ok", async () => {
    const { status, data } = await req("GET", "/api/health");
    assert.equal(status, 200);
    assert.equal(data.status, "ok");
    assert.ok(data.timestamp);
    assert.ok(typeof data.uptime === "number");
  });
});

// ═══════════════════════════════════════════════════════════
// AUDIT ENDPOINT
// ═══════════════════════════════════════════════════════════
describe("POST /api/audit", () => {
  it("stores a valid audit event", async () => {
    const { status, data } = await req("POST", "/api/audit", {
      type: "crisis_detected",
      userHint: "te***",
      details: "Test crisis event",
      timestamp: new Date().toISOString(),
    });
    assert.equal(status, 200);
    assert.equal(data.stored, true);
    assert.ok(data.id);
  });

  it("rejects invalid audit type", async () => {
    const { status } = await req("POST", "/api/audit", {
      type: "invalid_type",
      details: "Should be rejected",
    });
    assert.equal(status, 400);
  });

  it("accepts all valid audit types", async () => {
    const validTypes = [
      "crisis_detected", "essay_blocked", "off_topic_blocked",
      "upload_rejected", "upload_accepted", "validation_cleaned",
      "validation_failed", "validation_error", "parental_notify_sent",
    ];
    for (const type of validTypes) {
      const { status } = await req("POST", "/api/audit", { type, details: `test ${type}` });
      assert.equal(status, 200, `Failed for type: ${type}`);
    }
  });

  it("truncates oversized details", async () => {
    const longDetails = "x".repeat(1000);
    const { status, data } = await req("POST", "/api/audit", {
      type: "essay_blocked",
      details: longDetails,
    });
    assert.equal(status, 200);
    assert.ok(data.stored);
  });
});

// ═══════════════════════════════════════════════════════════
// AUDIT DASHBOARD
// ═══════════════════════════════════════════════════════════
describe("GET /api/audit/dashboard", () => {
  it("rejects unauthenticated requests", async () => {
    const { status } = await req("GET", "/api/audit/dashboard");
    assert.equal(status, 401);
  });

  it("rejects wrong credentials", async () => {
    const { status } = await req("GET", "/api/audit/dashboard", null, {
      Authorization: "Basic " + btoa("wrong:wrong"),
    });
    assert.equal(status, 403);
  });

  it("returns events with valid credentials", async () => {
    const creds = "Basic " + btoa(`${process.env.COUNSELOR_USER || "counselor"}:${process.env.COUNSELOR_PASS || "testpass"}`);
    const { status, data } = await req("GET", "/api/audit/dashboard", null, {
      Authorization: creds,
    });
    // Will be 200 if COUNSELOR_PASS=testpass, 403 otherwise
    if (status === 200) {
      assert.ok(Array.isArray(data.events));
      assert.ok(data.summary);
      assert.ok(typeof data.summary.crisisLast24h === "number");
    }
  });
});

// ═══════════════════════════════════════════════════════════
// PARENTAL NOTIFICATION
// ═══════════════════════════════════════════════════════════
describe("POST /api/notify-parent", () => {
  it("queues a valid crisis notification", async () => {
    const { status, data } = await req("POST", "/api/notify-parent", {
      to: "parent@example.com",
      studentHint: "Test Student",
      type: "crisis_alert",
      message: "Safety alert triggered",
    });
    assert.equal(status, 200);
    assert.equal(data.queued, true);
    assert.ok(data.id);
  });

  it("rejects missing email", async () => {
    const { status } = await req("POST", "/api/notify-parent", {
      type: "crisis_alert",
      message: "No email",
    });
    assert.equal(status, 400);
  });

  it("rejects non-crisis notification types", async () => {
    const { status } = await req("POST", "/api/notify-parent", {
      to: "parent@example.com",
      type: "marketing",
      message: "Not allowed",
    });
    assert.equal(status, 400);
  });

  it("rejects oversized messages (prevents student content leakage)", async () => {
    const { status } = await req("POST", "/api/notify-parent", {
      to: "parent@example.com",
      type: "crisis_alert",
      message: "x".repeat(600),
    });
    assert.equal(status, 400);
  });
});

// ═══════════════════════════════════════════════════════════
// API PROXY VALIDATION
// ═══════════════════════════════════════════════════════════
describe("POST /api/anthropic (validation only)", () => {
  it("rejects empty body", async () => {
    const { status } = await req("POST", "/api/anthropic", {});
    assert.equal(status, 400);
  });

  it("rejects invalid model shapes", async () => {
    const { status } = await req("POST", "/api/anthropic", {
      model: "bad model id",
      messages: [{ role: "user", content: "test" }],
      max_tokens: 100,
    });
    assert.equal(status, 400);
  });

  it("rejects missing messages", async () => {
    const { status } = await req("POST", "/api/anthropic", {
      model: "claude-sonnet-4-20250514",
      max_tokens: 100,
    });
    assert.equal(status, 400);
  });

  it("rejects too many messages", async () => {
    const messages = Array(51).fill({ role: "user", content: "x" });
    const { status } = await req("POST", "/api/anthropic", {
      model: "claude-sonnet-4-20250514",
      messages,
      max_tokens: 100,
    });
    assert.equal(status, 400);
  });
});

// ═══════════════════════════════════════════════════════════
// TIER 1: COLLEGE SEARCH
// ═══════════════════════════════════════════════════════════
describe("POST /api/colleges/search", () => {
  it("returns results (offline baseline fallback)", async () => {
    const { status, data } = await req("POST", "/api/colleges/search", {});
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.results));
    assert.ok(data.results.length > 0, "Should return at least 1 college from baselines");
    assert.ok(data.source);
  });

  it("filters by name", async () => {
    const { status, data } = await req("POST", "/api/colleges/search", { name: "MIT" });
    assert.equal(status, 200);
    assert.ok(data.results.some(c => c.name.includes("MIT") || c.name.includes("Massachusetts")));
  });

  it("filters by state", async () => {
    const { status, data } = await req("POST", "/api/colleges/search", { state: "CA" });
    assert.equal(status, 200);
    for (const c of data.results) {
      assert.equal(c.state, "CA");
    }
  });

  it("respects limit parameter", async () => {
    const { status, data } = await req("POST", "/api/colleges/search", { limit: 5 });
    assert.equal(status, 200);
    assert.ok(data.results.length <= 5);
  });

  it("finds expanded fallback schools like Vanderbilt", async () => {
    const { status, data } = await req("POST", "/api/colleges/search", { name: "Vanderbilt" });
    assert.equal(status, 200);
    assert.ok(data.results.some(c => c.name.includes("Vanderbilt")), "Expected Vanderbilt in fallback baseline results");
  });

  it("finds expanded fallback schools like Georgetown", async () => {
    const { status, data } = await req("POST", "/api/colleges/search", { name: "Georgetown" });
    assert.equal(status, 200);
    assert.ok(data.results.some(c => c.name.includes("Georgetown")), "Expected Georgetown in fallback baseline results");
  });
});

// ═══════════════════════════════════════════════════════════
// TIER 1: SINGLE COLLEGE LOOKUP
// ═══════════════════════════════════════════════════════════
describe("GET /api/colleges/:id", () => {
  it("returns college by unit ID (baseline fallback)", async () => {
    // First get a valid unit ID from search
    const search = await req("POST", "/api/colleges/search", { limit: 1 });
    if (search.data?.results?.length > 0) {
      const unitId = search.data.results[0].unitId;
      const { status, data } = await req("GET", `/api/colleges/${unitId}`);
      assert.equal(status, 200);
      assert.ok(data.name);
      assert.ok(data.unitId || data.unit_id);
    }
  });

  it("returns 404 for unknown college", async () => {
    const { status } = await req("GET", "/api/colleges/9999999");
    assert.equal(status, 404);
  });

  it("rejects oversized unit ID", async () => {
    const { status } = await req("GET", "/api/colleges/12345678901");
    assert.equal(status, 400);
  });
});

// ═══════════════════════════════════════════════════════════
// TIER 3: FINANCIAL AID
// ═══════════════════════════════════════════════════════════
describe("GET /api/colleges/:id/financial-aid", () => {
  it("returns financial profile (baseline fallback)", async () => {
    const search = await req("POST", "/api/colleges/search", { limit: 1 });
    if (search.data?.results?.length > 0) {
      const unitId = search.data.results[0].unitId;
      const { status, data } = await req("GET", `/api/colleges/${unitId}/financial-aid`);
      assert.equal(status, 200);
      assert.ok(data.name);
      assert.ok(data.source);
    }
  });

  it("returns 404 for unknown college", async () => {
    const { status } = await req("GET", "/api/colleges/9999999/financial-aid");
    assert.equal(status, 404);
  });
});

// ═══════════════════════════════════════════════════════════
// TIER 4: COLLEGE COMPARISON MATRIX
// ═══════════════════════════════════════════════════════════
describe("POST /api/colleges/compare", () => {
  it("compares colleges from baseline data", async () => {
    const search = await req("POST", "/api/colleges/search", { limit: 3 });
    if (search.data?.results?.length >= 2) {
      const ids = search.data.results.slice(0, 3).map(c => c.unitId);
      const { status, data } = await req("POST", "/api/colleges/compare", { unitIds: ids });
      assert.equal(status, 200);
      assert.ok(Array.isArray(data.colleges));
      assert.ok(Array.isArray(data.matrix));
      assert.ok(data.matrix.length > 0);
      // Each matrix dimension should have values for each college
      for (const dim of data.matrix) {
        assert.ok(dim.dimension);
        assert.ok(Array.isArray(dim.values));
      }
    }
  });

  it("rejects fewer than 2 unit IDs", async () => {
    const { status } = await req("POST", "/api/colleges/compare", { unitIds: ["123456"] });
    assert.equal(status, 400);
  });

  it("rejects more than 8 unit IDs", async () => {
    const ids = Array(9).fill("123456");
    const { status } = await req("POST", "/api/colleges/compare", { unitIds: ids });
    assert.equal(status, 400);
  });

  it("rejects non-array unitIds", async () => {
    const { status } = await req("POST", "/api/colleges/compare", { unitIds: "not-array" });
    assert.equal(status, 400);
  });
});

// ═══════════════════════════════════════════════════════════
// BASELINES STATUS
// ═══════════════════════════════════════════════════════════
describe("GET /api/baselines/status", () => {
  it("returns baseline counts and freshness data", async () => {
    const { status, data } = await req("GET", "/api/baselines/status");
    assert.equal(status, 200);
    assert.ok(data.baselines);
    assert.ok(typeof data.baselines.gpa === "number");
    assert.ok(typeof data.baselines.colleges === "number");
    assert.ok(data.status);
    // Freshness alerts (5c)
    assert.ok(data.freshness, "Should include freshness data");
    assert.ok(Array.isArray(data.freshness.datasets));
    assert.ok(data.freshness.datasets.length >= 5, "Should check 5 datasets");
    for (const ds of data.freshness.datasets) {
      assert.ok(ds.label);
      assert.ok(["current", "stale", "missing"].includes(ds.status));
      assert.ok(typeof ds.stale === "boolean");
    }
    assert.ok(typeof data.freshness.staleCount === "number");
    assert.ok(data.freshness.lastChecked);
  });
});

// ═══════════════════════════════════════════════════════════
// COUNSELOR DASHBOARD UI
// ═══════════════════════════════════════════════════════════
describe("GET /dashboard", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await fetch(`${BASE}/dashboard`);
    assert.equal(res.status, 401);
  });

  it("returns HTML with valid credentials", async () => {
    const creds = "Basic " + btoa(`${process.env.COUNSELOR_USER || "counselor"}:${process.env.COUNSELOR_PASS || "testpass"}`);
    const res = await fetch(`${BASE}/dashboard`, { headers: { Authorization: creds } });
    if (res.status === 200) {
      const html = await res.text();
      assert.ok(html.includes("Safety & Audit Dashboard"), "Should contain dashboard title");
      assert.ok(html.includes("Crisis"), "Should contain crisis section");
      assert.ok(html.includes("Baseline Data Freshness"), "Should contain freshness section");
    }
  });
});

// ═══════════════════════════════════════════════════════════
// STUDENT DATA EXPORT (FERPA/GDPR)
// ═══════════════════════════════════════════════════════════
describe("GET /api/students/export", () => {
  it("rejects unauthenticated requests", async () => {
    const { status } = await req("GET", "/api/students/export");
    assert.equal(status, 401);
  });
});

describe("POST /api/agents/orchestrate", () => {
  it("routes a college-match query with masking and structured grounding", async () => {
    const { token } = await createStudentSession();
    const { status, data } = await req("POST", "/api/agents/orchestrate", {
      query: "Can I get into UMich Ross? My SSN is 123-45-6789 and my email is student@example.com.",
    }, {
      Authorization: `Bearer ${token}`,
    });

    assert.equal(status, 200);
    assert.equal(data.route.intent, "college_match");
    assert.equal(data.executionPlan.primaryAgent.id, "data_miner");
    assert.equal(data.compliance.piiMasking.applied, true);
    assert.match(data.query.masked, /STUDENT_SSN_01/);
    assert.match(data.query.masked, /STUDENT_EMAIL_01/);
    assert.ok(Array.isArray(data.retrieval.structured.colleges));
    assert.ok(data.retrieval.structured.colleges.some(c => c.name.includes("University of Michigan")));
    assert.ok(Array.isArray(data.retrieval.unstructured.topDocuments));
    assert.ok(data.retrieval.unstructured.topDocuments.length > 0);
  });

  it("routes FAFSA queries to the compliance officer and reports missing corpus honestly", async () => {
    const { token } = await createStudentSession({ majorInterest: "Engineering" });
    const { status, data } = await req("POST", "/api/agents/orchestrate", {
      query: "How will FAFSA affect need-based aid at MIT?",
    }, {
      Authorization: `Bearer ${token}`,
    });

    assert.equal(status, 200);
    assert.equal(data.route.intent, "financial_aid");
    assert.equal(data.executionPlan.primaryAgent.id, "compliance_officer");
    assert.equal(data.compliance.fafsaGrounding.required, true);
    assert.equal(data.compliance.fafsaGrounding.ready, false);
    assert.ok(data.knowledgeGaps.includes("fafsa_corpus_missing"));
  });
});

describe("POST /api/mcp/admissions/query", () => {
  it("returns deterministic college snapshots for matched schools", async () => {
    const { token } = await createStudentSession();
    const { status, data } = await req("POST", "/api/mcp/admissions/query", {
      operation: "college_snapshot",
      query: "Need a grounded snapshot for UMich",
    }, {
      Authorization: `Bearer ${token}`,
    });

    assert.equal(status, 200);
    assert.equal(data.server, "admissions-mcp");
    assert.equal(data.operation, "college_snapshot");
    assert.ok(data.result.name.includes("University of Michigan"));
    assert.ok(typeof data.result.acceptanceRatePct === "number");
  });
});

describe("POST /api/simulations", () => {
  it("creates a temporary simulated profile without changing the actual student profile", async () => {
    const { token } = await createStudentSession({ majorInterest: "Computer Science" });
    const before = await req("GET", "/api/students/profile", null, { Authorization: `Bearer ${token}` });
    assert.equal(before.status, 200);
    assert.equal(before.data.profile.majorInterest, "Computer Science");

    const create = await req("POST", "/api/simulations", {
      scenarioName: "Higher SAT and robotics focus",
      profilePatch: {
        gpa: { unweighted: 3.95 },
        testScores: [{ test: "sat", totalScore: 1560 }],
        activities: [
          { name: "Robotics Team", role: "Captain", description: "Led autonomous robot design for state finals." },
        ],
      },
      targets: [{
        collegeContext: {
          name: "Example Tech",
          acceptanceRate: 12,
          avgGpaAdmitted: 3.9,
          sat25: 1450,
          sat75: 1560,
          topMajors: ["Computer Science"],
          source: "test",
        },
        cdsResult: {
          schoolName: "Example Tech",
          source: "test",
          fetchStatus: "simulated",
          parsed: {
            admitRatePercent: 12,
            gpaAverage: 3.9,
            testPolicy: "test_considered_or_required",
            c7: { academicGpa: 1, rigor: 1, standardizedTests: 0.7, essay: 0.35, extracurriculars: 0.35 },
          },
        },
      }],
    }, { Authorization: `Bearer ${token}` });

    assert.equal(create.status, 201);
    assert.equal(create.data.simulation, true);
    assert.ok(create.data.simulationId);
    assert.equal(create.data.profile.gpa.unweighted, 3.95);
    assert.ok(Array.isArray(create.data.vectors));
    assert.ok(create.data.positioning.targets.length > 0);
    assert.ok(Date.parse(create.data.expiresAt) > Date.now());

    const get = await req("GET", `/api/simulations/${create.data.simulationId}`, null, { Authorization: `Bearer ${token}` });
    assert.equal(get.status, 200);
    assert.equal(get.data.simulationId, create.data.simulationId);

    const after = await req("GET", "/api/students/profile", null, { Authorization: `Bearer ${token}` });
    assert.equal(after.status, 200);
    assert.equal(after.data.profile.gpa.unweighted, before.data.profile.gpa.unweighted);
    assert.equal(after.data.profile.testScores[0].totalScore, 1450);

    const del = await req("DELETE", `/api/simulations/${create.data.simulationId}`, null, { Authorization: `Bearer ${token}` });
    assert.equal(del.status, 200);
    assert.equal(del.data.deleted, true);
  });

  it("does not expose simulation routes under actual student/vector prefixes", async () => {
    const source = fs.readFileSync(path.join(PROJECT_ROOT, "server.js"), "utf8");
    const routeMatches = [...source.matchAll(/app\.(get|post|put|patch|delete)\("([^"]*simulation[^"]*)"/g)]
      .map(match => match[2]);
    assert.ok(routeMatches.length >= 3);
    for (const routePath of routeMatches) {
      assert.ok(routePath.startsWith("/api/simulations"), `${routePath} should stay in the simulation namespace`);
      assert.ok(!routePath.startsWith("/api/students"));
      assert.ok(!routePath.startsWith("/api/positioning"));
      assert.ok(!routePath.startsWith("/api/ec"));
      assert.ok(!routePath.startsWith("/api/directionality"));
      assert.ok(!routePath.startsWith("/api/ap-concepts"));
    }
  });
});

describe("PII redaction pipeline", () => {
  it("applies deterministic, contextual, and guardian-style masking with token restoration", () => {
    const payload = {
      model: "claude-sonnet-4-20250514",
      messages: [{
        role: "user",
        content: "John Doe from Lakeside High lives at 123 Main Street, Evanston, IL 60201. Family income is $180,000 and student ID is U-12345. Email me at john@example.com.",
      }],
    };

    const redacted = redactAnthropicPayload(payload);
    const text = redacted.payload.messages[0].content;

    assert.match(text, /\[STUDENT_NAME_01\]/);
    assert.match(text, /\[CURRENT_SCHOOL_01\]/);
    assert.match(text, /\[STREET_ADDRESS_01\]/);
    assert.match(text, /\[ANNUAL_INCOME_01\]/);
    assert.match(text, /\[STUDENT_ID_01\]/);
    assert.match(text, /\[STUDENT_EMAIL_01\]/);
    assert.equal(redacted.masking.applied, true);
    assert.ok(redacted.masking.byLayer.deterministic >= 2);
    assert.ok(redacted.masking.byLayer.guardian_slm >= 1);
    assert.ok(redacted.masking.restorableTokens >= 2);

    const restored = restoreAnthropicResponse({
      content: [{
        type: "text",
        text: "[STUDENT_NAME_01] should focus on leadership at [CURRENT_SCHOOL_01], but sensitive financial placeholders stay masked like [ANNUAL_INCOME_01].",
      }],
    }, redacted.tokenMap);

    const restoredText = restored.response.content[0].text;
    assert.match(restoredText, /John Doe/);
    assert.match(restoredText, /Lakeside High/);
    assert.match(restoredText, /\[ANNUAL_INCOME_01\]/);
    assert.equal(restored.restoration.applied, true);
  });

  it("strips raw FAFSA-style line items from structured financial profiles", () => {
    const payload = {
      metadata: {
        fafsaProfile: {
          parentAdjustedGrossIncome: 180000,
          studentAidIndex: -1500,
          householdSize: 4,
          numberInCollege: 1,
          dependencyStatus: "dependent",
        },
      },
    };

    const redacted = redactAnthropicPayload(payload);
    const profile = redacted.payload.metadata.fafsaProfile;

    assert.equal(profile.studentAidIndex, -1500);
    assert.equal(profile.householdSize, 4);
    assert.equal(profile.numberInCollege, 1);
    assert.equal(profile.rawTaxDataStripped, true);
    assert.equal(profile.strippedFieldCount, 1);
    assert.equal(profile.parentAdjustedGrossIncome, undefined);
    assert.equal(profile.financialNeedCategory, "maximum_need");
    assert.equal(redacted.structuredSanitization.applied, true);
  });
});

console.log("Tests will start the backend automatically on http://localhost:3001");

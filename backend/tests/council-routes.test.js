import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";
import { mountPillarRoutes } from "../server-routes-pillars.js";
import {
  initCouncilTables,
  prepareCouncilStatements,
  recordConvening,
} from "../council/audit-trail.js";

const API_KEY = "sk-proj-abcdefghijklmnopqrstuvwxyz012345";

async function startHarness(t) {
  const db = new Database(":memory:");
  const app = express();
  app.use(express.json());
  const calls = { limiter: 0, begin: [], release: [], convene: [] };
  const budgetSession = { stages: [] };

  mountPillarRoutes(app, {
    db,
    dataDir: process.cwd(),
    studentLimiter(_req, _res, next) {
      calls.limiter += 1;
      next();
    },
    requireAuth(req, res, next) {
      if (req.headers.authorization !== "Bearer good") {
        return res.status(401).json({ error: "unauthorized" });
      }
      req.user = { studentId: "student-1" };
      next();
    },
    requireSelf(_req, _res, next) {
      next();
    },
    validateAIConsent: () => ({ allowed: true }),
    getOperatorLLM: () => ({ apiKey: "configured-test-key" }),
    getStudentProfile: async () => ({ grade: 11 }),
    beginCouncilBudget: async (args) => {
      calls.begin.push(args);
      return budgetSession;
    },
    beforeCouncilStage: async () => ({ allowed: true }),
    afterCouncilStage: async () => ({ ok: true }),
    releaseCouncilBudget: (session) => {
      calls.release.push(session);
    },
    conveneCouncil: async (args) => {
      calls.convene.push(args);
      const dissent = {
        from: "Skeptic",
        text: "Call 555-123-4567 before deciding.",
        recommendation: "Never expose " + API_KEY + ".",
        citations: [],
      };
      return {
        convening_id: "conv-1",
        recommendation: "Compare against " + args.question + "; call 555-123-4567; " + API_KEY,
        confidence: 0.7,
        dissent,
        dissents: [dissent],
        citations: [],
        council_breakdown: [],
        moderator_rule: "dissent_preserved",
        decision_type: args.decisionType,
        total_tokens: { input: 0, output: 0 },
        stage_order: [],
        sequential: true,
      };
    },
  });

  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    db.close();
  });
  return { calls, url: "http://127.0.0.1:" + server.address().port };
}

async function postCouncil(harness, body, headers = {}) {
  const response = await fetch(harness.url + "/api/council/convene", {
    method: "POST",
    headers: {
      authorization: "Bearer good",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function explicitRequest(overrides = {}) {
  return {
    question: "Should I revise my college list?",
    request_id: "request-1",
    explicit: true,
    auto: false,
    decision_type: "other",
    ...overrides,
  };
}

test("Council requires an explicit, non-automatic action before reserving budget", async (t) => {
  const harness = await startHarness(t);
  for (const body of [
    explicitRequest({ explicit: undefined }),
    explicitRequest({ explicit: false }),
    explicitRequest({ auto: true }),
  ]) {
    const response = await postCouncil(harness, body);
    assert.equal(response.status, 400);
    assert.equal(response.body.code, "COUNCIL_EXPLICIT_ACTION_REQUIRED");
  }
  assert.equal(harness.calls.limiter, 3);
  assert.equal(harness.calls.begin.length, 0);
  assert.equal(harness.calls.convene.length, 0);
  assert.equal(harness.calls.release.length, 0);
});

test("Council rejects invalid and blocked requests without model work", async (t) => {
  const harness = await startHarness(t);
  const cases = [
    [explicitRequest({ question: { nested: true } }), "COUNCIL_QUESTION_INVALID"],
    [explicitRequest({ question: "a".repeat(2001) }), "COUNCIL_QUESTION_TOO_LONG"],
    [explicitRequest({ request_id: { nested: true } }), "COUNCIL_REQUEST_ID_REQUIRED"],
    [explicitRequest({ decision_type: "unsupported" }), "COUNCIL_DECISION_TYPE_INVALID"],
    [explicitRequest({ question: "My API key is " + API_KEY }), "COUNCIL_INPUT_BLOCKED"],
    [explicitRequest({ question: "Write my college essay for me." }), "COUNCIL_INPUT_BLOCKED"],
  ];
  for (const [body, code] of cases) {
    const response = await postCouncil(harness, body);
    assert.equal(response.status, 400);
    assert.equal(response.body.code, code);
  }
  assert.equal(harness.calls.limiter, cases.length);
  assert.equal(harness.calls.begin.length, 0);
  assert.equal(harness.calls.convene.length, 0);
  assert.equal(harness.calls.release.length, 0);
});

test("Council crisis handling bypasses malformed metadata, budget, and models", async (t) => {
  const harness = await startHarness(t);
  const response = await postCouncil(
    harness,
    { question: "I want to kill myself." },
    { "x-collegeapp-locale": "ko" },
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.crisisSafe, true);
  assert.equal(response.body._meta.deterministic, true);
  assert.equal(response.body._meta.modelTier, "NONE");
  assert.ok(response.body.actions.some((item) => item.contact === "1393"));
  assert.equal(harness.calls.limiter, 1);
  assert.equal(harness.calls.begin.length, 0);
  assert.equal(harness.calls.convene.length, 0);
  assert.equal(harness.calls.release.length, 0);
});

test("Council screens provider input and every user-visible recommendation", async (t) => {
  const harness = await startHarness(t);
  const response = await postCouncil(harness, explicitRequest({
    question: "Should my family budget $1,234 for applications?",
    decision_type: "college-list",
  }));
  assert.equal(response.status, 200);
  assert.equal(harness.calls.begin.length, 1);
  assert.equal(harness.calls.convene.length, 1);
  assert.equal(harness.calls.release.length, 1);

  const args = harness.calls.convene[0];
  assert.equal(args.explicit, true);
  assert.equal(args.triggerSource, "manual");
  assert.equal(args.decisionType, "college-list");
  assert.doesNotMatch(args.question, /\$1,234/);
  assert.match(args.question, /\[FINANCIAL_REDACTED_[0-9a-f]{8}\]/);

  assert.match(response.body.recommendation, /\$1,234/);
  assert.doesNotMatch(response.body.recommendation, /555-123-4567|sk-proj-/);
  assert.match(response.body.recommendation, /\[REDACTED\]/);
  assert.doesNotMatch(response.body.dissent.text, /555-123-4567/);
  assert.doesNotMatch(response.body.dissent.recommendation, /sk-proj-/);
  assert.doesNotMatch(response.body.dissents[0].text, /555-123-4567/);
  assert.doesNotMatch(response.body.dissents[0].recommendation, /sk-proj-/);
  assert.deepEqual(response.body.usage, {
    stages: [],
    reserved_usd: 0,
    actual_usd: 0,
    input_tokens: 0,
    output_tokens: 0,
  });
});

test("Every Council HTTP surface invokes the student limiter", async (t) => {
  const harness = await startHarness(t);
  const before = harness.calls.limiter;
  const cases = [
    ["/api/council/convenings", 200],
    ["/api/council/convenings/missing", 404],
    ["/api/strategy-council", 410],
  ];
  for (const [path, status] of cases) {
    const response = await fetch(harness.url + path, {
      headers: { authorization: "Bearer good" },
    });
    assert.equal(response.status, status);
  }
  assert.equal(harness.calls.limiter - before, cases.length);
});

test("Council request IDs are unique per student after migrating the legacy index", async () => {
  const db = new Database(":memory:");
  try {
    initCouncilTables(db);
    db.exec("DROP INDEX idx_council_request");
    db.exec(
      "CREATE UNIQUE INDEX idx_council_request ON council_convenings(request_id) " +
      "WHERE request_id IS NOT NULL",
    );
    initCouncilTables(db);

    const columns = db.prepare("PRAGMA index_info(idx_council_request)")
      .all()
      .map((row) => row.name);
    assert.deepEqual(columns, ["student_id", "request_id"]);

    const stmts = prepareCouncilStatements(db);
    const envelope = {
      recommendation: "Use a balanced list.",
      moderator_rule: "supported_consensus",
      confidence: 0.8,
      dissent: null,
      dissents: [],
      citations: [],
      council_breakdown: [],
    };
    const first = await recordConvening({
      stmts,
      studentId: "student-1",
      decisionType: "college-list",
      question: "Question one",
      envelope,
      requestId: "shared-request",
    });
    const second = await recordConvening({
      stmts,
      studentId: "student-2",
      decisionType: "college-list",
      question: "Question two",
      envelope,
      requestId: "shared-request",
    });
    const repeated = await recordConvening({
      stmts,
      studentId: "student-1",
      decisionType: "college-list",
      question: "Question one repeated",
      envelope,
      requestId: "shared-request",
    });
    assert.notEqual(first, second);
    assert.equal(repeated, first);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM council_convenings").get().count,
      2,
    );
  } finally {
    db.close();
  }
});

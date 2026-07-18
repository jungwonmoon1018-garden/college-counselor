import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  convene,
  COUNCIL_STAGE_ORDER,
  initCouncilTables,
  prepareCouncilStatements,
} from "../council/index.js";
import { validateCitations } from "../council/councilor.js";

const context = {
  text: "[baseline_fact:fact-1] Robotics leadership sustained for four years.",
  evidenceIndex: {
    "baseline_fact:fact-1": {
      type: "baseline_fact",
      id: "fact-1",
      text: "Robotics leadership sustained for four years.",
    },
  },
};

function responseFor(system) {
  if (system.includes("Data Checker")) {
    return {
      stance: "support",
      recommendation: "The robotics leadership claim is supported.",
      confidence: 0.9,
      citations: [{ type: "baseline_fact", id: "fact-1" }],
      reasoning: "Robotics leadership appears in fact-1.",
    };
  }
  if (system.includes("Skeptic")) {
    return {
      stance: "modify",
      recommendation: "Balance robotics leadership with the current course load.",
      confidence: 0.7,
      citations: [{ type: "baseline_fact", id: "fact-1" }],
      reasoning: "The sustained robotics commitment may consume substantial time.",
    };
  }
  if (system.includes("Devil's Advocate")) {
    return {
      stance: "oppose",
      recommendation: "Reduce robotics leadership hours rather than expanding the role.",
      confidence: 0.6,
      citations: [{ type: "baseline_fact", id: "fact-1" }],
      reasoning: "Four sustained years make a reduction a credible alternative.",
    };
  }
  return {
    stance: "support",
    recommendation: "Continue robotics leadership and document measurable outcomes.",
    confidence: 0.8,
    citations: [{ type: "baseline_fact", id: "fact-1" }],
    reasoning: "The record shows sustained robotics leadership.",
  };
}

describe("sequential Strategy Council", () => {
  it("runs stages in order and gives each reviewer the prior outputs", async () => {
    const db = new Database(":memory:");
    initCouncilTables(db);
    const calls = [];
    const before = [];
    const after = [];
    const callModel = async (request) => {
      calls.push(request);
      return {
        content: [{ text: JSON.stringify(responseFor(request.system)) }],
        usage: { input_tokens: 100, output_tokens: 50 },
      };
    };
    const result = await convene({
      explicit: true,
      requestId: "request-1",
      studentId: "student-1",
      question: "Should I expand my robotics role?",
      student: { grade: 11 },
      councilStmts: prepareCouncilStatements(db),
      contextOverride: context,
      llm: { apiKey: "admin-key", model: "test/model" },
      callModel,
      beforeStage: async (stage) => {
        before.push(stage.role);
        return { allowed: true, reservationId: stage.role };
      },
      afterStage: async (stage) => {
        after.push(stage.role);
      },
    });

    assert.deepEqual(COUNCIL_STAGE_ORDER, [
      "Strategist", "Data Checker", "Skeptic", "Devil's Advocate", "Moderator",
    ]);
    assert.deepEqual(before, COUNCIL_STAGE_ORDER.slice(0, 4));
    assert.deepEqual(after, COUNCIL_STAGE_ORDER.slice(0, 4));
    assert.equal(calls.length, 4);
    assert.match(calls[1].messages[0].content, /Continue robotics leadership/);
    assert.match(calls[2].messages[0].content, /Data Checker/);
    assert.equal(result.sequential, true);
    assert.equal(result.dissents.length, 2);
    assert.ok(result.citations.every((citation) => citation.validated === true));
    assert.equal(result.total_tokens.input, 400);
    assert.equal(result.total_tokens.output, 200);

    const audit = db.prepare("SELECT * FROM council_convenings").get();
    assert.equal(audit.question.includes("Should I"), false);
    assert.equal(audit.recommendation.includes("robotics"), false);
    assert.equal(audit.request_id, "request-1");
    await assert.rejects(convene({
      explicit: true,
      requestId: "request-1",
      studentId: "student-1",
      question: "Should I expand my robotics role?",
      councilStmts: prepareCouncilStatements(db),
      contextOverride: context,
      llm: { apiKey: "admin-key", model: "test/model" },
      callModel,
    }), (error) => error.code === "COUNCIL_DUPLICATE_REQUEST");
    assert.equal(calls.length, 4, "duplicate request must be rejected before another model call");
    db.close();
  });

  it("rejects automatic invocation", async () => {
    await assert.rejects(
      convene({ studentId: "student", question: "Auto run" }),
      (error) => error.code === "COUNCIL_EXPLICIT_ACTION_REQUIRED",
    );
  });

  it("stops before a stage whose budget hook denies the call", async () => {
    const db = new Database(":memory:");
    initCouncilTables(db);
    let calls = 0;
    await assert.rejects(convene({
      explicit: true,
      studentId: "student",
      question: "Question",
      councilStmts: prepareCouncilStatements(db),
      contextOverride: context,
      llm: { apiKey: "admin-key", model: "test/model" },
      callModel: async () => {
        calls++;
        return { content: [{ text: JSON.stringify(responseFor("Strategist")) }] };
      },
      beforeStage: async ({ role }) => role === "Data Checker"
        ? { allowed: false, code: "monthly_cap_exceeded" }
        : { allowed: true },
    }), (error) => error.code === "monthly_cap_exceeded");
    assert.equal(calls, 1);
    db.close();
  });
});

describe("Council citation validation", () => {
  it("requires both an existing ID and lexical claim support", () => {
    const checked = validateCitations([
      { type: "baseline_fact", id: "fact-1" },
      { type: "baseline_fact", id: "missing" },
      { type: "logseq_block", id: "old" },
    ], "Robotics leadership is sustained.", context.evidenceIndex);
    assert.equal(checked.valid.length, 1);
    assert.equal(checked.invalid.length, 2);

    const unsupported = validateCitations([
      { type: "baseline_fact", id: "fact-1" },
    ], "The student received a national poetry award.", context.evidenceIndex);
    assert.equal(unsupported.valid.length, 0);
    assert.equal(unsupported.invalid[0].reason, "no_claim_support");
  });
});

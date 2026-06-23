// Council harness hardening — DeepSeek V4-Pro seat model + anti-sycophancy /
// anti-hallucination calibration in the deterministic moderator.

import { test } from "node:test";
import assert from "node:assert/strict";
import { moderate } from "../council/moderator.js";
import { resolveCouncilModel } from "../council/councilor.js";
import { isReasoningModel } from "../llm-adapters/tier-defaults.js";

function seat(role, stance, confidence, citations = []) {
  return { role, stance, confidence, citations, recommendation: `${role} says`, reasoning: "because", model: "m", provider: "p" };
}

// ── resolveCouncilModel: OpenRouter councils standardize on DeepSeek V4 Pro ──

test("resolveCouncilModel pins OpenRouter seats to DeepSeek V4 Pro", () => {
  delete process.env.COUNCIL_MODEL;
  assert.equal(resolveCouncilModel({ provider: "openrouter" }, "medium"), "deepseek/deepseek-v4-pro");
});

test("resolveCouncilModel honors COUNCIL_MODEL override", () => {
  process.env.COUNCIL_MODEL = "deepseek/deepseek-v4-flash";
  assert.equal(resolveCouncilModel({ provider: "openrouter" }, "medium"), "deepseek/deepseek-v4-flash");
  delete process.env.COUNCIL_MODEL;
});

test("resolveCouncilModel leaves non-OpenRouter BYOK on its tier default", () => {
  delete process.env.COUNCIL_MODEL;
  // openai medium tier default — unchanged behavior for non-OpenRouter providers.
  assert.equal(resolveCouncilModel({ provider: "openai" }, "medium"), "gpt-4o");
  // explicit student model wins for non-OpenRouter.
  assert.equal(resolveCouncilModel({ provider: "openai", model: "gpt-4.1" }, "medium"), "gpt-4.1");
});

test("DeepSeek V4 Pro is a reasoning model (so the council bumps its token cap)", () => {
  assert.equal(isReasoningModel("deepseek/deepseek-v4-pro"), true);
  assert.equal(isReasoningModel("google/gemma-4-31b-it"), false);
});

// ── Anti-sycophancy / anti-hallucination calibration ──

test("ungrounded high-confidence support is clamped below strong consensus", () => {
  const env = moderate([
    seat("Strategist", "support", 0.95, []),     // no citations → rubber-stamp
    seat("Skeptic", "support", 0.9, []),
    seat("Data Checker", "support", 0.9, []),
    seat("Devil's Advocate", "oppose", 0.6, [{ type: "graph_node", id: "x" }]),
    seat("Compliance Reviewer", "support", 0.8, []),
  ]);
  const strat = env.council_breakdown.find((s) => s.role === "Strategist");
  assert.equal(strat.calibrated, "ungrounded_support_clamped");
  assert.ok(strat.confidence < 0.7, "clamped below the strong-consensus threshold");
  assert.equal(strat.grounded, false);
});

test("grounded support keeps its confidence and is marked grounded", () => {
  const env = moderate([
    seat("Strategist", "support", 0.85, [{ type: "graph_node", id: "n1" }]),
    seat("Skeptic", "support", 0.8, [{ type: "logseq_block", id: "b1" }]),
  ]);
  const strat = env.council_breakdown.find((s) => s.role === "Strategist");
  assert.equal(strat.grounded, true);
  assert.equal(strat.calibrated, null);
  assert.equal(strat.confidence, 0.85);
});

test("Compliance HARD veto is preserved regardless of calibration", () => {
  const env = moderate([
    seat("Strategist", "support", 0.95, [{ type: "graph_node", id: "n1" }]),
    seat("Compliance Reviewer", "oppose", 0.9, [{ type: "baseline_fact", id: "f1" }]),
  ]);
  assert.equal(env.moderator_rule, "compliance_veto");
});

test("ungrounded oppose is NOT clamped (only support agreement is policed)", () => {
  const env = moderate([
    seat("Strategist", "support", 0.8, [{ type: "graph_node", id: "n1" }]),
    seat("Skeptic", "oppose", 0.9, []),
  ]);
  const skeptic = env.council_breakdown.find((s) => s.role === "Skeptic");
  assert.equal(skeptic.calibrated, null);
  assert.equal(skeptic.confidence, 0.9);
});

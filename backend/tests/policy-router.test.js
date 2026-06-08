// ═══════════════════════════════════════════════════════════
// TESTS: Policy Router
// ═══════════════════════════════════════════════════════════

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyTopic,
  enforceGates,
  selectModelTier,
  canHandleDeterministically,
  routeRequest,
  TOPIC_TYPES,
  MODEL_TIERS,
} from "../policy-router.js";

describe("classifyTopic", () => {
  it("classifies FAFSA queries as REGULATED", () => {
    const result = classifyTopic("How do I fill out my FAFSA?");
    assert.equal(result.topicType, TOPIC_TYPES.REGULATED);
    assert.equal(result.subIntent, "fafsa");
  });

  it("classifies FERPA queries as REGULATED", () => {
    const result = classifyTopic("What are my FERPA rights?");
    assert.equal(result.topicType, TOPIC_TYPES.REGULATED);
    assert.equal(result.subIntent, "ferpa");
  });

  it("classifies deadline queries as HIGH_STAKES", () => {
    const result = classifyTopic("When is the MIT early action deadline?");
    assert.equal(result.topicType, TOPIC_TYPES.HIGH_STAKES);
  });

  it("classifies essay questions as COACHING", () => {
    const result = classifyTopic("Can you help me brainstorm essay topics?");
    assert.equal(result.topicType, TOPIC_TYPES.COACHING);
  });

  it("classifies crisis language as CRISIS", () => {
    const result = classifyTopic("I want to end my life");
    assert.equal(result.topicType, TOPIC_TYPES.CRISIS);
  });

  it("defaults unmatched questions to COACHING (general)", () => {
    // No crisis/regulated/high-stakes/coaching keyword → falls through to the
    // evidence-grounded coaching default (subIntent "general").
    const result = classifyTopic("What time does the office open?");
    assert.equal(result.topicType, TOPIC_TYPES.COACHING);
    assert.equal(result.subIntent, "general");
  });

  it("returns confidence score", () => {
    const result = classifyTopic("FAFSA eligibility requirements");
    assert.ok(typeof result.confidence === "number");
    assert.ok(result.confidence >= 0 && result.confidence <= 1);
  });
});

describe("enforceGates", () => {
  it("blocks a REGULATED topic with no verified evidence (no-source-no-answer)", () => {
    const result = enforceGates(TOPIC_TYPES.REGULATED, "fafsa", []);
    assert.equal(result.allowed, false);
    assert.ok(result.fallback);
    assert.ok(result.gates.some((g) => g.gate === "no_source_no_answer" && g.passed === false));
  });

  it("allows COACHING topics with no fallback", () => {
    const result = enforceGates(TOPIC_TYPES.COACHING, "essay", []);
    assert.equal(result.allowed, true);
    assert.equal(result.fallback, null);
    assert.ok(result.gates.some((g) => g.gate === "coaching_label" && g.passed === true));
  });

  it("allows a REGULATED topic once verified evidence exists", () => {
    const result = enforceGates(TOPIC_TYPES.REGULATED, "fafsa", [{ confidence: "verified" }]);
    assert.equal(result.allowed, true);
    assert.ok(result.gates.some((g) => g.gate === "source_verification" && g.passed === true));
  });
});

describe("selectModelTier", () => {
  it("returns NONE for deterministic regulated topics", () => {
    const tier = selectModelTier(TOPIC_TYPES.REGULATED, "fafsa_eligibility", "simple");
    assert.equal(tier, MODEL_TIERS.NONE);
  });

  it("returns SONNET for general coaching", () => {
    const tier = selectModelTier(TOPIC_TYPES.COACHING, "general", "simple");
    assert.equal(tier, MODEL_TIERS.SONNET);
  });

  it("returns OPUS for heavy cross-source coaching (essay/ec_strategy)", () => {
    assert.equal(selectModelTier(TOPIC_TYPES.COACHING, "essay", "complex"), MODEL_TIERS.OPUS);
    assert.equal(selectModelTier(TOPIC_TYPES.COACHING, "ec_strategy", "simple"), MODEL_TIERS.OPUS);
  });

  it("escalates a regulated query to OPUS after a low-confidence Sonnet attempt", () => {
    const tier = selectModelTier(TOPIC_TYPES.REGULATED, "fafsa", "complex", { tier: MODEL_TIERS.SONNET, confidence: 0.2 });
    assert.equal(tier, MODEL_TIERS.OPUS);
  });
});

describe("canHandleDeterministically", () => {
  it("returns true for FAFSA eligibility", () => {
    assert.ok(canHandleDeterministically(TOPIC_TYPES.REGULATED, "fafsa"));
    assert.ok(canHandleDeterministically(TOPIC_TYPES.REGULATED, "eligibility"));
  });

  it("returns true for deadline status", () => {
    assert.ok(canHandleDeterministically(TOPIC_TYPES.HIGH_STAKES, "deadlines"));
  });

  it("returns false for essay coaching", () => {
    assert.equal(canHandleDeterministically(TOPIC_TYPES.COACHING, "essay"), false);
  });
});

describe("routeRequest", () => {
  it("returns a complete routing decision", () => {
    // Pass verified evidence so the regulated gate allows the full decision
    // shape (classification + gateResult + modelTier + isDeterministic).
    const result = routeRequest("Am I eligible for FAFSA?", {}, [{ confidence: "verified" }]);
    assert.ok(result.classification.topicType);
    assert.ok(typeof result.isDeterministic === "boolean");
    assert.ok(result.gateResult);
    assert.ok(result.modelTier);
  });

  it("routes crisis to deterministic with no model", () => {
    const result = routeRequest("I want to hurt myself");
    assert.equal(result.classification.topicType, TOPIC_TYPES.CRISIS);
    assert.equal(result.modelTier, MODEL_TIERS.NONE);
  });
});

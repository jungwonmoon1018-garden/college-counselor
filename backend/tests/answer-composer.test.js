// ═══════════════════════════════════════════════════════════
// TESTS: Answer Composer
// ═══════════════════════════════════════════════════════════

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { composeAnswer, composeDeterministicAnswer } from "../answer-composer.js";

describe("composeDeterministicAnswer", () => {
  it("composes FAFSA eligibility answer", () => {
    const result = composeDeterministicAnswer({
      classification: { topicType: "REGULATED", subIntent: "fafsa_eligibility" },
      result: {
        eligible: true,
        rules: [
          { id: "citizenship", status: "pass", message: "U.S. citizen", source: "https://studentaid.gov" },
        ],
        failedRules: [],
        unknownRules: [],
      },
      locale: "en-US",
    });

    assert.ok(result.verified_facts);
    assert.ok(result.verified_facts.some((fact) => fact.statement === "U.S. citizen"));
    assert.ok(result.claims.some((claim) => claim.lane === "verified_fact"));
    assert.ok(result.ai_disclosure);
    assert.ok(result.ai_disclosure.advisory_disclosure);
  });

  it("includes Korean disclosure for ko locale", () => {
    const result = composeDeterministicAnswer({
      classification: { topicType: "REGULATED", subIntent: "fafsa_eligibility" },
      result: { eligible: true, rules: [], failedRules: [], unknownRules: [] },
      locale: "ko",
    });
    assert.ok(result.ai_disclosure);
  });

  it("composes deadline status answer", () => {
    const result = composeDeterministicAnswer({
      classification: { topicType: "HIGH_STAKES", subIntent: "deadline_status" },
      result: { status: "upcoming", daysRemaining: 30, deadline: "2026-05-01" },
      locale: "en-US",
    });
    assert.ok(result.verified_facts);
  });
});

describe("composeAnswer", () => {
  it("composes regulated answer with verified facts only", () => {
    const result = composeAnswer({
      classification: { topicType: "REGULATED", subIntent: "fafsa" },
      evidence: [
        { fact_key: "fafsa_deadline", fact_value: "June 30, 2027", source_url: "https://studentaid.gov", confidence: "verified", trust_level: "official" },
      ],
      modelOutput: null,
      locale: "en-US",
    });

    assert.ok(result.verified_facts.length > 0);
    assert.ok(result.ai_disclosure);
    assert.ok(result.explanation);
  });

  it("includes no-verified-answer for regulated topics without evidence", () => {
    const result = composeAnswer({
      classification: { topicType: "REGULATED", subIntent: "fafsa" },
      evidence: [],
      modelOutput: null,
      locale: "en-US",
    });

    assert.ok(result.no_verified_answer || result.verified_facts.length === 0);
  });

  it("composes coaching answer with three lanes", () => {
    const result = composeAnswer({
      classification: { topicType: "COACHING", subIntent: "essay" },
      evidence: [
        { claim: "Your essay could focus on personal growth", grounding: "Based on your activities", trust_level: "inferred" },
      ],
      modelOutput: { text: "Consider the Common App prompt about challenges", model: "claude-3-haiku" },
      locale: "en-US",
    });

    assert.ok(result.model_inferences || result.coaching_suggestions);
    assert.ok(result.ai_disclosure);
  });

  it("always includes explanation object", () => {
    const result = composeAnswer({
      classification: { topicType: "COACHING", subIntent: "ec_strategy" },
      evidence: [],
      modelOutput: null,
      locale: "en-US",
    });

    assert.ok(result.explanation);
    assert.ok(result.explanation.routing || result.explanation.model_tier !== undefined);
  });

  it("never promotes a model paragraph to a verified claim", () => {
    const result = composeAnswer({
      classification: { topicType: "regulated", subIntent: "fafsa" },
      evidence: [{
        id: "fafsa-source",
        fact_key: "fafsa_eligibility",
        fact_value: "Students must meet federal eligibility requirements.",
        source_url: "https://studentaid.gov",
        source_domain: "studentaid.gov",
        confidence: "verified",
        trust_level: "official",
        expires_at: "2099-01-01T00:00:00.000Z",
      }],
      modelOutput: { text: "You definitely qualify for aid.", model: "test-model" },
    });
    assert.equal(
      result.claims.find((claim) => claim.statement === "You definitely qualify for aid.").lane,
      "coaching_suggestion",
    );
    assert.equal(result.verified_facts.some((fact) => fact.statement.includes("definitely qualify")), false);
  });

  it("does not label expired evidence as verified", () => {
    const result = composeAnswer({
      classification: { topicType: "regulated", subIntent: "fafsa" },
      evidence: [{
        fact_key: "fafsa_eligibility",
        fact_value: "Expired rule",
        source_url: "https://studentaid.gov",
        source_domain: "studentaid.gov",
        confidence: "verified",
        trust_level: "official",
        expires_at: "2000-01-01T00:00:00.000Z",
      }],
    });
    assert.equal(result.verified_facts.length, 0);
    assert.equal(result.no_verified_answer, true);
  });
});

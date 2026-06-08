// ═══════════════════════════════════════════════════════════════════════
// tests/friendly-labels.test.js — lock the engineer→student copy map
// ═══════════════════════════════════════════════════════════════════════
// The label strings the backend emits (tier_1_distinctive, prestige source
// "research", factor key "narrative_fit", etc.) must never leak into the
// student UI. If someone adds a new tier or renames a factor without
// updating the friendly map, this test makes it fail loudly.
// ═══════════════════════════════════════════════════════════════════════

import test from "node:test";
import assert from "node:assert/strict";

import {
  TIER_FRIENDLY,
  PRESTIGE_SOURCE_FRIENDLY,
  FACTOR_FRIENDLY,
  DIRECTIONALITY_FACTOR_FRIENDLY,
  DIRECTIONALITY_LABEL_FRIENDLY,
  renderFriendlyTier,
  renderFriendlyPrestigeSource,
  renderFriendlyFactor,
  enrichECVectorWithFriendly,
  getPrestigeExplanation,
} from "../friendly-labels.js";

import { STRENGTH_FACTORS, TIERS } from "../ec-strength-vectorizer.js";

test("every tier in TIERS has a friendly rendering", () => {
  for (const tier of Object.values(TIERS)) {
    const f = renderFriendlyTier(tier);
    assert.ok(f.short, `tier ${tier} missing .short`);
    assert.ok(f.summary, `tier ${tier} missing .summary`);
    // Must not leak the engineer token into the UI string.
    assert.doesNotMatch(f.short, /tier_|_distinctive|_strong|_developing|_foundational/);
  }
});

test("every prestige_source enum value has a friendly rendering", () => {
  // These must match ec-strength-vectorizer.js PRESTIGE_SOURCES.
  for (const src of ["research", "benchmark", "legacy", "override", "unavailable", "research_failed"]) {
    const f = renderFriendlyPrestigeSource(src);
    assert.ok(f.short, `prestige source ${src} missing .short`);
    assert.ok(f.summary, `prestige source ${src} missing .summary`);
  }
});

test("every factor in STRENGTH_FACTORS has a friendly rendering", () => {
  for (const factor of STRENGTH_FACTORS) {
    const f = renderFriendlyFactor(factor);
    assert.ok(f.short && f.short.length > 0, `factor ${factor} missing .short`);
    assert.ok(f.summary, `factor ${factor} missing .summary`);
    // No engineer underscores in the short label.
    assert.doesNotMatch(f.short, /_/, `factor ${factor} short must not contain an underscore`);
    // The summary must not leak the raw snake_case key either.
    assert.doesNotMatch(f.summary, /\b[a-z]+_[a-z]+\b/, `factor ${factor} summary must not leak snake_case`);
  }
});

test("every prestige_source short label is user-friendly (no underscores)", () => {
  for (const src of Object.keys(PRESTIGE_SOURCE_FRIENDLY)) {
    const f = PRESTIGE_SOURCE_FRIENDLY[src];
    assert.doesNotMatch(f.short, /_/, `source ${src} short must not contain an underscore`);
  }
});

test("every directionality factor + label has a friendly rendering", () => {
  const expectedFactors = [
    "academic_momentum",
    "test_score_strength",
    "major_academic_fit",
    "rigor_and_challenge",
    "overall_academic_standing",
  ];
  for (const key of expectedFactors) {
    const f = DIRECTIONALITY_FACTOR_FRIENDLY[key];
    assert.ok(f, `missing directionality factor ${key}`);
    assert.ok(f.short && f.summary);
    assert.doesNotMatch(f.short, /_/);
  }
  const expectedLabels = [
    "rising_strong",
    "rising_developing",
    "stable_strong",
    "stable_developing",
    "declining",
  ];
  for (const key of expectedLabels) {
    const f = DIRECTIONALITY_LABEL_FRIENDLY[key];
    assert.ok(f, `missing directionality label ${key}`);
    assert.ok(f.short && f.summary);
  }
});

test("unknown values fall back to the raw string", () => {
  const t = renderFriendlyTier("tier_99_mystery");
  assert.equal(t.short, "tier_99_mystery");
});

test("enrichECVectorWithFriendly attaches tier + prestigeSource + factors", () => {
  const baseVector = {
    id: "v1",
    ecName: "AMC 12",
    factors: { dedication: 0.8, achievement: 0.7, leadership: 0.2, prestige: 0.6, narrative_fit: 0.9 },
    tierLabel: "tier_2_strong",
    prestigeSource: "benchmark",
  };
  const explanation = {
    score: 0.62,
    source: "benchmark",
    rationale: "Seeded in baseline_ec_competitive",
    sourcesCited: ["maa.org"],
  };
  const enriched = enrichECVectorWithFriendly(baseVector, explanation);
  assert.ok(enriched.friendly, "friendly missing");
  assert.equal(enriched.friendly.tier.short, "Strong");
  assert.equal(enriched.friendly.prestigeSource.short, "Matched");
  assert.ok(enriched.friendly.factors.narrative_fit, "narrative_fit friendly missing");
  assert.deepEqual(enriched.prestigeExplanation, explanation);
  // Original vector unmutated.
  assert.equal(baseVector.friendly, undefined);
});

test("getPrestigeExplanation returns null when no row is cached", () => {
  const stmts = {
    getPrestigeCacheByName: { get: () => null },
  };
  assert.equal(getPrestigeExplanation(stmts, "Unseen Contest"), null);
});

test("getPrestigeExplanation parses sources_json and returns shaped output", () => {
  const stmts = {
    getPrestigeCacheByName: {
      get: (name) => ({
        cache_key: "k",
        activity_name: name,
        level_hint: "national",
        score: 0.85,
        rationale: "Elite US olympiad",
        sources_json: '["maa.org", "artofproblemsolving.com"]',
        source: "research",
        provider: "anthropic",
        model: "claude-sonnet-4.5",
        result_json: "{}",
        created_at: "2026-01-05 12:00:00",
      }),
    },
  };
  const out = getPrestigeExplanation(stmts, "USAMO");
  assert.equal(out.score, 0.85);
  assert.deepEqual(out.sourcesCited, ["maa.org", "artofproblemsolving.com"]);
  assert.equal(out.source, "research");
  assert.equal(out.fetchedAt, "2026-01-05 12:00:00");
});

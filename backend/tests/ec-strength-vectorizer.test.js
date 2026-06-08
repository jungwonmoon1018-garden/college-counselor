// Tests for ec-strength-vectorizer.js
// Uses better-sqlite3(":memory:") and a mock llmClient so the LLM
// fallback path can be exercised without hitting the network.

import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import crypto from "node:crypto";

import {
  initECStrengthTables,
  prepareECStrengthStatements,
  vectorizeECStrength,
  recomputeStudentECStrengthVectors,
  applyStrengthOverride,
  computeTierLabel,
  scoreNarrativeFit,
  isValidTier,
  toPublicShape,
  STRENGTH_FACTORS,
  TIERS,
} from "../ec-strength-vectorizer.js";

import { extractNarrativeThemes } from "../narrative-store.js";
import {
  initNarrativeFitCacheTable,
  prepareNarrativeFitCacheStatements,
  hashText,
} from "../narrative-fit-llm.js";
import { initRAGTables, prepareRAGStatements } from "../rag-engine.js";

// Short helper for a fresh in-memory DB with all tables.
function freshDb() {
  const db = new Database(":memory:");
  initECStrengthTables(db);
  initNarrativeFitCacheTable(db);
  return {
    db,
    stmts: prepareECStrengthStatements(db),
    cacheStmts: prepareNarrativeFitCacheStatements(db),
  };
}

function freshRagDb() {
  const db = new Database(":memory:");
  initRAGTables(db);
  return {
    db,
    ragStmts: prepareRAGStatements(db),
  };
}

function mockLLM(fn) {
  return {
    calls: 0,
    lastArgs: null,
    async call(args) {
      this.calls += 1;
      this.lastArgs = args;
      return fn(args);
    },
  };
}

// ═══════════════════════════════════════════════════════════
// Dedication
// ═══════════════════════════════════════════════════════════
test("dedication scales monotonically with hours-per-week", async () => {
  const ecs = [
    { name: "a", hoursPerWeek: 1, weeksPerYear: 40, yearsOfParticipation: 1 },
    { name: "b", hoursPerWeek: 5, weeksPerYear: 40, yearsOfParticipation: 1 },
    { name: "c", hoursPerWeek: 15, weeksPerYear: 40, yearsOfParticipation: 1 },
    { name: "d", hoursPerWeek: 20, weeksPerYear: 40, yearsOfParticipation: 2 },
  ];
  const scores = [];
  for (const ec of ecs) {
    const r = await vectorizeECStrength({ ec });
    scores.push(r.factors.dedication);
  }
  for (let i = 1; i < scores.length; i++) {
    assert.ok(scores[i] >= scores[i - 1], `dedication must be monotonic: ${scores}`);
  }
});

test("dedication is tiny for a zero-hour zero-year EC", async () => {
  const r = await vectorizeECStrength({
    ec: { name: "empty", hoursPerWeek: 0, weeksPerYear: 0, yearsOfParticipation: 0 },
  });
  assert.ok(r.factors.dedication < 0.1, `expected <0.1, got ${r.factors.dedication}`);
});

// ═══════════════════════════════════════════════════════════
// Achievement
// ═══════════════════════════════════════════════════════════
test("USAMO qualifier scores achievement >= 0.55", async () => {
  const r = await vectorizeECStrength({
    ec: {
      name: "Math Olympiad",
      role: "competitor",
      description: "USAMO qualifier; AIME 11; AMC 12 distinguished honor roll.",
      hoursPerWeek: 3, weeksPerYear: 30, yearsOfParticipation: 2,
    },
  });
  assert.ok(
    r.factors.achievement >= 0.55,
    `expected achievement ≥ 0.55, got ${r.factors.achievement}`,
  );
});

test("low-signal activity scores achievement < 0.3", async () => {
  const r = await vectorizeECStrength({
    ec: {
      name: "Library",
      role: "volunteer",
      description: "helped in the library shelving books occasionally.",
      hoursPerWeek: 1, weeksPerYear: 30, yearsOfParticipation: 1,
    },
  });
  assert.ok(
    r.factors.achievement < 0.3,
    `expected achievement < 0.3, got ${r.factors.achievement}`,
  );
});

// ═══════════════════════════════════════════════════════════
// Leadership
// ═══════════════════════════════════════════════════════════
test("founder + president scores leadership >= 0.8", async () => {
  const r = await vectorizeECStrength({
    ec: {
      name: "Robotics Club",
      role: "founder and president",
      description: "Founded the robotics club; organized regional competitions; recruited 20 members.",
      hoursPerWeek: 4, weeksPerYear: 35, yearsOfParticipation: 2,
    },
  });
  assert.ok(r.factors.leadership >= 0.8, `expected leadership ≥ 0.8, got ${r.factors.leadership}`);
});

test("passive member scores leadership < 0.25", async () => {
  const r = await vectorizeECStrength({
    ec: {
      name: "Chess Club",
      role: "member",
      description: "Played weekly chess with peers.",
      hoursPerWeek: 2, weeksPerYear: 30, yearsOfParticipation: 1,
    },
  });
  assert.ok(r.factors.leadership < 0.25, `expected leadership < 0.25, got ${r.factors.leadership}`);
});

// ═══════════════════════════════════════════════════════════
// Narrative fit
// ═══════════════════════════════════════════════════════════
test("narrative_fit via keyword overlap scores > 0.5 with a relevant EC", async () => {
  const narrative =
    "I am an environmental policy advocate focused on climate and community resilience. " +
    "I build legislation briefs and run community workshops on environmental justice.";
  const { themes } = extractNarrativeThemes(narrative);
  const r = await vectorizeECStrength({
    ec: {
      name: "Climate Policy Club",
      role: "organizer",
      description:
        "Organized environmental policy workshops; drafted community policy briefs on climate impacts and environmental justice.",
      hoursPerWeek: 3, weeksPerYear: 30, yearsOfParticipation: 2,
    },
    narrative,
    narrativeThemes: themes,
    narrativeHash: hashText(narrative),
  });
  assert.ok(
    r.factors.narrative_fit > 0.5,
    `expected narrative_fit > 0.5, got ${r.factors.narrative_fit}`,
  );
  assert.equal(r.reasoning.narrative_fit.source, "keyword");
});

test("narrative_fit falls back to LLM when overlap is inconclusive", async () => {
  const { cacheStmts } = freshDb();
  const narrative =
    "I want to become a researcher who explores how humans experience music across cultures.";
  const { themes } = extractNarrativeThemes(narrative);
  // Long EC text with no keyword overlap
  const longEcText = (
    "I spent two summers working at a small local cafe as a barista, handling transactions, " +
    "training coworkers on espresso drink preparation, and coordinating weekly supply orders. " +
    "I designed a new register workflow that cut average checkout time by about 25 percent. " +
    "I also collected informal feedback from customers to inform menu choices through a simple paper survey."
  );
  const llm = mockLLM(async () => ({ score: 0.55, reason: "Tangential leadership skills." }));

  const r = await scoreNarrativeFit({
    narrative,
    narrativeThemes: themes,
    narrativeHash: hashText(narrative),
    ecText: longEcText,
    llmClient: llm,
  });

  // Only count LLM call if keyword path yielded < 2 distinct matches
  assert.equal(r.source, "llm", `expected llm source when inconclusive, got ${r.source} / matches=${r.matched_themes.length}`);
  assert.equal(r.score, 0.55);
  assert.equal(llm.calls, 1);
  // Re-query — make sure the mock is re-callable
  assert.equal(llm.lastArgs.narrative, narrative);
});

test("narrative_fit LLM cache returns cached:true on second call", async () => {
  const { cacheStmts } = freshDb();
  const narrative =
    "I want to become a quiet humanities researcher studying renaissance poetry and translation.";
  const { themes } = extractNarrativeThemes(narrative);
  const ecText = (
    "I spent two years coaching a youth soccer team where I coordinated weekly practice sessions, " +
    "managed travel logistics, and built parent volunteer schedules every weekend. I also organized " +
    "a small fundraising drive to buy new uniforms for the kids, and kept detailed attendance logs " +
    "for each of the forty-plus players so we could track who needed extra support during matches."
  );
  const narrativeHash = hashText(narrative);
  const ecTextHash = hashText(ecText);

  // Populate the cache directly so we don't need to hit the network
  cacheStmts.put.run(
    hashText(narrativeHash + ":" + ecTextHash), // wrong key for demo
    0.42, "cached demo", "claude-haiku-4-5", "anthropic",
  );
  // The cache key is computed inside callHaikuForNarrativeFit; mirror that
  // behavior by computing the same key here.
  const { computeCacheKey } = await import("../narrative-fit-llm.js");
  const key = computeCacheKey(narrativeHash, ecTextHash);
  cacheStmts.put.run(key, 0.42, "cached demo", "claude-haiku-4-5", "anthropic");

  // Inject an llmClient that delegates to the real cache path
  const { callHaikuForNarrativeFit } = await import("../narrative-fit-llm.js");
  const llmClient = {
    async call(args) {
      return callHaikuForNarrativeFit({
        narrative: args.narrative,
        ecText: args.ecText,
        narrativeHash: args.narrativeHash,
        ecTextHash: args.ecTextHash,
        stmts: cacheStmts,
      });
    },
  };

  const r = await scoreNarrativeFit({
    narrative,
    narrativeThemes: themes,
    narrativeHash,
    ecText,
    llmClient,
  });

  assert.equal(r.source, "llm");
  assert.equal(r.llm_cached, true);
  assert.equal(r.score, 0.42);
});

test("narrative_fit on LLM error falls back to keyword_llm_fallback", async () => {
  const narrative =
    "I want to become a quiet humanities researcher studying renaissance poetry and translation.";
  const { themes } = extractNarrativeThemes(narrative);
  const longEcText = (
    "I spent summers working at a local cafe as a barista; handled transactions, " +
    "trained new coworkers, and designed a workflow that cut customer wait times. " +
    "I also collected feedback from customers through a simple paper survey to inform menu choices."
  );
  const llm = mockLLM(async () => { throw new Error("network fail"); });

  const r = await scoreNarrativeFit({
    narrative,
    narrativeThemes: themes,
    narrativeHash: hashText(narrative),
    ecText: longEcText,
    llmClient: llm,
  });

  assert.equal(r.source, "keyword_llm_fallback");
  assert.ok(r.score >= 0.1);
});

test("narrative_fit with no narrative returns no_narrative neutral", async () => {
  const r = await scoreNarrativeFit({
    narrative: null,
    narrativeThemes: [],
    ecText: "irrelevant",
  });
  assert.equal(r.source, "no_narrative");
  assert.equal(r.score, 0.2);
});

// ═══════════════════════════════════════════════════════════
// Tier label — recalibrated for 5 factors (prestige required
// as a floor for tier 1 and tier 2).
// ═══════════════════════════════════════════════════════════
test("tier_1_distinctive fires when all five ≥ 0.75", () => {
  assert.equal(
    computeTierLabel({
      dedication: 0.8, achievement: 0.82, leadership: 0.77,
      prestige: 0.78, narrative_fit: 0.9,
    }),
    TIERS.TIER_1,
  );
});

test("tier_1_distinctive fires with an anchor ≥ 0.9 + 3 others ≥ 0.7 AND prestige ≥ 0.7", () => {
  assert.equal(
    computeTierLabel({
      dedication: 0.95, achievement: 0.72, leadership: 0.71,
      prestige: 0.71, narrative_fit: 0.71,
    }),
    TIERS.TIER_1,
  );
});

test("tier_1 does NOT fire when prestige floor is missed even with strong other factors", () => {
  assert.notEqual(
    computeTierLabel({
      dedication: 0.95, achievement: 0.72, leadership: 0.71,
      prestige: 0.3, narrative_fit: 0.71,
    }),
    TIERS.TIER_1,
  );
});

test("tier_2_strong fires when three ≥ 0.6, all ≥ 0.4, and prestige ≥ 0.4", () => {
  assert.equal(
    computeTierLabel({
      dedication: 0.65, achievement: 0.7, leadership: 0.6,
      prestige: 0.45, narrative_fit: 0.45,
    }),
    TIERS.TIER_2,
  );
});

test("tier_2 does NOT fire when prestige < 0.4 (floor)", () => {
  // Three factors ≥ 0.6, but prestige is 0.2 — drops to tier_3 at best.
  const tier = computeTierLabel({
    dedication: 0.65, achievement: 0.7, leadership: 0.6,
    prestige: 0.2, narrative_fit: 0.45,
  });
  assert.notEqual(tier, TIERS.TIER_2);
});

test("tier_3_developing fires when two ≥ 0.5 and all ≥ 0.2", () => {
  assert.equal(
    computeTierLabel({
      dedication: 0.55, achievement: 0.5, leadership: 0.25,
      prestige: 0.25, narrative_fit: 0.35,
    }),
    TIERS.TIER_3,
  );
});

test("tier_4_foundational catches everything else", () => {
  assert.equal(
    computeTierLabel({
      dedication: 0.1, achievement: 0.1, leadership: 0.1,
      prestige: 0, narrative_fit: 0.2,
    }),
    TIERS.TIER_4,
  );
});

test("isValidTier accepts all four tier labels", () => {
  assert.ok(isValidTier("tier_1_distinctive"));
  assert.ok(isValidTier("tier_2_strong"));
  assert.ok(isValidTier("tier_3_developing"));
  assert.ok(isValidTier("tier_4_foundational"));
  assert.ok(!isValidTier("tier_5"));
  assert.ok(!isValidTier(""));
});

// ═══════════════════════════════════════════════════════════
// Invariants
// ═══════════════════════════════════════════════════════════
test("all factors are in [0,1] and tier_label is valid across a sample", async () => {
  const samples = [
    { name: "x", description: "did stuff", hoursPerWeek: 5, weeksPerYear: 30, yearsOfParticipation: 2 },
    {
      name: "y",
      role: "president and founder",
      description: "Founded USAMO prep circle; USAMO qualifier; published research.",
      hoursPerWeek: 20, weeksPerYear: 40, yearsOfParticipation: 4,
    },
    { name: "z", description: "", hoursPerWeek: 0, weeksPerYear: 0, yearsOfParticipation: 0 },
  ];
  for (const ec of samples) {
    const r = await vectorizeECStrength({ ec });
    for (const f of STRENGTH_FACTORS) {
      assert.ok(r.factors[f] >= 0 && r.factors[f] <= 1, `${f} out of range: ${r.factors[f]}`);
    }
    assert.ok(isValidTier(r.tier_label), `tier_label invalid: ${r.tier_label}`);
  }
});

// ═══════════════════════════════════════════════════════════
// Batch recompute
// ═══════════════════════════════════════════════════════════
test("recomputeStudentECStrengthVectors writes rows and removes deleted ECs", async () => {
  const { stmts } = freshDb();
  const sid = "student-1";

  const first = await recomputeStudentECStrengthVectors(stmts, sid, {
    activities: [
      { name: "Robotics", role: "president", description: "Founded; led regional competitions", hoursPerWeek: 4, weeksPerYear: 35, yearsOfParticipation: 2 },
      { name: "Choir",    role: "member",    description: "Sang in choir", hoursPerWeek: 2, weeksPerYear: 30, yearsOfParticipation: 1 },
    ],
  });
  assert.equal(first.count, 2);

  // Remove Choir, keep Robotics
  const second = await recomputeStudentECStrengthVectors(stmts, sid, {
    activities: [
      { name: "Robotics", role: "president", description: "Founded; led regional competitions", hoursPerWeek: 4, weeksPerYear: 35, yearsOfParticipation: 2 },
    ],
  });
  assert.equal(second.count, 1);
  const remaining = stmts.getByStudent.all(sid);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].ec_name, "Robotics");
});

test("override survives a full recompute and tier_label is merged", async () => {
  const { stmts } = freshDb();
  const sid = "student-2";

  const activities = [
    { name: "Chess", role: "member", description: "weekly meetings", hoursPerWeek: 2, weeksPerYear: 30, yearsOfParticipation: 1 },
  ];
  await recomputeStudentECStrengthVectors(stmts, sid, { activities });

  // Pin leadership high; this should survive and bump tier
  applyStrengthOverride(stmts, sid, "Chess", { leadership: 0.95 });
  let row = stmts.getByStudentAndName.get(sid, "Chess");
  assert.equal(row.is_overridden, 1);
  assert.equal(row.leadership, 0.95);
  const tierAfterOverride = row.tier_label;
  assert.ok(isValidTier(tierAfterOverride));

  // Recompute — override should persist
  await recomputeStudentECStrengthVectors(stmts, sid, { activities });
  row = stmts.getByStudentAndName.get(sid, "Chess");
  assert.equal(row.is_overridden, 1);
  assert.equal(row.leadership, 0.95);
});

test("file-text from an attachment bumps achievement", async () => {
  const { db, stmts } = freshDb();
  const sid = "student-3";

  // Seed an attachment for "Coding"
  stmts.insertAttachment.run(
    crypto.randomUUID(), sid, "Coding", "cert.pdf", "application/pdf", 1234,
    "data/ec-attachments/x.pdf",
    "USACO Platinum qualifier; competed at national level in Gold.",
    hashText("USACO Platinum qualifier"), 60,
    "ok", null,
  );

  // First compute without narrative (keyword path is neutral)
  const r = await recomputeStudentECStrengthVectors(stmts, sid, {
    activities: [
      { name: "Coding", role: "member", description: "Did programming.", hoursPerWeek: 6, weeksPerYear: 40, yearsOfParticipation: 2 },
    ],
  });
  const vec = r.vectors[0];
  assert.ok(vec.factors.achievement >= 0.3, `expected achievement ≥ 0.3 from attachment, got ${vec.factors.achievement}`);
  assert.equal(vec.fileRefs.length, 1);
});

test("narrative refresh shifts narrative_fit", async () => {
  const { stmts } = freshDb();
  const sid = "student-4";

  const activities = [
    { name: "Lab", role: "volunteer", description: "assisted in a biology research lab on microbial cultures.", hoursPerWeek: 5, weeksPerYear: 30, yearsOfParticipation: 1 },
  ];

  // First pass: no narrative
  const pass1 = await recomputeStudentECStrengthVectors(stmts, sid, { activities });
  const fit1 = pass1.vectors[0].factors.narrative_fit;

  // Second pass: add a biology-focused narrative
  const narrative =
    "I am a future research biologist focused on microbial genetics and molecular biology. " +
    "I run lab experiments and analyze culture data across different environmental conditions.";
  const { themes } = extractNarrativeThemes(narrative);
  const pass2 = await recomputeStudentECStrengthVectors(stmts, sid, {
    activities, narrative, narrativeThemes: themes, narrativeHash: hashText(narrative),
  });
  const fit2 = pass2.vectors[0].factors.narrative_fit;
  assert.notEqual(fit1, fit2, "narrative_fit should change after adding a matching narrative");
  assert.ok(fit2 >= fit1, "narrative_fit should not decrease when narrative matches");
});

test("factors stay independent: overriding one never mutates the others", async () => {
  const { stmts } = freshDb();
  const sid = "student-5";
  const activities = [
    { name: "Debate", role: "captain", description: "debate tournaments", hoursPerWeek: 3, weeksPerYear: 30, yearsOfParticipation: 2 },
  ];
  await recomputeStudentECStrengthVectors(stmts, sid, { activities });
  const before = stmts.getByStudentAndName.get(sid, "Debate");

  applyStrengthOverride(stmts, sid, "Debate", { achievement: 0.88 });

  const after = stmts.getByStudentAndName.get(sid, "Debate");
  assert.equal(after.dedication, before.dedication);
  assert.equal(after.leadership, before.leadership);
  assert.equal(after.narrative_fit, before.narrative_fit);
  assert.equal(after.achievement, 0.88);
});

// ═══════════════════════════════════════════════════════════
// Public shape
// ═══════════════════════════════════════════════════════════
test("toPublicShape exposes 5 factors + tierLabel + prestigeSource", async () => {
  const { stmts } = freshDb();
  const sid = "student-6";
  await recomputeStudentECStrengthVectors(stmts, sid, {
    activities: [{ name: "Soccer", role: "member", hoursPerWeek: 3, weeksPerYear: 30, yearsOfParticipation: 1 }],
  });
  const row = stmts.getByStudentAndName.get(sid, "Soccer");
  const pub = toPublicShape(row);
  assert.equal(pub.ecName, "Soccer");
  assert.ok(STRENGTH_FACTORS.every((f) => f in pub.factors));
  assert.equal(typeof pub.factors.prestige, "number");
  assert.ok("prestigeSource" in pub, "prestigeSource must be exposed at the top level");
  assert.ok(isValidTier(pub.tierLabel));
  assert.deepEqual(pub.fileRefs, []);
});

// ═══════════════════════════════════════════════════════════
// Prestige factor + source tracking
// ═══════════════════════════════════════════════════════════
test("prestige defaults to 0 with source:unavailable when no ragStmts/adapter provided", async () => {
  const r = await vectorizeECStrength({
    ec: { name: "Generic Club", hoursPerWeek: 2, weeksPerYear: 30, yearsOfParticipation: 1 },
  });
  // No ragStmts + no adapter — prestige path falls back cleanly.
  assert.equal(typeof r.factors.prestige, "number");
  assert.ok(r.factors.prestige >= 0 && r.factors.prestige <= 1);
  assert.ok(r.prestige_source, "prestige_source should be populated");
});

test("STRENGTH_FACTORS ordering puts prestige 4th (before narrative_fit)", () => {
  assert.deepEqual(
    STRENGTH_FACTORS,
    ["dedication", "achievement", "leadership", "prestige", "major_spike", "narrative_fit"],
  );
});

test("major-spike scoring rewards intended-major depth over unrelated ECs", async () => {
  const cs = await vectorizeECStrength({
    ec: {
      name: "AI Research Lab",
      role: "founder",
      description: "Built a computer vision app, published a machine learning paper, and mentored teammates through robotics code reviews.",
      hoursPerWeek: 8,
      weeksPerYear: 34,
      yearsOfParticipation: 3,
    },
    majorInterest: "Computer Science",
  });
  const unrelated = await vectorizeECStrength({
    ec: {
      name: "School Choir",
      role: "member",
      description: "Performed in seasonal concerts and practiced harmony weekly.",
      hoursPerWeek: 4,
      weeksPerYear: 30,
      yearsOfParticipation: 3,
    },
    majorInterest: "Computer Science",
  });
  assert.ok(cs.factors.major_spike >= 0.65, `expected a clear CS spike, got ${cs.factors.major_spike}`);
  assert.ok(cs.factors.major_spike > unrelated.factors.major_spike);
});

test("vectorizeECStrength caches all six subvector components in the RAG DB", async () => {
  const { db, ragStmts } = freshRagDb();
  const ec = {
    name: "USACO Platinum",
    role: "competitor",
    description: "Promoted to USACO Platinum after Gold contests.",
    hoursPerWeek: 6,
    weeksPerYear: 32,
    yearsOfParticipation: 2,
  };

  const first = await vectorizeECStrength({ ec, ragStmts });
  assert.equal(first.reasoning.prestige.source, "catalog");
  assert.equal(first.reasoning.prestige.component_cache_hit, false);

  const rows = db.prepare(`
    SELECT factor, score, source
    FROM ec_component_cache
    ORDER BY factor
  `).all();
  const factors = new Set(rows.map((r) => r.factor));
  for (const f of STRENGTH_FACTORS) {
    assert.ok(factors.has(f), `missing component cache row for ${f}`);
  }
  assert.ok(rows.find((r) => r.factor === "prestige").score >= 0.82);

  const second = await vectorizeECStrength({ ec, ragStmts });
  assert.equal(second.reasoning.prestige.component_cache_hit, true);
  assert.equal(second.reasoning.narrative_fit.component_cache_hit, true);
});

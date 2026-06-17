// ═══════════════════════════════════════════════════════════════════════
// tests/competition-research.test.js — prestige research + cache behavior
// ═══════════════════════════════════════════════════════════════════════
// The research module has three gated paths:
//   1. TTL-cache hit   — returns immediately, no LLM, cached: true.
//   2. Benchmark/catalog hit — seeded/official prestige, no web call.
//   3. OpenRouter      — calls callLLM with the web plugin enabled
//                        (plugins:[{id:"web"}]), parses the JSON, caches 30d.
// Non-OpenRouter providers short-circuit with source: "unavailable" so the
// vectorizer never crashes when only an OpenAI/Google key is configured.
// ═══════════════════════════════════════════════════════════════════════

import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  researchCompetitionPrestige,
  computePrestigeCacheKey,
  normalizeActivityName,
  searchCompetitionCatalog,
  findBestCompetitionCatalogPrestige,
  isReputableSourceUrl,
  PRESTIGE_TTL_DAYS,
  REPUTABLE_DOMAINS,
  OFFICIAL_COMPETITION_SOURCES,
} from "../competition-research.js";
import { initRAGTables, prepareRAGStatements } from "../rag-engine.js";

function freshStmts() {
  const db = new Database(":memory:");
  initRAGTables(db);
  return { db, stmts: prepareRAGStatements(db) };
}

// Fake fetch returning an OpenAI/OpenRouter-shaped chat-completion whose
// message content is the JSON payload. Captures the outbound request body so
// tests can assert the web-plugin wiring (plugins:[{id:"web"}], no tools).
function fakeOpenRouterFetch(jsonPayload, captured = {}) {
  return async (_url, opts) => {
    captured.body = JSON.parse(opts.body);
    captured.url = _url;
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({
        id: "chatcmpl-1",
        model: "z-ai/glm-5.1",
        choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(jsonPayload) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      }),
    };
  };
}

// ─── Normalization + cache key ─────────────────────────────────────────

test("normalizeActivityName lowercases and collapses whitespace/punctuation", () => {
  assert.equal(normalizeActivityName("  AMC 10/12 — 2024  "), "amc 10 12 2024");
  assert.equal(normalizeActivityName("USAMO, Qualifier!"), "usamo qualifier");
  assert.equal(normalizeActivityName(null), "");
  assert.equal(normalizeActivityName(undefined), "");
});

test("computePrestigeCacheKey is stable on equivalent inputs", () => {
  const k1 = computePrestigeCacheKey("USAMO Qualifier", "national");
  const k2 = computePrestigeCacheKey(" usamo  QUALIFIER ", "National");
  assert.equal(k1, k2);
  const k3 = computePrestigeCacheKey("USAMO Qualifier", "regional");
  assert.notEqual(k1, k3, "different levelHint must produce different key");
});

// ─── Reputable-domain allowlist ────────────────────────────────────────

test("REPUTABLE_DOMAINS is restricted to official competition / gov / school hosts", () => {
  assert.ok(REPUTABLE_DOMAINS.includes("maa.org"));
  assert.ok(REPUTABLE_DOMAINS.includes("usaco.org"));
  assert.ok(REPUTABLE_DOMAINS.includes("societyforscience.org"));
  assert.ok(REPUTABLE_DOMAINS.includes("firstinspires.org"));
  assert.ok(REPUTABLE_DOMAINS.includes("ci.uky.edu"));
  assert.ok(!REPUTABLE_DOMAINS.includes("en.wikipedia.org"));
  assert.ok(!REPUTABLE_DOMAINS.includes("collegevine.com"));
  assert.ok(!REPUTABLE_DOMAINS.includes("ivywise.com"));
});

test("official competition catalog returns source-backed prestige matches", () => {
  assert.ok(OFFICIAL_COMPETITION_SOURCES.length >= 10);
  const [usaco] = searchCompetitionCatalog("USACO Platinum finalist", { limit: 3 });
  assert.equal(usaco.activityId, "usaco");
  assert.ok(usaco.score >= 0.82);
  assert.ok(usaco.sourcesCited.every(isReputableSourceUrl));

  const best = findBestCompetitionCatalogPrestige("HOSA ILC medallion winner");
  assert.equal(best.activityId, "hosa");
  assert.ok(best.score >= 0.8);
});

test("RAG statements expose bulk cache-memory readers for prestige and components", () => {
  const { stmts } = freshStmts();
  const prestigeKey = computePrestigeCacheKey("USACO Platinum", "national");

  stmts.upsertPrestigeCache.run(
    prestigeKey,
    "USACO Platinum",
    "national",
    0.82,
    "Matched official competition catalog.",
    JSON.stringify(["https://usaco.org/current/current/index.php?page=details"]),
    "catalog",
    null,
    null,
    JSON.stringify({ score: 0.82 }),
  );
  stmts.upsertComponentCache.run(
    "component-cache-key",
    "prestige",
    0.82,
    JSON.stringify({ source: "catalog" }),
    "catalog",
    null,
    null,
    "{\"activityName\":\"USACO Platinum\"}",
  );

  assert.equal(Number(stmts.countPrestigeCache.get().total), 1);
  assert.equal(Number(stmts.countComponentCache.get().total), 1);
  assert.equal(Number(stmts.countComponentCacheByFactor.get("prestige").total), 1);
  assert.equal(stmts.listPrestigeCacheRecent.all(10).length, 1);
  assert.equal(stmts.listComponentCacheRecentByFactor.all("prestige", 10).length, 1);
});

// ─── Path 1: cache hit ─────────────────────────────────────────────────

test("returns cached prestige on TTL hit without calling the adapter", async () => {
  const { stmts } = freshStmts();
  const key = computePrestigeCacheKey("AIME", "national");

  // Pre-seed a fresh cache row.
  stmts.upsertPrestigeCache.run(
    key, "AIME", "national", 0.72,
    "Seeded from test.",
    JSON.stringify(["https://maa.org/aime"]),
    "research", "anthropic", "claude-haiku-4-5-20251001",
    JSON.stringify({ score: 0.72 }),
  );

  // Adapter is Anthropic but fetchImpl would throw if touched.
  const r = await researchCompetitionPrestige({
    activityName: "AIME",
    levelHint: "national",
    stmts,
    adapter: { provider: "openrouter", apiKey: "sk-or-x", model: "z-ai/glm-5.1" },
    options: {
      fetchImpl: async () => { throw new Error("should not fetch on cache hit"); },
    },
  });
  assert.equal(r.cached, true);
  assert.equal(r.score, 0.72);
  assert.equal(r.source, "research");
});

// ─── Path 2: benchmark short-circuit ───────────────────────────────────

test("benchmark hit short-circuits web search and caches result", async () => {
  const { stmts } = freshStmts();
  const r = await researchCompetitionPrestige({
    activityName: "USAJMO qualifier",
    levelHint: "national",
    benchmarkHit: { level: "USAJMO qualifier", prestige_score: 0.80 },
    stmts,
    adapter: { provider: "openrouter", apiKey: "sk-or-x", model: "z-ai/glm-5.1" },
    options: {
      fetchImpl: async () => { throw new Error("should not fetch on benchmark hit"); },
    },
  });
  assert.equal(r.source, "benchmark");
  assert.equal(r.score, 0.80);
  assert.equal(r.cached, false);

  // The benchmark result should now be cached — a second call should hit cache.
  const r2 = await researchCompetitionPrestige({
    activityName: "USAJMO qualifier",
    levelHint: "national",
    stmts,
    adapter: { provider: "openrouter", apiKey: "sk-or-x", model: "z-ai/glm-5.1" },
    options: {
      fetchImpl: async () => { throw new Error("should not fetch on second call either"); },
    },
  });
  assert.equal(r2.cached, true);
  assert.equal(r2.source, "benchmark");
});

test("official catalog hit short-circuits web search and caches result without adapter", async () => {
  const { stmts } = freshStmts();
  const r = await researchCompetitionPrestige({
    activityName: "USACO Platinum",
    stmts,
    adapter: null,
    options: {
      fetchImpl: async () => { throw new Error("catalog hit should not fetch"); },
    },
  });
  assert.equal(r.source, "catalog");
  assert.ok(r.score >= 0.82);
  assert.ok(r.sourcesCited.every(isReputableSourceUrl));

  const r2 = await researchCompetitionPrestige({
    activityName: "USACO Platinum",
    stmts,
    adapter: null,
    options: {
      fetchImpl: async () => { throw new Error("cached catalog hit should not fetch"); },
    },
  });
  assert.equal(r2.cached, true);
  assert.equal(r2.source, "catalog");
});

// ─── Path 3: non-Anthropic → unavailable ───────────────────────────────

test("non-Anthropic adapter returns source:unavailable without throwing", async () => {
  const { stmts } = freshStmts();
  const r = await researchCompetitionPrestige({
    activityName: "Some Obscure Contest",
    levelHint: "regional",
    stmts,
    adapter: { provider: "openai", apiKey: "sk-x", model: "gpt-4o-mini" },
  });
  assert.equal(r.source, "unavailable");
  assert.equal(r.score, 0);
  assert.equal(r.cached, false);
});

test("missing adapter returns source:unavailable without throwing", async () => {
  const { stmts } = freshStmts();
  const r = await researchCompetitionPrestige({
    activityName: "Some Obscure Contest",
    levelHint: "regional",
    stmts,
    adapter: null,
  });
  assert.equal(r.source, "unavailable");
});

// ─── Path 3: OpenRouter web-plugin research ────────────────────────────

test("OpenRouter adapter runs web-plugin research, parses JSON, sends plugins (not tools), and caches", async () => {
  const { stmts } = freshStmts();
  const captured = {};
  let usageLogged = null;
  const fetchImpl = fakeOpenRouterFetch(
    {
      score: 0.83,
      rationale: "National official-source engineering challenge signal.",
      sourcesCited: ["https://usaco.org/index.php?page=contests", "https://www.soinc.org/"],
    },
    captured,
  );
  const r = await researchCompetitionPrestige({
    activityName: "Uncataloged Engineering Challenge",
    levelHint: "national",
    stmts,
    adapter: {
      provider: "openrouter", apiKey: "sk-or-x", model: "z-ai/glm-5.1",
      recordUsage: (model, usage) => { usageLogged = { model, usage }; },
    },
    options: { fetchImpl },
  });
  assert.equal(r.source, "research");
  assert.equal(r.score, 0.83);
  assert.ok(r.sourcesCited.length >= 1 && r.sourcesCited.every(isReputableSourceUrl));
  // Web plugin wired, no Anthropic-native tools.
  assert.ok(Array.isArray(captured.body.plugins), "plugins[] must be present");
  assert.equal(captured.body.plugins[0].id, "web");
  assert.equal(captured.body.tools, undefined, "must NOT send native tools");
  // Usage sink fired for budget accounting.
  assert.ok(usageLogged && usageLogged.usage, "recordUsage should fire");

  // Second call hits the 30-day cache (no fetch).
  const r2 = await researchCompetitionPrestige({
    activityName: "Uncataloged Engineering Challenge",
    levelHint: "national",
    stmts,
    adapter: { provider: "openrouter", apiKey: "sk-or-x", model: "z-ai/glm-5.1" },
    options: { fetchImpl: async () => { throw new Error("second call must hit cache"); } },
  });
  assert.equal(r2.cached, true);
  assert.equal(r2.score, 0.83);
});

test("expired cache row is ignored; a fresh OpenRouter call re-researches", async () => {
  const { db, stmts } = freshStmts();
  const key = computePrestigeCacheKey("Old Research", null);
  const stalePastIso = new Date(Date.now() - (PRESTIGE_TTL_DAYS + 5) * 86_400_000).toISOString();
  db.prepare(`
    INSERT INTO ec_prestige_cache (cache_key, activity_name, level_hint, score, rationale, sources_json, source, provider, model, result_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    key, "Old Research", null, 0.11, "stale", JSON.stringify([]),
    "research", "openrouter", "z-ai/glm-5.1", JSON.stringify({ score: 0.11 }), stalePastIso,
  );
  const r = await researchCompetitionPrestige({
    activityName: "Old Research",
    stmts,
    adapter: { provider: "openrouter", apiKey: "sk-or-x", model: "z-ai/glm-5.1" },
    options: { fetchImpl: fakeOpenRouterFetch({ score: 0.66, rationale: "refreshed.", sourcesCited: ["https://maa.org/"] }) },
  });
  assert.equal(r.source, "research");
  assert.equal(r.score, 0.66);
  assert.equal(r.cached, false);
});

// ─── Invalid input ─────────────────────────────────────────────────────

test("missing activityName or stmts returns invalid_input source", async () => {
  const { stmts } = freshStmts();
  const r1 = await researchCompetitionPrestige({ activityName: "", stmts });
  assert.equal(r1.source, "invalid_input");
  const r2 = await researchCompetitionPrestige({ activityName: "Foo", stmts: null });
  assert.equal(r2.source, "invalid_input");
});

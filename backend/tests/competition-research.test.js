// ═══════════════════════════════════════════════════════════════════════
// tests/competition-research.test.js — prestige research + cache behavior
// ═══════════════════════════════════════════════════════════════════════
// The research module has three gated paths:
//   1. TTL-cache hit   — returns immediately, no LLM, cached: true.
//   2. Benchmark hit   — returns seeded prestige_score, no web_search,
//                        source: "benchmark".
//   3. Anthropic       — calls web_search_20250305 through callLLM, parses
//                        the JSON response, caches 30d.
// Non-Anthropic providers short-circuit with source: "unavailable" so the
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

// Fake fetch returning an Anthropic-shaped response containing a JSON
// payload in the text block. Also captures the outbound request body so
// tests can assert on the web_search tool wiring.
function fakeAnthropicFetch(jsonPayload, captured = {}) {
  return async (_url, opts) => {
    captured.body = JSON.parse(opts.body);
    captured.url = _url;
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({
        id: "msg_1",
        model: "claude-haiku-4-5-20251001",
        content: [{ type: "text", text: JSON.stringify(jsonPayload) }],
        usage: { input_tokens: 10, output_tokens: 20 },
        stop_reason: "end_turn",
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
    adapter: { provider: "anthropic", apiKey: "sk-ant-x", model: "claude-haiku-4-5-20251001" },
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
    adapter: { provider: "anthropic", apiKey: "sk-ant-x", model: "claude-haiku-4-5-20251001" },
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
    adapter: { provider: "anthropic", apiKey: "sk-ant-x", model: "claude-haiku-4-5-20251001" },
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

// ─── Path 3b: successful Anthropic research ────────────────────────────

test("successful research parses JSON, caches, and forwards web_search tool", async () => {
  const { stmts } = freshStmts();
  const captured = {};
  const fetchImpl = fakeAnthropicFetch(
    {
      score: 0.88,
      rationale: "National official-source engineering challenge signal.",
      sourcesCited: [
        "https://usaco.org/current/current/index.php?page=details",
        "https://www.soinc.org/2026-national-tournament",
      ],
    },
    captured,
  );

  const r = await researchCompetitionPrestige({
    activityName: "Uncataloged Engineering Challenge",
    levelHint: "national",
    stmts,
    adapter: { provider: "anthropic", apiKey: "sk-ant-x", model: "claude-haiku-4-5-20251001" },
    options: { fetchImpl },
  });
  assert.equal(r.source, "research");
  assert.equal(r.score, 0.88);
  assert.equal(r.sourcesCited.length, 2);
  assert.equal(r.provider, "anthropic");

  // Request body must include the web_search tool with the reputable-domain allowlist.
  assert.ok(Array.isArray(captured.body.tools));
  const tool = captured.body.tools[0];
  assert.equal(tool.type, "web_search_20250305");
  assert.equal(tool.name, "web_search");
  assert.ok(Array.isArray(tool.allowed_domains));
  assert.ok(tool.allowed_domains.includes("maa.org"));
  assert.ok(tool.allowed_domains.includes("usaco.org"));

  // Cache the result — second call must hit cache.
  const r2 = await researchCompetitionPrestige({
    activityName: "Uncataloged Engineering Challenge",
    levelHint: "national",
    stmts,
    adapter: { provider: "anthropic", apiKey: "sk-ant-x", model: "claude-haiku-4-5-20251001" },
    options: {
      fetchImpl: async () => { throw new Error("second call must hit cache"); },
    },
  });
  assert.equal(r2.cached, true);
  assert.equal(r2.score, 0.88);
});

// ─── Malformed JSON → research_failed ──────────────────────────────────

test("malformed JSON response yields source:research_failed with score 0", async () => {
  const { stmts } = freshStmts();
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: new Map(),
    json: async () => ({
      id: "msg_1",
      model: "claude-haiku-4-5-20251001",
      content: [{ type: "text", text: "this is not json at all" }],
      usage: { input_tokens: 1, output_tokens: 2 },
      stop_reason: "end_turn",
    }),
  });

  const r = await researchCompetitionPrestige({
    activityName: "Made-Up Contest",
    stmts,
    adapter: { provider: "anthropic", apiKey: "sk-ant-x", model: "claude-haiku-4-5-20251001" },
    options: { fetchImpl },
  });
  assert.equal(r.source, "research_failed");
  assert.equal(r.score, 0);
});

// ─── Network failure → research_failed ─────────────────────────────────

test("research response with only non-official sources is rejected", async () => {
  const { stmts } = freshStmts();
  const fetchImpl = fakeAnthropicFetch({
    score: 0.77,
    rationale: "Looks selective but cites a weak source.",
    sourcesCited: ["https://en.wikipedia.org/wiki/Example"],
  });
  const r = await researchCompetitionPrestige({
    activityName: "Uncataloged Contest With Weak Sources",
    stmts,
    adapter: { provider: "anthropic", apiKey: "sk-ant-x", model: "claude-haiku-4-5-20251001" },
    options: { fetchImpl },
  });
  assert.equal(r.source, "research_failed");
  assert.equal(r.score, 0);
});

test("fetch throwing yields source:research_failed, cached for brief backoff", async () => {
  const { stmts } = freshStmts();
  const fetchImpl = async () => { throw new Error("boom"); };
  const r = await researchCompetitionPrestige({
    activityName: "Unstable Network Contest",
    stmts,
    adapter: { provider: "anthropic", apiKey: "sk-ant-x", model: "claude-haiku-4-5-20251001" },
    options: { fetchImpl },
  });
  assert.equal(r.source, "research_failed");
  assert.equal(r.score, 0);
});

// ─── Cache TTL expiry ──────────────────────────────────────────────────

test("expired cache row is ignored and a fresh call runs", async () => {
  const { db, stmts } = freshStmts();
  const key = computePrestigeCacheKey("Old Research", null);
  // Write a row with a created_at far older than PRESTIGE_TTL_DAYS.
  const stalePastIso = new Date(Date.now() - (PRESTIGE_TTL_DAYS + 5) * 86_400_000).toISOString();
  db.prepare(`
    INSERT INTO ec_prestige_cache (cache_key, activity_name, level_hint, score, rationale, sources_json, source, provider, model, result_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    key, "Old Research", null, 0.11,
    "stale", JSON.stringify([]),
    "research", "anthropic", "claude-haiku-4-5-20251001",
    JSON.stringify({ score: 0.11 }),
    stalePastIso,
  );

  // On a new call, the stale row should be ignored — the fake fetch answers.
  const fetchImpl = fakeAnthropicFetch({
    score: 0.66,
    rationale: "refreshed.",
    sourcesCited: ["https://maa.org/"],
  });
  const r = await researchCompetitionPrestige({
    activityName: "Old Research",
    stmts,
    adapter: { provider: "anthropic", apiKey: "sk-ant-x", model: "claude-haiku-4-5-20251001" },
    options: { fetchImpl },
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

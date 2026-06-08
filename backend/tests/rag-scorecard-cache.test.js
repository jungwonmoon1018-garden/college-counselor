import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import crypto from "node:crypto";

import { initRAGTables, prepareRAGStatements } from "../rag-engine.js";

function freshStmts() {
  const db = new Database(":memory:");
  initRAGTables(db);
  return prepareRAGStatements(db);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function buildCacheKey(kind, payload) {
  return crypto.createHash("sha256").update(`${kind}|${stableStringify(payload)}`).digest("hex");
}

test("scorecard_query_cache persists repeated search payloads in SQLite", () => {
  const stmts = freshStmts();
  const payload = {
    name: "Stanford",
    state: "CA",
    states: ["CA", "NY"],
    minSAT: 1500,
    limit: 20,
    page: 0,
  };
  const response = {
    results: [{ unitId: "243744", name: "Stanford University" }],
    total: 1,
    source: "U.S. Department of Education College Scorecard API",
  };
  const key = buildCacheKey("search", payload);

  stmts.upsertScorecardQueryCache.run(
    key,
    "search",
    JSON.stringify(payload),
    JSON.stringify(response),
  );

  const row = stmts.getScorecardQueryCache.get(key);
  assert.equal(row.cache_kind, "search");
  assert.deepEqual(JSON.parse(row.query_json), payload);
  assert.deepEqual(JSON.parse(row.data_json), response);
});

test("scorecard_query_cache keys are stable for equivalent compare requests", () => {
  const a = buildCacheKey("compare", { unitIds: ["243744", "166683"] });
  const b = buildCacheKey("compare", { unitIds: ["243744", "166683"] });
  assert.equal(a, b);
});

test("scorecard_query_cache keys can normalize equivalent search payloads", () => {
  const normalize = (payload) => ({
    name: String(payload.name || "").trim().toLowerCase().replace(/\s+/g, " ") || null,
    state: String(payload.state || "").trim().toUpperCase() || null,
    states: Array.isArray(payload.states)
      ? payload.states.map((s) => String(s || "").trim().toUpperCase()).filter(Boolean).sort()
      : null,
    minSAT: payload.minSAT ?? null,
    maxTuition: payload.maxTuition ?? null,
    maxAcceptanceRate: payload.maxAcceptanceRate ?? null,
    sizePreference: String(payload.sizePreference || "").trim().toLowerCase() || null,
    limit: Math.min(Math.max(Number(payload.limit || 20), 1), 100),
    page: Math.max(Number(payload.page || 0), 0),
  });

  const a = buildCacheKey("search", normalize({
    name: " Stanford  University ",
    state: "ca",
    states: ["ny", "ca"],
    sizePreference: " Medium ",
    limit: "20",
    page: "0",
  }));
  const b = buildCacheKey("search", normalize({
    name: "stanford university",
    state: "CA",
    states: ["CA", "NY"],
    sizePreference: "medium",
    limit: 20,
    page: 0,
  }));
  assert.equal(a, b);
});

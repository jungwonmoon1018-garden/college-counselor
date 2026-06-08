// ═══════════════════════════════════════════════════════════════════════
// NARRATIVE FIT LLM SHIM — small-tier narrative_fit scorer with cache
// ═══════════════════════════════════════════════════════════════════════
// The EC strength vectorizer's narrative_fit factor is keyword-first.
// When keyword overlap is inconclusive (< 2 distinct theme matches and
// the EC text is long enough to be worth a second look), we fall back
// to this tiny LLM call.
//
// Provider: whichever adapter is resolved at call time — Anthropic Haiku
// is the historical default, but an OpenAI-compat key / Gemini key works
// just as well. These internal scoring calls bypass the student-facing
// audit log and rate limiter on purpose.
// ═══════════════════════════════════════════════════════════════════════

import crypto from "node:crypto";
import { callLLM, detectProvider, resolveTierDefault } from "./llm-adapters/index.js";

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TOKENS = 80;
const MAX_NARRATIVE_CHARS = 1200;
const MAX_EC_CHARS = 1200;

// Legacy export — keeps working for call sites that still reference the
// old Anthropic-only constant. New code should read the resolved model
// from the returned row (`model` column) or from callLLM's response.
export const NARRATIVE_FIT_LLM_MODEL = "claude-haiku-4-5";

// Table DDL + prepared statements — these live in counselor.db so we can
// piggy-back on the shared connection opened by rag-engine.js. The
// `provider` column was added alongside multi-LLM support; existing rows
// migrate with NULL provider (treated as "anthropic" for audit display).
export function initNarrativeFitCacheTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS narrative_fit_cache (
      cache_key TEXT PRIMARY KEY,
      score REAL NOT NULL,
      reason TEXT,
      model TEXT,
      provider TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  // In-place migration for pre-existing installations.
  const cols = db.prepare(`PRAGMA table_info(narrative_fit_cache)`).all().map(r => r.name);
  if (!cols.includes("provider")) {
    db.exec(`ALTER TABLE narrative_fit_cache ADD COLUMN provider TEXT`);
  }
}

export function prepareNarrativeFitCacheStatements(db) {
  return {
    get: db.prepare(`SELECT * FROM narrative_fit_cache WHERE cache_key = ?`),
    put: db.prepare(`
      INSERT OR REPLACE INTO narrative_fit_cache
        (cache_key, score, reason, model, provider, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `),
  };
}

export function computeCacheKey(narrativeHash, ecTextHash) {
  return crypto
    .createHash("sha256")
    .update(`${narrativeHash}:${ecTextHash}`)
    .digest("hex");
}

export function hashText(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex");
}

/**
 * Resolve (provider, apiKey, baseUrl, model) given call-site options.
 * Precedence:
 *   1. Explicit options.provider/apiKey/baseUrl/model.
 *   2. options.apiKey alone → provider auto-detected from key prefix.
 *   3. options.byokLookup() → returns {provider, apiKey, baseUrl, model}
 *      for the student; injected by ec-strength-vectorizer when a student
 *      id is available so narrative-fit runs on the student's bill.
 *   4. Env fallbacks: ANTHROPIC_API_KEY, OPENAI_API_KEY+OPENAI_BASE_URL,
 *      GOOGLE_API_KEY.
 *   5. null — signal keyword-only fallback.
 */
function resolveAdapterConfig(options = {}) {
  // 1. Full explicit config.
  if (options.provider && options.apiKey) {
    const model = options.model || resolveTierDefault(options.provider, "small") || null;
    return { provider: options.provider, apiKey: options.apiKey, baseUrl: options.baseUrl || null, model };
  }

  // 2. apiKey only — detect.
  if (options.apiKey) {
    const provider = options.provider || detectProvider({ apiKey: options.apiKey, baseUrl: options.baseUrl });
    if (provider) {
      const model = options.model || resolveTierDefault(provider, "small");
      return { provider, apiKey: options.apiKey, baseUrl: options.baseUrl || null, model };
    }
  }

  // 3. BYOK lookup (injected by caller).
  if (typeof options.byokLookup === "function") {
    try {
      const byok = options.byokLookup();
      if (byok && byok.apiKey) {
        const provider = byok.provider || detectProvider({ apiKey: byok.apiKey, baseUrl: byok.baseUrl });
        if (provider) {
          const model = byok.model || resolveTierDefault(provider, "small");
          return { provider, apiKey: byok.apiKey, baseUrl: byok.baseUrl || null, model };
        }
      }
    } catch {
      // Non-fatal — fall through to env.
    }
  }

  // 4. Env fallbacks.
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      provider: "anthropic",
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseUrl: null,
      model: process.env.LLM_SMALL_MODEL || resolveTierDefault("anthropic", "small"),
    };
  }
  if (process.env.OPENAI_API_KEY) {
    const baseUrl = process.env.OPENAI_BASE_URL || null;
    const provider = baseUrl ? "openai_compat" : "openai";
    return {
      provider,
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl,
      model: process.env.LLM_SMALL_MODEL || resolveTierDefault(provider, "small"),
    };
  }
  if (process.env.GOOGLE_API_KEY) {
    return {
      provider: "google",
      apiKey: process.env.GOOGLE_API_KEY,
      baseUrl: null,
      model: process.env.LLM_SMALL_MODEL || resolveTierDefault("google", "small"),
    };
  }

  return null;
}

/**
 * Backward-compatible entry point. Name kept so existing tests and the
 * ec-strength-vectorizer don't need renaming.
 *
 * @param {object} params
 * @param {string} params.narrative
 * @param {string} params.ecText
 * @param {string} params.narrativeHash
 * @param {string} params.ecTextHash
 * @param {object} params.stmts - from prepareNarrativeFitCacheStatements
 * @param {object} [params.options]
 * @param {function} [params.options.fetchImpl] - injected for tests
 * @param {string}   [params.options.apiKey]
 * @param {string}   [params.options.provider]
 * @param {string}   [params.options.baseUrl]
 * @param {string}   [params.options.model]
 * @param {function} [params.options.byokLookup] — () => {provider, apiKey, baseUrl, model}
 * @param {number}   [params.options.timeoutMs]
 * @returns {Promise<{score:number, reason:string, cached:boolean}|null>}
 */
export async function callHaikuForNarrativeFit({
  narrative,
  ecText,
  narrativeHash,
  ecTextHash,
  stmts,
  options = {},
}) {
  if (!narrative || !ecText) return null;
  if (!stmts) throw new Error("narrative_fit_cache statements required");

  const cacheKey = computeCacheKey(narrativeHash, ecTextHash);
  const cached = stmts.get.get(cacheKey);
  if (cached) {
    return {
      score: Number(cached.score),
      reason: String(cached.reason || ""),
      cached: true,
    };
  }

  const adapter = resolveAdapterConfig(options);
  if (!adapter) return null;
  if (!adapter.model) return null;

  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const systemPrompt =
      "You score how well an extracurricular activity fits a student's self-written narrative. " +
      'Respond with JSON ONLY in the exact shape {"score": NUMBER, "reason": STRING}. ' +
      "Score is 0.0-1.0: 0.0 = no alignment, 0.5 = tangential, 1.0 = obvious embodiment. " +
      "Reason must be <=30 words.";

    const userText =
      "NARRATIVE:\n" +
      String(narrative).slice(0, MAX_NARRATIVE_CHARS) +
      "\n\nEC DESCRIPTION:\n" +
      String(ecText).slice(0, MAX_EC_CHARS);

    const resp = await callLLM({
      provider: adapter.provider,
      apiKey: adapter.apiKey,
      baseUrl: adapter.baseUrl,
      model: adapter.model,
      system: systemPrompt,
      messages: [{ role: "user", content: userText }],
      maxTokens: MAX_TOKENS,
      temperature: 0,
      signal: controller.signal,
      fetchImpl: options.fetchImpl,
    });

    const raw = Array.isArray(resp?.content)
      ? resp.content.map((c) => c?.text || "").join("").trim()
      : "";
    const parsed = parseJsonLoose(raw);
    if (!parsed) return null;

    const score = clamp01(Number(parsed.score));
    if (!Number.isFinite(score)) return null;
    const reason = String(parsed.reason || "").slice(0, 240);

    stmts.put.run(cacheKey, score, reason, adapter.model, adapter.provider);
    return { score, reason, cached: false };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Helpers ──────────────────────────────────────────────
function parseJsonLoose(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // Extract first balanced {...} block
    const start = raw.indexOf("{");
    if (start < 0) return null;
    let depth = 0;
    for (let i = start; i < raw.length; i++) {
      if (raw[i] === "{") depth += 1;
      else if (raw[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          const candidate = raw.slice(start, i + 1);
          try {
            return JSON.parse(candidate);
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }
}

function clamp01(n) {
  if (!Number.isFinite(n)) return NaN;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

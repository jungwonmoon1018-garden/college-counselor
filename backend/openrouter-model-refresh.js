// ═══════════════════════════════════════════════════════════════════════
// OPENROUTER MODEL REFRESH — keep recommended OpenRouter models current, but
// migrate WITH HUMAN APPROVAL (never silently, unlike the Anthropic path).
//
// How it differs from claude-model-migration.js:
//   - Anthropic: retired IDs are rewritten on student rows automatically.
//   - OpenRouter (and other BYOK providers): we only refresh the *recommended*
//     tier defaults from OpenRouter's live model list. The student's stored
//     models are left untouched; the existing "Update models" prompt in the
//     BYOK UI compares stored vs recommended and asks the student to APPROVE
//     before anything changes.
//
// So this module's job is narrow: detect when a recommended default has been
// retired (no longer offered by OpenRouter) and propose an available
// replacement, exposing status for /api/llm/providers and /api/methodology.
// ═══════════════════════════════════════════════════════════════════════

import { TIER_DEFAULTS } from "./llm-adapters/tier-defaults.js";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

// Mutable recommended defaults (seeded from the static catalog). The providers
// endpoint overlays these for the openrouter provider; ES-module binding means
// importers see live updates.
export const OPENROUTER_TARGETS = {
  small: TIER_DEFAULTS.openrouter?.small || "google/gemma-4-26b-a4b-it",
  medium: TIER_DEFAULTS.openrouter?.medium || "google/gemma-4-31b-it",
  large: TIER_DEFAULTS.openrouter?.large || "deepseek/deepseek-v4-pro",
};

// Per-tier preference lists used ONLY to pick a replacement when a current
// default is retired. The refresh picks the first id that is actually live.
// Free/low-cost first so new users aren't surprised by spend.
const TIER_FALLBACKS = {
  small: ["google/gemma-4-26b-a4b-it", "google/gemma-2-9b-it:free", "meta-llama/llama-3.2-3b-instruct:free", "qwen/qwen-2.5-7b-instruct"],
  medium: ["google/gemma-4-31b-it", "meta-llama/llama-3.3-70b-instruct", "qwen/qwen-2.5-72b-instruct", "deepseek/deepseek-chat"],
  large: ["deepseek/deepseek-v4-pro", "deepseek/deepseek-r1", "deepseek/deepseek-chat", "anthropic/claude-sonnet-4"],
};

export const OPENROUTER_STATUS = {
  lastChecked: null,      // ISO string
  availableCount: null,   // number of models OpenRouter returned
  reachable: null,        // boolean
  proposals: [],          // [{ tier, from, to, reason }] — for human approval
  note: "Recommended OpenRouter models are proposed, never auto-applied. Approve changes in your API-key settings.",
};

// ─── Live model catalog cache ────────────────────────────────────────────
// Populated from OpenRouter's /api/v1/models. Drives two things:
//   1. GET /api/llm/openrouter/models — the BYOK model dropdown is built from
//      this live list so it only ever shows currently-served model IDs.
//   2. Budget tracking — usage-budget.js prices token usage off the per-model
//      `pricing.prompt` / `pricing.completion` fields here (USD per token).
export const OPENROUTER_CATALOG = {
  models: [],            // [{ id, name, contextLength, pricing:{inputPerMTok, outputPerMTok} }]
  byId: new Map(),       // id → catalog entry
  lastFetched: null,     // ISO string
  reachable: null,       // boolean
};

// Fetch the full model catalog (id, name, context, pricing). pricing.prompt /
// pricing.completion are USD-per-token strings; we expose them as USD per
// 1M tokens for the budget tracker and UI.
export async function fetchOpenRouterModels(fetchImpl = fetch) {
  const res = await fetchImpl(OPENROUTER_MODELS_URL, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`OpenRouter /models ${res.status}`);
  const json = await res.json();
  const list = Array.isArray(json?.data) ? json.data : [];
  return list
    .map((m) => {
      const id = String(m?.id || "").trim();
      if (!id) return null;
      const promptPerTok = Number(m?.pricing?.prompt);
      const completionPerTok = Number(m?.pricing?.completion);
      return {
        id,
        name: String(m?.name || id),
        contextLength: Number(m?.context_length) || null,
        pricing: {
          inputPerMTok: Number.isFinite(promptPerTok) ? promptPerTok * 1_000_000 : null,
          outputPerMTok: Number.isFinite(completionPerTok) ? completionPerTok * 1_000_000 : null,
        },
        free: /:free$/.test(id) || promptPerTok === 0,
      };
    })
    .filter(Boolean);
}

// Refresh the in-memory catalog. Safe to call at boot and on a daily timer.
export async function refreshOpenRouterCatalog({ fetchImpl = fetch } = {}) {
  try {
    const models = await fetchOpenRouterModels(fetchImpl);
    OPENROUTER_CATALOG.models = models;
    OPENROUTER_CATALOG.byId = new Map(models.map((m) => [m.id, m]));
    OPENROUTER_CATALOG.reachable = true;
    OPENROUTER_CATALOG.lastFetched = nowISO();
  } catch (err) {
    OPENROUTER_CATALOG.reachable = false;
    OPENROUTER_CATALOG.lastFetched = nowISO();
    console.warn("[OR-CATALOG] refresh failed:", String(err.message).slice(0, 160));
  }
  return OPENROUTER_CATALOG;
}

// Pricing lookup for the budget tracker. Returns { input, output } USD per
// 1M tokens, or null when the model isn't in the catalog (caller treats
// unknown as $0 — better to undercount than block on a missing price).
export function getOpenRouterPricingUSDPerMTok(modelId) {
  if (!modelId) return null;
  const entry = OPENROUTER_CATALOG.byId.get(String(modelId));
  if (!entry || !entry.pricing) return null;
  const { inputPerMTok, outputPerMTok } = entry.pricing;
  if (inputPerMTok == null && outputPerMTok == null) return null;
  return { input: inputPerMTok || 0, output: outputPerMTok || 0 };
}

// Backwards-compatible helper: the tier-default refresh only needs the set
// of available IDs.
export async function fetchOpenRouterModelIds(fetchImpl = fetch) {
  const models = await fetchOpenRouterModels(fetchImpl);
  return new Set(models.map((m) => m.id));
}

/**
 * Refresh the recommended OpenRouter defaults against the live model list.
 * Retired defaults are replaced with the first available fallback and recorded
 * as a proposal. Returns OPENROUTER_STATUS. Pure-ish: only mutates the two
 * exported objects (intentional, so importers see live values).
 */
export async function refreshOpenRouterTargets({ fetchImpl = fetch, reason = "scheduled" } = {}) {
  OPENROUTER_STATUS.proposals = [];
  let available;
  try {
    available = await fetchOpenRouterModelIds(fetchImpl);
    OPENROUTER_STATUS.reachable = true;
    OPENROUTER_STATUS.availableCount = available.size;
  } catch (err) {
    OPENROUTER_STATUS.reachable = false;
    OPENROUTER_STATUS.availableCount = null;
    OPENROUTER_STATUS.lastChecked = nowISO();
    OPENROUTER_STATUS.error = String(err.message).slice(0, 160);
    return OPENROUTER_STATUS;
  }
  delete OPENROUTER_STATUS.error;

  for (const tier of ["small", "medium", "large"]) {
    const current = OPENROUTER_TARGETS[tier];
    if (current && available.has(current)) continue; // still offered — keep it
    const replacement = (TIER_FALLBACKS[tier] || []).find((id) => available.has(id));
    if (replacement && replacement !== current) {
      OPENROUTER_STATUS.proposals.push({
        tier,
        from: current,
        to: replacement,
        reason: current ? `'${current}' is no longer offered by OpenRouter` : "no default set",
      });
      OPENROUTER_TARGETS[tier] = replacement; // update the *recommendation*
    }
  }

  OPENROUTER_STATUS.lastChecked = nowISO();
  if (OPENROUTER_STATUS.proposals.length) {
    console.log(`[OR-MIGRATE] ${reason}: ${OPENROUTER_STATUS.proposals.length} recommended OpenRouter model(s) updated (pending user approval).`);
  }
  return OPENROUTER_STATUS;
}

// Isolated so tests can stub it; real boot/daily calls use wall clock.
function nowISO() {
  try { return new Date().toISOString(); } catch { return null; }
}

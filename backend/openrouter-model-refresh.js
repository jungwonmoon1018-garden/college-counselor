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

export async function fetchOpenRouterModelIds(fetchImpl = fetch) {
  const res = await fetchImpl(OPENROUTER_MODELS_URL, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`OpenRouter /models ${res.status}`);
  const json = await res.json();
  const list = Array.isArray(json?.data) ? json.data : [];
  return new Set(list.map((m) => String(m.id)).filter(Boolean));
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

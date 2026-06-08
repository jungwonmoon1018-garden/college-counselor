// ═══════════════════════════════════════════════════════════════════════
// TIER DEFAULTS — provider → {small, medium, large} model registry
// ═══════════════════════════════════════════════════════════════════════
// Every provider exposes three reasoning tiers that mirror the backend's
// internal HAIKU / SONNET / OPUS ladder:
//
//   small  — routing, extraction, classification, moderation, OCR validation,
//            narrative-fit fallback scoring. Fast, cheap, <5s latency.
//   medium — source-grounded coaching, list synthesis, trend analysis.
//   large  — cross-source conflict resolution, essay critique, last-resort
//            reasoning when medium reports low confidence.
//
// Per-student BYOK rows can override any of these; env vars
// (LLM_SMALL_MODEL / LLM_MEDIUM_MODEL / LLM_LARGE_MODEL) override when no
// student override exists; otherwise we pick the registry default below.
// ═══════════════════════════════════════════════════════════════════════

export const TIER_DEFAULTS = Object.freeze({
  // Native Anthropic — the backend's original home.
  anthropic: Object.freeze({
    small: "claude-haiku-4-5-20251001",
    medium: "claude-sonnet-4-20250514",
    large: "claude-opus-4-6",
  }),
  // OpenAI proper.
  openai: Object.freeze({
    small: "gpt-4o-mini",
    medium: "gpt-4o",
    large: "gpt-4.1",
  }),
  // Google Gemini native API.
  google: Object.freeze({
    small: "gemini-2.0-flash",
    medium: "gemini-2.5-pro",
    large: "gemini-2.5-pro",
  }),
  // OpenRouter — recommended provider for new accounts.
  // All three tiers default to GLM-5.1. Free-model availability on
  // OpenRouter is unstable (providers rotate their free quotas
  // weekly — `:free` model IDs we pick today may 404 tomorrow).
  // Pointing every tier at a single paid model the user explicitly
  // confirmed (GLM-5.1) means chat works the moment they save the
  // BYOK. Students who want to save cost on routing/synthesis can
  // pick currently-live free models from the dropdown — see the
  // up-to-date list at https://openrouter.ai/models?max_price=0
  // Cost-conscious defaults for students:
  //   small  — Gemma 4 26B A4B (MoE w/ ~4B active params, $0.06/MTok
  //            input — fast & cheap for routing/classification).
  //   medium — Gemma 4 31B-it ($0.12/MTok input — synthesis & coaching).
  //   large  — DeepSeek V4 Pro ($0.435/MTok input, $0.87/MTok output —
  //            frontier reasoning at ~5× lower cost than Anthropic/OpenAI
  //            flagships). Only fires when medium reports low confidence,
  //            so per-session large spend stays bounded. Falls back to
  //            medium tier if V4 Pro is unavailable (tier-walk chain).
  // Combined with prompt caching (cache_control: ephemeral on system +
  // chat history), repeat-turn cost stays in the sub-cent range even
  // for long conversations.
  openrouter: Object.freeze({
    small:  "google/gemma-4-26b-a4b-it",
    medium: "google/gemma-4-31b-it",
    large:  "deepseek/deepseek-v4-pro",
  }),
  // DeepSeek direct — same wire format as OpenAI.
  deepseek: Object.freeze({
    small: "deepseek-chat",
    medium: "deepseek-chat",
    large: "deepseek-reasoner",
  }),
  // Together.ai — open-weight Qwen + Llama.
  together: Object.freeze({
    small: "Qwen/Qwen2.5-7B-Instruct-Turbo",
    medium: "Qwen/Qwen2.5-72B-Instruct-Turbo",
    large: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  }),
  // Zhipu / GLM — OpenAI-compatible v4 API.
  zhipu: Object.freeze({
    small: "glm-4-flash",
    medium: "glm-4-air",
    large: "glm-4.6",
  }),
  // Ollama — local daemon, OpenAI-compatible endpoint.
  ollama: Object.freeze({
    small: "llama3.2:3b",
    medium: "llama3.1:8b",
    large: "qwen2.5:32b",
  }),
  // LM Studio — local OpenAI-compatible host (user-chosen model).
  lmstudio: Object.freeze({
    small: "local-model",
    medium: "local-model",
    large: "local-model",
  }),
  // Generic OpenAI-compatible endpoint — fall through to OpenAI defaults.
  openai_compat: Object.freeze({
    small: "gpt-4o-mini",
    medium: "gpt-4o",
    large: "gpt-4.1",
  }),
});

// Human-friendly metadata exposed via /api/llm/providers so the frontend can
// render a "Pick your LLM" wizard without hard-coding anything.
export const PROVIDER_META = Object.freeze([
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    keyPrefix: "sk-ant-",
    baseUrlOptional: false,
    // Current published Anthropic models. The daily refresh from
    // claude-model-migration.js → fetchLatestClaudeTargetsFromAnthropic
    // keeps the "recommended" defaults in sync, but this static list is
    // what the BYOK dropdowns display as user-selectable options.
    knownModels: [
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
      // Older but still active aliases — useful for cost control or
      // pinning, exposed in case a student wants them.
      "claude-opus-4-5",
      "claude-opus-4-1",
      "claude-sonnet-4-5",
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    keyPrefix: "sk-",
    baseUrlOptional: true,
    knownModels: ["gpt-4o-mini", "gpt-4o", "gpt-4.1", "o1-mini", "o3-mini"],
  },
  {
    id: "google",
    label: "Google (Gemini)",
    keyPrefix: "AIza",
    baseUrlOptional: false,
    knownModels: [
      "gemini-2.0-flash",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    keyPrefix: "sk-or-",
    baseUrlOptional: false,
    baseUrl: "https://openrouter.ai/api/v1",
    // Curated list — `:free` suffixed models are zero-cost on OpenRouter
    // (rate-limited but unlimited per-token). Listed first so they sort to
    // the top of the dropdown for cost-conscious students. The exact free
    // models on OpenRouter shift over time; if any of these become
    // unavailable, the BYOK flow accepts the `unverified: true` validator
    // signal so the key still saves and the dropdown lets the student
    // pick a different model.
    knownModels: [
      // ── Free tier (zero per-token cost) ──
      "meta-llama/llama-3.3-70b-instruct:free",
      "qwen/qwen-2.5-72b-instruct:free",
      "deepseek/deepseek-r1:free",
      "z-ai/glm-4.5-air:free",
      "nousresearch/hermes-3-llama-3.1-405b:free",
      // ── Cheap & student-friendly (Gemma 4 family) ──
      "google/gemma-4-26b-a4b-it",
      "google/gemma-4-26b-a4b-it:free",
      "google/gemma-4-31b-it",
      "google/gemma-4-31b-it:free",
      // ── Frontier reasoning at low cost (DeepSeek V4) ──
      "deepseek/deepseek-v4-pro",
      "deepseek/deepseek-v4-flash",
      "deepseek/deepseek-v4-flash:free",
      // ── Paid: GLM family (Zhipu) ──
      "z-ai/glm-5.1",
      "z-ai/glm-4.6",
      "z-ai/glm-4.5",
      // ── Paid: Claude pass-throughs ──
      "anthropic/claude-haiku-4.5",
      "anthropic/claude-sonnet-4",
      "anthropic/claude-opus-4",
      // ── Paid: other strong options ──
      "openai/gpt-4o",
      "openai/gpt-4o-mini",
      "google/gemini-2.5-pro",
      "google/gemini-2.0-flash",
      "deepseek/deepseek-chat",
      "deepseek/deepseek-reasoner",
      "meta-llama/llama-3.3-70b-instruct",
      "qwen/qwen-2.5-72b-instruct",
    ],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    keyPrefix: "sk-",
    baseUrlOptional: false,
    baseUrl: "https://api.deepseek.com",
    knownModels: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "together",
    label: "Together.ai",
    keyPrefix: "",
    baseUrlOptional: false,
    baseUrl: "https://api.together.xyz/v1",
    knownModels: [
      "Qwen/Qwen2.5-7B-Instruct-Turbo",
      "Qwen/Qwen2.5-72B-Instruct-Turbo",
      "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    ],
  },
  {
    id: "zhipu",
    label: "Zhipu (GLM)",
    keyPrefix: "",
    baseUrlOptional: false,
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    knownModels: ["glm-4-flash", "glm-4-air", "glm-4.6"],
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    keyPrefix: "",
    baseUrlOptional: false,
    baseUrl: "http://localhost:11434/v1",
    knownModels: ["llama3.2:3b", "llama3.1:8b", "qwen2.5:32b", "gemma2:9b"],
  },
  {
    id: "lmstudio",
    label: "LM Studio (local)",
    keyPrefix: "",
    baseUrlOptional: false,
    baseUrl: "http://localhost:1234/v1",
    knownModels: ["local-model"],
  },
  {
    id: "openai_compat",
    label: "OpenAI-compatible (custom)",
    keyPrefix: "",
    baseUrlOptional: false,
    knownModels: [],
  },
]);

// Build a reverse map: providerId → which adapter kind handles it on the wire.
// Anthropic and Google have bespoke wire protocols; everybody else speaks
// OpenAI Chat Completions.
export const PROVIDER_WIRE_PROTOCOL = Object.freeze({
  anthropic: "anthropic",
  google: "google",
  openai: "openai",
  openai_compat: "openai",
  openrouter: "openai",
  deepseek: "openai",
  together: "openai",
  zhipu: "openai",
  ollama: "openai",
  lmstudio: "openai",
});

// Reasoning models burn output tokens on internal "thinking" before
// producing visible text. If max_tokens is small, the entire budget
// disappears into reasoning and the user sees an empty response.
// Callers should bump max_tokens significantly when dispatching to
// any of these — typically 4–8× the non-reasoning cap, AND wait
// long enough for the thinking phase to complete.
const REASONING_MODEL_PATTERNS = [
  /^deepseek\/deepseek-r1/i,
  /^deepseek\/deepseek-v4-pro/i,       // V4 Pro is reasoning-by-default
  /^deepseek-reasoner/i,
  /^openai\/o1/i,
  /^openai\/o3/i,
  /^anthropic\/.*-(reasoning|thinking)/i,
  /^z-ai\/glm-.*-reasoning/i,
];
export function isReasoningModel(modelId) {
  if (typeof modelId !== "string") return false;
  return REASONING_MODEL_PATTERNS.some((re) => re.test(modelId));
}

// Resolve a sensible model id for a (providerId, tier) pair. Callers should
// layer on top of this: student override → env override → this default.
export function resolveTierDefault(providerId, tier) {
  if (!providerId || !tier) return null;
  const row = TIER_DEFAULTS[providerId];
  if (!row) return null;
  return row[tier] || null;
}

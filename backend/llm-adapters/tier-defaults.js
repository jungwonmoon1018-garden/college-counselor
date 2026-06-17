// ═══════════════════════════════════════════════════════════════════════
// TIER DEFAULTS — provider → {small, medium, large} model registry
// ═══════════════════════════════════════════════════════════════════════
// Every provider exposes three reasoning tiers:
//
//   small  — routing, extraction, classification, moderation, OCR validation,
//            narrative-fit fallback scoring. Fast, cheap, <5s latency.
//   medium — source-grounded coaching, list synthesis, trend analysis.
//   large  — cross-source conflict resolution, essay critique, last-resort
//            reasoning when medium reports low confidence.
//
// OpenRouter is the default/primary provider. Per-student BYOK rows can
// override any tier; env vars (LLM_SMALL_MODEL / LLM_MEDIUM_MODEL /
// LLM_LARGE_MODEL) override when no student override exists; otherwise we
// pick the registry default below.
// ═══════════════════════════════════════════════════════════════════════

export const TIER_DEFAULTS = Object.freeze({
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
  // OpenRouter — the default/primary provider for new accounts.
  // These are the STATIC SEED + last-resort fallback. At runtime the
  // recommended tier models are validated against (and, when retired,
  // replaced from) OpenRouter's LIVE /models catalog — see
  // OPENROUTER_TARGETS + resolveOpenRouterTier() in
  // openrouter-model-refresh.js. So callers should resolve through that,
  // not read these directly, to guarantee a currently-served id.
  // Cost-conscious student defaults (all verified present in the live
  // catalog at time of writing):
  //   small  — Gemma 4 26B A4B (MoE, ~4B active params; fast/cheap routing).
  //   medium — Gemma 4 31B-it (synthesis & coaching).
  //   large  — DeepSeek V4 Pro (frontier reasoning at low cost); only fires
  //            when medium reports low confidence, so large spend stays bounded.
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
    id: "openrouter",
    label: "OpenRouter",
    keyPrefix: "sk-or-",
    baseUrlOptional: false,
    baseUrl: "https://openrouter.ai/api/v1",
    // OpenRouter is the default/primary provider. The BYOK dropdown is
    // populated from OpenRouter's LIVE /api/v1/models catalog (served via
    // GET /api/llm/openrouter/models) so it only ever shows currently-
    // available model IDs. This curated list is a static FALLBACK used
    // when the live catalog can't be reached. `:free` models are zero
    // per-token cost (rate-limited); listed first for cost-conscious
    // students. Free availability rotates, so the live list is preferred.
    // Static FALLBACK only (the live catalog drives the real dropdown).
    // Every id below was verified present in OpenRouter's live /models
    // catalog; prune here if any 404s rather than letting stale ids linger.
    knownModels: [
      // ── Free tier (zero per-token cost; rotates — live list preferred) ──
      "meta-llama/llama-3.3-70b-instruct:free",
      // ── Cheap & student-friendly (Gemma 4 family) ──
      "google/gemma-4-26b-a4b-it",
      "google/gemma-4-31b-it",
      // ── Frontier reasoning at low cost (DeepSeek V4) ──
      "deepseek/deepseek-v4-pro",
      "deepseek/deepseek-v4-flash",
      // ── Paid: GLM family (Zhipu) ──
      "z-ai/glm-5.1",
      "z-ai/glm-4.6",
      // ── Paid: other strong options ──
      "openai/gpt-4o",
      "openai/gpt-4o-mini",
      "google/gemini-2.5-pro",
      "deepseek/deepseek-chat",
      "meta-llama/llama-3.3-70b-instruct",
      "qwen/qwen-2.5-72b-instruct",
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
// Google has a bespoke wire protocol; everybody else speaks OpenAI Chat
// Completions (OpenRouter, OpenAI, DeepSeek, Together, Zhipu, Ollama, etc.).
export const PROVIDER_WIRE_PROTOCOL = Object.freeze({
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

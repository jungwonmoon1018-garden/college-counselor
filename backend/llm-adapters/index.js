// ═══════════════════════════════════════════════════════════════════════
// LLM ADAPTER DISPATCHER — provider detection + unified callLLM()
// ═══════════════════════════════════════════════════════════════════════
// This module is the single edge between the counseling backend and any
// LLM API. The rest of the app now speaks in provider-agnostic verbs:
//
//   - detectProvider({apiKey, provider, baseUrl})   → normalized provider id
//   - callLLM({provider, ...})                       → Anthropic-shape response
//   - validateKey({provider, apiKey, baseUrl})       → cheap "is this alive"
//   - listKnownModels(provider)                      → seed list for UI
//
// Every response — no matter which provider answered — comes back shaped as
// { content: [{type:"text",text}], usage: {input_tokens, output_tokens},
//   model, stop_reason, _raw, _responseHeaders }.
// ═══════════════════════════════════════════════════════════════════════

import { callAnthropic, validateAnthropicKey } from "./anthropic.js";
import { callOpenAI,    validateOpenAIKey }    from "./openai.js";
import { callGoogle,    validateGoogleKey }    from "./google.js";
import {
  TIER_DEFAULTS,
  PROVIDER_META,
  PROVIDER_WIRE_PROTOCOL,
  resolveTierDefault,
  isReasoningModel,
} from "./tier-defaults.js";
import { sanitizeProviderPayload } from "../content-moderation.js";

export const PROVIDERS = Object.freeze({
  ANTHROPIC: "anthropic",
  OPENAI: "openai",
  OPENAI_COMPAT: "openai_compat",
  GOOGLE: "google",
  OPENROUTER: "openrouter",
  DEEPSEEK: "deepseek",
  TOGETHER: "together",
  ZHIPU: "zhipu",
  OLLAMA: "ollama",
  LMSTUDIO: "lmstudio",
});

// Model id must be a plain string: 3-120 chars, no whitespace, no control
// characters. Prevents injection via model field; does NOT restrict which
// model families are allowed.
const MODEL_ID_RE = /^[\w./:@\-+]{3,120}$/;
export function isReasonableModelId(value) {
  if (typeof value !== "string") return false;
  if (value.length < 3 || value.length > 120) return false;
  if (/\s/.test(value)) return false;
  // Disallow ASCII control characters.
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return MODEL_ID_RE.test(value);
}

/**
 * Pick the provider id given (in priority order):
 *   1. Explicit `provider` param.
 *   2. Explicit `baseUrl` — force openai_compat (unless apiKey prefix hints
 *      at a known OpenAI-compat host).
 *   3. Key prefix heuristics.
 *   4. null — caller must choose.
 */
export function detectProvider({ apiKey = "", provider = "", baseUrl = "" } = {}) {
  if (provider && typeof provider === "string") {
    const canon = provider.toLowerCase().trim();
    if (PROVIDER_WIRE_PROTOCOL[canon]) return canon;
  }

  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  const url = typeof baseUrl === "string" ? baseUrl.trim().toLowerCase() : "";

  // Infer from baseUrl hostnames for common compat hosts, but only if no
  // provider was explicitly set.
  if (url) {
    if (url.includes("openrouter.ai")) return PROVIDERS.OPENROUTER;
    if (url.includes("deepseek.com")) return PROVIDERS.DEEPSEEK;
    if (url.includes("together.xyz")) return PROVIDERS.TOGETHER;
    if (url.includes("bigmodel.cn")) return PROVIDERS.ZHIPU;
    if (url.includes("11434")) return PROVIDERS.OLLAMA;
    if (url.includes("1234")) return PROVIDERS.LMSTUDIO;
    if (url.includes("generativelanguage.googleapis.com")) return PROVIDERS.GOOGLE;
    if (url.includes("api.anthropic.com")) return PROVIDERS.ANTHROPIC;
    if (url.includes("api.openai.com")) return PROVIDERS.OPENAI;
    // Unknown baseUrl + key present → generic compat.
    if (key) return PROVIDERS.OPENAI_COMPAT;
  }

  if (key.startsWith("sk-ant-")) return PROVIDERS.ANTHROPIC;
  if (key.startsWith("sk-or-")) return PROVIDERS.OPENROUTER;
  if (key.startsWith("AIza")) return PROVIDERS.GOOGLE;
  // sk-proj-*, sk-* — default to OpenAI; user can override with baseUrl.
  if (key.startsWith("sk-")) return PROVIDERS.OPENAI;

  return null;
}

/**
 * Dispatch to the correct wire adapter. Accepts either a concrete model id
 * (preferred) or a `tier` name ("small"|"medium"|"large") — we resolve the
 * tier against TIER_DEFAULTS when no explicit model is given.
 *
 * @param {object} opts
 * @param {string} opts.provider
 * @param {string} opts.apiKey
 * @param {string} [opts.baseUrl]
 * @param {string} [opts.model]
 * @param {"small"|"medium"|"large"} [opts.tier]
 * @param {Array}  opts.messages
 * @param {string} [opts.system]
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.temperature]
 * @param {string} [opts.anthropicBeta]
 * @param {object} [opts.extraHeaders]
 * @param {Array}  [opts.tools]       — Anthropic tool definitions (native tool use + web_search); non-Anthropic providers reject.
 * @param {object|string} [opts.toolChoice]
 * @param {AbortSignal} [opts.signal]
 * @param {function}   [opts.fetchImpl]
 */
export async function callLLM(opts = {}) {
  const provider = opts.provider || detectProvider({ apiKey: opts.apiKey, baseUrl: opts.baseUrl });
  if (!provider) {
    const err = new Error("Could not detect LLM provider; pass an explicit `provider`.");
    err.status = 400;
    err.code = "unknown_provider";
    err.provider = null;
    throw err;
  }

  const model = opts.model || resolveTierDefault(provider, opts.tier || "small");
  if (!model) {
    const err = new Error(`No model id for provider "${provider}" (tier ${opts.tier || "small"}).`);
    err.status = 400;
    err.code = "missing_model";
    err.provider = provider;
    throw err;
  }
  if (!isReasonableModelId(model)) {
    const err = new Error(`Invalid model id "${String(model).slice(0, 60)}".`);
    err.status = 400;
    err.code = "invalid_model";
    err.provider = provider;
    throw err;
  }

  const wire = PROVIDER_WIRE_PROTOCOL[provider];
  const hasTools = Array.isArray(opts.tools) && opts.tools.length > 0;
  if (hasTools && wire !== "anthropic") {
    // OpenRouter has a native web plugin that we route web search through
    // for non-Anthropic models. If the caller is asking for web access via
    // Anthropic-shape tools and we're on OpenRouter, fall through silently
    // and let the OpenAI adapter pick up the webPlugin opt — never throw
    // tools_unsupported when there's a viable alternative.
    if (provider === PROVIDERS.OPENROUTER && opts.webPlugin && opts.webPlugin.enabled) {
      // ok — adapter will use plugins: [{id:"web"}] instead of native tools.
    } else {
      const err = new Error(
        `Provider "${provider}" does not support Anthropic-native tools (web_search). ` +
        `Tool-use calls currently require an Anthropic-shaped provider.`
      );
      err.status = 400;
      err.code = "tools_unsupported";
      err.provider = provider;
      throw err;
    }
  }

  const sanitized = sanitizeProviderPayload({
    system: opts.system,
    messages: opts.messages,
    tools: opts.tools,
    toolChoice: opts.toolChoice,
    metadata: opts.metadata,
  }, { boundary: `llm-adapter:${provider}` });
  const sanitizedPayload = sanitized.sanitizedPayload;

  // Reasoning models (DeepSeek V4 Pro, R1, OpenAI o1/o3, etc.) spend
  // a large fraction of their max_tokens budget on internal thinking
  // BEFORE emitting visible text. If the caller asked for 1024 and
  // the model burns 1200 thinking tokens, the user gets an empty
  // response. Auto-bump the budget to a safe floor so reasoning has
  // room to breathe AND there's enough left for an answer. Caller's
  // explicit override is respected when it's already large enough.
  const reasoningBudgetFloor = isReasoningModel(model) ? 8192 : 0;
  const effectiveMaxTokens = Math.max(opts.maxTokens || 1024, reasoningBudgetFloor);
  const attachRedaction = (response) => {
    if (response && typeof response === "object") {
      response._redaction = sanitized.redactionReport;
      response._tokenMap = sanitized.tokenMap;
    }
    return response;
  };

  switch (wire) {
    case "anthropic":
      return attachRedaction(await callAnthropic({
        apiKey: opts.apiKey,
        baseUrl: opts.baseUrl,
        model,
        messages: sanitizedPayload.messages,
        system: sanitizedPayload.system,
        maxTokens: effectiveMaxTokens,
        temperature: opts.temperature,
        anthropicBeta: opts.anthropicBeta,
        tools: sanitizedPayload.tools,
        toolChoice: sanitizedPayload.toolChoice,
        signal: opts.signal,
        fetchImpl: opts.fetchImpl,
      }));
    case "google":
      return attachRedaction(await callGoogle({
        apiKey: opts.apiKey,
        baseUrl: opts.baseUrl,
        model,
        messages: sanitizedPayload.messages,
        system: sanitizedPayload.system,
        maxTokens: effectiveMaxTokens,
        temperature: opts.temperature,
        signal: opts.signal,
        fetchImpl: opts.fetchImpl,
      }));
    case "openai":
    default:
      return attachRedaction(await callOpenAI({
        apiKey: opts.apiKey,
        baseUrl: opts.baseUrl || defaultBaseUrlFor(provider),
        model,
        messages: sanitizedPayload.messages,
        system: sanitizedPayload.system,
        maxTokens: effectiveMaxTokens,
        temperature: opts.temperature,
        extraHeaders: opts.extraHeaders,
        signal: opts.signal,
        fetchImpl: opts.fetchImpl,
        providerTag: provider,
        webPlugin: opts.webPlugin || null,
      }));
  }
}

export async function validateKey({ provider, apiKey, baseUrl, fetchImpl, signal } = {}) {
  const detected = provider || detectProvider({ apiKey, baseUrl });
  if (!detected) {
    return { valid: false, status: 400, code: "unknown_provider", message: "Cannot detect provider from inputs" };
  }
  const wire = PROVIDER_WIRE_PROTOCOL[detected];
  if (wire === "anthropic") return validateAnthropicKey({ apiKey, baseUrl, fetchImpl, signal });
  if (wire === "google")    return validateGoogleKey({ apiKey, baseUrl, fetchImpl, signal });
  return validateOpenAIKey({
    apiKey,
    baseUrl: baseUrl || defaultBaseUrlFor(detected),
    model: resolveTierDefault(detected, "small"),
    fetchImpl,
    signal,
    providerTag: detected,
  });
}

export function listKnownModels(provider) {
  const meta = PROVIDER_META.find((p) => p.id === provider);
  return meta?.knownModels || [];
}

export function listProviders() {
  return PROVIDER_META.map((p) => ({
    id: p.id,
    label: p.label,
    keyPrefix: p.keyPrefix,
    baseUrlOptional: p.baseUrlOptional,
    baseUrl: p.baseUrl || null,
    knownModels: p.knownModels,
    defaults: TIER_DEFAULTS[p.id] || null,
  }));
}

function defaultBaseUrlFor(provider) {
  const meta = PROVIDER_META.find((p) => p.id === provider);
  return meta?.baseUrl || null;
}

export { TIER_DEFAULTS, PROVIDER_META, PROVIDER_WIRE_PROTOCOL, resolveTierDefault, isReasoningModel };

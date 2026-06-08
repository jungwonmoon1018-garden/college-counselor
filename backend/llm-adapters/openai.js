// ═══════════════════════════════════════════════════════════════════════
// OPENAI ADAPTER — speaks OpenAI Chat Completions / compatible endpoints
// ═══════════════════════════════════════════════════════════════════════
// Covers OpenAI proper, OpenRouter, DeepSeek, Together, Zhipu/GLM, Ollama,
// LM Studio — they all expose /v1/chat/completions with Bearer auth.
//
// Translation rules (Anthropic → OpenAI):
//   - `system` prompt becomes a prepended `{role:"system",content}` entry.
//   - Each Anthropic message's `content` can be string OR [{type:"text",text}].
//     We flatten text blocks. Non-text blocks (image, document) are collapsed
//     into a literal `[non-text block omitted]` marker — the OpenAI-compat
//     world does not universally support multimodal inputs.
//
// Translation rules (OpenAI → Anthropic shape):
//   - `choices[0].message.content` (string) → `[{type:"text",text}]`.
//   - `usage.prompt_tokens` → `usage.input_tokens`.
//   - `usage.completion_tokens` → `usage.output_tokens`.
//   - `choices[0].finish_reason` → `stop_reason`.
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_BASE_URL = "https://api.openai.com";

/**
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} [opts.baseUrl]      — e.g. "https://openrouter.ai/api/v1"
 * @param {string} opts.model
 * @param {Array}  opts.messages       — Anthropic-shape messages
 * @param {string} [opts.system]
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.temperature]
 * @param {object} [opts.extraHeaders] — e.g. OpenRouter's HTTP-Referer
 * @param {AbortSignal} [opts.signal]
 * @param {function}   [opts.fetchImpl]
 * @param {string}  [opts.providerTag] — for normalized error tagging
 */
export async function callOpenAI({
  apiKey,
  baseUrl,
  model,
  messages,
  system,
  maxTokens = 1024,
  temperature,
  extraHeaders,
  signal,
  fetchImpl,
  providerTag = "openai",
  webPlugin = null, // { enabled: bool, allowedDomains: string[] } — OpenRouter only
}) {
  if (!model) {
    throw normalizedError(400, "missing_model", "Model required", providerTag);
  }
  const fetchFn = fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== "function") {
    throw normalizedError(500, "no_fetch", "fetch not available", providerTag);
  }

  // OpenRouter (and Anthropic-pass-through routes through it) honors
  // `cache_control: ephemeral` markers in the OpenAI message format
  // when the underlying model supports prompt caching (Anthropic,
  // Gemini, DeepSeek auto, Grok auto). Other providers ignore the
  // markers silently — safe to always emit.
  const cacheable = providerTag === "openrouter" || providerTag === "deepseek";
  const translated = translateMessagesToOpenAI({ system, messages, cacheable });

  const body = {
    model,
    messages: translated,
    max_tokens: maxTokens,
  };
  if (typeof temperature === "number") body.temperature = temperature;
  // OpenRouter `usage.include` surfaces cache_creation_input_tokens /
  // cache_read_input_tokens in the response so we can verify the
  // discount is actually firing in logs.
  if (providerTag === "openrouter") body.usage = { include: true };

  // ── OpenRouter web search plugin ─────────────────────────────────
  // OpenRouter exposes a model-agnostic web-search plugin that works
  // for every routed model (Anthropic passthrough, Gemma, GLM,
  // DeepSeek, Llama, …). When enabled, OpenRouter injects search
  // results into the model's context before generation and surfaces
  // citations in the response — no Anthropic-native tool-use blocks
  // required. This is the ONLY way non-Anthropic OpenRouter models
  // can search the web; without it they have no internet access.
  if (providerTag === "openrouter" && webPlugin && webPlugin.enabled) {
    const plugin = { id: "web" };
    // OpenRouter accepts an allowed_domains array on the plugin to
    // restrict the underlying search engine to a whitelist — matches
    // the same credible-sources policy used on the Anthropic path.
    if (Array.isArray(webPlugin.allowedDomains) && webPlugin.allowedDomains.length > 0) {
      plugin.search_prompt = `Restrict your search to these credible domains: ${webPlugin.allowedDomains.join(", ")}.`;
    }
    body.plugins = [plugin];
  }

  const headers = {
    "Content-Type": "application/json",
  };
  // Ollama in OpenAI-compat mode accepts an empty/fake key; only set
  // Authorization if we have one.
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  if (extraHeaders && typeof extraHeaders === "object") {
    for (const [k, v] of Object.entries(extraHeaders)) headers[k] = v;
  }

  const base = baseUrl || DEFAULT_BASE_URL;
  // Allow callers to pass either ".../v1" or a bare host; /chat/completions
  // lives under /v1.
  const urlBase = /\/v\d+$/.test(base) ? base : `${base}/v1`;
  const url = `${urlBase}/chat/completions`;

  let resp;
  try {
    resp = await fetchFn(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") throw normalizedError(499, "aborted", "Request aborted", providerTag);
    throw normalizedError(502, "network_error", err?.message || "Request failed", providerTag);
  }

  let data = null;
  try {
    data = await resp.json();
  } catch {
    data = null;
  }

  if (!resp.ok) {
    const code = resp.status === 401 || resp.status === 403 ? "auth_rejected" : "http_error";
    const message =
      data?.error?.message ||
      data?.error ||
      `${providerTag} returned HTTP ${resp.status}`;
    throw normalizedError(resp.status, code, String(message), providerTag);
  }

  return translateOpenAIResponseToAnthropic(data, { fallbackModel: model, responseHeaders: resp.headers });
}

/**
 * Cheap key validator — OpenAI-compat providers answer a 1-token completion
 * quickly. We tolerate 400s that aren't auth errors (some compat endpoints
 * quibble about model ids while still accepting the key).
 */
export async function validateOpenAIKey({ apiKey, baseUrl, model, fetchImpl, signal, providerTag = "openai" }) {
  try {
    await callOpenAI({
      apiKey,
      baseUrl,
      model: model || "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 1,
      fetchImpl,
      signal,
      providerTag,
    });
    return { valid: true };
  } catch (err) {
    // An auth rejection is a definitive no; other errors (model id bad,
    // network) don't disprove the key.
    if (err?.code === "auth_rejected") {
      return { valid: false, status: err.status, code: err.code, message: err.message };
    }
    if (err?.code === "network_error") {
      return { valid: false, status: err.status, code: err.code, message: err.message };
    }
    // Treat ambiguous errors as "probably valid, could not confirm".
    return { valid: true, unverified: true, code: err?.code, message: err?.message };
  }
}

// ─── translation helpers ──────────────────────────────────────────────

function translateMessagesToOpenAI({ system, messages, cacheable = false }) {
  const out = [];
  if (system && typeof system === "string" && system.trim()) {
    if (cacheable) {
      // Structured content array with cache_control on the system
      // prompt — the largest stable chunk in every request.
      out.push({
        role: "system",
        content: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      });
    } else {
      out.push({ role: "system", content: system });
    }
  }
  // Find the last assistant turn so we can place ONE cache breakpoint
  // there (covers all history before the current user query).
  const arr = Array.isArray(messages) ? messages : [];
  let cacheIdx = -1;
  if (cacheable) {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i]?.role === "assistant") { cacheIdx = i; break; }
    }
  }
  for (let i = 0; i < arr.length; i++) {
    const m = arr[i];
    if (!m || !m.role) continue;
    const role = m.role === "assistant" ? "assistant" : m.role === "system" ? "system" : "user";
    const text = flattenContentToText(m.content);
    if (cacheable && i === cacheIdx && text) {
      out.push({
        role,
        content: [{ type: "text", text, cache_control: { type: "ephemeral" } }],
      });
    } else {
      out.push({ role, content: text });
    }
  }
  return out;
}

function flattenContentToText(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content);
  const parts = [];
  for (const block of content) {
    if (!block) continue;
    if (typeof block === "string") { parts.push(block); continue; }
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    } else if (block.type === "image" || block.type === "document") {
      parts.push("[non-text block omitted]");
    } else if (typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  return parts.join("\n").trim();
}

function translateOpenAIResponseToAnthropic(data, { fallbackModel, responseHeaders }) {
  const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
  const text = typeof choice?.message?.content === "string" ? choice.message.content : "";
  return {
    content: [{ type: "text", text }],
    usage: {
      input_tokens: Number(data?.usage?.prompt_tokens) || 0,
      output_tokens: Number(data?.usage?.completion_tokens) || 0,
    },
    model: data?.model || fallbackModel,
    stop_reason: choice?.finish_reason || null,
    _raw: data,
    _responseHeaders: responseHeaders,
  };
}

function normalizedError(status, code, message, provider) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.provider = provider;
  return err;
}

// Exported for tests.
export const __internals = { translateMessagesToOpenAI, flattenContentToText, translateOpenAIResponseToAnthropic };

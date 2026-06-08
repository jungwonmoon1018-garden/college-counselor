// ═══════════════════════════════════════════════════════════════════════
// GOOGLE GEMINI ADAPTER — generativelanguage.googleapis.com
// ═══════════════════════════════════════════════════════════════════════
// Gemini uses a bespoke "generateContent" endpoint and an API-key query
// parameter (no Authorization header). System prompts live in a top-level
// `systemInstruction` object, and the message history is `contents` with
// roles {"user","model"}.
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";
const DEFAULT_API_VERSION = "v1beta";

/**
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} [opts.baseUrl]
 * @param {string} opts.model
 * @param {Array}  opts.messages      — Anthropic-shape messages
 * @param {string} [opts.system]
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.temperature]
 * @param {AbortSignal} [opts.signal]
 * @param {function}   [opts.fetchImpl]
 */
export async function callGoogle({
  apiKey,
  baseUrl,
  model,
  messages,
  system,
  maxTokens = 1024,
  temperature,
  signal,
  fetchImpl,
}) {
  if (!apiKey) throw normalizedError(400, "missing_api_key", "Google API key required", "google");
  if (!model)  throw normalizedError(400, "missing_model",   "Model required",            "google");

  const fetchFn = fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== "function") {
    throw normalizedError(500, "no_fetch", "fetch not available", "google");
  }

  const body = {
    contents: translateMessagesToGoogle(messages),
    generationConfig: {
      maxOutputTokens: maxTokens,
    },
  };
  if (typeof temperature === "number") body.generationConfig.temperature = temperature;
  if (system && typeof system === "string" && system.trim()) {
    body.systemInstruction = {
      role: "system",
      parts: [{ text: system }],
    };
  }

  const base = baseUrl || DEFAULT_BASE_URL;
  const url = `${base}/${DEFAULT_API_VERSION}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  let resp;
  try {
    resp = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") throw normalizedError(499, "aborted", "Request aborted", "google");
    throw normalizedError(502, "network_error", err?.message || "Google request failed", "google");
  }

  let data = null;
  try {
    data = await resp.json();
  } catch {
    data = null;
  }

  if (!resp.ok) {
    const code = resp.status === 401 || resp.status === 403 ? "auth_rejected" : "http_error";
    const message = data?.error?.message || `Google returned HTTP ${resp.status}`;
    throw normalizedError(resp.status, code, String(message), "google");
  }

  return translateGoogleResponseToAnthropic(data, { fallbackModel: model, responseHeaders: resp.headers });
}

export async function validateGoogleKey({ apiKey, baseUrl, fetchImpl, signal }) {
  try {
    await callGoogle({
      apiKey,
      baseUrl,
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 1,
      fetchImpl,
      signal,
    });
    return { valid: true };
  } catch (err) {
    if (err?.code === "auth_rejected") {
      return { valid: false, status: err.status, code: err.code, message: err.message };
    }
    if (err?.code === "network_error") {
      return { valid: false, status: err.status, code: err.code, message: err.message };
    }
    return { valid: true, unverified: true, code: err?.code, message: err?.message };
  }
}

// ─── translation helpers ──────────────────────────────────────────────

function translateMessagesToGoogle(messages) {
  const out = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m || !m.role) continue;
    // Gemini uses "user" and "model"; system goes into systemInstruction.
    if (m.role === "system") continue;
    const role = m.role === "assistant" ? "model" : "user";
    const text = flattenContentToText(m.content);
    if (!text) continue;
    out.push({ role, parts: [{ text }] });
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
    } else if (typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  return parts.join("\n").trim();
}

function translateGoogleResponseToAnthropic(data, { fallbackModel, responseHeaders }) {
  const candidate = Array.isArray(data?.candidates) ? data.candidates[0] : null;
  const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  const text = parts.map((p) => p?.text || "").join("");
  const finishReason = candidate?.finishReason || null;
  return {
    content: [{ type: "text", text }],
    usage: {
      input_tokens: Number(data?.usageMetadata?.promptTokenCount) || 0,
      output_tokens: Number(data?.usageMetadata?.candidatesTokenCount) || 0,
    },
    model: fallbackModel,
    stop_reason: finishReason,
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

export const __internals = { translateMessagesToGoogle, translateGoogleResponseToAnthropic };

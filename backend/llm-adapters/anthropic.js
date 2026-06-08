// ═══════════════════════════════════════════════════════════════════════
// ANTHROPIC ADAPTER — native api.anthropic.com passthrough
// ═══════════════════════════════════════════════════════════════════════
// Anthropic is the canonical response shape for the whole backend. Other
// adapters translate INTO this shape; this one just forwards and validates.
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const DEFAULT_VERSION = "2023-06-01";

/**
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} [opts.baseUrl]
 * @param {string} opts.model
 * @param {Array}  opts.messages        — Anthropic-shape messages
 * @param {string} [opts.system]
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.temperature]
 * @param {string} [opts.anthropicBeta] — comma-separated beta flags
 * @param {Array}  [opts.tools]         — Anthropic tool definitions (e.g. web_search_20250305)
 * @param {object|string} [opts.toolChoice]
 * @param {AbortSignal} [opts.signal]
 * @param {function}   [opts.fetchImpl] — injected for tests
 * @returns {Promise<{content, usage, model, stop_reason, _raw}>}
 */
export async function callAnthropic({
  apiKey,
  baseUrl,
  model,
  messages,
  system,
  maxTokens = 1024,
  temperature,
  anthropicBeta,
  tools,
  toolChoice,
  signal,
  fetchImpl,
}) {
  if (!apiKey) throw normalizedError(400, "missing_api_key", "Anthropic API key required", "anthropic");
  if (!model)  throw normalizedError(400, "missing_model",   "Model required",              "anthropic");

  const fetchFn = fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== "function") {
    throw normalizedError(500, "no_fetch", "fetch not available", "anthropic");
  }

  // ── Prompt caching ────────────────────────────────────────────────
  // Cost-controls: convert the stable parts of every request (system
  // prompt, tool defs, all but the most recent turn of history) into
  // `cache_control: ephemeral` blocks. Anthropic charges ~10% of input
  // cost for cache READS and ~125% for the first cache WRITE; after the
  // first turn of a thread, every subsequent turn pays ~10× less for
  // re-sending the same chat history. Hard requirement for students.
  const cachedSystem = buildCachedSystem(system);
  const cachedTools = buildCachedTools(tools);
  const cachedMessages = applyMessageCacheBreakpoints(messages);

  const body = {
    model,
    max_tokens: maxTokens,
    messages: cachedMessages,
  };
  if (cachedSystem != null) body.system = cachedSystem;
  if (typeof temperature === "number") body.temperature = temperature;
  if (cachedTools && cachedTools.length > 0) body.tools = cachedTools;
  if (toolChoice) body.tool_choice = toolChoice;

  const headers = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": DEFAULT_VERSION,
  };
  if (anthropicBeta) headers["anthropic-beta"] = anthropicBeta;

  const url = `${baseUrl || DEFAULT_BASE_URL}/v1/messages`;
  let resp;
  try {
    resp = await fetchFn(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") throw normalizedError(499, "aborted", "Request aborted", "anthropic");
    throw normalizedError(502, "network_error", err?.message || "Anthropic request failed", "anthropic");
  }

  let data = null;
  try {
    data = await resp.json();
  } catch {
    data = null;
  }

  if (!resp.ok) {
    // Distinguish credit/billing exhaustion from genuine key rejection.
    // Anthropic disables the org's API on credit exhaustion and returns
    // an auth-shape 401/403 response whose message names the cause —
    // e.g. "Your credit balance is too low" or "out of usage credits".
    // Surface that as a dedicated `credit_exhausted` code so the
    // frontend can show "Top up your account" instead of "Bad key".
    const message = data?.error?.message || `Anthropic returned HTTP ${resp.status}`;
    const errType = data?.error?.type || "";
    const lowerMsg = String(message).toLowerCase();
    const isCreditIssue =
      errType === "billing_error" ||
      /credit\s*balance|usage\s*credits|out of credits|insufficient credits|api\s+has\s+been\s+disabled\s+because|access\s+to\s+the\s+claude\s+api\s+has\s+been\s+disabled/i.test(lowerMsg);
    let code;
    if (isCreditIssue) code = "credit_exhausted";
    else if (resp.status === 401 || resp.status === 403) code = "auth_rejected";
    else if (resp.status === 429) code = "rate_limited";
    else code = "http_error";
    throw normalizedError(resp.status, code, message, "anthropic");
  }

  // Normalize missing fields so callers can rely on shape.
  return {
    content: Array.isArray(data?.content) ? data.content : [],
    usage: {
      input_tokens: Number(data?.usage?.input_tokens) || 0,
      output_tokens: Number(data?.usage?.output_tokens) || 0,
    },
    model: data?.model || model,
    stop_reason: data?.stop_reason || null,
    _raw: data,
    _responseHeaders: resp.headers,
  };
}

/**
 * Cheap "is this key alive" ping — 1-token Haiku call.
 */
export async function validateAnthropicKey({ apiKey, baseUrl, fetchImpl, signal }) {
  try {
    await callAnthropic({
      apiKey,
      baseUrl,
      model: "claude-haiku-4-5-20251001",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 1,
      fetchImpl,
      signal,
    });
    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      status: err?.status || 0,
      code: err?.code || "unknown",
      message: err?.message || "Validation failed",
    };
  }
}

function normalizedError(status, code, message, provider) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.provider = provider;
  return err;
}

// ─── Prompt-cache helpers ─────────────────────────────────────────────
// Anthropic only honors `cache_control` markers on blocks ≥ 1024 tokens
// (Sonnet/Opus) or 2048 tokens (Haiku). We mark optimistically — markers
// on too-short blocks are silently ignored by the API, so there's no
// downside, and longer system prompts / chat histories pick up the
// discount automatically.

const EPHEMERAL = Object.freeze({ type: "ephemeral" });

function buildCachedSystem(system) {
  if (!system) return null;
  if (typeof system === "string") {
    if (!system.trim()) return system;
    return [{ type: "text", text: system, cache_control: EPHEMERAL }];
  }
  if (Array.isArray(system) && system.length > 0) {
    // Mark only the LAST block so we don't waste cache breakpoints
    // (Anthropic allows up to 4 per request).
    return system.map((b, i) =>
      i === system.length - 1 && b && typeof b === "object" && !b.cache_control
        ? { ...b, cache_control: EPHEMERAL }
        : b,
    );
  }
  return system;
}

function buildCachedTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return tools;
  // Cache the tool schema as a unit by marking the last tool. Tool defs
  // are large (every web_search / web_fetch schema is multi-KB) and
  // identical turn-to-turn — prime caching target.
  return tools.map((t, i) =>
    i === tools.length - 1 && t && typeof t === "object" && !t.cache_control
      ? { ...t, cache_control: EPHEMERAL }
      : t,
  );
}

function applyMessageCacheBreakpoints(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  // Strategy: place ONE cache breakpoint at the last assistant turn
  // before the current user message. That checkpoint covers all
  // history up to (but excluding) the new query. The new user message
  // stays uncached because it's unique per turn.
  let breakpoint = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "assistant") { breakpoint = i; break; }
  }
  if (breakpoint < 0) {
    // No assistant turn yet — cache the first user turn for multi-turn
    // future re-use (only really useful when history grows past the
    // 1024-token threshold).
    breakpoint = 0;
  }
  return messages.map((m, i) => {
    if (i !== breakpoint || !m) return m;
    return { ...m, content: addCacheControlToContent(m.content) };
  });
}

function addCacheControlToContent(content) {
  if (typeof content === "string") {
    return [{ type: "text", text: content, cache_control: EPHEMERAL }];
  }
  if (!Array.isArray(content) || content.length === 0) return content;
  // Mark only the last block — that's where the cache boundary lands.
  return content.map((b, i) => {
    if (i !== content.length - 1) return b;
    if (!b || typeof b !== "object") return b;
    if (b.cache_control) return b;
    return { ...b, cache_control: EPHEMERAL };
  });
}

export const __internals = {
  buildCachedSystem,
  buildCachedTools,
  applyMessageCacheBreakpoints,
};

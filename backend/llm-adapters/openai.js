// Fixed OpenRouter Chat Completions wire adapter. The endpoint and sensitive
// headers are not caller-configurable, preventing API-key exfiltration.
const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const PROVIDER = 'openrouter';

export async function callOpenAI({
  apiKey,
  model,
  messages,
  system,
  maxTokens = 1024,
  temperature,
  signal,
  fetchImpl,
}) {
  if (!apiKey || typeof apiKey !== 'string') {
    throw normalizedError(400, 'missing_api_key', 'OpenRouter API key required');
  }
  if (!model) throw normalizedError(400, 'missing_model', 'Model required');
  const fetchFn = fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw normalizedError(500, 'no_fetch', 'fetch not available');
  }

  const body = {
    model,
    messages: translateMessagesToOpenAI({ system, messages }),
    max_tokens: maxTokens,
    usage: { include: true },
  };
  if (typeof temperature === 'number') body.temperature = temperature;

  let response;
  try {
    response = await fetchFn(CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw normalizedError(499, 'aborted', 'Request aborted');
    }
    throw normalizedError(502, 'network_error', error?.message || 'Request failed');
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const code = response.status === 401 || response.status === 403
      ? 'auth_rejected'
      : 'http_error';
    const message = data?.error?.message
      || data?.error
      || `OpenRouter returned HTTP ${response.status}`;
    throw normalizedError(response.status, code, String(message));
  }
  return translateOpenAIResponseToAnthropic(data, { fallbackModel: model });
}

export async function validateOpenAIKey({ apiKey, model, fetchImpl, signal }) {
  try {
    await callOpenAI({
      apiKey,
      model,
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 1,
      fetchImpl,
      signal,
    });
    return { valid: true };
  } catch (error) {
    if (['auth_rejected', 'network_error', 'missing_api_key'].includes(error?.code)) {
      return {
        valid: false,
        status: error.status,
        code: error.code,
        message: error.message,
      };
    }
    return {
      valid: true,
      unverified: true,
      code: error?.code,
      message: error?.message,
    };
  }
}

function translateMessagesToOpenAI({ system, messages }) {
  const output = [];
  if (typeof system === 'string' && system.trim()) {
    output.push({
      role: 'system',
      content: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    });
  }
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message?.role) continue;
    // The separately supplied system prompt is the only trusted instruction
    // channel. Message-array system roles are untrusted and downgraded.
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    output.push({ role, content: flattenContentToText(message.content) });
  }
  return output;
}

function flattenContentToText(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content);
  const parts = [];
  for (const block of content) {
    if (!block) continue;
    if (typeof block === 'string') parts.push(block);
    else if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    else if (block.type === 'image' || block.type === 'document') parts.push('[non-text block omitted]');
    else if (typeof block.text === 'string') parts.push(block.text);
  }
  return parts.join('\n').trim();
}

function translateOpenAIResponseToAnthropic(data, { fallbackModel }) {
  const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
  const text = typeof choice?.message?.content === 'string' ? choice.message.content : '';
  return {
    content: [{ type: 'text', text }],
    usage: {
      input_tokens: Number(data?.usage?.prompt_tokens) || 0,
      output_tokens: Number(data?.usage?.completion_tokens) || 0,
    },
    model: data?.model || fallbackModel,
    stop_reason: choice?.finish_reason || null,
  };
}

function normalizedError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.provider = PROVIDER;
  return error;
}

export const __internals = {
  translateMessagesToOpenAI,
  flattenContentToText,
  translateOpenAIResponseToAnthropic,
};

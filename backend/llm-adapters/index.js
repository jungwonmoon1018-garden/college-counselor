import { callOpenAI, validateOpenAIKey } from './openai.js';
import {
  TIER_DEFAULTS,
  PROVIDER_META,
  PROVIDER_WIRE_PROTOCOL,
  resolveTierDefault,
  isReasoningModel,
} from './tier-defaults.js';
import { sanitizeProviderPayload } from '../content-moderation.js';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const PROVIDERS = Object.freeze({ OPENROUTER: 'openrouter' });

const MODEL_ID_RE = /^[\w./:@+\-]{3,120}$/;
const OPENROUTER_META = PROVIDER_META[0];
const OPENROUTER_ALLOWED_MODELS = new Set([
  ...Object.values(TIER_DEFAULTS.openrouter).filter(Boolean),
  ...(OPENROUTER_META?.knownModels || []),
]);

export function isReasonableModelId(value) {
  return typeof value === 'string'
    && MODEL_ID_RE.test(value)
    && !/[\s\x00-\x1f\x7f]/.test(value);
}

export function isAllowedOpenRouterModel(value) {
  return isReasonableModelId(value) && OPENROUTER_ALLOWED_MODELS.has(value);
}

export function detectProvider({ apiKey = '', provider = '', baseUrl = '' } = {}) {
  const explicit = String(provider || '').trim().toLowerCase();
  const key = String(apiKey || '').trim();
  const url = String(baseUrl || '').trim().replace(/\/$/, '');
  if (explicit && explicit !== PROVIDERS.OPENROUTER) return null;
  if (url && url !== OPENROUTER_BASE_URL) return null;
  return key.startsWith('sk-or-') ? PROVIDERS.OPENROUTER : null;
}

function configurationError(message, code) {
  const error = new Error(message);
  error.status = 400;
  error.code = code;
  error.provider = PROVIDERS.OPENROUTER;
  return error;
}

export async function callLLM(options = {}) {
  if (detectProvider(options) !== PROVIDERS.OPENROUTER) {
    throw configurationError('Only the fixed OpenRouter provider is supported.', 'unsupported_provider');
  }
  if (options.webPlugin?.enabled || (Array.isArray(options.tools) && options.tools.length > 0)) {
    throw configurationError('General web and custom tool execution are disabled.', 'tools_disabled');
  }

  const model = options.model || resolveTierDefault('openrouter', options.tier || 'small');
  if (!isAllowedOpenRouterModel(model)) {
    throw configurationError('The requested model is not in the packaged allowlist.', 'model_not_allowed');
  }

  const sanitized = sanitizeProviderPayload({
    system: options.system,
    messages: options.messages,
    metadata: options.metadata,
  }, { boundary: 'llm-adapter:openrouter' });
  const requested = Number.isFinite(Number(options.maxTokens))
    ? Math.trunc(Number(options.maxTokens))
    : 1024;
  const reasoningFloor = isReasoningModel(model) ? 8192 : 1;
  const maxTokens = Math.min(16384, Math.max(reasoningFloor, requested));
  return callOpenAI({
    apiKey: options.apiKey,
    model,
    messages: sanitized.sanitizedPayload.messages,
    system: sanitized.sanitizedPayload.system,
    maxTokens,
    temperature: options.temperature,
    signal: options.signal,
    fetchImpl: options.fetchImpl,
  });
}

export async function validateKey({ provider = 'openrouter', apiKey, baseUrl, fetchImpl, signal } = {}) {
  if (detectProvider({ provider, apiKey, baseUrl }) !== PROVIDERS.OPENROUTER) {
    return {
      valid: false,
      status: 400,
      code: 'unsupported_provider',
      message: 'Only an OpenRouter key and the fixed OpenRouter endpoint are supported.',
    };
  }
  return validateOpenAIKey({
    apiKey,
    model: resolveTierDefault('openrouter', 'small'),
    fetchImpl,
    signal,
  });
}

// Compatibility probe for legacy callers while embedded inference is removed.
export function isEmbeddedAvailable() {
  return false;
}

export function listKnownModels(provider) {
  return provider === 'openrouter' ? [...OPENROUTER_ALLOWED_MODELS] : [];
}

export function listProviders() {
  return [{
    id: 'openrouter',
    label: 'OpenRouter',
    keyPrefix: 'sk-or-',
    baseUrlOptional: false,
    baseUrl: OPENROUTER_BASE_URL,
    knownModels: [...OPENROUTER_ALLOWED_MODELS],
    defaults: TIER_DEFAULTS.openrouter,
  }];
}

export {
  TIER_DEFAULTS,
  PROVIDER_META,
  PROVIDER_WIRE_PROTOCOL,
  resolveTierDefault,
  isReasoningModel,
};

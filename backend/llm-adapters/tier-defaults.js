// Packaged OpenRouter model registry. Changes are reviewed and released with
// the application instead of being accepted from a client at runtime.
export const TIER_DEFAULTS = Object.freeze({
  openrouter: Object.freeze({
    small: 'google/gemma-4-26b-a4b-it',
    medium: 'google/gemma-4-31b-it',
    large: 'deepseek/deepseek-v4-pro',
  }),
});

export const PROVIDER_META = Object.freeze([
  Object.freeze({
    id: 'openrouter',
    label: 'OpenRouter',
    keyPrefix: 'sk-or-',
    baseUrlOptional: false,
    baseUrl: 'https://openrouter.ai/api/v1',
    knownModels: Object.freeze([
      'google/gemma-4-26b-a4b-it',
      'google/gemma-4-31b-it',
      'deepseek/deepseek-v4-pro',
      'deepseek/deepseek-v4-flash',
      'z-ai/glm-5.1',
      'z-ai/glm-4.6',
      'openai/gpt-4o',
      'openai/gpt-4o-mini',
      'google/gemini-2.5-pro',
      'deepseek/deepseek-chat',
      'meta-llama/llama-3.3-70b-instruct',
      'qwen/qwen-2.5-72b-instruct',
    ]),
  }),
]);

// Compatibility metadata for the one remaining wire protocol.
export const PROVIDER_WIRE_PROTOCOL = Object.freeze({ openrouter: 'openai' });

const REASONING_MODEL_PATTERNS = [
  /^deepseek\/deepseek-r1/i,
  /^deepseek\/deepseek-v4-pro/i,
  /^openai\/o1/i,
  /^openai\/o3/i,
  /^z-ai\/glm-.*-reasoning/i,
];

export function isReasoningModel(modelId) {
  return typeof modelId === 'string'
    && REASONING_MODEL_PATTERNS.some((pattern) => pattern.test(modelId));
}

export function resolveTierDefault(providerId, tier) {
  if (providerId !== 'openrouter') return null;
  return TIER_DEFAULTS.openrouter[tier] || null;
}

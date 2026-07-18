import test from 'node:test';
import assert from 'node:assert/strict';
import { callLLM, OPENROUTER_BASE_URL } from '../llm-adapters/index.js';

test('caller headers cannot override OpenRouter authorization or endpoint', async () => {
  let request;
  await callLLM({
    provider: 'openrouter',
    apiKey: 'sk-or-admin-secret',
    model: 'google/gemma-4-26b-a4b-it',
    messages: [{ role: 'user', content: 'hello' }],
    extraHeaders: {
      Authorization: 'Bearer attacker-value',
      Host: 'attacker.invalid',
    },
    fetchImpl: async (url, init) => {
      request = { url, init };
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ choices: [{ message: { content: 'ok' } }], usage: {} }),
      };
    },
  });
  assert.equal(request.url, `${OPENROUTER_BASE_URL}/chat/completions`);
  assert.deepEqual(request.init.headers, {
    Authorization: 'Bearer sk-or-admin-secret',
    'Content-Type': 'application/json',
  });
});

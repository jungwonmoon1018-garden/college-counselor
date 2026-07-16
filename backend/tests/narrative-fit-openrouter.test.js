import test from 'node:test';
import assert from 'node:assert/strict';
import { callHaikuForNarrativeFit, hashText } from '../narrative-fit-llm.js';
import { OPENROUTER_BASE_URL } from '../llm-adapters/index.js';

function memoryStatements() {
  const rows = new Map();
  return {
    get: { get: (key) => rows.get(key) || null },
    put: {
      run(key, score, reason, model, provider) {
        rows.set(key, { score, reason, model, provider });
      },
    },
  };
}

const input = {
  narrative: 'I use computing to improve access to local public services.',
  ecText: 'Built and maintained an accessibility tool for the community library.',
};

test('narrative fit ignores environment and student BYOK fallbacks', async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'sk-or-environment';
  let fetched = false;
  try {
    const result = await callHaikuForNarrativeFit({
      ...input,
      narrativeHash: hashText(input.narrative),
      ecTextHash: hashText(input.ecText),
      stmts: memoryStatements(),
      options: {
        byokLookup: () => ({ provider: 'openrouter', apiKey: 'sk-or-student' }),
        fetchImpl: async () => {
          fetched = true;
          throw new Error('must not fetch');
        },
      },
    });
    assert.equal(result, null);
    assert.equal(fetched, false);
  } finally {
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous;
  }
});

test('narrative fit uses an explicitly injected OpenRouter key', async () => {
  let request;
  const result = await callHaikuForNarrativeFit({
    ...input,
    narrativeHash: hashText(input.narrative),
    ecTextHash: hashText(input.ecText),
    stmts: memoryStatements(),
    options: {
      apiKey: 'sk-or-admin',
      fetchImpl: async (url, init) => {
        request = { url, init };
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            model: 'google/gemma-4-26b-a4b-it',
            choices: [{ message: { content: '{\u0022score\u0022:0.75,\u0022reason\u0022:\u0022Clear alignment\u0022}' } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
        };
      },
    },
  });
  assert.equal(request.url, `${OPENROUTER_BASE_URL}/chat/completions`);
  assert.equal(request.init.headers.Authorization, 'Bearer sk-or-admin');
  assert.equal(result.score, 0.75);
  assert.equal(result.cached, false);
});

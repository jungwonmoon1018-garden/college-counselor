import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOrchestration, DEFAULT_MODELS } from '../orchestration-engine.js';
import { MODEL_TIERS } from '../policy-router.js';
import { TIER_DEFAULTS } from '../llm-adapters/index.js';

test('orchestration ignores runtime model overrides and selects OpenRouter', () => {
  const result = buildOrchestration({
    query: 'How can I improve my extracurricular profile?',
    studentContext: {},
    catalog: {},
    config: {
      LLM_SMALL_MODEL: 'attacker/small',
      LLM_MEDIUM_MODEL: 'attacker/medium',
      LLM_LARGE_MODEL: 'attacker/large',
    },
  });
  assert.equal(result.executionPlan.requiresModel, true);
  assert.equal(result.executionPlan.provider, 'openrouter');
  assert.equal(result.executionPlan.model, TIER_DEFAULTS.openrouter.medium);
  assert.equal(DEFAULT_MODELS[MODEL_TIERS.EMBEDDED_SMALL], undefined);
});

import test from "node:test";
import assert from "node:assert/strict";

import { isLlmDebug } from "../llm-adapters/llm-log.js";

test("isLlmDebug is forced off in production even when LLM_DEBUG=1", () => {
  const prevEnv = process.env.NODE_ENV;
  const prevDebug = process.env.LLM_DEBUG;
  try {
    process.env.NODE_ENV = "production";
    process.env.LLM_DEBUG = "1";
    assert.equal(isLlmDebug(), false);

    process.env.NODE_ENV = "development";
    process.env.LLM_DEBUG = "1";
    assert.equal(isLlmDebug(), true);

    process.env.NODE_ENV = "development";
    process.env.LLM_DEBUG = "0";
    assert.equal(isLlmDebug(), false);
  } finally {
    if (prevEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevEnv;
    if (prevDebug === undefined) delete process.env.LLM_DEBUG; else process.env.LLM_DEBUG = prevDebug;
  }
});

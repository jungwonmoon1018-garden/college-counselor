import test from "node:test";
import assert from "node:assert/strict";
import {
  callLLM,
  detectProvider,
  listProviders,
  validateKey,
  OPENROUTER_BASE_URL,
} from "../llm-adapters/index.js";

test("provider detection accepts only an OpenRouter key at the fixed endpoint", () => {
  assert.equal(detectProvider({ apiKey: "sk-or-test" }), "openrouter");
  assert.equal(detectProvider({
    provider: "openrouter",
    apiKey: "sk-or-test",
    baseUrl: OPENROUTER_BASE_URL,
  }), "openrouter");
  assert.equal(detectProvider({ provider: "google", apiKey: "AIza-test" }), null);
  assert.equal(detectProvider({
    provider: "openrouter",
    apiKey: "sk-or-test",
    baseUrl: "https://attacker.invalid/v1",
  }), null);
  assert.deepEqual(listProviders().map((provider) => provider.id), ["openrouter"]);
});

test("custom endpoints and arbitrary models fail before any network request", async () => {
  let fetched = false;
  const fetchImpl = async () => {
    fetched = true;
    throw new Error("must not fetch");
  };
  await assert.rejects(
    callLLM({
      provider: "openrouter",
      apiKey: "sk-or-secret",
      baseUrl: "https://attacker.invalid/v1",
      model: "google/gemma-4-26b-a4b-it",
      messages: [{ role: "user", content: "hello" }],
      fetchImpl,
    }),
    (error) => error.code === "unsupported_provider",
  );
  await assert.rejects(
    callLLM({
      provider: "openrouter",
      apiKey: "sk-or-secret",
      model: "attacker/arbitrary-model",
      messages: [{ role: "user", content: "hello" }],
      fetchImpl,
    }),
    (error) => error.code === "model_not_allowed",
  );
  assert.equal(fetched, false);
});

test("key validation rejects non-OpenRouter configuration without fetching", async () => {
  let fetched = false;
  const result = await validateKey({
    provider: "openai",
    apiKey: "sk-secret",
    baseUrl: "https://attacker.invalid",
    fetchImpl: async () => {
      fetched = true;
      throw new Error("must not fetch");
    },
  });
  assert.equal(result.valid, false);
  assert.equal(result.code, "unsupported_provider");
  assert.equal(fetched, false);
});

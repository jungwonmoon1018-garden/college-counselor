import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeProviderPayload, screenInput, screenOutput } from "../content-moderation.js";
import { redactAnthropicPayload, restoreAnthropicResponse } from "../orchestration-engine.js";
import { callLLM } from "../llm-adapters/index.js";

const PII_TEXT = "John Doe from Lakeside High lives at 123 Main Street. Email john@example.com, phone 555-123-4567, SSN 123-45-6789, income $180,000, student ID is U-12345.";

function assertNoRawPii(serialized) {
  assert.doesNotMatch(serialized, /john@example\.com/i);
  assert.doesNotMatch(serialized, /555-123-4567/);
  assert.doesNotMatch(serialized, /123-45-6789/);
  assert.doesNotMatch(serialized, /\$180,000/);
  assert.doesNotMatch(serialized, /123 Main Street/);
  assert.doesNotMatch(serialized, /U-12345/);
}

test("sanitizeProviderPayload deep-redacts strings and structured FAFSA data", () => {
  const redacted = sanitizeProviderPayload({
    system: `Counsel ${PII_TEXT}`,
    messages: [{ role: "user", content: [{ type: "text", text: PII_TEXT }] }],
    metadata: {
      fafsaProfile: {
        parentAdjustedGrossIncome: 180000,
        studentAidIndex: -1500,
        householdSize: 4,
      },
    },
  });
  const serialized = JSON.stringify(redacted.sanitizedPayload);
  assertNoRawPii(serialized);
  assert.match(serialized, /\[STUDENT_EMAIL_01\]/);
  assert.match(serialized, /\[SSN_01\]/);
  assert.equal(redacted.structuredSanitization.applied, true);
  assert.equal(redacted.sanitizedPayload.metadata.fafsaProfile.parentAdjustedGrossIncome, undefined);
  assert.equal(redacted.sanitizedPayload.metadata.fafsaProfile.financialNeedCategory, "maximum_need");
});

test("compat Anthropic redactor exports redact and restore only restorable tokens", () => {
  const redacted = redactAnthropicPayload({
    messages: [{ role: "user", content: PII_TEXT }],
  }, "student-1");
  const serialized = JSON.stringify(redacted.payload);
  assertNoRawPii(serialized);
  assert.ok(redacted.payload.metadata.user_id);
  assert.ok(redacted.masking.applied);

  const restored = restoreAnthropicResponse({
    content: [{ type: "text", text: "[STUDENT_NAME_01] attends [CURRENT_SCHOOL_01]; [SSN_01] stays masked." }],
  }, redacted.tokenMap);
  assert.match(restored.response.content[0].text, /John Doe/);
  assert.match(restored.response.content[0].text, /Lakeside High/);
  assert.match(restored.response.content[0].text, /\[SSN_01\]/);
});

test("callLLM redacts Anthropic request bodies before fetch", async () => {
  let captured = "";
  await callLLM({
    provider: "anthropic",
    apiKey: "sk-ant-test",
    model: "claude-haiku-4-5-20251001",
    messages: [{ role: "user", content: PII_TEXT }],
    fetchImpl: async (_url, init) => {
      captured = init.body;
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ content: [{ type: "text", text: "ok" }], usage: {} }) };
    },
  });
  assertNoRawPii(captured);
});

test("callLLM redacts OpenAI-compatible request bodies before fetch", async () => {
  let captured = "";
  await callLLM({
    provider: "openai",
    apiKey: "sk-test",
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: PII_TEXT }],
    fetchImpl: async (_url, init) => {
      captured = init.body;
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ choices: [{ message: { content: "ok" } }], usage: {} }) };
    },
  });
  assertNoRawPii(captured);
});

test("callLLM redacts Google request bodies before fetch", async () => {
  let captured = "";
  await callLLM({
    provider: "google",
    apiKey: "AIza-test",
    model: "gemini-2.0-flash",
    messages: [{ role: "user", content: PII_TEXT }],
    fetchImpl: async (_url, init) => {
      captured = init.body;
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ candidates: [{ content: { parts: [{ text: "ok" }] } }], usageMetadata: {} }) };
    },
  });
  assertNoRawPii(captured);
});

test("screenInput and screenOutput expose compatibility aliases", () => {
  const input = screenInput("password: hunter2");
  assert.equal(input.blocked, true);
  assert.equal(input.reason, input.message);

  const output = screenOutput("Do not leak 123-45-6789 or sk-proj-abcdefghijklmnopqrstuvwxyz.");
  assert.equal(output.modified, true);
  assert.doesNotMatch(output.text, /123-45-6789/);
  assert.doesNotMatch(output.text, /sk-proj-/);
});

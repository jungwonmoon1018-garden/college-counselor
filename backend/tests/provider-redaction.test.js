import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeProviderPayload, screenInput, screenOutput, redactProviderText } from "../content-moderation.js";
import { redactProviderPayload, restoreProviderResponse } from "../orchestration-engine.js";
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

test("compat provider redactor exports redact and restore only restorable tokens", () => {
  const redacted = redactProviderPayload({
    messages: [{ role: "user", content: PII_TEXT }],
  }, "student-1");
  const serialized = JSON.stringify(redacted.payload);
  assertNoRawPii(serialized);
  assert.ok(redacted.payload.metadata.user_id);
  assert.ok(redacted.masking.applied);

  const restored = restoreProviderResponse({
    content: [{ type: "text", text: "[STUDENT_NAME_01] attends [CURRENT_SCHOOL_01]; [SSN_01] stays masked." }],
  }, redacted.tokenMap);
  assert.match(restored.response.content[0].text, /John Doe/);
  assert.match(restored.response.content[0].text, /Lakeside High/);
  assert.match(restored.response.content[0].text, /\[SSN_01\]/);
});

test("callLLM redacts the fixed OpenRouter request body before fetch", async () => {
  let captured = "";
  const result = await callLLM({
    provider: "openrouter",
    apiKey: "sk-or-test",
    model: "google/gemma-4-26b-a4b-it",
    messages: [{ role: "user", content: PII_TEXT }],
    fetchImpl: async (_url, init) => {
      captured = init.body;
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ choices: [{ message: { content: "ok" } }], usage: {} }) };
    },
  });
  assertNoRawPii(captured);
  assertNoRawPii(JSON.stringify(result));
  assert.equal(Object.hasOwn(result, "_raw"), false);
  assert.equal(Object.hasOwn(result, "_tokenMap"), false);
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

// ─── L2: output screening covers non-restorable PII (not just SSN) ───
test("screenOutput redacts leaked phone numbers but keeps legitimate counseling content", () => {
  const out = screenOutput("Reach the office at admissions@uni.edu, tuition is about $40,000 — call 555-123-4567 for details.");
  assert.equal(out.modified, true);
  assert.doesNotMatch(out.text, /555-123-4567/);            // non-restorable phone → redacted
  assert.match(out.text, /admissions@uni\.edu/);            // restorable email → kept (round-tripped by restorePII)
  assert.match(out.text, /\$40,000/);                        // restorable financial → kept (legit tuition figure)
  assert.ok(out.issues.some((i) => i.type === "phone_leak"));
});

test("screenOutput leaves clean counselor text untouched", () => {
  const clean = "Focus your essay on the robotics project and ask your counselor about deadlines.";
  const out = screenOutput(clean);
  assert.equal(out.safe, true);
  assert.equal(out.text, clean);
});

// ─── L1: profile-context system prompt is masked before dispatch ───
test("redactProviderText masks PII in an auto-injected profile context", () => {
  const { text, tokenMap } = redactProviderText(
    "STUDENT PROFILE — Activities: founded a club, contact john@example.com; family income $180,000; SSN 123-45-6789."
  );
  assert.doesNotMatch(text, /john@example\.com/);   // email masked
  assert.doesNotMatch(text, /\$180,000/);            // income masked (non-restorable)
  assert.doesNotMatch(text, /123-45-6789/);          // SSN masked
  // restorable email token is recoverable so the student sees their own value if echoed
  assert.ok(Object.values(tokenMap).includes("john@example.com"));
});

test("redactProviderText is a no-op on non-strings and clean text", () => {
  assert.deepEqual(redactProviderText("").text, "");
  assert.equal(redactProviderText(undefined).text, "");
  const clean = "You are a college counselor. Cite official sources for FAFSA questions.";
  const r = redactProviderText(clean);
  assert.equal(r.text, clean);
  assert.equal(r.applied, false);
});

// ─── Server-side essay ghost-writing refusal ───
test("screenInput blocks essay ghost-writing requests with a coaching redirect", () => {
  for (const req of [
    "Write my college essay for me",
    "Can you write my personal statement?",
    "compose the whole 650-word common app essay about my grandmother",
    "draft my admissions essay please",
  ]) {
    const r = screenInput(req);
    assert.equal(r.blocked, true, `should block: ${req}`);
    assert.match(r.message, /brainstorm|outline|feedback/i);
  }
});

test("screenInput allows legitimate essay coaching requests", () => {
  for (const req of [
    "Can you give me feedback on my essay draft?",
    "Help me outline my personal statement",
    "I wrote my essay — how can I improve the intro?",
    "Brainstorm topics for my common app essay",
    "Revise this paragraph I wrote for clarity",
  ]) {
    const r = screenInput(req);
    assert.equal(r.blocked, false, `should NOT block: ${req}`);
  }
});

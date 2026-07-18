import { describe, expect, it } from "vitest";
import {
  COUNCIL_DECISION_OPTIONS,
  councilErrorMessage,
  createCouncilPayload,
  formatCouncilResult,
  isAmbiguousCouncilFailure,
  reconcileCouncilFailureMessages,
  resolveCouncilRequest,
} from "./strategy-council.js";

describe("Strategy Council client contract", () => {
  it("builds an explicit-only payload with no provider or student controls", () => {
    const payload = createCouncilPayload(
      "Which AP science should I take next year?",
      "course-selection",
      "request-123",
    );
    expect(payload).toEqual({
      question: "Which AP science should I take next year?",
      request_id: "request-123",
      explicit: true,
      auto: false,
      decision_type: "course-selection",
    });
    expect(Object.keys(payload).sort()).toEqual([
      "auto",
      "decision_type",
      "explicit",
      "question",
      "request_id",
    ]);
  });

  it("rejects invalid categories and overlong questions before a request", () => {
    expect(() => createCouncilPayload("question", "not-a-type", "id")).toThrow(/valid/i);
    expect(() => createCouncilPayload("x".repeat(2001), "other", "id")).toThrow(/2,000/);
    expect(COUNCIL_DECISION_OPTIONS).toHaveLength(5);
  });

  it("formats recommendation, dissent, evidence, and cost without model metadata", () => {
    const result = formatCouncilResult({
      recommendation: "Take AP Biology after completing chemistry.",
      confidence: 0.74,
      decision_type: "course-selection",
      dissents: [{
        from: "Skeptic",
        text: "Confirm the weekly workload first.",
        citations: [{ id: "e1", validated: true }],
      }],
      citations: [{ id: "e2", validated: true }],
      usage: { actual_usd: 0.01234 },
      council_breakdown: [{ provider: "openrouter", model: "secret/model" }],
    });
    expect(result.text).toMatch(/Confidence:\*\* 74%/);
    expect(result.text).toMatch(/Skeptic/);
    expect(result.text).toMatch(/Validated evidence references:\*\* 2/);
    expect(result.text).toMatch(/\$0\.0123/);
    expect(result.text).not.toMatch(/openrouter|secret\/model/i);
  });

  it("returns actionable messages for budget and consent failures", () => {
    expect(councilErrorMessage(402)).toMatch(/remaining monthly AI budget/i);
    expect(councilErrorMessage(403)).toMatch(/consent/i);
  });

  it("reuses an ambiguous request ID only for the identical explicit retry", () => {
    let sequence = 0;
    const createId = () => `request-${++sequence}`;
    const first = resolveCouncilRequest(null, "  Should I take AP Biology?  ", "course-selection", createId);
    const retry = resolveCouncilRequest(first, "Should I take AP Biology?", "course-selection", createId);
    const changed = resolveCouncilRequest(first, "Should I take AP Chemistry?", "course-selection", createId);
    expect(retry).toBe(first);
    expect(changed.requestId).toBe("request-2");
    expect(isAmbiguousCouncilFailure(undefined)).toBe(true);
    expect(isAmbiguousCouncilFailure(503)).toBe(true);
    expect(isAmbiguousCouncilFailure(403)).toBe(false);
  });

  it("removes a failed optimistic Council turn and keeps its error transient", () => {
    const messages = [
      { role: "assistant", content: "Earlier answer" },
      { role: "user", content: "Council question", clientTurnId: "turn-1" },
    ];
    const reconciled = reconcileCouncilFailureMessages(messages, "turn-1", "Try again.");
    expect(reconciled).toEqual([
      { role: "assistant", content: "Earlier answer" },
      { role: "assistant", content: "Try again.", transient: true },
    ]);
  });

  it("keeps deterministic crisis resources visible and out of Council output", () => {
    const result = formatCouncilResult({
      answer: "Please reach out now.",
      actions: [
        { name: "Suicide & Crisis Lifeline", contact: "988", description: "24/7 support" },
        { name: "Crisis Text Line", contact: "Text HOME to 741741" },
      ],
      limitations: ["This assistant cannot provide crisis counseling."],
      crisisSafe: true,
    });
    expect(result.text).toMatch(/988/);
    expect(result.text).toMatch(/741741/);
    expect(result.text).toMatch(/cannot provide crisis counseling/i);
    expect(result.crisisSafe).toBe(true);
    expect(result.council).toBe(false);
  });
});

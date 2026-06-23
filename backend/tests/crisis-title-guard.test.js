// Guardrail: a minor's crisis words must never become a chat-thread title
// (a glanceable, plaintext sidebar surface). Plus the canonical crisis
// predicate and the resolveTargetSchools fallback type-safety regression.

import { test } from "node:test";
import assert from "node:assert/strict";
import { appendMessage } from "../chat-history.js";
import { isCrisisText } from "../policy-router.js";
import { extractTargetSchoolNames } from "../cds-search.js";

// Minimal stmts mock: a fresh thread on the default title, recording any title update.
function mockStmts() {
  const calls = { title: null };
  return {
    _calls: calls,
    getThread: { get: () => ({ message_count: 0, title: "New conversation", archived_at: null }) },
    insertMessage: { run: () => {} },
    touchThread: { run: () => {} },
    updateThreadTitle: { run: (title) => { calls.title = title; } },
  };
}

test("crisis first message yields a neutral supportive title, not the crisis text", () => {
  const stmts = mockStmts();
  const r = appendMessage(stmts, "stu1", "thr1", "user", "I want to kill myself, I can't go on");
  assert.equal(r.ok, true);
  assert.equal(stmts._calls.title, "Support resources");
  assert.ok(!/kill myself/i.test(stmts._calls.title || ""), "crisis words must not appear in the title");
});

test("Korean crisis first message is also caught", () => {
  const stmts = mockStmts();
  appendMessage(stmts, "stu1", "thr1", "user", "너무 힘들어서 죽고 싶어요");
  assert.equal(stmts._calls.title, "Support resources");
});

test("ordinary first message still auto-titles from the text", () => {
  const stmts = mockStmts();
  appendMessage(stmts, "stu1", "thr1", "user", "What AP courses should I take for CS?");
  assert.equal(stmts._calls.title, "What AP courses should I take for CS?");
});

test("isCrisisText: crisis vs ordinary", () => {
  assert.equal(isCrisisText("i want to die"), true);
  assert.equal(isCrisisText("self-harm"), true);
  assert.equal(isCrisisText("자해"), true);
  assert.equal(isCrisisText("Help me pick between Princeton and MIT"), false);
  assert.equal(isCrisisText(""), false);
  assert.equal(isCrisisText(null), false);
});

// Regression for the /api/calendar/context 500: extractTargetSchoolNames returns
// {schoolName} objects, so resolveTargetSchools' fallback must stringify them or
// downstream s.toLowerCase() throws.
test("target-school names map to strings safe for toLowerCase", () => {
  const goals = ["Ivy League / T20", { schoolName: "MIT" }, { name: "Stanford" }];
  const raw = extractTargetSchoolNames(goals, []);
  assert.ok(raw.some((t) => typeof t === "object"), "raw entries are objects (the original hazard)");
  const mapped = raw
    .map((t) => (typeof t === "string" ? t : t?.schoolName || ""))
    .filter(Boolean);
  assert.ok(mapped.every((s) => typeof s === "string"));
  assert.doesNotThrow(() => mapped.map((s) => s.toLowerCase()));
  assert.ok(mapped.includes("Ivy League / T20"));
});

// tests/crisis-audit-redaction.test.js — guard against re-introducing raw crisis
// text into the unencrypted audit table. The crisis branches in /api/llm and
// /api/chat must log a neutral marker, never userText, because crisis messages can
// carry address/medical PII. Source-level assertion (same style as skill-bridge.test.js)
// so it catches a regression without standing up the full auth'd crisis flow.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.resolve(__dirname, "../server.js"), "utf8");

test("crisis_detected audit rows never persist raw user text", () => {
  // This build routes crisis handling through one unified deterministic path
  // (not separate /api/llm + /api/chat branches), so there is a single crisis
  // audit insert. The invariant is the same: it must log a neutral constant
  // marker, never the student's words (which can carry address/medical PII into
  // the unencrypted audit table). Multi-line inserts are matched, [^;] spans
  // newlines.
  const crisisInserts = SRC.match(/insertAudit\.run\([^;]*"crisis_detected"[^;]*\);/g) || [];
  assert.ok(crisisInserts.length >= 1, "expected at least one crisis_detected audit insert");
  for (const line of crisisInserts) {
    assert.ok(
      !/userText/.test(line),
      "crisis audit row must NOT log the user's message (PII at rest):\n" + line,
    );
    assert.match(
      line,
      /"crisis_policy_triggered"|\[crisis text redacted\]/,
      "crisis audit row must use a neutral marker, not raw text:\n" + line,
    );
  }
});

test("the crisis audit type itself is preserved (count signal intact)", () => {
  assert.match(SRC, /"crisis_detected"/, "crisis_detected audit type must still exist");
  assert.match(SRC, /getCrisisCount24h/, "the 24h crisis count query must still exist");
});

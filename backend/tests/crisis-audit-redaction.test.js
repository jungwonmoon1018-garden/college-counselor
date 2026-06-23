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
  // Every insertAudit call that logs a crisis must use the redaction marker…
  const crisisInserts = SRC.match(/insertAudit\.run\([^;]*"crisis_detected"[^;]*\);/g) || [];
  assert.ok(crisisInserts.length >= 2, "expected the crisis branches in /api/llm and /api/chat");
  for (const line of crisisInserts) {
    assert.ok(
      !/userText\.slice/.test(line),
      "crisis audit row must NOT log userText (PII at rest):\n" + line,
    );
    assert.match(line, /\[crisis text redacted\]/, "crisis audit row must use the redaction marker:\n" + line);
  }
});

test("the crisis audit type itself is preserved (count signal intact)", () => {
  assert.match(SRC, /"crisis_detected"/, "crisis_detected audit type must still exist");
  assert.match(SRC, /getCrisisCount24h/, "the 24h crisis count query must still exist");
});

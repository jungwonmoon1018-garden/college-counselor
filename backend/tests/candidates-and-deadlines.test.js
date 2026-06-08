// ═══════════════════════════════════════════════════════════════════════
// tests/candidates-and-deadlines.test.js — F6 + F7 coverage
// ═══════════════════════════════════════════════════════════════════════
// Keep these grep-style + route-shape tests. Full integration would need
// a seeded PII vault + narrative store + session token, which is out of
// scope for a unit suite. These assertions lock the contract that
// server.js actually wires the endpoints and respects student ownership.
// ═══════════════════════════════════════════════════════════════════════

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = fs.readFileSync(path.resolve(__dirname, "../server.js"), "utf8");
const RAG    = fs.readFileSync(path.resolve(__dirname, "../rag-engine.js"), "utf8");
const I18N   = fs.readFileSync(path.resolve(__dirname, "../i18n.js"), "utf8");

// ─── F6 — candidate ranking ────────────────────────────────────────────
test("server.js exposes POST /api/ec/candidates/rank", () => {
  assert.match(SERVER, /app\.post\("\/api\/ec\/candidates\/rank"/);
});

test("candidate-rank returns 409 when there's no active narrative (narrative-first enforcement)", () => {
  // Server.js references the i18n key; the literal copy lives in i18n.js
  // (Round 5 localization moved friendly strings there so ko/en both work).
  assert.match(SERVER, /no_active_narrative/);
  assert.match(I18N, /Save your narrative first/);
});

test("candidate-rank uses deterministic matchMajorBucket + theme overlap (no LLM)", () => {
  assert.match(SERVER, /matchMajorBucketFn/);
  assert.match(SERVER, /predictedNarrativeFit/);
  assert.match(SERVER, /predictedTier/);
  assert.match(SERVER, /bucketHit/);
});

test("candidate-rank caps input to prevent abuse", () => {
  assert.match(SERVER, /candidates\.length > 25/);
});

// ─── F7 — student deadlines ────────────────────────────────────────────
test("rag-engine.js creates the student_deadlines table with the expected columns", () => {
  assert.match(RAG, /CREATE TABLE IF NOT EXISTS student_deadlines/);
  for (const col of ["id", "student_id", "title", "due_at", "category", "notes", "college_ids_json", "status"]) {
    assert.match(RAG, new RegExp(`\\b${col}\\b`), `column ${col} missing`);
  }
  // Index by student + due date so "upcoming deadlines" queries are cheap.
  assert.match(RAG, /idx_student_deadlines_student/);
});

test("rag-engine.js prepares CRUD statements that scope by student_id (no cross-tenant leakage)", () => {
  assert.match(RAG, /deadlines:\s*\{/);
  // Every mutating statement must filter by BOTH id AND student_id so a
  // student can't touch another student's deadline even by guessing the UUID.
  assert.match(RAG, /SELECT \* FROM student_deadlines WHERE id = \? AND student_id = \?/);
  assert.match(RAG, /UPDATE student_deadlines SET status = \?, updated_at = datetime\('now'\) WHERE id = \? AND student_id = \?/);
  assert.match(RAG, /DELETE FROM student_deadlines WHERE id = \? AND student_id = \?/);
});

test("server.js exposes the full deadlines REST surface", () => {
  assert.match(SERVER, /app\.post\("\/api\/students\/deadlines"/,        "POST missing");
  assert.match(SERVER, /app\.get\("\/api\/students\/deadlines"/,          "GET missing");
  assert.match(SERVER, /app\.patch\("\/api\/students\/deadlines\/:id"/,   "PATCH missing");
  assert.match(SERVER, /app\.delete\("\/api\/students\/deadlines\/:id"/,  "DELETE missing");
});

test("deadlines responses include the friendly student-facing summary (F11 consistency)", () => {
  assert.match(SERVER, /friendlyMessage/);
  assert.match(SERVER, /daysUntil/);
});

test("deadlines validate dueAt is a parseable ISO-8601", () => {
  // The wire-up is in server.js (key reference); the copy itself is in i18n.js.
  assert.match(SERVER, /deadlines\.due_at_invalid/);
  assert.match(I18N, /must be a parseable ISO-8601/);
});

test("deadlines status transitions are whitelisted (open|done|snoozed)", () => {
  assert.match(SERVER, /\["open", "done", "snoozed"\]/);
});

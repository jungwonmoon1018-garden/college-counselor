// ═══════════════════════════════════════════════════════════════════════
// tests/auto-narrative.test.js — auto-updating narrative
// ═══════════════════════════════════════════════════════════════════════
// Unit tests for the fingerprint helper + grep-style contract tests that
// lock the wiring (course-change detection, sync hook, voice protection),
// matching the convention in differentiation-endpoints.test.js. Full
// integration needs a seeded vault + BYOK + session token (out of scope).
// ═══════════════════════════════════════════════════════════════════════

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeProfileFingerprint } from "../narrative-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = fs.readFileSync(path.resolve(__dirname, "../server.js"), "utf8");
const RAG = fs.readFileSync(path.resolve(__dirname, "../rag-engine.js"), "utf8");
const NARR = fs.readFileSync(path.resolve(__dirname, "../narrative-store.js"), "utf8");

// ─── computeProfileFingerprint (pure) ───────────────────────────────────
test("computeProfileFingerprint", async (t) => {
  await t.test("is order-independent over courses and activities", () => {
    const a = computeProfileFingerprint({
      majorInterest: "Computer Science",
      courses: [{ name: "AP Calc AB" }, { name: "AP CS A" }],
      activities: [{ name: "Robotics" }, { name: "Debate" }],
    });
    const b = computeProfileFingerprint({
      majorInterest: "computer science",
      courses: [{ name: "AP CS A" }, { name: "AP Calc AB" }],
      activities: [{ name: "Debate" }, { name: "Robotics" }],
    });
    assert.equal(a, b);
  });

  await t.test("changes when a course or activity is added", () => {
    const base = computeProfileFingerprint({ majorInterest: "bio", courses: [{ name: "AP Bio" }], activities: [] });
    const plusCourse = computeProfileFingerprint({ majorInterest: "bio", courses: [{ name: "AP Bio" }, { name: "AP Chem" }], activities: [] });
    const plusEC = computeProfileFingerprint({ majorInterest: "bio", courses: [{ name: "AP Bio" }], activities: [{ name: "Science Olympiad" }] });
    assert.notEqual(base, plusCourse);
    assert.notEqual(base, plusEC);
  });

  await t.test("changes when the major changes", () => {
    const a = computeProfileFingerprint({ majorInterest: "bio", courses: [], activities: [] });
    const b = computeProfileFingerprint({ majorInterest: "cs", courses: [], activities: [] });
    assert.notEqual(a, b);
  });

  await t.test("is stable / deterministic for the same input", () => {
    const p = { majorInterest: "econ", courses: [{ name: "AP Micro" }], activities: [{ name: "DECA" }] };
    assert.equal(computeProfileFingerprint(p), computeProfileFingerprint(p));
  });
});

// ─── narrative-store source + fingerprint ───────────────────────────────
test("narrative-store tracks source + profile_fingerprint", () => {
  assert.match(NARR, /ALTER TABLE student_narratives ADD COLUMN source/);
  assert.match(NARR, /ALTER TABLE student_narratives ADD COLUMN profile_fingerprint/);
  // saveNarrative accepts opts and getActiveNarrative returns source.
  assert.match(NARR, /export function saveNarrative\(stmts, studentId, narrativeText, opts/);
  assert.match(NARR, /source: row\.source \|\| "student"/);
  assert.match(NARR, /export function computeProfileFingerprint/);
});

// ─── rag-engine course-change detection ─────────────────────────────────
test("rag-engine detectChanges emits course_added / course_updated", () => {
  assert.match(RAG, /type:\s*"course_added"/);
  assert.match(RAG, /type:\s*"course_updated"/);
});

// ─── server.js auto-narrative wiring + voice protection ──────────────────
test("server.js wires the auto-narrative regenerator into sync", () => {
  assert.match(SERVER, /function maybeAutoRegenerateNarrative\(/);
  assert.match(SERVER, /maybeAutoRegenerateNarrative\(req\.studentId, result\.changes\)/);
});

test("auto-narrative never overwrites a student-written narrative", () => {
  assert.match(SERVER, /existing\.source === "student"/);
  assert.match(SERVER, /skipped: "student_written"/);
});

test("auto-narrative no-ops on unchanged fingerprint + gates on triggers/BYOK/budget", () => {
  assert.match(SERVER, /AUTO_NARRATIVE_TRIGGERS/);
  assert.match(SERVER, /fingerprint_unchanged/);
  assert.match(SERVER, /skipped: "no_byok"/);
  assert.match(SERVER, /skipped: "budget"/);
});

test("auto-narrative reuses the shared draft generator + saves as source:auto", () => {
  assert.match(SERVER, /function generateNarrativeDraftText\(/);
  assert.match(SERVER, /saveNarrative\(ragStmts\.narrative, studentId, draft, \{ source: "auto", profileFingerprint: fp \}\)/);
});

test("server.js exposes GET /api/ec/narrative/active with source + profileStale", () => {
  assert.match(SERVER, /app\.get\("\/api\/ec\/narrative\/active",\s*studentLimiter,\s*requireStudentAuth/);
  assert.match(SERVER, /profileStale/);
});

test("context bundle narrative block exposes source + profileStale", () => {
  assert.match(SERVER, /source: active\.source \|\| "student"/);
});

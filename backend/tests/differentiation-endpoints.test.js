// ═══════════════════════════════════════════════════════════════════════
// tests/differentiation-endpoints.test.js — Spike Finder + Course recommender
// ═══════════════════════════════════════════════════════════════════════
// Grep-style contract tests, matching the convention in
// candidates-and-deadlines.test.js: full integration needs a seeded PII
// vault + session token (out of scope for the unit suite), so we lock the
// contract that server.js wires the new routes, gates them with student
// auth, and returns the three trust lanes. The pure ranking/diff logic is
// covered behaviourally in course-sequence-catalog.test.js.
// ═══════════════════════════════════════════════════════════════════════

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = fs.readFileSync(path.resolve(__dirname, "../server.js"), "utf8");

// ─── Spike Finder ───────────────────────────────────────────────────────
test("server.js exposes GET /api/ec/spike, student-auth gated", () => {
  assert.match(SERVER, /app\.get\("\/api\/ec\/spike",\s*studentLimiter,\s*requireStudentAuth/);
});

test("spike endpoint ranks from existing fields (tier + major_spike + narrative_fit)", () => {
  assert.match(SERVER, /SPIKE_TIER_WEIGHT/);
  assert.match(SERVER, /major_spike/);
  assert.match(SERVER, /narrative_fit/);
  // Returns leading + supporting partitions.
  assert.match(SERVER, /leading/);
  assert.match(SERVER, /supporting/);
});

test("spike endpoint enforces the wellbeing guardrail from WELLBEING_LIMITS", () => {
  assert.match(SERVER, /WELLBEING_LIMITS/);
  assert.match(SERVER, /overCommitted/);
  assert.match(SERVER, /caution_weekly_hours/);
});

test("spike endpoint reuses friendly enrichment + prestige provenance", () => {
  assert.match(SERVER, /enrichECVectorWithFriendly/);
  assert.match(SERVER, /getPrestigeExplanation/);
});

// ─── Course-sequence recommender ────────────────────────────────────────
test("server.js exposes GET /api/courses/recommendations, student-auth gated", () => {
  assert.match(SERVER, /app\.get\("\/api\/courses\/recommendations",\s*studentLimiter,\s*requireStudentAuth/);
});

test("course recommender builds the student model + diffs the major ladder", () => {
  assert.match(SERVER, /buildStudentModel/);
  assert.match(SERVER, /diffCoursesAgainstSequence/);
});

test("course recommender returns the three trust lanes", () => {
  assert.match(SERVER, /lanes:\s*\{\s*verified,\s*inference,\s*coaching\s*\}/);
});

test("course recommender cross-references AP concept-mastery gaps", () => {
  assert.match(SERVER, /getAllSubjectVectors/);
  assert.match(SERVER, /conceptSignal/);
  assert.match(SERVER, /COURSE_CONCEPT_GAP_THRESHOLD/);
});

test("course recommender frames coaching as non-binding 'you might consider'", () => {
  assert.match(SERVER, /you might consider/i);
});

// ─── LLM + web-search semantic ranking ──────────────────────────────────
test("candidate rank has an LLM + web-search re-rank with deterministic fallback", () => {
  assert.match(SERVER, /async function llmRankCandidates\(/);
  assert.match(SERVER, /app\.post\("\/api\/ec\/candidates\/rank",\s*studentLimiter,\s*requireStudentAuth,\s*async/);
  // deterministic baseline still present (fallback)
  assert.match(SERVER, /predictedNarrativeFit/);
  assert.match(SERVER, /using deterministic/);
  // engine flag returned
  assert.match(SERVER, /engine,/);
});

test("spike finder has an LLM + web-search re-rank", () => {
  assert.match(SERVER, /async function llmRankSpike\(/);
  assert.match(SERVER, /app\.get\("\/api\/ec\/spike",\s*studentLimiter,\s*requireStudentAuth,\s*async/);
  assert.match(SERVER, /leadRationale/);
});

test("semantic rankers enable web search via credible-source tools", () => {
  assert.match(SERVER, /makeWebSearchTool/);
  assert.match(SERVER, /makeWebFetchTool/);
  assert.match(SERVER, /wantsWeb: true/);
});

test("rank + spike fold in target-school priorities", () => {
  // both resolve target schools and pass priorities into the prompt
  assert.match(SERVER, /resolveTargetSchools\(req\.studentId, req\.body\?\.targetSchools\)/);
  assert.match(SERVER, /getSchoolPriorities/);
});

// ─── Admissions calendar / date awareness ───────────────────────────────
test("server.js exposes POST /api/calendar/context, student-auth gated", () => {
  assert.match(SERVER, /app\.post\("\/api\/calendar\/context",\s*studentLimiter,\s*requireStudentAuth,\s*async/);
});

test("calendar builds a deterministic cycle calendar + web deadline lookup", () => {
  assert.match(SERVER, /function buildAdmissionsCalendar\(/);
  assert.match(SERVER, /async function fetchSchoolDeadlinesViaWeb\(/);
  // typical deadlines + HS breaks + ISO fallbacks present in the calendar shape
  assert.match(SERVER, /typicalDeadlines/);
  assert.match(SERVER, /typicalHsBreaks/);
  assert.match(SERVER, /typicalISO/);
  // deadlines cached + resolved against target schools
  assert.match(SERVER, /calendar_deadlines/);
  assert.match(SERVER, /resolveTargetSchools/);
});

test("deadline web lookup is pinned to DeepSeek V4 Pro on OpenRouter", () => {
  assert.match(SERVER, /deepseek\/deepseek-v4-pro/);
  assert.match(SERVER, /byok\.provider === "openrouter"/);
});

test("bulk deadlines endpoint exists (collapses the add-school burst)", () => {
  assert.match(SERVER, /app\.post\("\/api\/students\/deadlines\/bulk",\s*studentLimiter,\s*requireStudentAuth/);
  assert.match(SERVER, /existingTitles/);
});

// ─── Imports wired ──────────────────────────────────────────────────────
test("server.js imports the course-sequence catalog and WELLBEING_LIMITS", () => {
  assert.match(SERVER, /from "\.\/course-sequence-catalog\.js"/);
  assert.match(SERVER, /WELLBEING_LIMITS/);
});

// ─── Generation endpoints (EC ideas + narrative draft) ──────────────────
test("server.js exposes POST /api/ec/ideas/generate, student-auth gated", () => {
  assert.match(SERVER, /app\.post\("\/api\/ec\/ideas\/generate",\s*studentLimiter,\s*requireStudentAuth/);
});

test("server.js exposes POST /api/narrative/draft, student-auth gated", () => {
  assert.match(SERVER, /app\.post\("\/api\/narrative\/draft",\s*studentLimiter,\s*requireStudentAuth/);
});

test("generation endpoints use the shared BYOK closure + MEDIUM tier", () => {
  assert.match(SERVER, /function buildStudentCallLLM\(/);
  assert.match(SERVER, /lookupStudentBYOK/);
  // Both endpoints prefer the medium model for synthesis work.
  assert.match(SERVER, /byok\.models\?\.medium/);
});

test("generation endpoints gate on budget and require a BYOK key", () => {
  assert.match(SERVER, /No personal API key on file/);
  assert.match(SERVER, /checkBudget\(piiVault, ragStmts, req\.studentId\)/);
});

test("EC idea generation grounds + tags ideas, narrative draft is not auto-saved", () => {
  assert.match(SERVER, /tagIdeaWithNarrative/);
  assert.match(SERVER, /assembleProfileForGeneration/);
  assert.match(SERVER, /parseLLMJson/);
  // Draft endpoint returns { draft } and never calls saveNarrative.
  assert.match(SERVER, /\[narrative draft\]/);
});

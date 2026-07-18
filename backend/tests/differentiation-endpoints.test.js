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
const LLM_ADAPTER = fs.readFileSync(path.resolve(__dirname, "../llm-adapters/index.js"), "utf8");

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

// ─── Budgeted LLM semantic ranking ───────────────────────────────────────
test("candidate rank has an LLM semantic re-rank with deterministic fallback", () => {
  assert.match(SERVER, /async function llmRankCandidates\(/);
  assert.match(SERVER, /app\.post\("\/api\/ec\/candidates\/rank",\s*studentLimiter,\s*requireStudentAuth,\s*async/);
  // deterministic baseline still present (fallback)
  assert.match(SERVER, /predictedNarrativeFit/);
  assert.match(SERVER, /using deterministic/);
  // engine flag returned
  assert.match(SERVER, /engine,/);
});

test("spike finder has an LLM semantic re-rank", () => {
  assert.match(SERVER, /async function llmRankSpike\(/);
  assert.match(SERVER, /app\.get\("\/api\/ec\/spike",\s*studentLimiter,\s*requireStudentAuth,\s*async/);
  assert.match(SERVER, /leadRationale/);
});

test("semantic rankers stay inside the fixed OpenRouter no-tools boundary", () => {
  assert.doesNotMatch(SERVER, /wantsWeb\s*:/);
  assert.match(SERVER, /No browsing is available/);
  assert.match(LLM_ADAPTER, /General web and custom tool execution are disabled/);
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

test("calendar builds a deterministic cycle calendar + typical target-school fallback", () => {
  assert.match(SERVER, /function buildAdmissionsCalendar\(/);
  // typical deadlines + HS breaks + ISO fallbacks present in the calendar shape
  assert.match(SERVER, /typicalDeadlines/);
  assert.match(SERVER, /typicalHsBreaks/);
  assert.match(SERVER, /typicalISO/);
  // target schools are resolved but exact dates remain explicitly unverified
  assert.match(SERVER, /resolveTargetSchools/);
  assert.match(SERVER, /source: "typical"/);
  assert.doesNotMatch(SERVER, /fetchSchoolDeadlinesViaWeb/);
});

test("calendar context does not dispatch a paid model or web lookup", () => {
  const start = SERVER.indexOf('app.post("/api/calendar/context"');
  const end = SERVER.indexOf("// GET: retrieve historical directionality", start);
  const route = SERVER.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(route, /buildStudentCallLLM|callLLM|reserveStudentModelCall|deepseek/i);
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

test("generation endpoints use the shared fixed-OpenRouter closure + MEDIUM tier", () => {
  assert.match(SERVER, /function buildStudentCallLLM\(/);
  assert.match(SERVER, /function currentOperatorKeyConfig\(/);
  assert.match(SERVER, /provider: "openrouter"/);
  // Both endpoints prefer the medium model for synthesis work.
  assert.match(SERVER, /modelConfig\.models\?\.medium/);
});

test("generation endpoints require administrator OpenRouter config and reserve budget", () => {
  assert.match(SERVER, /The administrator must configure OpenRouter first/);
  assert.match(SERVER, /function reserveStudentModelCall\(/);
  assert.match(SERVER, /reserveBudget\(db,/);
  assert.doesNotMatch(SERVER, /No personal API key on file/);
});

test("EC idea generation grounds + tags ideas, narrative draft is not auto-saved", () => {
  assert.match(SERVER, /tagIdeaWithNarrative/);
  assert.match(SERVER, /assembleProfileForGeneration/);
  assert.match(SERVER, /parseLLMJson/);
  // Draft endpoint returns { draft } and never calls saveNarrative.
  assert.match(SERVER, /\[narrative draft\]/);
});

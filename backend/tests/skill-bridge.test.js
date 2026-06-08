// ═══════════════════════════════════════════════════════════════════════
// tests/skill-bridge.test.js — lock in the collegeapp-ai skill contract
// ═══════════════════════════════════════════════════════════════════════
// The skill-side fetch-context.js script relies on a stable v1.0 schema
// from GET /api/context/bundle. This test doesn't boot the HTTP server
// (that would require seeding the PII vault + RAG DB); instead it asserts
// the *documented* shape exists in SKILL.md and that the helper scripts
// are wired to hit the expected endpoint. If anyone silently changes the
// contract, these grep-style assertions catch it.
// ═══════════════════════════════════════════════════════════════════════

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(__dirname, "../skills/collegeapp-ai");

test("SKILL.md declares v1.1 and the required fields", () => {
  const md = fs.readFileSync(path.join(SKILL_DIR, "SKILL.md"), "utf8");

  // YAML frontmatter with the core metadata.
  assert.match(md, /^---/,                "YAML frontmatter missing");
  assert.match(md, /name:\s*collegeapp-ai/, "skill name missing");
  assert.match(md, /version:\s*1\.1\.0/,   "skill version must be 1.1.0 (prestige factor + narrativeText opt-in)");

  // 5-factor EC strength vector must be documented.
  for (const factor of ["dedication", "achievement", "leadership", "prestige", "narrative_fit"]) {
    assert.match(md, new RegExp(`\\b${factor}\\b`), `SKILL.md must reference EC factor: ${factor}`);
  }
  assert.match(md, /prestigeSource/, "SKILL.md must document prestigeSource field");
  assert.match(md, /narrativeText/,  "SKILL.md must document the opt-in narrativeText field");

  // Every bundle field mentioned in SKILL.md must be a top-level key of
  // the documented JSON shape. If we rename one on the backend, this test
  // forces us to rename it here too.
  for (const field of ["rag", "ecStrength", "apConcepts", "directionality", "narrative", "tierHints", "studentPlaceholder", "version"]) {
    assert.match(md, new RegExp(`\\b${field}\\b`), `SKILL.md must reference field: ${field}`);
  }

  // Tier hints must mention small/medium/large.
  assert.match(md, /\bSMALL\b/);
  assert.match(md, /\bMEDIUM\b/);
  assert.match(md, /\bLARGE\b/);

  // Red lines.
  assert.match(md, /crisis/i, "SKILL.md must cover crisis handling");
  assert.match(md, /FAFSA/,   "SKILL.md must cover FAFSA/FERPA citations");
});

test("fetch-context.js hits /api/context/bundle with the session token", () => {
  const src = fs.readFileSync(path.join(SKILL_DIR, "scripts/fetch-context.js"), "utf8");
  assert.match(src, /\/api\/context\/bundle/);
  assert.match(src, /COLLEGEAPP_SESSION_TOKEN/);
  assert.match(src, /COLLEGEAPP_BACKEND_URL/);
  // Default backend URL fallback so the skill works out of the box.
  assert.match(src, /localhost:3001/);
  // --narrative-text opt-in for v1.1 bundle upgrade (F2 from UX audit).
  assert.match(src, /--narrative-text/);
  assert.match(src, /narrativeText/);
});

test("register.js exists and wires the register → consent → narrative flow", () => {
  const src = fs.readFileSync(path.join(SKILL_DIR, "scripts/register.js"), "utf8");
  assert.match(src, /\/api\/students\/register/);
  assert.match(src, /\/api\/students\/auth/);
  assert.match(src, /\/api\/consent\/grant/);
  assert.match(src, /\/api\/ec\/narrative/);
  // Must grant all three Korea-PIPA consents by default.
  assert.match(src, /data_processing/);
  assert.match(src, /ai_interaction/);
  assert.match(src, /cross_border_transfer/);
  // And surface the session token so the student can export it.
  assert.match(src, /sessionToken/);
});

test("upload-attachment.js posts to /api/ec/upload with multipart form", () => {
  const src = fs.readFileSync(path.join(SKILL_DIR, "scripts/upload-attachment.js"), "utf8");
  assert.match(src, /\/api\/ec\/upload/);
  assert.match(src, /FormData/);
  assert.match(src, /ec_name/);
});

test("server.js exposes the three new LLM endpoints by name", async () => {
  // The goal here is to catch someone silently removing these routes.
  const src = fs.readFileSync(path.resolve(__dirname, "../server.js"), "utf8");
  assert.match(src, /app\.post\("\/api\/llm"/,             "POST /api/llm missing");
  assert.match(src, /app\.get\("\/api\/llm\/providers"/,   "GET /api/llm/providers missing");
  assert.match(src, /app\.get\("\/api\/context\/bundle"/,  "GET /api/context/bundle missing");
  assert.match(src, /app\.get\("\/api\/students\/structured-metrics"/,
    "GET /api/students/structured-metrics missing");
});

test("context bundle emits version: 1.1 in server.js (5-factor EC strength)", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../server.js"), "utf8");
  // Bump to 1.1 when the prestige factor was added. The skill side reads
  // this version to decide how to render the EC block.
  assert.match(src, /version:\s*"1\.1"/,                   "Bundle must declare version: 1.1");
  assert.match(src, /studentPlaceholder:\s*"\[STUDENT\]"/, "Bundle must expose studentPlaceholder");
});

test("server.js exposes the EC prestige/cache endpoints by name", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../server.js"), "utf8");
  assert.match(src, /app\.get\("\/api\/ec\/prestige\/:activityName"/,
    "GET /api/ec/prestige/:activityName missing");
  assert.match(src, /app\.post\("\/api\/ec\/prestige\/recompute"/,
    "POST /api/ec/prestige/recompute missing");
  assert.match(src, /app\.delete\("\/api\/ec\/component-cache"/,
    "DELETE /api/ec/component-cache missing");
  assert.match(src, /app\.post\("\/api\/ec\/competitions\/search"/,
    "POST /api/ec/competitions/search missing");
  assert.match(src, /app\.get\("\/api\/ec\/cache-memory"/,
    "GET /api/ec/cache-memory missing");
  // Student-facing prestige rationale surface (Jiyeon UX audit F5).
  assert.match(src, /app\.get\("\/api\/ec\/strength\/:ecName\/prestige"/,
    "GET /api/ec/strength/:ecName/prestige missing");
  // Narrative drift detection (Jiyeon UX audit F10).
  assert.match(src, /app\.get\("\/api\/narrative\/drift"/,
    "GET /api/narrative/drift missing");
  // Candidate EC ranking (Jiyeon UX audit F6).
  assert.match(src, /app\.post\("\/api\/ec\/candidates\/rank"/,
    "POST /api/ec/candidates/rank missing");
  // Personal student deadlines (Jiyeon UX audit F7).
  assert.match(src, /app\.post\("\/api\/students\/deadlines"/,
    "POST /api/students/deadlines missing");
});

test("server.js marks Scorecard fallback responses explicitly and normalizes search caching", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../server.js"), "utf8");
  assert.match(src, /normalizeScorecardSearchPayload/,
    "Scorecard search payloads should be normalized before caching");
  assert.match(src, /fallbackReason:\s*"scorecard_not_configured"/,
    "Scorecard fallback should expose scorecard_not_configured");
  assert.match(src, /fallbackReason:\s*"scorecard_live_error"/,
    "Scorecard fallback should expose scorecard_live_error");
  assert.match(src, /withScorecardMeta/,
    "Scorecard responses should be wrapped with provenance metadata");
});

test("user-side skill install exists at ~/.claude/skills/collegeapp-ai/ (if present)", () => {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) return;
  const userSide = path.join(home, ".claude", "skills", "collegeapp-ai");
  if (!fs.existsSync(userSide)) {
    // Not installed yet — that's fine, DEPLOY.md documents how.
    return;
  }
  assert.ok(fs.existsSync(path.join(userSide, "SKILL.md")), "user-side SKILL.md missing");
  assert.ok(
    fs.existsSync(path.join(userSide, "scripts", "fetch-context.js")),
    "user-side fetch-context.js missing",
  );
});

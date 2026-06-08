// ═══════════════════════════════════════════════════════════════════════
// tests/narrative-drift-and-majors.test.js — F3, F4, F10 coverage
// ═══════════════════════════════════════════════════════════════════════
// - F3: new major buckets (computational_biology, neuroscience, etc.) are
//   reachable from matchMajorBucket().
// - F4: enhancedCollegeMatch weights narrativeFit when an active narrative
//   exists, and falls back to legacy weights when it doesn't.
// - F10: /api/narrative/drift is wired into server.js.
// ═══════════════════════════════════════════════════════════════════════

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { matchMajorBucket, LEXICON } from "../ec-vectorizer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── F3 ────────────────────────────────────────────────────────────────
test("matchMajorBucket routes computational biology narratives correctly", () => {
  assert.equal(matchMajorBucket("computational biology"), "computational_biology");
  assert.equal(matchMajorBucket("bioinformatics / genomics"), "computational_biology");
  // Should not collapse to generic biology.
  assert.notEqual(matchMajorBucket("mitochondrial disease research"), "biology");
  assert.equal(matchMajorBucket("mitochondrial disease research"), "computational_biology");
});

test("matchMajorBucket covers the new Jiyeon-adjacent majors", () => {
  assert.equal(matchMajorBucket("neuroscience"), "neuroscience");
  assert.equal(matchMajorBucket("biomedical engineering"), "biomedical_engineering");
  assert.equal(matchMajorBucket("data science"), "data_science");
  assert.equal(matchMajorBucket("public policy"), "public_policy");
  assert.equal(matchMajorBucket("international relations"), "international_relations");
  assert.equal(matchMajorBucket("linguistics"), "linguistics");
  assert.equal(matchMajorBucket("journalism"), "journalism");
  assert.equal(matchMajorBucket("architecture"), "architecture");
  assert.equal(matchMajorBucket("film studies"), "film");
  assert.equal(matchMajorBucket("philosophy"), "philosophy");
  assert.equal(matchMajorBucket("education"), "education");
});

test("existing major buckets still route correctly (no regression)", () => {
  assert.equal(matchMajorBucket("computer science"), "computer_science");
  assert.equal(matchMajorBucket("biology"), "biology");
  assert.equal(matchMajorBucket("chemistry"), "chemistry");
  assert.equal(matchMajorBucket("mathematics"), "mathematics");
});

test("LEXICON.majorBuckets contains the new buckets", () => {
  for (const bucket of [
    "computational_biology",
    "neuroscience",
    "biomedical_engineering",
    "data_science",
    "public_policy",
    "international_relations",
    "linguistics",
    "journalism",
    "architecture",
    "film",
    "philosophy",
    "anthropology",
    "education",
    "materials_science",
  ]) {
    assert.ok(LEXICON.majorBuckets[bucket], `missing bucket: ${bucket}`);
    assert.ok(Array.isArray(LEXICON.majorBuckets[bucket]));
    assert.ok(LEXICON.majorBuckets[bucket].length > 0, `bucket ${bucket} has no keywords`);
  }
});

// ─── F4 (static source check — runtime test would need a seeded DB) ─────
test("enhancedCollegeMatch source includes narrativeFit weighting", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../rag-engine.js"), "utf8");
  assert.match(src, /narrativeFit\s*:\s*0\.20/,
    "Composite weights must include narrativeFit: 0.20 when narrative exists");
  assert.match(src, /narrativeMajorBuckets/, "Narrative buckets must be consulted in match scoring");
  assert.match(src, /narrativeHitBucket/, "narrativeHitBucket provenance flag must be exposed");
});

// ─── F10 ────────────────────────────────────────────────────────────────
test("server.js exposes GET /api/narrative/drift with a friendly message", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../server.js"), "utf8");
  assert.match(src, /app\.get\("\/api\/narrative\/drift"/,
    "GET /api/narrative/drift missing");
  assert.match(src, /staleCount/, "drift response must expose staleCount");
  assert.match(src, /friendlyMessage/, "drift response must include a friendly student-facing message");
  assert.match(src, /recomputeUrl/, "drift response must point the student at the recompute URL");
});

test("context bundle surfaces narrative.active.drift for UI banners", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../server.js"), "utf8");
  assert.match(src, /drift:\s*\{\s*staleCount/,
    "context/bundle narrative.active.drift block missing");
});

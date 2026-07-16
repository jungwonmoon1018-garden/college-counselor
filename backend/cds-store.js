// ═══════════════════════════════════════════════════════════════════════
// cds-store.js — bridges the on-disk parsed/validated CDS cache
// (tools/cds-cache/parsed/*.json) into the live `cds_records` table, and
// adapts a stored record into the shape positioning-engine.js consumes.
//
// Why this exists: the positioning calculation used to depend on a LIVE,
// per-request CDS fetch (resolveAndParseCdsTargets) that frequently fails,
// leaving "Very Low" evidence confidence and forcing the engine onto
// optimistic defaults. Meanwhile a fully parsed + validated CDS dataset for
// ~23 top schools sat unused on disk and the cds_records table was empty.
// This module loads that dataset once and lets College Fit read real C7
// factor weights, admit rates, and test-score ranges instead of guessing.
// ═══════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { persistAndValidate, loadValidatedRecord, loadAllValidatedRecords, loadLatestValidation } from "./cds-validator.js";
import { normalizeSchoolName } from "./cds-search.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PARSED_CDS_DIR = path.join(__dirname, "tools", "cds-cache", "parsed");

// Turn a school display name into the slug convention used by the parsed
// cache files and the context/bundle endpoint ("Columbia University" →
// "columbia-university").
export function slugifySchoolName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Strict name key for matching DISTINCT institutions. Unlike
// normalizeSchoolName (which strips "university"/"college" so "Columbia
// University" can match "...in the City of New York"), this KEEPS the
// institution-type word — otherwise "Boston University" and "Boston College"
// both collapse to "boston" and we'd bind one school to the other's data.
export function strictSchoolKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\b(the)\b/g, " ") // only the article is noise
    .replace(/\s+/g, " ")
    .trim();
}

// Two names refer to the same institution when their strict keys are equal or
// one is a prefix-extension of the other ("Columbia University" ⊂ "Columbia
// University in the City of New York"). "Boston University" vs "Boston College"
// is neither → rejected.
export function schoolNamesCompatible(a, b) {
  const ka = strictSchoolKey(a);
  const kb = strictSchoolKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  return ka.startsWith(`${kb} `) || kb.startsWith(`${ka} `);
}

// Map CDS test-policy vocabulary onto the two buckets scoreTestPercentile
// understands. Anything optional/blind de-emphasizes tests; everything else
// is treated as considered/required.
export function normalizeCdsTestPolicy(policy) {
  const p = String(policy || "").toLowerCase();
  if (p.includes("optional") || p.includes("blind") || p.includes("deemphasi") || p.includes("de-emphasi")) {
    return "test_optional_or_deemphasized";
  }
  if (!p) return null;
  return "test_considered_or_required";
}

// ─── Ingest: disk → cds_records ────────────────────────────────────────
// Reads every parsed record file (skips _meta files) and upserts it via the
// existing validated-persist path so corrections/overrides are reapplied.
// Idempotent: safe to call on every boot.
export async function ingestParsedCdsCache(ragStmts, { dir = DEFAULT_PARSED_CDS_DIR } = {}) {
  const result = { dir, ingested: 0, skipped: 0, errors: [] };
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch (err) {
    result.errors.push(`readdir ${dir}: ${err.message}`);
    return result;
  }

  for (const file of files) {
    if (!file.endsWith(".json") || file.startsWith("_")) { result.skipped++; continue; }
    const full = path.join(dir, file);
    try {
      const parsed = JSON.parse(fs.readFileSync(full, "utf8"));
      if (!parsed?.slug && !parsed?.school) { result.skipped++; continue; }
      if (!parsed.slug) parsed.slug = slugifySchoolName(parsed.school);
      await persistAndValidate(ragStmts, parsed, { sourceKind: parsed.source || "cds_cache" });
      result.ingested++;
    } catch (err) {
      result.errors.push(`${file}: ${err.message}`);
    }
  }
  return result;
}

// Count rows so callers can decide whether a boot-time ingest is needed.
export function countCdsRecords(ragStmts) {
  try {
    return loadAllValidatedRecords(ragStmts).length;
  } catch {
    return 0;
  }
}

// Ingest only when the table is empty (boot path), unless force=true.
export async function ensureCdsStoreSeeded(ragStmts, { dir = DEFAULT_PARSED_CDS_DIR, force = false } = {}) {
  if (!force && countCdsRecords(ragStmts) > 0) {
    return { seeded: false, reason: "already_populated" };
  }
  const res = await ingestParsedCdsCache(ragStmts, { dir });
  return { seeded: true, ...res };
}

// ─── Resolve: school name → stored record ──────────────────────────────
// Tries exact slug first, then a CONSERVATIVE normalized-name match across
// all stored records (equality or prefix-extension only — never a loose
// substring), mirroring the baseline-college resolver so "Columbia
// University" binds to the right record without matching decoys.
export function resolveStoredCdsRecord(ragStmts, { schoolName, slug } = {}) {
  const directSlug = slug || (schoolName ? slugifySchoolName(schoolName) : null);
  if (directSlug) {
    const rec = loadValidatedRecord(ragStmts, directSlug);
    if (rec) return rec;
  }
  if (!schoolName) return null;

  const query = strictSchoolKey(schoolName);
  if (!query) return null;
  let best = null;
  let bestScore = -1;
  for (const rec of loadAllValidatedRecords(ragStmts)) {
    const cand = strictSchoolKey(rec.school);
    if (!cand) continue;
    let score = -1;
    if (cand === query) score = 100;                                   // exact institution
    else if (cand.startsWith(`${query} `)) score = 80 - Math.min(40, cand.split(" ").length - query.split(" ").length);
    else if (query.startsWith(`${cand} `)) score = 70 - Math.min(40, query.split(" ").length - cand.split(" ").length);
    else continue;                                                     // distinct school → skip
    if (score > bestScore) { bestScore = score; best = rec; }
  }
  return best;
}

// A record is "validated" when it was checked against ground truth during
// ingestion (the curated store). Live-parsed records have validation status
// "no_truth" — real data, but unverified.
export function isCdsRecordValidated(ragStmts, slug) {
  if (!slug) return false;
  const v = loadLatestValidation(ragStmts, slug);
  return Boolean(v && v.status && v.status !== "no_truth");
}

// ─── Adapt: stored record → positioning-engine cdsResult ───────────────
// Produces the exact shape buildPositioningForTarget()/scoreEvidenceConfidence()
// read. Because this is a validated, sourced record, fetchStatus is "ok" and
// the source URL + reporting year are populated, so evidence confidence now
// reflects real data instead of a failed live fetch.
export function cdsRecordToPositioningResult(record, { liveFallback = null, unitId = null, validated = true } = {}) {
  if (!record) return liveFallback;
  const admitRatePercent = record.overallAdmitRate != null
    ? Math.round(record.overallAdmitRate * 1000) / 10
    : (liveFallback?.parsed?.admitRatePercent ?? null);

  const parsed = {
    c7: record.c7 && Object.keys(record.c7).length ? record.c7 : (liveFallback?.parsed?.c7 ?? null),
    admitRatePercent,
    gpaAverage: record.enrolledGPA?.avg ?? liveFallback?.parsed?.gpaAverage ?? null,
    satComposite: record.enrolledSAT
      ? { low: record.enrolledSAT.p25 ?? null, high: record.enrolledSAT.p75 ?? null }
      : (liveFallback?.parsed?.satComposite ?? null),
    actComposite: record.enrolledACT
      ? { low: record.enrolledACT.p25 ?? null, high: record.enrolledACT.p75 ?? null }
      : (liveFallback?.parsed?.actComposite ?? null),
    testPolicy: normalizeCdsTestPolicy(record.testPolicy) ?? liveFallback?.parsed?.testPolicy ?? null,
  };

  const reportingYear = record.yearLabel || (record.year != null ? String(record.year) : null);
  // Distinguish how an unverified record was obtained: AI web-read vs a live
  // PDF parse. (Validated curated records are always "cds_store".)
  const isWebRead = record.sourceKind === "web_llm";
  const provenanceKind = validated ? "cds_store" : (isWebRead ? "cds_web" : "cds_live");
  const sourceLabel = validated
    ? "CDS store (validated)"
    : (isWebRead ? "CDS (AI web-read, unverified)" : "CDS (live, unverified)");

  return {
    unitId: unitId ?? liveFallback?.unitId ?? null,
    schoolName: record.school || liveFallback?.schoolName || null,
    repositoryMatch: {
      schoolName: record.school,
      latestAvailableYear: reportingYear,
    },
    source: sourceLabel,
    sourceUrl: record.sourceUrl || liveFallback?.sourceUrl || null,
    sourceContentType: liveFallback?.sourceContentType ?? null,
    sourceExtraction: liveFallback?.sourceExtraction ?? null,
    fetchStatus: "ok",
    // Read by scoreEvidenceConfidence: unverified records take a confidence
    // penalty and are capped below "High".
    validated,
    parsed,
    // Provenance surfaced to the UI / payload so the source is visible/citable.
    provenance: {
      kind: provenanceKind,
      slug: record.slug,
      year: record.year ?? null,
      yearLabel: record.yearLabel ?? null,
      tier: record.tier ?? null,
      admitRatePercent,
      sourceUrl: record.sourceUrl || null,
      validated,
    },
  };
}

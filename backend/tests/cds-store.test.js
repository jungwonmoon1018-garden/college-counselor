import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { initRAGTables, prepareRAGStatements } from "../rag-engine.js";
import {
  ingestParsedCdsCache,
  resolveStoredCdsRecord,
  cdsRecordToPositioningResult,
  normalizeCdsTestPolicy,
  slugifySchoolName,
  strictSchoolKey,
  schoolNamesCompatible,
} from "../cds-store.js";
import { resolveDownloadURL, unwrapGoogleRedirect } from "../cds-ingest-pipeline.js";

function freshStmts() {
  const db = new Database(":memory:");
  initRAGTables(db);
  return prepareRAGStatements(db);
}

test("slugifySchoolName matches the parsed-cache convention", () => {
  assert.equal(slugifySchoolName("Columbia University"), "columbia-university");
  assert.equal(slugifySchoolName("University of Michigan"), "university-of-michigan");
});

test("normalizeCdsTestPolicy maps onto the engine's two buckets", () => {
  assert.equal(normalizeCdsTestPolicy("test_optional"), "test_optional_or_deemphasized");
  assert.equal(normalizeCdsTestPolicy("test_blind"), "test_optional_or_deemphasized");
  assert.equal(normalizeCdsTestPolicy("test_required"), "test_considered_or_required");
  assert.equal(normalizeCdsTestPolicy(""), null);
});

test("ingest populates cds_records and resolves a school to real data", async () => {
  const stmts = freshStmts();
  const res = await ingestParsedCdsCache(stmts);
  assert.ok(res.ingested >= 15, `expected a healthy ingest, got ${res.ingested}`);
  assert.deepEqual(res.errors, []);

  // Exact-name resolution + the conservative fuzzy fallback.
  const exact = resolveStoredCdsRecord(stmts, { schoolName: "Columbia University" });
  assert.ok(exact, "Columbia should resolve");
  assert.ok(exact.overallAdmitRate > 0 && exact.overallAdmitRate < 0.1, "Columbia admit rate should be single-digit %");
  assert.ok(exact.c7 && exact.c7.gpa, "C7 factor weights should be present");
  assert.ok(exact.enrolledSAT?.p25, "enrolled SAT range should be present");
});

test("adapter shapes a stored record for the positioning engine", async () => {
  const stmts = freshStmts();
  await ingestParsedCdsCache(stmts);
  const rec = resolveStoredCdsRecord(stmts, { schoolName: "Columbia University" });

  const live = { schoolName: "Columbia University", fetchStatus: "not_found", parsed: null, sourceUrl: null };
  const adapted = cdsRecordToPositioningResult(rec, { liveFallback: live });

  assert.equal(adapted.fetchStatus, "ok");
  assert.ok(adapted.parsed.c7.gpa, "c7 carried through");
  assert.ok(adapted.parsed.admitRatePercent > 0 && adapted.parsed.admitRatePercent < 10);
  assert.ok(adapted.parsed.satComposite.low > 0 && adapted.parsed.satComposite.high > adapted.parsed.satComposite.low);
  assert.equal(adapted.parsed.testPolicy, "test_optional_or_deemphasized");
  assert.equal(adapted.provenance.kind, "cds_store");
  assert.equal(adapted.provenance.validated, true);
  assert.ok(adapted.repositoryMatch.latestAvailableYear);
});

test("adapter returns the live fallback when no record is given", () => {
  const live = { schoolName: "Unknown", fetchStatus: "not_found", parsed: null };
  assert.equal(cdsRecordToPositioningResult(null, { liveFallback: live }), live);
});

test("adapter tags unvalidated live records as cds_live / validated:false", () => {
  const rec = { slug: "x-university", school: "X University", overallAdmitRate: 0.5, enrolledSAT: { p25: 1200, p75: 1400 }, c7: { gpa: "very_important" }, year: 2024 };
  const validatedOut = cdsRecordToPositioningResult(rec, { validated: true });
  const liveOut = cdsRecordToPositioningResult(rec, { validated: false });
  assert.equal(validatedOut.validated, true);
  assert.equal(validatedOut.provenance.kind, "cds_store");
  assert.equal(liveOut.validated, false);
  assert.equal(liveOut.provenance.kind, "cds_live");
  assert.equal(liveOut.provenance.validated, false);
});

test("strict matching keeps distinct institutions apart", () => {
  // The bug this guards: "University"/"College" must NOT be stripped, or
  // "Boston University" binds to "Boston College".
  assert.equal(schoolNamesCompatible("Boston University", "Boston College"), false);
  assert.equal(schoolNamesCompatible("Columbia University", "Columbia University in the City of New York"), true);
  assert.equal(schoolNamesCompatible("University of Missouri-Columbia", "Columbia University"), false);
  assert.equal(schoolNamesCompatible("Boston University", "Boston University"), true);
  assert.notEqual(strictSchoolKey("Boston University"), strictSchoolKey("Boston College"));
});

test("resolveDownloadURL unwraps Google redirect + Drive links", () => {
  const wrapped = "https://www.google.com/url?q=https://drive.google.com/file/d/ABC123XYZ&sa=D&source=editors&ust=1";
  assert.equal(unwrapGoogleRedirect(wrapped), "https://drive.google.com/file/d/ABC123XYZ");
  assert.equal(resolveDownloadURL(wrapped), "https://drive.google.com/uc?export=download&id=ABC123XYZ");
  // Direct PDF passes through.
  assert.equal(resolveDownloadURL("https://x.edu/cds.pdf"), "https://x.edu/cds.pdf");
  // Sheets → xlsx export (then rejected downstream as non-PDF).
  assert.match(resolveDownloadURL("https://docs.google.com/spreadsheets/d/SHEET1/edit"), /export\?format=xlsx/);
});

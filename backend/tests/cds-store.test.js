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
import { resolveDownloadURL, unwrapGoogleRedirect, isBlockedIp, assertSafeFetchTarget } from "../cds-ingest-pipeline.js";

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

test("isBlockedIp rejects loopback/private/link-local, allows public", () => {
  assert.equal(isBlockedIp("127.0.0.1", 4), true);
  assert.equal(isBlockedIp("10.0.0.5", 4), true);
  assert.equal(isBlockedIp("172.16.0.1", 4), true);
  assert.equal(isBlockedIp("172.31.255.255", 4), true);
  assert.equal(isBlockedIp("172.32.0.1", 4), false); // just outside the 172.16/12 block
  assert.equal(isBlockedIp("192.168.1.1", 4), true);
  assert.equal(isBlockedIp("169.254.1.1", 4), true);
  assert.equal(isBlockedIp("100.64.0.1", 4), true); // carrier-grade NAT
  assert.equal(isBlockedIp("8.8.8.8", 4), false);
  assert.equal(isBlockedIp("::1", 6), true);
  assert.equal(isBlockedIp("::ffff:127.0.0.1", 6), true); // IPv4-mapped loopback
  assert.equal(isBlockedIp("fe80::1", 6), true);
  assert.equal(isBlockedIp("fd00::1", 6), true); // unique-local
  assert.equal(isBlockedIp("2001:4860:4860::8888", 6), false);
});

test("assertSafeFetchTarget rejects malformed URLs, non-http(s) schemes, and loopback hosts", async () => {
  await assert.rejects(() => assertSafeFetchTarget("file:///etc/passwd"), /non-http/);
  await assert.rejects(() => assertSafeFetchTarget("ftp://internal.example/x"), /non-http/);
  await assert.rejects(() => assertSafeFetchTarget("http://127.0.0.1/admin"), /non-public address/);
  await assert.rejects(() => assertSafeFetchTarget("http://localhost:3001/api/health"), /non-public address/);
  await assert.rejects(() => assertSafeFetchTarget("not a url"), /malformed/);
});

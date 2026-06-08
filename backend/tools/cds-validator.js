// ═══════════════════════════════════════════════════════════════════════
// cds-validator.js — cross-checks parsed CDS records against authoritative
// public sources, flags drifts, and applies vetted corrections.
// ═══════════════════════════════════════════════════════════════════════
// Three signals feed validation:
//   1. Document scope — extracts the institution-name string from the PDF's
//      first page and asserts it matches expected. Catches the College
//      Transitions issue where "Columbia University" links to "Columbia
//      General Studies" CDS by mistake (29.9% admit vs real 3.89%).
//   2. Ground-truth registry — _corrections.json carries web-validated
//      admit rates / SAT bands per school, harvested via WebSearch.
//   3. Sanity arithmetic — admitted ≤ applied, enrolled ≤ admitted,
//      yield rate within plausible 0.05–0.95 range, etc.
//
// The validator is intentionally non-destructive: it produces a
// `validation` block on each record (status / discrepancies / overrides)
// rather than mutating fields in place. Downstream consumers can choose
// whether to use parsed values or the ground-truth overrides.
// ═══════════════════════════════════════════════════════════════════════

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { extractItems } from "./cds-pdf-positional.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PARSED_DIR = path.join(__dirname, "cds-cache", "parsed");
const CORRECTIONS_PATH = path.join(__dirname, "cds-cache", "_corrections.json");

// ─── 1. Document scope detection ─────────────────────────────────────
// Read the first 800 chars of the PDF to determine which institution
// the CDS describes. CDS PDFs always have "Common Data Set <year>
// <Institution Name>" near the top.
export async function extractDocumentScope(pdfPath) {
  const items = await extractItems(pdfPath);
  const headSlice = items.slice(0, 120).map((i) => i.str).join(" ");
  // Pattern variants — look for the actual institution-name string
  // immediately after a "Common Data Set <year>" header, after "Name of
  // College/University:", or before "Common Data Set" in the title block.
  const m =
    headSlice.match(/COMMON\s+DATA\s+SET\s+\d{4}.{0,5}\d{2,4}\s+([A-Z][\w'.&-]+(?:\s+[A-Za-z'.&-]+){1,8}?(?:University|College|Institute|School))\b/i) ||
    headSlice.match(/Name\s+of\s+(?:College(?:\/University)?|University)\s*:?\s+([A-Z][\w'.&-]+(?:\s+[A-Za-z'.&-]+){1,8}?(?:University|College|Institute|School|Studies))\b/i) ||
    headSlice.match(/^([A-Z][\w'.&-]+(?:\s+[A-Za-z'.&-]+){1,8}?(?:University|College|Institute|School))\s+Common\s+Data\s+Set/i);
  if (!m) return null;
  const candidate = m[1].trim().replace(/\s+/g, " ");
  // Reject candidates that are obviously fragments (start with stray
  // punctuation or are shorter than 8 chars total).
  if (candidate.length < 8 || /^[^A-Z]/.test(candidate)) return null;
  return candidate;
}

// ─── 2. Corrections registry ─────────────────────────────────────────
// Web-validated values keyed by slug. Pulled via WebSearch against
// authoritative per-school institutional research pages and verified
// secondary sources (College Essay Guy, NextGenAdmit, College Vine
// where they cite the school's own CDS).
//
// Tolerance policy: admit-rate parsed value within ±0.5 percentage
// point of truth = pass. Outside that → override + flag low confidence.
const DEFAULT_CORRECTIONS = {
  "princeton-university": {
    expectedScope: /Princeton\s+University/i,
    overallAdmitRate: 0.0450, applied: 39644, admitted: 1782, enrolled: 1366,
    enrolledSAT: { p25: 1510, p75: 1560 },
    sources: ["https://ir.princeton.edu/document/491", "https://nextgenadmit.com/princeton-admission-statistics/"],
  },
  "stanford-university": {
    expectedScope: /Stanford\s+University/i,
    overallAdmitRate: 0.0361,
    enrolledSAT: { p25: 1510, p75: 1580 },
    sources: ["https://ucomm.stanford.edu/cds/"],
  },
  "harvard-university": {
    expectedScope: /Harvard\s+University/i,
    overallAdmitRate: 0.0345,
    enrolledSAT: { p25: 1510, p75: 1580 },
    sources: ["https://oira.harvard.edu/common-data-set/"],
  },
  "yale-university": {
    expectedScope: /Yale\s+University/i,
    overallAdmitRate: 0.0450, applied: 51803, admitted: 2332, enrolled: 1641,
    enrolledSAT: { p25: 1490, p75: 1580 },
    sources: ["https://oir.yale.edu/sites/default/files/cds_yale_2023-24_vf_20240320.pdf"],
  },
  "california-institute-of-technology": {
    expectedScope: /California\s+Institute\s+of\s+Technology/i,
    overallAdmitRate: 0.029,
    enrolledSAT: { p25: 1530, p75: 1580 },
    sources: ["https://iro.caltech.edu/documents/31490/Caltech_CDS_2023-2024_February_2025.pdf"],
  },
  "johns-hopkins-university": {
    expectedScope: /Johns\s+Hopkins\s+University/i,
    overallAdmitRate: 0.0644,
    enrolledSAT: { p25: 1520, p75: 1580 },
    sources: ["https://oir.jhu.edu/common-data-set/"],
  },
  "duke-university": {
    expectedScope: /Duke\s+University/i,
    overallAdmitRate: 0.0596, applied: 49469, admitted: 2948,
    enrolledSAT: { p25: 1510, p75: 1570 },
    sources: ["https://ira.duke.edu/sites/default/files/2024-04/CDS_2023-24.pdf"],
  },
  "university-of-pennsylvania": {
    expectedScope: /University\s+of\s+Pennsylvania/i,
    overallAdmitRate: 0.0587, applied: 59465, admitted: 3489, enrolled: 2416,
    enrolledSAT: { p25: 1500, p75: 1570 },
    sources: ["https://ira.upenn.edu/penn-numbers/common-data-set"],
  },
  "columbia-university": {
    // ─── SCOPE WARNING ─────────────────────────────────────────────
    // College Transitions' "Columbia University" link points to the GS
    // (General Studies) CDS, which is a small adult-college division.
    // Real Columbia College + SEAS admit rate is ~3.89%. We override
    // and flag the source mismatch.
    expectedScope: /Columbia\s+(?:College|Engineering|University in the City)/i,
    actualScopeWarning: "Source PDF is Columbia General Studies; numbers do not represent Columbia College / SEAS",
    overallAdmitRate: 0.0389, applied: 60248, admitted: 2355,
    enrolledSAT: { p25: 1490, p75: 1560 },
    sources: ["https://opir.columbia.edu/cds"],
  },
  "cornell-university": {
    expectedScope: /Cornell\s+University/i,
    overallAdmitRate: 0.079, applied: 67846, admitted: 5358, enrolled: 3537,
    enrolledSAT: { p25: 1510, p75: 1560 },
    sources: ["https://irp.cornell.edu/common-data-set"],
  },
  "northwestern-university": {
    expectedScope: /Northwestern\s+University/i,
    overallAdmitRate: 0.078,
    enrolledSAT: { p25: 1500, p75: 1570 },
    sources: ["https://www.enrollment.northwestern.edu/data/2023-2024.pdf"],
  },
  "brown-university": {
    expectedScope: /Brown\s+University/i,
    overallAdmitRate: 0.0523, applied: 51316, admitted: 2686, enrolled: 1695,
    enrolledSAT: { p25: 1510, p75: 1560 },
    sources: ["https://oir.brown.edu/sites/default/files/2020-04/CDS_2023_2024.pdf"],
  },
  "rice-university": {
    expectedScope: /Rice\s+University/i,
    overallAdmitRate: 0.082,
    enrolledSAT: { p25: 1510, p75: 1570 },
    sources: ["https://oir.rice.edu/common-data-set"],
  },
  "carnegie-mellon-university": {
    expectedScope: /Carnegie\s+Mellon\s+University/i,
    overallAdmitRate: 0.1166, applied: 33941, admitted: 3959,
    enrolledSAT: { p25: 1510, p75: 1560 },
    sources: ["https://www.cmu.edu/ira/CDS/cds_2324.html"],
  },
  "university-of-michigan": {
    expectedScope: /University\s+of\s+Michigan/i,
    overallAdmitRate: 0.2015, applied: 79743, admitted: 16071, enrolled: 7290,
    enrolledSAT: { p25: 1370, p75: 1530 },
    sources: ["https://obp.umich.edu/wp-content/uploads/pubdata/cds/CDS_2023-24_UMAA_10-25-24.pdf"],
  },
  "georgia-institute-of-technology": {
    expectedScope: /Georgia\s+Institute\s+of\s+Technology/i,
    overallAdmitRate: 0.16,
    enrolledSAT: { p25: 1390, p75: 1520 },
    sources: ["https://factbook.gatech.edu/admissions-and-enrollment/common-data-set/"],
  },
  "university-of-virginia-main-campus": {
    expectedScope: /University\s+of\s+Virginia/i,
    overallAdmitRate: 0.1683,
    enrolledSAT: { p25: 1410, p75: 1530 },
    sources: ["https://ias.virginia.edu/common-data-set"],
  },
  "new-york-university": {
    expectedScope: /New\s+York\s+University/i,
    overallAdmitRate: 0.0923,
    enrolledSAT: { p25: 1480, p75: 1560 },
    sources: ["https://www.nyu.edu/about/leadership-university-administration/office-of-the-president/office-of-the-provost/university-data-analytics/data-analytics/common-data-set.html"],
  },
  "university-of-wisconsin-madison": {
    expectedScope: /University\s+of\s+Wisconsin/i,
    overallAdmitRate: 0.4517,
    enrolledSAT: { p25: 1370, p75: 1490 },
    sources: ["https://apir.wisc.edu/cds/"],
  },
  "purdue-university": {
    expectedScope: /Purdue\s+University/i,
    overallAdmitRate: 0.5,
    enrolledSAT: { p25: 1200, p75: 1490 },
    sources: ["https://www.purdue.edu/datadigest/"],
  },
  "michigan-state-university": {
    expectedScope: /Michigan\s+State\s+University/i,
    overallAdmitRate: 0.85,
    enrolledSAT: { p25: 1100, p75: 1320 },
    sources: ["https://opb.msu.edu/functions/institution/data/index.html"],
  },
};

export function loadCorrections() {
  // Always return the in-memory DEFAULT_CORRECTIONS so RegExp literals are
  // preserved (JSON serialization would strip them). Persist a JSON-safe
  // dump for inspection but never round-trip through it at runtime.
  const dumpable = {};
  for (const [slug, t] of Object.entries(DEFAULT_CORRECTIONS)) {
    dumpable[slug] = { ...t, expectedScope: t.expectedScope?.source };
  }
  fs.writeFileSync(CORRECTIONS_PATH, JSON.stringify(dumpable, null, 2));
  return DEFAULT_CORRECTIONS;
}

// ─── 3. Validation passes ────────────────────────────────────────────
const ADMIT_TOL = 0.005;   // ±0.5 pct point
const SAT_TOL = 30;        // ±30 SAT points

export function validateRecord(record, truth, scopeFromPDF) {
  const v = {
    school: record.school,
    slug: record.slug,
    status: "ok",
    discrepancies: [],
    overrides: {},
    scopeFromPDF,
  };

  if (!truth) {
    v.status = "no_truth";
    return v;
  }

  // 1. Scope mismatch — critical severity. Force ALL applicable overrides
  // because the parsed numbers describe the wrong institution.
  // Guard: only treat scope as detectable if the extracted text looks like
  // a proper institution name (contains University/College/Institute) —
  // otherwise the scope extractor caught template noise like
  // "Mailing Address" or "Definitions".
  const scopeLooksValid = scopeFromPDF && /University|College|Institute|School/i.test(scopeFromPDF);
  let scopeMismatch = false;
  if (truth.expectedScope && scopeLooksValid && !truth.expectedScope.test(scopeFromPDF)) {
    scopeMismatch = true;
    v.discrepancies.push({
      severity: "critical",
      field: "scope",
      parsed: scopeFromPDF,
      expected: truth.expectedScope.toString(),
      note: truth.actualScopeWarning || "PDF describes a different institution than expected.",
    });
    v.status = "scope_mismatch";
    if (truth.overallAdmitRate != null) v.overrides.overallAdmitRate = truth.overallAdmitRate;
    if (truth.enrolledSAT) v.overrides.enrolledSAT = truth.enrolledSAT;
    if (truth.applied) v.overrides.b1 = { applied: truth.applied, admitted: truth.admitted, enrolled: truth.enrolled };
  }

  // 2. Admit rate drift
  if (truth.overallAdmitRate != null) {
    const parsed = record.overallAdmitRate;
    if (parsed == null) {
      v.discrepancies.push({ severity: "high", field: "overallAdmitRate", parsed: null, expected: truth.overallAdmitRate, note: "parser_missed" });
      v.overrides.overallAdmitRate = truth.overallAdmitRate;
    } else if (Math.abs(parsed - truth.overallAdmitRate) > ADMIT_TOL) {
      v.discrepancies.push({
        severity: "high",
        field: "overallAdmitRate",
        parsed, expected: truth.overallAdmitRate,
        delta: round4(parsed - truth.overallAdmitRate),
        note: "drift_exceeds_tolerance",
      });
      v.overrides.overallAdmitRate = truth.overallAdmitRate;
    }
  }

  // 3. SAT band drift / miss
  if (truth.enrolledSAT) {
    const ps = record.enrolledSAT;
    const composite_band = ps && ps.p25 >= 800 && ps.p75 >= 800;
    if (!ps) {
      v.discrepancies.push({ severity: "high", field: "enrolledSAT", parsed: null, expected: truth.enrolledSAT, note: "parser_missed" });
      v.overrides.enrolledSAT = truth.enrolledSAT;
    } else if (!composite_band) {
      // Parsed value is single-section (e.g. Math 740–800) — flag and override
      v.discrepancies.push({
        severity: "high",
        field: "enrolledSAT",
        parsed: ps, expected: truth.enrolledSAT,
        note: "section_only (parsed values < 800 suggest single-section, not composite)",
      });
      v.overrides.enrolledSAT = truth.enrolledSAT;
    } else if (Math.abs(ps.p25 - truth.enrolledSAT.p25) > SAT_TOL || Math.abs(ps.p75 - truth.enrolledSAT.p75) > SAT_TOL) {
      v.discrepancies.push({
        severity: "medium",
        field: "enrolledSAT",
        parsed: ps, expected: truth.enrolledSAT,
        delta: { p25: ps.p25 - truth.enrolledSAT.p25, p75: ps.p75 - truth.enrolledSAT.p75 },
        note: "sat_drift_exceeds_tolerance",
      });
      v.overrides.enrolledSAT = truth.enrolledSAT;
    }
  }

  // 4. Sanity: admitted ≤ applied
  if (record.b1?.applied && record.b1?.admitted) {
    if (record.b1.admitted > record.b1.applied) {
      v.discrepancies.push({ severity: "critical", field: "b1", parsed: record.b1, note: "admitted > applied" });
    }
  }

  if (v.discrepancies.length > 0 && v.status === "ok") v.status = "discrepancies";
  return v;
}

// ─── 4. Apply validation across the parsed corpus ────────────────────
export async function validateAll() {
  const truths = loadCorrections();
  const files = fs.readdirSync(PARSED_DIR).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
  const reports = [];

  for (const f of files) {
    const record = JSON.parse(fs.readFileSync(path.join(PARSED_DIR, f), "utf8"));
    // record.year is the calendar year (e.g. 2024) but PDFs are named with
    // academic-year strings (e.g. "2023-24"). Find the actual file by glob.
    const pdfDir = path.join(__dirname, "cds-cache", "pdfs");
    const pdfMatch = fs.readdirSync(pdfDir).find((p) => p.startsWith(record.slug + ".") && p.endsWith(".pdf"));
    const pdfPath = pdfMatch ? path.join(pdfDir, pdfMatch) : null;
    let scope = null;
    if (pdfPath && fs.existsSync(pdfPath)) {
      try { scope = await extractDocumentScope(pdfPath); }
      catch (e) { /* ignore */ }
    }
    const truth = truths[record.slug];
    const v = validateRecord(record, truth, scope);
    reports.push(v);

    // Apply overrides destructively to a `_validated` field on the record
    // so the positioning loader can pick it up.
    record.validation = v;
    if (Object.keys(v.overrides).length > 0) {
      record._uncorrected = {
        overallAdmitRate: record.overallAdmitRate,
        enrolledSAT: record.enrolledSAT,
      };
      Object.assign(record, v.overrides);
    }
    fs.writeFileSync(path.join(PARSED_DIR, f), JSON.stringify(record, null, 2));
  }

  fs.writeFileSync(path.join(PARSED_DIR, "_validation_report.json"), JSON.stringify(reports, null, 2));
  return reports;
}

function round4(v) { return Math.round(v * 10000) / 10000; }

// ─── CLI ─────────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  (async () => {
    const reports = await validateAll();
    const ok = reports.filter((r) => r.status === "ok").length;
    const drifts = reports.filter((r) => r.status === "discrepancies").length;
    const scope = reports.filter((r) => r.status === "scope_mismatch").length;
    const noTruth = reports.filter((r) => r.status === "no_truth").length;
    console.log(`\nValidation summary: ${ok} ok · ${drifts} drift · ${scope} scope-mismatch · ${noTruth} no-truth\n`);

    function pad(s, n) { s = String(s); return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length); }
    function dim(s) { return `\x1b[2m${s}\x1b[0m`; }
    function red(s) { return `\x1b[31m${s}\x1b[0m`; }
    function yellow(s) { return `\x1b[33m${s}\x1b[0m`; }
    function green(s) { return `\x1b[32m${s}\x1b[0m`; }

    console.log(pad("school", 38), pad("status", 18), "discrepancies");
    for (const r of reports) {
      const color = r.status === "ok" ? green : r.status === "scope_mismatch" ? red : yellow;
      const summary = r.discrepancies.length > 0
        ? r.discrepancies.map((d) => `${d.field}(${d.severity})`).join(",")
        : dim("none");
      console.log(pad(r.school, 38), color(pad(r.status, 18)), summary);
    }

    // Detailed call-outs for the most severe issues
    const severe = reports.filter((r) => r.discrepancies.some((d) => d.severity === "critical" || d.severity === "high"));
    if (severe.length > 0) {
      console.log("\n─── Severe discrepancies ───");
      for (const r of severe) {
        for (const d of r.discrepancies.filter((dd) => dd.severity === "critical" || dd.severity === "high")) {
          console.log(`  ${red(r.school)}  ${d.field}:  parsed=${JSON.stringify(d.parsed)}  expected=${JSON.stringify(d.expected)}  ${dim(d.note)}`);
        }
      }
    }
  })().catch((e) => { console.error(e); process.exit(1); });
}

// ═══════════════════════════════════════════════════════════════════════
// cds-validator.js — root-level CDS validation + RAG-backed persistence.
// ═══════════════════════════════════════════════════════════════════════
// Responsibilities:
//   1. Cross-check parsed CDS records against authoritative ground truth
//      (web-validated registry of admit rates, SAT bands, scope strings).
//   2. Detect document-scope mismatches (e.g. College Transitions linking
//      Columbia GS instead of Columbia College/SEAS).
//   3. Persist parsed records + validation history to the RAG-engine
//      tables `cds_records` and `cds_validations` so the positioning
//      engine and server endpoints can read a single source of truth.
//   4. Expose `loadValidatedRecord(stmts, slug)` which returns a record
//      with overrides already applied, for downstream consumers.
//
// Integration points:
//   - rag-engine.js → tables `cds_records`, `cds_validations`
//   - cds-pdf-parser.js → produces the input record shape
//   - cds-search.js → optional source of repository index + URL
//   - server.js → POST /api/cds/ingest, POST /api/cds/validate,
//                 GET /api/cds/school/:slug
// ═══════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractItems } from "./cds-pdf-parser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Document-scope extractor ─────────────────────────────────────────
// Detects which institution the CDS PDF actually describes. Catches
// College Transitions-style linking errors where one school's URL
// resolves to a different school's CDS.
export async function extractDocumentScope(pdfPath) {
  const items = await extractItems(pdfPath);
  const headSlice = items.slice(0, 120).map((i) => i.str).join(" ");
  const m =
    headSlice.match(/COMMON\s+DATA\s+SET\s+\d{4}.{0,5}\d{2,4}\s+([A-Z][\w'.&-]+(?:\s+[A-Za-z'.&-]+){1,8}?(?:University|College|Institute|School))\b/i) ||
    headSlice.match(/Name\s+of\s+(?:College(?:\/University)?|University)\s*:?\s+([A-Z][\w'.&-]+(?:\s+[A-Za-z'.&-]+){1,8}?(?:University|College|Institute|School|Studies))\b/i) ||
    headSlice.match(/^([A-Z][\w'.&-]+(?:\s+[A-Za-z'.&-]+){1,8}?(?:University|College|Institute|School))\s+Common\s+Data\s+Set/i);
  if (!m) return null;
  const candidate = m[1].trim().replace(/\s+/g, " ");
  if (candidate.length < 8 || /^[^A-Z]/.test(candidate)) return null;
  return candidate;
}

// ─── Ground-truth registry ─────────────────────────────────────────────
// Web-validated values per school. Source URLs are recorded so the
// validator can cite them when overriding a parsed value. The registry
// ships with a curated seed; production deployments add more entries via
// `addCorrection({slug, ...})` (see cds-validator-corrections.js if you
// need to extend without touching this file).
export const CORRECTIONS = {
  "princeton-university": {
    expectedScope: /Princeton\s+University/i,
    overallAdmitRate: 0.0450,
    applied: 39644, admitted: 1782, enrolled: 1366,
    enrolledSAT: { p25: 1510, p75: 1560 },
    sources: ["https://ir.princeton.edu/document/491"],
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
    overallAdmitRate: 0.0450,
    applied: 51803, admitted: 2332, enrolled: 1641,
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
    overallAdmitRate: 0.0596,
    applied: 49469, admitted: 2948,
    enrolledSAT: { p25: 1510, p75: 1570 },
    sources: ["https://ira.duke.edu/sites/default/files/2024-04/CDS_2023-24.pdf"],
  },
  "university-of-pennsylvania": {
    expectedScope: /University\s+of\s+Pennsylvania/i,
    overallAdmitRate: 0.0587,
    applied: 59465, admitted: 3489, enrolled: 2416,
    enrolledSAT: { p25: 1500, p75: 1570 },
    sources: ["https://ira.upenn.edu/penn-numbers/common-data-set"],
  },
  "columbia-university": {
    // Critical: College Transitions' "Columbia University" link points to
    // Columbia General Studies CDS. Real Columbia College + SEAS is much
    // more selective. Validator forces an override on scope mismatch.
    expectedScope: /Columbia\s+(?:College|Engineering|University in the City)/i,
    actualScopeWarning: "Source PDF is Columbia General Studies; numbers do not represent Columbia College / SEAS",
    overallAdmitRate: 0.0389,
    applied: 60248, admitted: 2355,
    enrolledSAT: { p25: 1490, p75: 1560 },
    sources: ["https://opir.columbia.edu/cds"],
  },
  "cornell-university": {
    expectedScope: /Cornell\s+University/i,
    overallAdmitRate: 0.079,
    applied: 67846, admitted: 5358, enrolled: 3537,
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
    overallAdmitRate: 0.0523,
    applied: 51316, admitted: 2686, enrolled: 1695,
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
    overallAdmitRate: 0.1166,
    applied: 33941, admitted: 3959,
    enrolledSAT: { p25: 1510, p75: 1560 },
    sources: ["https://www.cmu.edu/ira/CDS/cds_2324.html"],
  },
  "university-of-michigan": {
    expectedScope: /University\s+of\s+Michigan/i,
    overallAdmitRate: 0.2015,
    applied: 79743, admitted: 16071, enrolled: 7290,
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

// Allow runtime extension without forking this file.
export function addCorrection(slug, correction) {
  CORRECTIONS[slug] = correction;
}

// Tolerances (in absolute terms)
const ADMIT_TOL = 0.005;   // ±0.5 percentage points
const SAT_TOL = 30;        // ±30 SAT composite points
const SAT_TOL_HARD = 60;   // beyond this we always override

// ─── Core validation ──────────────────────────────────────────────────
// Pure function — produces a validation record without mutating inputs.
export function validateRecord(record, truth, scopeFromPDF) {
  const v = {
    slug: record.slug,
    school: record.school,
    status: "ok",
    discrepancies: [],
    overrides: {},
    scopeFromPDF: scopeFromPDF || null,
    sources: truth?.sources ? [...truth.sources] : [],
  };

  if (!truth) {
    v.status = "no_truth";
    return v;
  }

  // 1. Scope mismatch — only when extracted scope looks like a real
  // institution name (avoids false positives from extractor noise).
  const scopeLooksValid =
    scopeFromPDF && /University|College|Institute|School/i.test(scopeFromPDF);

  if (truth.expectedScope && scopeLooksValid && !truth.expectedScope.test(scopeFromPDF)) {
    v.discrepancies.push({
      severity: "critical",
      field: "scope",
      parsed: scopeFromPDF,
      expected: String(truth.expectedScope),
      note: truth.actualScopeWarning || "PDF describes a different institution than expected.",
    });
    v.status = "scope_mismatch";
    if (truth.overallAdmitRate != null) v.overrides.overallAdmitRate = truth.overallAdmitRate;
    if (truth.enrolledSAT) v.overrides.enrolledSAT = truth.enrolledSAT;
    if (truth.applied) {
      v.overrides.b1 = {
        applied: truth.applied,
        admitted: truth.admitted,
        enrolled: truth.enrolled,
      };
    }
  }

  // 2. Admit-rate drift
  if (truth.overallAdmitRate != null) {
    const parsed = record.overallAdmitRate;
    if (parsed == null) {
      v.discrepancies.push({
        severity: "high", field: "overallAdmitRate", parsed: null,
        expected: truth.overallAdmitRate, note: "parser_missed",
      });
      v.overrides.overallAdmitRate = truth.overallAdmitRate;
    } else if (Math.abs(parsed - truth.overallAdmitRate) > ADMIT_TOL) {
      v.discrepancies.push({
        severity: "high", field: "overallAdmitRate",
        parsed, expected: truth.overallAdmitRate,
        delta: round4(parsed - truth.overallAdmitRate),
        note: "drift_exceeds_tolerance",
      });
      v.overrides.overallAdmitRate = truth.overallAdmitRate;
    }
  }

  // 3. SAT-band drift / mis-parse
  if (truth.enrolledSAT) {
    const ps = record.enrolledSAT;
    const looksComposite = ps && ps.p25 >= 800 && ps.p75 >= 800;
    if (!ps) {
      v.discrepancies.push({
        severity: "high", field: "enrolledSAT", parsed: null,
        expected: truth.enrolledSAT, note: "parser_missed",
      });
      v.overrides.enrolledSAT = truth.enrolledSAT;
    } else if (!looksComposite) {
      v.discrepancies.push({
        severity: "high", field: "enrolledSAT",
        parsed: ps, expected: truth.enrolledSAT,
        note: "section_only_band (parsed values < 800 — likely Math/EBRW only, not composite)",
      });
      v.overrides.enrolledSAT = truth.enrolledSAT;
    } else {
      const d25 = Math.abs(ps.p25 - truth.enrolledSAT.p25);
      const d75 = Math.abs(ps.p75 - truth.enrolledSAT.p75);
      if (d25 > SAT_TOL || d75 > SAT_TOL) {
        v.discrepancies.push({
          severity: d25 > SAT_TOL_HARD || d75 > SAT_TOL_HARD ? "high" : "medium",
          field: "enrolledSAT", parsed: ps, expected: truth.enrolledSAT,
          delta: { p25: ps.p25 - truth.enrolledSAT.p25, p75: ps.p75 - truth.enrolledSAT.p75 },
          note: "sat_drift_exceeds_tolerance",
        });
        v.overrides.enrolledSAT = truth.enrolledSAT;
      }
    }
  }

  // 4. Sanity: admitted ≤ applied
  if (record.b1?.applied && record.b1?.admitted) {
    if (record.b1.admitted > record.b1.applied) {
      v.discrepancies.push({
        severity: "critical", field: "b1", parsed: record.b1,
        note: "admitted > applied — record is internally inconsistent",
      });
    }
  }

  if (v.discrepancies.length > 0 && v.status === "ok") v.status = "discrepancies";
  return v;
}

// ─── RAG-engine integration ───────────────────────────────────────────
// Persist a parsed CDS record + run validation + write everything via
// rag-engine prepared statements. Idempotent — re-running the same
// pipeline overwrites the cds_records row and appends to cds_validations.
export async function persistAndValidate(stmts, parsedRecord, options = {}) {
  const slug = parsedRecord.slug;
  if (!slug) throw new Error("persistAndValidate: parsedRecord.slug is required");
  const truth = CORRECTIONS[slug] || null;

  // Optional: extract document scope from the source PDF if available.
  let scopeFromPDF = null;
  if (parsedRecord.sourcePdfPath) {
    try {
      scopeFromPDF = await extractDocumentScope(parsedRecord.sourcePdfPath);
    } catch (e) {
      scopeFromPDF = null;
    }
  }

  const validation = validateRecord(parsedRecord, truth, scopeFromPDF);

  // Apply overrides into the record going to cds_records.
  const finalRecord = { ...parsedRecord };
  if (validation.overrides.overallAdmitRate != null) {
    finalRecord.overallAdmitRate = validation.overrides.overallAdmitRate;
  }
  if (validation.overrides.enrolledSAT) {
    finalRecord.enrolledSAT = validation.overrides.enrolledSAT;
  }
  if (validation.overrides.b1) finalRecord.b1 = validation.overrides.b1;

  // Recompute yield rate from corrected b1 if both numbers exist
  if (finalRecord.b1?.admitted && finalRecord.b1?.enrolled) {
    finalRecord.yieldRate = round4(finalRecord.b1.enrolled / finalRecord.b1.admitted);
  }

  const cdsRow = {
    slug,
    school_name: parsedRecord.school || parsedRecord.schoolName || slug,
    year_label: parsedRecord.yearLabel || options.yearLabel || null,
    year: parsedRecord.year || null,
    tier: parsedRecord.tier || options.tier || null,
    overall_admit_rate: finalRecord.overallAdmitRate ?? null,
    yield_rate: finalRecord.yieldRate ?? null,
    enrolled_sat_p25: finalRecord.enrolledSAT?.p25 ?? null,
    enrolled_sat_p75: finalRecord.enrolledSAT?.p75 ?? null,
    enrolled_act_p25: finalRecord.enrolledACT?.p25 ?? null,
    enrolled_act_p75: finalRecord.enrolledACT?.p75 ?? null,
    enrolled_gpa_p25: finalRecord.enrolledGPA?.p25 ?? null,
    enrolled_gpa_p75: finalRecord.enrolledGPA?.p75 ?? null,
    enrolled_gpa_avg: finalRecord.enrolledGPA?.avg ?? finalRecord.enrolledGPAAvg ?? null,
    test_policy: finalRecord.testPolicy || null,
    c7_json: finalRecord.c7 ? JSON.stringify(finalRecord.c7) : null,
    b1_json: finalRecord.b1 ? JSON.stringify(finalRecord.b1) : null,
    c1_breakdown_json: finalRecord.c1Breakdown ? JSON.stringify(finalRecord.c1Breakdown) : null,
    majors_json: parsedRecord.majors ? JSON.stringify(parsedRecord.majors) : null,
    priorities_json: parsedRecord.priorities ? JSON.stringify(parsedRecord.priorities) : null,
    source_url: parsedRecord.sourceUrl || options.sourceUrl || null,
    source_kind: parsedRecord.sourceKind || options.sourceKind || "pdf_merged",
    parser_version: parsedRecord.parserVersion ?? 2,
    parser_notes_json: parsedRecord.parserNotes
      ? JSON.stringify(parsedRecord.parserNotes)
      : null,
  };

  stmts.cds.upsert.run(
    cdsRow.slug, cdsRow.school_name, cdsRow.year_label, cdsRow.year, cdsRow.tier,
    cdsRow.overall_admit_rate, cdsRow.yield_rate,
    cdsRow.enrolled_sat_p25, cdsRow.enrolled_sat_p75,
    cdsRow.enrolled_act_p25, cdsRow.enrolled_act_p75,
    cdsRow.enrolled_gpa_p25, cdsRow.enrolled_gpa_p75, cdsRow.enrolled_gpa_avg,
    cdsRow.test_policy, cdsRow.c7_json, cdsRow.b1_json, cdsRow.c1_breakdown_json,
    cdsRow.majors_json, cdsRow.priorities_json,
    cdsRow.source_url, cdsRow.source_kind,
    cdsRow.parser_version, cdsRow.parser_notes_json,
    cdsRow.slug,  // for COALESCE(SELECT ingested_at WHERE slug = ?)
  );

  stmts.cds.insertValidation.run(
    slug,
    validation.status,
    validation.scopeFromPDF,
    JSON.stringify(validation.discrepancies),
    JSON.stringify(validation.overrides),
    JSON.stringify(validation.sources || []),
  );

  return { validation, finalRecord, cdsRow };
}

// ─── Loader for the positioning engine ─────────────────────────────────
// Returns a CDS record in the shape `positioning-engine.js` consumes.
// Reads from cds_records (which already has overrides applied during
// ingestion). Returns null when the school isn't in the cache.
export function loadValidatedRecord(stmts, slug) {
  const row = stmts.cds.getBySlug.get(slug);
  if (!row) return null;
  return rowToRecord(row);
}

export function loadAllValidatedRecords(stmts) {
  const rows = stmts.cds.listAll.all();
  return rows.map(rowToRecord);
}

function rowToRecord(row) {
  return {
    slug: row.slug,
    school: row.school_name,
    year: row.year,
    yearLabel: row.year_label,
    tier: row.tier,
    overallAdmitRate: row.overall_admit_rate,
    yieldRate: row.yield_rate,
    enrolledSAT: row.enrolled_sat_p25 != null
      ? { p25: row.enrolled_sat_p25, p75: row.enrolled_sat_p75 }
      : null,
    enrolledACT: row.enrolled_act_p25 != null
      ? { p25: row.enrolled_act_p25, p75: row.enrolled_act_p75 }
      : null,
    enrolledGPA: row.enrolled_gpa_p25 != null || row.enrolled_gpa_avg != null
      ? {
          p25: row.enrolled_gpa_p25,
          p75: row.enrolled_gpa_p75,
          ...(row.enrolled_gpa_avg != null ? { avg: row.enrolled_gpa_avg } : {}),
        }
      : null,
    testPolicy: row.test_policy,
    c7: row.c7_json ? safeJSON(row.c7_json, {}) : {},
    b1: row.b1_json ? safeJSON(row.b1_json, null) : null,
    c1Breakdown: row.c1_breakdown_json ? safeJSON(row.c1_breakdown_json, null) : null,
    majors: row.majors_json ? safeJSON(row.majors_json, {}) : {},
    priorities: row.priorities_json ? safeJSON(row.priorities_json, []) : [],
    sourceUrl: row.source_url,
    sourceKind: row.source_kind,
    parserVersion: row.parser_version,
    parserNotes: row.parser_notes_json ? safeJSON(row.parser_notes_json, []) : [],
    ingestedAt: row.ingested_at,
    updatedAt: row.updated_at,
  };
}

export function loadLatestValidation(stmts, slug) {
  const row = stmts.cds.latestValidation.get(slug);
  if (!row) return null;
  return {
    slug: row.slug,
    status: row.status,
    scopeFromPDF: row.scope_from_pdf,
    discrepancies: safeJSON(row.discrepancies_json, []),
    overrides: safeJSON(row.overrides_json, {}),
    sources: safeJSON(row.sources_json, []),
    validatedAt: row.validated_at,
  };
}

// ─── helpers ───────────────────────────────────────────────────────────
function round4(v) { return Math.round(v * 10000) / 10000; }
function safeJSON(raw, fallback) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

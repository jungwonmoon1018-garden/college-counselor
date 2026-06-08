// ═══════════════════════════════════════════════════════════════════════
// cds-form-fields.js — extracts CDS data from PDF AcroForm fields.
// ═══════════════════════════════════════════════════════════════════════
// Many universities (Cornell, UMich, GT, UWisc, others) submit CDS PDFs
// with the standardized PDF form template — the data is stored as form
// field values rather than rendered text. pdfjs.getTextContent() misses
// these; we have to walk getAnnotations() and decode the field schema.
//
// The CDS PDF template is published by Annual Survey of Colleges /
// CollegeBoard. Field names are consistent across schools that use it:
//   AP_RECD_1ST_{MEN,WMN,NON_BINARY,UNK}_N      applied (C1)
//   AP_ADMT_1ST_{MEN,WMN,NON_BINARY,UNK}_N      admitted (C1)
//   EN_FRSH_{FT,PT}_{MEN,WMN}_N                 enrolled (C1)
//   SAT1_COMP_{25TH,50TH,75TH}_P                 SAT composite percentile (C9)
//   ACT_COMP_{25TH,50TH,75TH}_P                  ACT composite percentile (C9)
//   Q111_1 .. Q111_6                             C7 academic factors
//   Q112_1 .. Q112_13                            C7 nonacademic factors
//   AD_TEST_POLICY_T                             test policy text
//   SAT1_PLACE / ACT_PLACE                       test required radios
//   FRSH_GPA_*_P                                  C12 GPA distribution
// ═══════════════════════════════════════════════════════════════════════

import fs from "fs";
const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

const C7_FIELD_MAP = {
  // academic — Q111
  Q111_1: "rigor",
  Q111_2: "class_rank",
  Q111_3: "gpa",
  Q111_4: "test_scores",
  Q111_5: "application_essay",
  Q111_6: "recommendations",
  // nonacademic — Q112
  Q112_1: "interview",
  Q112_2: "ec",
  Q112_3: "talent_ability",
  Q112_4: "character",
  Q112_5: "first_generation",
  Q112_6: "alumni_relation",
  Q112_7: "geographical_residence",
  Q112_8: "state_residency",
  Q112_9: "religious_affiliation",
  Q112_10: "racial_ethnic_status",
  Q112_11: "volunteer_work",
  Q112_12: "work_experience",
  Q112_13: "level_of_interest",
};

const C7_VALUE_MAP = {
  VI: "very_important",
  I: "important",
  C: "considered",
  NC: "not_considered",
};

export async function extractFormFields(pdfPath) {
  const buf = new Uint8Array(fs.readFileSync(pdfPath));
  const pdf = await pdfjsLib.getDocument({ data: buf, useSystemFonts: false, isEvalSupported: false, disableFontFace: true }).promise;
  const fields = {};
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const annots = await page.getAnnotations();
    for (const a of annots) {
      if (a.subtype !== "Widget" || !a.fieldName) continue;
      // For radio groups, every option carries the same fieldName but the
      // fieldValue is the selected option's export value. We collapse to
      // one entry per fieldName, taking the first non-null value seen.
      const key = a.fieldName;
      const v = a.fieldValue;
      if (v == null || v === "" || v === "Off") continue;
      // Some fields appear multiple times (one per page repeat) — keep the
      // first non-empty value.
      if (fields[key] == null) fields[key] = v;
    }
  }
  await pdf.destroy();
  return fields;
}

// Build a CDS-shaped record from form fields. Returns null on a field
// pattern that isn't filled in (e.g. test-rendered CDS) so the caller
// can fall back to positional parsing.
export function buildCDSFromFormFields(fields) {
  const out = { source: "cds_form", parserVersion: 1 };
  let any = false;

  // ─ B1 / C1 counts ─
  const apFields = ["AP_RECD_1ST_MEN_N", "AP_RECD_1ST_WMN_N", "AP_RECD_1ST_NON_BINARY_N", "AP_RECD_1ST_UNK_N"];
  const adFields = ["AP_ADMT_1ST_MEN_N", "AP_ADMT_1ST_WMN_N", "AP_ADMT_1ST_NON_BINARY_N", "AP_ADMT_1ST_UNK_N"];
  // Enrolled: schools differ. Try the first-time freshman fields.
  const enFields = [
    "EN_FRSH_FT_MEN_N", "EN_FRSH_FT_WMN_N",
    "EN_FRSH_PT_MEN_N", "EN_FRSH_PT_WMN_N",
    "EN_FRSH_FT_NON_BINARY_N", "EN_FRSH_PT_NON_BINARY_N",
    "EN_FRSH_FT_UNK_N", "EN_FRSH_PT_UNK_N",
    // alternate naming used by some schools
    "EN_TOT_1ST_FT_MEN_N", "EN_TOT_1ST_FT_WMN_N",
    "EN_TOT_1ST_PT_MEN_N", "EN_TOT_1ST_PT_WMN_N",
  ];

  const sumF = (arr) => arr.reduce((s, k) => s + (Number((fields[k] || "").toString().replace(/,/g, "")) || 0), 0);
  const applied = sumF(apFields);
  const admitted = sumF(adFields);
  const enrolledFresh = sumF(["EN_FRSH_FT_MEN_N", "EN_FRSH_FT_WMN_N", "EN_FRSH_PT_MEN_N", "EN_FRSH_PT_WMN_N", "EN_FRSH_FT_NON_BINARY_N", "EN_FRSH_PT_NON_BINARY_N"]);
  const enrolledTot1st = sumF(["EN_TOT_1ST_FT_MEN_N", "EN_TOT_1ST_FT_WMN_N", "EN_TOT_1ST_PT_MEN_N", "EN_TOT_1ST_PT_WMN_N"]);
  // EN_TOT_1ST_FT_MEN_N occasionally aliases to overall enrollment counts — sanity-check
  // by ensuring enrolled <= admitted.
  let enrolled = enrolledFresh > 0 ? enrolledFresh : enrolledTot1st;
  if (admitted && enrolled && enrolled > admitted) enrolled = enrolledFresh;

  if (applied > 0 && admitted > 0) {
    out.b1 = { applied, admitted };
    if (enrolled > 0 && enrolled <= admitted) out.b1.enrolled = enrolled;
    out.overallAdmitRate = round4(admitted / applied);
    if (out.b1.enrolled) out.yieldRate = round4(out.b1.enrolled / admitted);
    any = true;
  }

  // ─ C9 SAT / ACT bands ─
  const sat25 = Number(fields["SAT1_COMP_25TH_P"]);
  const sat75 = Number(fields["SAT1_COMP_75TH_P"]);
  if (!isNaN(sat25) && !isNaN(sat75) && sat25 > 0 && sat75 > 0) {
    out.enrolledSAT = { p25: sat25, p75: sat75 };
    any = true;
  } else {
    // Fall back to EBRW + Math
    const v25 = Number(fields["SAT1_VERB_25TH_P"]);
    const v75 = Number(fields["SAT1_VERB_75TH_P"]);
    const m25 = Number(fields["SAT1_MATH_25TH_P"]);
    const m75 = Number(fields["SAT1_MATH_75TH_P"]);
    if (v25 && v75 && m25 && m75) {
      out.enrolledSAT = { p25: v25 + m25, p75: v75 + m75 };
      any = true;
    }
  }
  const act25 = Number(fields["ACT_COMP_25TH_P"]);
  const act75 = Number(fields["ACT_COMP_75TH_P"]);
  if (!isNaN(act25) && !isNaN(act75) && act25 > 0 && act75 > 0) {
    out.enrolledACT = { p25: act25, p75: act75 };
    any = true;
  }

  // ─ C12 GPA distribution → p25/p75 ─
  const gpa = extractGPAFromFormFields(fields);
  if (gpa) { out.enrolledGPA = gpa; any = true; }

  // ─ C7 ratings ─
  const c7 = {};
  let c7Any = false;
  for (const [field, factor] of Object.entries(C7_FIELD_MAP)) {
    const v = fields[field];
    if (v && C7_VALUE_MAP[v]) {
      c7[factor] = C7_VALUE_MAP[v];
      c7Any = true;
    }
  }
  if (c7Any) { out.c7 = c7; any = true; }

  // ─ Test policy ─
  // SAT1_PLACE / ACT_PLACE radios encode position; AD_TEST_POLICY_T is text.
  const policy = inferTestPolicyFromForm(fields);
  if (policy) { out.testPolicy = policy; any = true; }

  return any ? out : null;
}

function extractGPAFromFormFields(fields) {
  // Common CDS template fields:
  //   FRSH_GPA_4_P     → 4.00
  //   FRSH_GPA_375_P   → 3.75-3.99
  //   FRSH_GPA_350_P   → 3.50-3.74
  //   FRSH_GPA_325_P   → 3.25-3.49
  //   FRSH_GPA_300_P   → 3.00-3.24
  //   FRSH_GPA_250_P   → 2.50-2.99
  //   FRSH_GPA_200_P   → 2.00-2.49
  const map = [
    ["FRSH_GPA_4_P", 4.00],
    ["FRSH_GPA_375_P", 3.75],
    ["FRSH_GPA_350_P", 3.50],
    ["FRSH_GPA_325_P", 3.25],
    ["FRSH_GPA_300_P", 3.00],
    ["FRSH_GPA_250_P", 2.50],
    ["FRSH_GPA_200_P", 2.00],
  ];
  const distrib = [];
  for (const [key, lower] of map) {
    const v = Number(fields[key]);
    if (!isNaN(v) && v > 0) distrib.push({ lower, pct: v });
  }
  if (distrib.length < 3) return null;
  distrib.sort((a, b) => b.lower - a.lower);
  let cum = 0, p75 = null, p25 = null;
  for (const r of distrib) {
    cum += r.pct;
    if (p75 == null && cum >= 25) p75 = r.lower;
    if (p25 == null && cum >= 75) p25 = r.lower;
  }
  if (p25 == null && p75 != null) p25 = Math.max(0, p75 - 0.4);
  if (p75 == null) return null;
  return { p25, p75, source: "C12_form" };
}

function inferTestPolicyFromForm(fields) {
  // The C8A test policy is encoded in radio fields named like SAT1_PLACE,
  // ACT_PLACE, etc. Each radio's fieldValue (when checked) is one of:
  //   "REQUIRED" / "REQUIRED_FOR_SOME" / "RECOMMENDED"
  //   "NREQ_CONSIDERED" (test optional) / "NCONSIDERED" (test blind)
  //
  // Different schools use different exact value codes. We check the most
  // common ones across multiple PDFs, plus a free-text fallback in
  // AD_TEST_POLICY_T.
  const candidates = ["SAT1_PLACE", "ACT_PLACE", "AD_TEST_POLICY_T"];
  for (const c of candidates) {
    const v = String(fields[c] || "").toUpperCase();
    if (!v) continue;
    if (/NCONSIDER|TEST.?BLIND|NEVER/.test(v)) return "test_blind";
    if (/NREQ|OPTION|CONSIDERED|RECOMMENDED/.test(v)) return "test_optional";
    if (/REQUIRED/.test(v)) return "test_required";
  }
  return null;
}

function round4(v) { return Math.round(v * 10000) / 10000; }

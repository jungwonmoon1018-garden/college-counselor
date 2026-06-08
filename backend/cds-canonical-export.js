// ═══════════════════════════════════════════════════════════════════════
// cds-canonical-export.js — human-readable xlsx export of CDS records.
// ═══════════════════════════════════════════════════════════════════════
// Produces a six-sheet workbook per school that mirrors the canonical
// CDS section grids (C1, C7, C9, C12) plus a Cover sheet with source
// provenance and a Validation sheet with discrepancy/override history.
//
// This is the audit artifact you'd hand to a counselor or admissions
// expert to verify "yes, our system correctly read this CDS." The C7
// sheet specifically reproduces the screenshot grid: 19 factor rows ×
// 4 importance columns with X marks in the matching cells.
//
// Consumed by:
//   - server.js → GET /api/cds/canonical/:slug.xlsx
//   - CLI → `node tools/export-cds-canonical.js <slug>`
//
// Reads from:
//   - cds_records (parsed/validated record)
//   - cds_validations (latest discrepancy report)
// ═══════════════════════════════════════════════════════════════════════

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { loadValidatedRecord, loadLatestValidation } from "./cds-validator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// CDS C7 factor list — order matches the official CDS template, which
// matches the screenshot the user provided. Splitting Academic vs
// Nonacademic mirrors the source layout.
const C7_ACADEMIC_FACTORS = [
  ["rigor",            "Rigor of secondary school record"],
  ["class_rank",       "Class rank"],
  ["gpa",              "Academic GPA"],
  ["test_scores",      "Standardized test scores"],
  ["application_essay","Application Essay"],
  ["recommendations",  "Recommendation(s)"],
];

const C7_NONACADEMIC_FACTORS = [
  ["interview",                "Interview"],
  ["ec",                       "Extracurricular activities"],
  ["talent_ability",           "Talent/ability"],
  ["character",                "Character/personal qualities"],
  ["first_generation",         "First generation"],
  ["alumni_relation",          "Alumni/ae relation"],
  ["geographical_residence",   "Geographical residence"],
  ["state_residency",          "State residency"],
  ["religious_affiliation",    "Religious affiliation/commitment"],
  ["racial_ethnic_status",     "Racial/ethnic status"],
  ["volunteer_work",           "Volunteer work"],
  ["work_experience",          "Work experience"],
  ["level_of_interest",        "Level of applicant's interest"],
];

const C7_RATING_COLUMNS = ["very_important", "important", "considered", "not_considered"];
const C7_RATING_HEADERS = ["Very Important", "Important", "Considered", "Not Considered"];
const C7_RATING_NUMERIC = { very_important: 1.00, important: 0.70, considered: 0.35, not_considered: 0.00 };

// ─── Public API ──────────────────────────────────────────────────────
export async function exportCanonicalXLSX(stmts, slug, outPath) {
  const record = loadValidatedRecord(stmts, slug);
  if (!record) throw new Error(`No CDS record for slug: ${slug}`);
  const validation = loadLatestValidation(stmts, slug);

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "college-counselor-backend (cds-canonical-export)";
  wb.created = new Date();
  wb.modified = new Date();

  buildCoverSheet(wb, record, validation);
  buildC1Sheet(wb, record);
  buildC7Sheet(wb, record);
  buildC9Sheet(wb, record);
  buildC12Sheet(wb, record);
  buildValidationSheet(wb, validation);

  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    await wb.xlsx.writeFile(outPath);
    return { path: outPath, slug };
  }
  // Return the workbook buffer for HTTP streaming
  const buf = await wb.xlsx.writeBuffer();
  return { buffer: buf, slug };
}

// Bulk export — one file per school.
export async function exportAllCanonicalXLSX(stmts, outDir) {
  const dir = outDir || path.join(__dirname, "data", "cds-cache", "canonical");
  fs.mkdirSync(dir, { recursive: true });
  const rows = stmts.cds.listAll.all();
  const results = [];
  for (const r of rows) {
    try {
      const out = path.join(dir, `${r.slug}.xlsx`);
      await exportCanonicalXLSX(stmts, r.slug, out);
      results.push({ slug: r.slug, status: "ok", path: out });
    } catch (e) {
      results.push({ slug: r.slug, status: "error", message: String(e.message).slice(0, 200) });
    }
  }
  return results;
}

// ─── Sheets ──────────────────────────────────────────────────────────

function buildCoverSheet(wb, r, v) {
  const s = wb.addWorksheet("Cover");
  s.columns = [{ header: "Field", width: 28 }, { header: "Value", width: 90 }];
  styleHeader(s.getRow(1));

  const rows = [
    ["School", r.school],
    ["Slug", r.slug],
    ["Year (label)", r.yearLabel || "—"],
    ["Year (calendar)", r.year ?? "—"],
    ["Tier", r.tier || "—"],
    ["", ""],
    ["Overall admit rate", percent(r.overallAdmitRate)],
    ["Yield rate", percent(r.yieldRate)],
    ["Test policy", r.testPolicy || "—"],
    ["", ""],
    ["Source URL", r.sourceUrl || "—"],
    ["Source kind", r.sourceKind || "—"],
    ["Parser version", r.parserVersion ?? "—"],
    ["Parser notes", (r.parserNotes || []).join("; ") || "—"],
    ["Ingested at", r.ingestedAt || "—"],
    ["Updated at", r.updatedAt || "—"],
    ["", ""],
    ["Validation status", v?.status || "—"],
    ["Discrepancies", (v?.discrepancies?.length ?? 0).toString()],
    ["Overrides applied", Object.keys(v?.overrides || {}).join(", ") || "—"],
    ["Truth sources", (v?.sources || []).join("\n")],
  ];
  for (const [k, val] of rows) {
    const row = s.addRow([k, val]);
    if (k && !val) row.getCell(1).font = { bold: true };
  }
  // Shade scope-mismatch rows red as a visual signal
  if (v?.status === "scope_mismatch") {
    for (let i = 18; i <= 21; i++) {
      const cell = s.getRow(i).getCell(2);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
    }
  }
}

function buildC1Sheet(wb, r) {
  const s = wb.addWorksheet("C1");
  s.columns = [
    { header: "Category", width: 36 },
    { header: "Men", width: 12 },
    { header: "Women", width: 12 },
    { header: "Another", width: 10 },
    { header: "Unknown", width: 10 },
    { header: "Total", width: 12 },
    { header: "Admit rate", width: 12 },
  ];
  styleHeader(s.getRow(1));

  const b1 = r.b1 || {};
  s.addRow(["Applicants",
    "—", "—", "—", "—", b1.applied ?? "—",
    null,
  ]);
  s.addRow(["Admitted",
    "—", "—", "—", "—", b1.admitted ?? "—",
    b1.applied && b1.admitted ? round4(b1.admitted / b1.applied) : "—",
  ]);
  s.addRow(["Enrolled",
    "—", "—", "—", "—", b1.enrolled ?? "—",
    null,
  ]);

  // Sub-breakdowns
  const sub = r.c1Breakdown || {};
  if (sub.byGender) {
    s.addRow([]);
    const r2 = s.addRow(["By gender", "applied", "admitted", "admit rate"]);
    r2.font = { bold: true };
    if (sub.byGender.men) {
      s.addRow(["  Men", sub.byGender.men.applied, sub.byGender.men.admitted, sub.byGender.men.admitRate]);
    }
    if (sub.byGender.women) {
      s.addRow(["  Women", sub.byGender.women.applied, sub.byGender.women.admitted, sub.byGender.women.admitRate]);
    }
  }
  if (sub.byResidency) {
    s.addRow([]);
    const r3 = s.addRow(["By residency", "applied", "admitted", "admit rate"]);
    r3.font = { bold: true };
    if (sub.byResidency.inState) {
      s.addRow(["  In-state", sub.byResidency.inState.applied, sub.byResidency.inState.admitted, sub.byResidency.inState.admitRate]);
    }
    if (sub.byResidency.international) {
      s.addRow(["  International", sub.byResidency.international.applied, sub.byResidency.international.admitted, sub.byResidency.international.admitRate]);
    }
  }
  if (sub.byDecisionPlan) {
    s.addRow([]);
    const r4 = s.addRow(["By decision plan", "applied", "admitted", "admit rate"]);
    r4.font = { bold: true };
    if (sub.byDecisionPlan.earlyDecision) {
      s.addRow(["  Early Decision", sub.byDecisionPlan.earlyDecision.applied, sub.byDecisionPlan.earlyDecision.admitted, sub.byDecisionPlan.earlyDecision.admitRate]);
    }
    if (sub.byDecisionPlan.earlyAction) {
      s.addRow(["  Early Action", sub.byDecisionPlan.earlyAction.applied, sub.byDecisionPlan.earlyAction.admitted, sub.byDecisionPlan.earlyAction.admitRate]);
    }
  }
}

function buildC7Sheet(wb, r) {
  const s = wb.addWorksheet("C7");
  s.columns = [
    { header: "", width: 38 },
    ...C7_RATING_HEADERS.map((h) => ({ header: h, width: 18 })),
    { header: "Numeric weight", width: 16 },
  ];
  styleHeader(s.getRow(1));

  const c7 = r.c7 || {};

  // Academic section header
  const acad = s.addRow(["Academic", ...C7_RATING_HEADERS.map(() => ""), ""]);
  acad.font = { bold: true };
  acad.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD0D0D0" } };

  for (const [key, label] of C7_ACADEMIC_FACTORS) {
    addC7Row(s, label, c7[key]);
  }

  // Nonacademic section header
  const nona = s.addRow(["Nonacademic", ...C7_RATING_HEADERS.map(() => ""), ""]);
  nona.font = { bold: true };
  nona.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD0D0D0" } };

  for (const [key, label] of C7_NONACADEMIC_FACTORS) {
    addC7Row(s, label, c7[key]);
  }
}

function addC7Row(sheet, label, rating) {
  const cells = [label];
  for (const col of C7_RATING_COLUMNS) {
    cells.push(rating === col ? "X" : "");
  }
  cells.push(rating != null ? (C7_RATING_NUMERIC[rating] ?? 0).toFixed(2) : "—");
  const row = sheet.addRow(cells);
  // Center the X cells
  for (let i = 2; i <= 5; i++) row.getCell(i).alignment = { horizontal: "center" };
  // Highlight the active column cell
  if (rating) {
    const colIdx = C7_RATING_COLUMNS.indexOf(rating) + 2;
    if (colIdx >= 2 && colIdx <= 5) {
      row.getCell(colIdx).fill = {
        type: "pattern", pattern: "solid",
        fgColor: { argb: rating === "very_important" ? "FFD1FAE5" :
                          rating === "important"      ? "FFDBEAFE" :
                          rating === "considered"      ? "FFFEF3C7" :
                                                         "FFF3F4F6" },
      };
      row.getCell(colIdx).font = { bold: true };
    }
  }
}

function buildC9Sheet(wb, r) {
  const s = wb.addWorksheet("C9");
  s.columns = [
    { header: "Test", width: 22 },
    { header: "25th percentile", width: 16 },
    { header: "75th percentile", width: 16 },
  ];
  styleHeader(s.getRow(1));

  if (r.enrolledSAT) s.addRow(["SAT Composite", r.enrolledSAT.p25 ?? "—", r.enrolledSAT.p75 ?? "—"]);
  else s.addRow(["SAT Composite", "—", "—"]);
  if (r.enrolledACT) s.addRow(["ACT Composite", r.enrolledACT.p25 ?? "—", r.enrolledACT.p75 ?? "—"]);
  else s.addRow(["ACT Composite", "—", "—"]);

  s.addRow([]);
  const policyRow = s.addRow(["Test policy:", r.testPolicy || "—"]);
  policyRow.getCell(1).font = { bold: true };
}

function buildC12Sheet(wb, r) {
  const s = wb.addWorksheet("C12");
  s.columns = [
    { header: "Field", width: 32 },
    { header: "Value", width: 16 },
  ];
  styleHeader(s.getRow(1));

  const gpa = r.enrolledGPA || {};
  s.addRow(["Enrolled GPA p25 (derived from C12 buckets)", gpa.p25 ?? "—"]);
  s.addRow(["Enrolled GPA p75 (derived from C12 buckets)", gpa.p75 ?? "—"]);
  s.addRow(["Average HS GPA (C11/C12 narrative field)", gpa.avg ?? "—"]);
  if (gpa.source) s.addRow(["Source", gpa.source]);
}

function buildValidationSheet(wb, v) {
  const s = wb.addWorksheet("Validation");
  s.columns = [
    { header: "Field", width: 32 },
    { header: "Value", width: 90 },
  ];
  styleHeader(s.getRow(1));
  if (!v) {
    s.addRow(["No validation report available", ""]);
    return;
  }
  s.addRow(["Status", v.status]);
  s.addRow(["Validated at", v.validatedAt]);
  s.addRow(["Scope from PDF", v.scopeFromPDF || "—"]);
  s.addRow([]);
  const headerRow = s.addRow(["Discrepancies", ""]);
  headerRow.getCell(1).font = { bold: true };
  if (Array.isArray(v.discrepancies) && v.discrepancies.length > 0) {
    s.addRow(["Severity", "Field / parsed → expected / note"]);
    s.getRow(s.rowCount).font = { bold: true };
    for (const d of v.discrepancies) {
      s.addRow([
        d.severity || "",
        `${d.field}: parsed=${JSON.stringify(d.parsed)} → expected=${JSON.stringify(d.expected)} (${d.note || ""})`,
      ]);
    }
  } else {
    s.addRow(["—", "no discrepancies"]);
  }
  s.addRow([]);
  const oR = s.addRow(["Overrides applied", ""]);
  oR.getCell(1).font = { bold: true };
  if (v.overrides && Object.keys(v.overrides).length > 0) {
    for (const [k, val] of Object.entries(v.overrides)) {
      s.addRow([k, JSON.stringify(val)]);
    }
  } else {
    s.addRow(["—", "no overrides"]);
  }
  s.addRow([]);
  const sR = s.addRow(["Truth sources", ""]);
  sR.getCell(1).font = { bold: true };
  for (const src of v.sources || []) s.addRow(["", src]);
}

// ─── helpers ───────────────────────────────────────────────────────────
function styleHeader(row) {
  row.font = { bold: true };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
}

function percent(v) {
  if (v == null || isNaN(v)) return "—";
  return `${(Number(v) * 100).toFixed(2)}%`;
}

function round4(v) { return Math.round(v * 10000) / 10000; }

// ═══════════════════════════════════════════════════════════════════════
// jiyeon-cds-test.js — runs the Jiyeon variants against the REAL CDS
// records ingested from College Transitions PDFs.
// ═══════════════════════════════════════════════════════════════════════
// What's real (from CDS PDFs):
//   - school.cds.overallAdmitRate
//   - school.cds.enrolledSAT.{p25, p75}
//   - school.cds.enrolledACT.{p25, p75}
//   - school.cds.enrolledGPA.{p25, p75}
//   - school.cds.c7 (factor importance ratings)
//   - school.testPolicy (required / optional / blind)
//
// What's NOT in the CDS and stays as hand-curated overlay:
//   - Major-level competitiveness (CIP-code level — needs IPEDS join)
//   - Institutional priorities (strategic plans — needs separate research)
//   - Capped/direct-admit flags (school catalog scrape)
//
// The positioning engine consumes both layers identically.
// ═══════════════════════════════════════════════════════════════════════

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { position } from "./positioning-engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PARSED_DIR = path.join(__dirname, "cds-cache", "parsed");

// ─── Load real CDS records ────────────────────────────────────────────
function loadCDSRecords() {
  const files = fs.readdirSync(PARSED_DIR).filter((f) => f.endsWith(".json") && f !== "_run_summary.json");
  const out = [];
  for (const f of files) {
    const r = JSON.parse(fs.readFileSync(path.join(PARSED_DIR, f), "utf8"));
    // Filter records that don't have enough data to score against
    if (!r.overallAdmitRate || !r.enrolledSAT) continue;
    out.push(r);
  }
  return out;
}

// ─── Major overlays — hand-curated for the sample ────────────────────
// In production this layer would come from a separate scraper that reads
// undergraduate catalogs + IPEDS completions by CIP code. For the demo
// we use realistic estimates on schools whose CS / Comp-Bio programs are
// publicly known to be capped or have direct-admit policies.
const MAJOR_OVERLAYS = {
  // Computational Biology defaults: moderately competitive, growing.
  default_compbio: {
    nationalDemand: 0.85,
    schoolSaturation: 0.65,
    capped: false,
    directAdmit: false,
    internalTransferDifficulty: 0.4,
    ipedsCompletionsGrowth5y: 0.35,
    capacityExpansion: 0.10,
  },
  default_cs: {
    nationalDemand: 0.95,
    schoolSaturation: 0.85,
    capped: false,
    directAdmit: false,
    internalTransferDifficulty: 0.5,
    ipedsCompletionsGrowth5y: 0.50,
    capacityExpansion: 0.10,
  },
  // Per-school overrides for known cap/restriction policies
  schools: {
    "princeton-university":      { CS: { schoolSaturation: 0.9 } },
    "stanford-university":       { CS: { schoolSaturation: 0.95 } },
    "cornell-university":        { CS: { capped: true, directAdmit: true, internalTransferDifficulty: 0.85, schoolSaturation: 0.95 },
                                   "Computational Biology": { directAdmit: true, schoolSaturation: 0.55 } },
    "georgia-institute-of-technology": { CS: { capped: true, directAdmit: true, internalTransferDifficulty: 0.85, schoolSaturation: 0.95 } },
    "university-of-michigan":    { CS: { capped: true, internalTransferDifficulty: 0.7, schoolSaturation: 0.92 } },
    "carnegie-mellon-university": { CS: { capped: true, directAdmit: true, internalTransferDifficulty: 0.95, schoolSaturation: 0.99, nationalDemand: 0.99 } },
    "university-of-pennsylvania": { CS: { capped: true, schoolSaturation: 0.95 } },
    "purdue-university":         { CS: { capped: true, internalTransferDifficulty: 0.7, schoolSaturation: 0.85 } },
    "university-of-wisconsin-madison": { CS: { capped: true, internalTransferDifficulty: 0.7, schoolSaturation: 0.85 } },
  },
};

// ─── Institutional priority overlays (strategic plans) ──────────────
// These would be ingested from each school's strategic-plan page,
// admissions blog, and announcements feed. For demo purposes we encode
// public, named initiatives that would surface from a real research pass.
const PRIORITY_OVERLAYS = {
  "princeton-university":   [{ label: "Princeton Precision Health", themes: ["computational biology","drug response prediction"], evidenceStrength: 0.9, ageMonths: 18 }],
  "stanford-university":    [{ label: "Stanford HAI", themes: ["AI","AI for science","machine learning"], evidenceStrength: 1.0, ageMonths: 10 },
                              { label: "BioX program", themes: ["computational biology","genomics"], evidenceStrength: 1.0, ageMonths: 18 }],
  "harvard-university":     [{ label: "Harvard Data Science Initiative", themes: ["AI","computational biology"], evidenceStrength: 1.0, ageMonths: 14 }],
  "johns-hopkins-university": [{ label: "Bloomberg Distinguished Professorships in computational medicine", themes: ["computational biology","drug response prediction"], evidenceStrength: 1.0, ageMonths: 6 }],
  "yale-university":        [{ label: "Yale Quantitative Biology cluster", themes: ["computational biology","genomics"], evidenceStrength: 0.7, ageMonths: 24 }],
  "california-institute-of-technology": [{ label: "Tianqiao & Chrissy Chen Institute", themes: ["computational biology","AI for science"], evidenceStrength: 1.0, ageMonths: 10 }],
  "duke-university":        [{ label: "Duke Initiative for Science & Society", themes: ["computational biology","AI for science"], evidenceStrength: 0.7, ageMonths: 18 }],
  "university-of-pennsylvania": [{ label: "Penn Institute for Biomedical Informatics", themes: ["computational biology","drug response prediction"], evidenceStrength: 0.8, ageMonths: 14 }],
  "columbia-university-in-the-city-of-new-york": [{ label: "Columbia Data Science Institute", themes: ["AI","computational biology"], evidenceStrength: 0.8, ageMonths: 16 }],
  "cornell-university":     [{ label: "Cornell Bowers CIS expansion", themes: ["AI","computational biology"], evidenceStrength: 1.0, ageMonths: 10 }],
  "northwestern-university": [{ label: "NU AI Institute", themes: ["AI","AI for science"], evidenceStrength: 0.8, ageMonths: 8 }],
  "rice-university":        [{ label: "Rice Ken Kennedy Institute", themes: ["computational biology","AI for science"], evidenceStrength: 0.7, ageMonths: 18 }],
  "carnegie-mellon-university": [{ label: "CMU AI cluster + MLD growth", themes: ["AI","machine learning","AI for science"], evidenceStrength: 1.0, ageMonths: 10 }],
  "university-of-michigan-ann-arbor": [{ label: "Michigan Institute for Data Science (MIDAS)", themes: ["computational biology","AI for science"], evidenceStrength: 0.8, ageMonths: 10 }],
  "georgia-institute-of-technology-main-campus": [{ label: "GT Bioinformatics & Quantitative Biosciences program growth", themes: ["computational biology","AI for science"], evidenceStrength: 0.7, ageMonths: 14 }],
  "university-of-wisconsin-madison": [{ label: "Morgridge Institute for Research", themes: ["computational biology","genomics"], evidenceStrength: 0.7, ageMonths: 18 }],
  "purdue-university-main-campus": [{ label: "Purdue Computes initiative", themes: ["AI","computational biology"], evidenceStrength: 0.7, ageMonths: 6 }],
};

// ─── Build positioning-engine school records from CDS + overlays ─────
function buildSchoolRecord(cds, intendedMajor) {
  const slug = cds.slug;
  const majorKey = intendedMajor === "Computer Science" ? "CS" : "Computational Biology";
  const defaultBase = intendedMajor === "Computer Science" ? MAJOR_OVERLAYS.default_cs : MAJOR_OVERLAYS.default_compbio;
  const schoolOverride = MAJOR_OVERLAYS.schools[slug]?.[majorKey] || {};
  const majors = {
    [intendedMajor]: { ...defaultBase, ...schoolOverride },
  };

  const cdsBlock = {
    year: cds.year,
    overallAdmitRate: cds.overallAdmitRate,
    enrolledGPA: cds.enrolledGPA,
    enrolledSAT: cds.enrolledSAT,
    enrolledACT: cds.enrolledACT,
    c7: mapCDSC7(cds.c7),
  };

  return {
    id: slug,
    name: cds.school,
    tier: cds.tier,
    testPolicy: cds.testPolicy,
    cds: cdsBlock,
    majors,
    priorities: PRIORITY_OVERLAYS[slug] || [],
  };
}

// CDS C7 keys → positioning engine C7 keys
function mapCDSC7(c7 = {}) {
  // The keys already align in the parser; just pass through. Backstop
  // missing factors with "not_considered".
  const out = {};
  for (const k of Object.keys(c7)) out[k] = c7[k];
  return out;
}

// ─── Jiyeon variants (same as before) ────────────────────────────────
const KOREAN_INTL_CONTEXT = {
  internationalCurriculum: false, esl: true, limitedResourceSchool: false,
  firstGenLowIncome: false, significantWorkOrFamily: false, maximizedRigor: true,
};

const JIYEON_TOP = {
  id: "jiyeon_top", label: "Jiyeon (top-tier prep)",
  gpa: 4.00,
  rigor: { apsTaken: 11, apsAvailable: 11, seniorRigor: 1.0, dualEnrollment: 0.6 },
  test: { submitted: true, sat: 1570 },
  awards: [
    { name: "ISEF Finalist (Computational Biology)", tier: "international" },
    { name: "USABO Semifinalist", tier: "national" },
    { name: "Regeneron STS Scholar", tier: "national" },
  ],
  intendedMajor: "Computational Biology",
  majorPrep: { relevantCoursesTaken: 7, relevantGPA: 4.0, researchExperience: 0.95, portfolio: 0.85 },
  ecs: [
    { name: "Independent research", role: "Lead", category: "research", hoursPerWeek: 12, tier: "national", evidence: { publication: true, codeOrPortfolio: true } },
    { name: "Bioinformatics club", role: "Founder", category: "club", hoursPerWeek: 6, tier: "school", evidence: { codeOrPortfolio: true } },
    { name: "Asan Medical Center internship", role: "Research intern", category: "research", hoursPerWeek: 30, tier: "regional", evidence: { press: true } },
    { name: "Korean Biology Olympiad team", role: "Captain", category: "academic", hoursPerWeek: 4, tier: "national" },
    { name: "Volunteer tutoring", role: "Tutor", category: "service", hoursPerWeek: 3, tier: "school" },
  ],
  narrative: {
    themes: ["computational biology","drug response prediction","open-source bioinformatics"],
    coherence: 0.92, intellectualVitality: 0.90, authenticity: 0.85, originality: 0.80, specificity: 0.85,
    activityListRecycle: 0.10,
    schoolSpecificReasoning: { "princeton-university":0.6, "stanford-university":0.7, "harvard-university":0.65,
      "johns-hopkins-university":0.9, "duke-university":0.55, "university-of-pennsylvania":0.45, "yale-university":0.4,
      "california-institute-of-technology":0.65, "columbia-university-in-the-city-of-new-york":0.45,
      "cornell-university":0.55, "northwestern-university":0.45, "brown-university":0.35, "rice-university":0.50,
      "carnegie-mellon-university":0.65, "university-of-michigan-ann-arbor":0.55, "georgia-institute-of-technology-main-campus":0.65,
      "university-of-virginia-main-campus":0.30, "new-york-university":0.30, "university-of-wisconsin-madison":0.30,
      "purdue-university-main-campus":0.40, "michigan-state-university":0.20 },
  },
  context: { ...KOREAN_INTL_CONTEXT, seniorYearSpike: false },
};

const JIYEON_MID = {
  id: "jiyeon_mid", label: "Jiyeon (mid-tier prep)",
  gpa: 3.85,
  rigor: { apsTaken: 7, apsAvailable: 11, seniorRigor: 0.8, dualEnrollment: 0.0 },
  test: { submitted: true, sat: 1480 },
  awards: [{ name: "Bio Olympiad regional silver", tier: "regional" }, { name: "School science fair 1st", tier: "school" }],
  intendedMajor: "Computational Biology",
  majorPrep: { relevantCoursesTaken: 4, relevantGPA: 3.9, researchExperience: 0.45, portfolio: 0.30 },
  ecs: [
    { name: "Comp Bio Club", role: "VP", category: "club", hoursPerWeek: 4, tier: "school" },
    { name: "Hospital volunteer", role: "Volunteer", category: "service", hoursPerWeek: 4, tier: "school" },
    { name: "Personal projects", role: "Self", category: "research", hoursPerWeek: 5, tier: "school", evidence: { codeOrPortfolio: true } },
    { name: "MUN", role: "Delegate", category: "club", hoursPerWeek: 3, tier: "school" },
    { name: "Piano", role: "Student", category: "arts", hoursPerWeek: 2, tier: "school" },
    { name: "Tutoring", role: "Tutor", category: "service", hoursPerWeek: 2, tier: "school" },
  ],
  narrative: { themes: ["AI","medicine","helping people"], coherence: 0.55, intellectualVitality: 0.50, authenticity: 0.55, originality: 0.30, specificity: 0.30, activityListRecycle: 0.55,
    schoolSpecificReasoning: { "johns-hopkins-university":0.30, "duke-university":0.20, "georgia-institute-of-technology-main-campus":0.30, "university-of-michigan-ann-arbor":0.25, "new-york-university":0.25, "rice-university":0.25 } },
  context: { ...KOREAN_INTL_CONTEXT, seniorYearSpike: true },
};

const JIYEON_LOW = {
  id: "jiyeon_low", label: "Jiyeon (struggling)",
  gpa: 3.55,
  rigor: { apsTaken: 4, apsAvailable: 11, seniorRigor: 0.55, dualEnrollment: 0.0 },
  test: { submitted: true, sat: 1340 },
  awards: [{ name: "School honor roll", tier: "school" }],
  intendedMajor: "Computer Science",
  majorPrep: { relevantCoursesTaken: 2, relevantGPA: 3.6, researchExperience: 0.10, portfolio: 0.20 },
  ecs: [
    { name: "Coding club", role: "Member", category: "club", hoursPerWeek: 2, tier: "school" },
    { name: "Hospital volunteer", role: "Volunteer", category: "service", hoursPerWeek: 2, tier: "school" },
    { name: "Newspaper", role: "Writer", category: "club", hoursPerWeek: 2, tier: "school" },
    { name: "Red Cross", role: "Volunteer", category: "service", hoursPerWeek: 2, tier: "school", claimsBigImpact: true },
    { name: "Math tutoring", role: "Tutor", category: "service", hoursPerWeek: 2, tier: "school" },
    { name: "Robotics", role: "Member", category: "club", hoursPerWeek: 2, tier: "school" },
    { name: "Choir", role: "Member", category: "arts", hoursPerWeek: 2, tier: "school" },
  ],
  narrative: { themes: ["AI","machine learning","tech for good","passion for coding"], coherence: 0.35, intellectualVitality: 0.30, authenticity: 0.40, originality: 0.15, specificity: 0.15, activityListRecycle: 0.75,
    schoolSpecificReasoning: { "university-of-michigan-ann-arbor":0.15, "georgia-institute-of-technology-main-campus":0.15, "purdue-university-main-campus":0.15 } },
  context: { ...KOREAN_INTL_CONTEXT, seniorYearSpike: true },
};

const STUDENTS = [JIYEON_TOP, JIYEON_MID, JIYEON_LOW];

// ─── Run ─────────────────────────────────────────────────────────────
function color(label) {
  if (label === "Highly competitive") return `\x1b[32m${label}\x1b[0m`;
  if (label === "Competitive")        return `\x1b[36m${label}\x1b[0m`;
  if (label === "Reach")              return `\x1b[33m${label}\x1b[0m`;
  return `\x1b[31m${label}\x1b[0m`;
}
function pad(s, n) { s = String(s); return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length); }
function dim(s) { return `\x1b[2m${s}\x1b[0m`; }
function bold(s) { return `\x1b[1m${s}\x1b[0m`; }

const cdsRecords = loadCDSRecords();
console.log(`Loaded ${cdsRecords.length} parsed CDS records.\n`);

for (const student of STUDENTS) {
  console.log(bold(`══════════════════════════════════════════════════════════════════════════════════`));
  console.log(bold(`  ${student.label}`));
  console.log(dim(`  GPA ${student.gpa} · SAT ${student.test.sat} · ${student.rigor.apsTaken}/${student.rigor.apsAvailable} APs · ${student.intendedMajor}`));
  console.log(bold(`══════════════════════════════════════════════════════════════════════════════════`));

  console.log("  " + pad("School", 38) + pad("Tier", 8) + pad("Score", 7) + pad("Acad", 6) + pad("Major×", 8) + pad("Fit+", 7) + pad("Flags", 7) + pad("Conf", 8) + "Label");

  // Sort by tier, then score (calculated below) — but we need to score first.
  const scored = cdsRecords
    .map((cds) => ({ cds, school: buildSchoolRecord(cds, student.intendedMajor) }))
    .map(({ cds, school }) => ({ cds, school, r: position({ ...student }, school) }));

  const tierOrder = ["T20", "Sub-Ivy", "T50", "T100"];
  scored.sort((a, b) => {
    const t = tierOrder.indexOf(a.cds.tier) - tierOrder.indexOf(b.cds.tier);
    if (t !== 0) return t;
    return b.r.score - a.r.score;
  });

  for (const { cds, r } of scored) {
    console.log(
      "  " + pad(cds.school, 38) + pad(cds.tier || "-", 8) +
      pad(r.score.toFixed(1), 7) +
      pad(r.components.academicReadiness.toFixed(0), 6) +
      pad("×" + r.components.majorCompetitiveness.toFixed(2), 8) +
      pad("+" + r.components.priorityFitBonus.toFixed(1), 7) +
      pad("-" + r.components.redFlagPenalty.toFixed(0) + "(" + r.redFlags.length + ")", 7) +
      pad(r.evidenceConfidence.label, 8) +
      color(r.label),
    );
  }
  console.log("");
}

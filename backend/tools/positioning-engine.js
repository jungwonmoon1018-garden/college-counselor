// ═══════════════════════════════════════════════════════════════════════
// positioning-engine.js — dynamic college-application positioning model
// ═══════════════════════════════════════════════════════════════════════
// Implements the layered scoring described in the design spec:
//
//   Final Positioning Score =
//       Academic Readiness Score
//     × Institutional Selectivity Adjustment
//     × Major Competitiveness Adjustment
//     + Institutional Priority Fit Bonus
//     + Narrative Fit Bonus
//     + Contextual Achievement Bonus
//     - Red Flag Penalties
//
// The engine deliberately produces *labels* (Highly Competitive / Competitive
// / Reach / High Reach), not acceptance probabilities. The only time we
// quote a number is when the institution itself publishes the data
// (overall admit rate, enrolled SAT/GPA bands, school/major-level admit
// rates from a Common Data Set).
//
// Inputs are pure JSON so the engine is provider-agnostic and trivially
// testable. The fixtures in test-runner.js wire it up to Jiyeon variants
// and a synthetic CDS/IPEDS dataset.
// ═══════════════════════════════════════════════════════════════════════

// ─── 1. CDS C7 weight table ───
// Common Data Set C7 ratings → numeric weights. Schools that don't publish
// C7 (rare but happens at smaller LACs) fall back to a generic prior.
export const CDS_C7_WEIGHTS = {
  very_important: 1.00,
  important: 0.70,
  considered: 0.35,
  not_considered: 0.00,
};

// Generic fallback when a school's CDS is unavailable. We bias toward
// rigor/GPA because that's the modal weighting at selective US colleges.
const C7_FALLBACK = {
  rigor: "very_important",
  gpa: "very_important",
  test_scores: "considered",
  class_rank: "considered",
  application_essay: "important",
  recommendations: "important",
  ec: "important",
  talent_ability: "important",
  character: "important",
  first_generation: "considered",
  alumni_relation: "not_considered",
  geographical_residence: "not_considered",
  state_residency: "not_considered",
  religious_affiliation: "not_considered",
  racial_ethnic_status: "not_considered",
  volunteer_work: "considered",
  work_experience: "considered",
  level_of_interest: "not_considered",
};

function c7Weight(school, factor) {
  const c7 = school.cds?.c7 || C7_FALLBACK;
  const rating = c7[factor] || C7_FALLBACK[factor] || "not_considered";
  return CDS_C7_WEIGHTS[rating] ?? 0;
}

// ─── 2. Academic Readiness Score ───
// Scaled 0–100. GPA, rigor, test, awards, major-relevant prep — each
// re-weighted by the school's C7 priorities so a test-blind school
// genuinely ignores the 1480 SAT.
export function academicReadiness(student, school) {
  const wG = c7Weight(school, "gpa");
  const wR = c7Weight(school, "rigor");
  const wT = c7Weight(school, "test_scores");
  const wA = 0.35; // awards — not a C7 line, fixed prior
  const wM = 0.50; // major-relevant prep — fixed prior

  // Per-component sub-scores (each 0–100)
  const gpaSub = subscoreGPA(student.gpa, school);
  const rigorSub = subscoreRigor(student.rigor, school);
  const testSub = subscoreTest(student.test, school);
  const awardSub = subscoreAwards(student.awards);
  const majorPrepSub = subscoreMajorPrep(student.majorPrep, student.intendedMajor);

  // Test-optional / test-blind handling: scale wT to 0 if the school's
  // policy is "test_blind", and to a fraction of its CDS weight if
  // "test_optional" so submitting helps but isn't required.
  const testPolicyScale =
    school.testPolicy === "test_blind" ? 0 :
    school.testPolicy === "test_optional" ? 0.5 :
    1.0;
  const wTeff = wT * testPolicyScale;

  const totalW = wG + wR + wTeff + wA + wM;
  if (totalW === 0) return 0;

  const weighted =
    (gpaSub * wG) +
    (rigorSub * wR) +
    (testSub * wTeff) +
    (awardSub * wA) +
    (majorPrepSub * wM);

  return clamp(weighted / totalW, 0, 100);
}

function subscoreGPA(gpa, school) {
  // Compare student UW GPA to the school's published 25th–75th band.
  // Above 75th = 95+, mid = 75-ish, below 25th = ≤45.
  const p25 = school.cds?.enrolledGPA?.p25 ?? 3.7;
  const p75 = school.cds?.enrolledGPA?.p75 ?? 4.0;
  if (gpa >= p75) return 95 + Math.min(5, (gpa - p75) * 50);
  if (gpa <= p25) return Math.max(20, 45 - (p25 - gpa) * 60);
  // Linear within band, mapped to 60..95
  const t = (gpa - p25) / Math.max(0.001, p75 - p25);
  return 60 + t * 35;
}

function subscoreRigor(rigor, school) {
  // rigor.apsTaken / rigor.apsAvailable, plus senior-year rigor bonus.
  const ratio = rigor.apsAvailable > 0
    ? Math.min(1, rigor.apsTaken / rigor.apsAvailable)
    : 0;
  const utilization = ratio * 70;             // 0..70
  const seniorBonus = (rigor.seniorRigor || 0) * 15;  // 0..15 (0–1 scale)
  const dualBonus = (rigor.dualEnrollment || 0) * 8;  // 0..8
  const baseline = rigor.apsTaken >= 8 ? 7 : rigor.apsTaken >= 5 ? 4 : 0;
  return clamp(utilization + seniorBonus + dualBonus + baseline, 0, 100);
}

function subscoreTest(test, school) {
  if (!test || test.submitted === false) return 50;     // neutral
  const sat = test.sat ?? null;
  const act = test.act ?? null;
  const satP25 = school.cds?.enrolledSAT?.p25 ?? 1400;
  const satP75 = school.cds?.enrolledSAT?.p75 ?? 1530;
  const useSAT = sat != null;
  const score = useSAT ? sat : actToSAT(act);
  if (score == null) return 50;
  if (score >= satP75) return 95 + Math.min(5, (score - satP75) / 10);
  if (score <= satP25) return Math.max(20, 45 - (satP25 - score) / 10);
  const t = (score - satP25) / Math.max(1, satP75 - satP25);
  return 60 + t * 35;
}
function actToSAT(act) {
  // Concordance approximation
  if (act == null) return null;
  const map = { 36:1590, 35:1540, 34:1500, 33:1460, 32:1430, 31:1400, 30:1370, 29:1340, 28:1310, 27:1280, 26:1240, 25:1210, 24:1180 };
  return map[act] ?? 1100;
}

function subscoreAwards(awards = []) {
  // Tiered: international > national > regional > school
  const tierMap = { international: 35, national: 22, regional: 12, school: 5 };
  let total = 0;
  for (const a of awards) total += tierMap[a.tier] || 0;
  return clamp(total, 0, 100);
}

function subscoreMajorPrep(prep = {}, major = "") {
  // prep.relevantCoursesTaken (count), prep.relevantGPA (number),
  // prep.researchExperience (0–1), prep.portfolio (0–1)
  const courses = Math.min(1, (prep.relevantCoursesTaken || 0) / 6) * 30;
  const gpaBoost = prep.relevantGPA != null
    ? Math.min(1, Math.max(0, (prep.relevantGPA - 3.5) / 0.5)) * 25
    : 0;
  const research = (prep.researchExperience || 0) * 25;
  const portfolio = (prep.portfolio || 0) * 20;
  return clamp(courses + gpaBoost + research + portfolio, 0, 100);
}

// ─── 3. Major Competitiveness Adjustment ───
// Multiplicative factor in [0.55, 1.15]. <1.0 means the major is harder
// than the school's headline rate suggests; >1.0 means the major has
// excess capacity (rare but real — humanities at a STEM-heavy school).
export function majorCompetitiveness(student, school) {
  const major = student.intendedMajor;
  const m = school.majors?.[major] || school.majors?.default || {};

  const baseDemand = m.nationalDemand ?? 0.5;        // 0–1
  const schoolSaturation = m.schoolSaturation ?? 0.5; // 0–1
  const cappedPenalty = m.capped ? 0.15 : 0;
  const directAdmitPenalty = m.directAdmit ? 0.10 : 0;
  const transferDifficulty = m.internalTransferDifficulty ?? 0; // 0–1
  const cipGrowth = m.ipedsCompletionsGrowth5y ?? 0; // -0.5..+0.5
  const capacityExpansion = m.capacityExpansion ?? 0; // 0–0.3

  // Higher penalty = harder. Then convert to multiplier centered at 1.0.
  const penalty =
    baseDemand * 0.20 +
    schoolSaturation * 0.20 +
    cappedPenalty +
    directAdmitPenalty +
    transferDifficulty * 0.10 +
    Math.max(0, cipGrowth) * 0.10;

  const offset = capacityExpansion * 0.20;
  const raw = 1.0 - penalty + offset;
  return clamp(raw, 0.55, 1.15);
}

// ─── 4. Institutional Selectivity Adjustment ───
// Headline admit-rate driven multiplier in [0.45, 1.0].
export function selectivityAdjustment(school) {
  const r = school.cds?.overallAdmitRate ?? 0.30;
  // Map admit rate → multiplier. Ivy-tier 4% → 0.45; 50% → 0.95.
  const mult = 0.45 + Math.min(0.55, r * 1.10);
  return clamp(mult, 0.45, 1.0);
}

// ─── 5. Institutional Priority Fit Bonus ───
// Aligns the applicant's narrative themes with documented institutional
// strategic priorities (strategic plans, new institutes, faculty cluster
// hires, capital projects, undergrad catalog changes). Each priority has
// an evidence-strength score 0–1 (higher = more recent, more authoritative
// source) and a recency penalty if older than 24 months.
export function priorityFitBonus(student, school) {
  const studentThemes = new Set(student.narrative?.themes || []);
  const priorities = school.priorities || [];
  let bonus = 0;
  const matches = [];

  for (const p of priorities) {
    const overlap = (p.themes || []).filter((t) => studentThemes.has(t));
    if (overlap.length === 0) continue;
    const evidenceStrength = p.evidenceStrength ?? 0.5;
    const ageMonths = p.ageMonths ?? 12;
    const recency = ageMonths <= 12 ? 1.0 : ageMonths <= 24 ? 0.7 : ageMonths <= 36 ? 0.4 : 0.2;
    const contribution = overlap.length * evidenceStrength * recency * 4;
    bonus += contribution;
    matches.push({ priority: p.label, themes: overlap, contribution: round2(contribution) });
  }
  return { bonus: clamp(bonus, 0, 25), matches };
}

// ─── 6. Narrative Fit Bonus ───
// 0–15 from narrative coherence × intellectual vitality × school-specific
// evidence in the student's stated reasoning.
export function narrativeFitBonus(student, school) {
  const n = student.narrative || {};
  const coherence = n.coherence ?? 0.5;
  const vitality = n.intellectualVitality ?? 0.5;
  const schoolSpecific = (n.schoolSpecificReasoning?.[school.id] || 0); // 0–1
  const authenticity = n.authenticity ?? 0.5;
  const raw = (coherence * 0.30 + vitality * 0.25 + schoolSpecific * 0.30 + authenticity * 0.15) * 15;
  return clamp(raw, 0, 15);
}

// ─── 7. Contextual Achievement Bonus ───
// School competitiveness, opportunity access, first-gen, language, etc.
export function contextualBonus(student) {
  const c = student.context || {};
  let b = 0;
  // Used most of available rigor → up to +5
  if (c.maximizedRigor) b += 5;
  // Limited-resource school → +3 (if achievement is still strong)
  if (c.limitedResourceSchool) b += 3;
  // First-gen / low-income → +3 (only if school considers it; we leave that
  // to be applied by the caller. Here we always add and let the priority-fit
  // path zero it out if not relevant.)
  if (c.firstGenLowIncome) b += 3;
  // International curriculum (IB / A-Level full diploma) → +3
  if (c.internationalCurriculum) b += 3;
  // ESL navigating English-medium app → +2
  if (c.esl) b += 2;
  // Heavy family responsibility / work hours → +2
  if (c.significantWorkOrFamily) b += 2;
  return clamp(b, 0, 15);
}

// ─── 8. Red flag penalties ───
export function redFlags(student, school) {
  const flags = [];

  const major = student.intendedMajor || "";
  const prep = student.majorPrep || {};
  const ecs = student.ecs || [];
  const narrative = student.narrative || {};

  // 1. Weak major-relevant coursework despite ambitious major
  if ((prep.relevantCoursesTaken || 0) < 3 && /CS|computer|engineer|biolog|bioengineer|data|math/i.test(major)) {
    flags.push({ code: "weak_major_prep", penalty: 8, msg: "Few major-relevant courses for ambitious target major." });
  }

  // 2. Many shallow ECs (>5 with hours/wk < 3)
  const shallow = ecs.filter((e) => (e.hoursPerWeek || 0) < 3).length;
  if (shallow >= 5) {
    flags.push({ code: "shallow_ec_breadth", penalty: 5, msg: `${shallow} shallow activities — depth missing.` });
  }

  // 3. Generic narrative themes
  const themes = narrative.themes || [];
  const generic = themes.filter((t) => /\b(ai|machine learning|medicine|business|coding|tech)\b/i.test(t)).length;
  if (generic > 0 && (narrative.specificity ?? 0.5) < 0.4) {
    flags.push({ code: "generic_narrative", penalty: 6, msg: "Narrative leans on AI/medicine/business clichés without specificity." });
  }

  // 4. No school-specific reasoning
  if (!narrative.schoolSpecificReasoning?.[school.id]) {
    flags.push({ code: "no_school_specific", penalty: 4, msg: `No documented "why ${school.name}" reasoning.` });
  }

  // 5. Transcript-major mismatch (e.g. CS major, no math/CS courses)
  if (/CS|computer|data/i.test(major) && (prep.relevantCoursesTaken || 0) === 0) {
    flags.push({ code: "transcript_major_mismatch", penalty: 10, msg: "Transcript shows no major-aligned coursework." });
  }

  // 6. Unsupported claims (claimed leadership/awards without evidence)
  const unsupported = ecs.filter((e) => e.claimsBigImpact && !e.evidence).length;
  if (unsupported > 0) {
    flags.push({ code: "unsupported_claims", penalty: unsupported * 2, msg: `${unsupported} claim(s) lack evidence.` });
  }

  // 7. Sudden senior-year activity spike
  if (student.context?.seniorYearSpike) {
    flags.push({ code: "senior_spike", penalty: 5, msg: "Senior-year EC spike reads as application-driven." });
  }

  // 8. Capped major without preparation
  const m = school.majors?.[major];
  if (m?.capped && (prep.relevantCoursesTaken || 0) < 4) {
    flags.push({ code: "capped_no_prep", penalty: 7, msg: `${school.name} ${major} is capped/restricted; preparation insufficient.` });
  }

  // 9. Essays that recycle the activity list
  if ((narrative.activityListRecycle ?? 0) > 0.5) {
    flags.push({ code: "activity_recycle", penalty: 5, msg: "Essays recycle the activity list rather than reflect." });
  }

  const totalPenalty = flags.reduce((s, f) => s + f.penalty, 0);
  return { flags, totalPenalty: clamp(totalPenalty, 0, 35) };
}

// ─── 9. Differentiation strength ───
// 0–100 — how distinctive is this applicant relative to the school's
// modal admit. Driven by selectivity-of-EC, originality of theme, and
// rare evidence quality (publications, press, juried awards).
export function differentiationStrength(student) {
  const ecs = student.ecs || [];
  const narrative = student.narrative || {};
  let score = 0;
  for (const e of ecs) {
    if (e.tier === "international") score += 22;
    else if (e.tier === "national") score += 14;
    else if (e.tier === "regional") score += 7;
    else if (e.tier === "school") score += 2;
    if (e.evidence?.publication) score += 6;
    if (e.evidence?.press) score += 4;
    if (e.evidence?.codeOrPortfolio) score += 3;
  }
  score += (narrative.originality ?? 0.4) * 25;
  return clamp(score, 0, 100);
}

// ─── 10. Capacity-risk flag ───
// True when the school+major appears to be capacity-constrained AND the
// applicant is at-or-below median. Flagged in the output, not penalized
// directly (it already gets baked into majorCompetitiveness).
export function capacityRiskFlag(student, school) {
  const m = school.majors?.[student.intendedMajor];
  if (!m) return null;
  const constrained = m.capped || m.directAdmit || (m.schoolSaturation || 0) > 0.7;
  if (!constrained) return null;
  const gpaP25 = school.cds?.enrolledGPA?.p25 ?? 3.7;
  const atRisk = (student.gpa || 0) < gpaP25 + 0.05;
  return {
    constrained: true,
    capped: !!m.capped,
    directAdmit: !!m.directAdmit,
    saturation: m.schoolSaturation,
    atRisk,
  };
}

// ─── 11. Evidence Confidence ───
// Confidence in the *positioning output* itself — how much do we trust
// the inputs that fed it?
export function evidenceConfidence(student, school) {
  let s = 0;
  // Source quality of school data
  if (school.cds?.year >= 2024) s += 25;
  else if (school.cds?.year >= 2022) s += 18;
  else if (school.cds) s += 8;
  if (school.priorities?.length) s += 12;
  if (school.majors) s += 10;
  // Student data completeness
  if (student.gpa) s += 8;
  if (student.test?.submitted) s += 6;
  if (student.rigor?.apsAvailable) s += 6;
  if (student.majorPrep?.relevantCoursesTaken != null) s += 5;
  if (student.ecs?.length >= 3) s += 6;
  if (student.narrative?.themes?.length) s += 6;
  // Penalties
  if (student.unverifiedClaims) s -= 8;
  if (school.cds == null) s -= 12;

  s = clamp(s, 0, 100);
  const label =
    s >= 80 ? "High" :
    s >= 60 ? "Medium" :
    s >= 40 ? "Low" :
    "Very Low";
  return { score: s, label };
}

// ─── 12. The aggregator ───
export function position(student, school) {
  const academic = academicReadiness(student, school);
  const selAdj = selectivityAdjustment(school);
  const majorAdj = majorCompetitiveness(student, school);
  const fit = priorityFitBonus(student, school);
  const narrFit = narrativeFitBonus(student, school);
  const ctx = contextualBonus(student);
  const flags = redFlags(student, school);
  const diff = differentiationStrength(student);
  const capRisk = capacityRiskFlag(student, school);
  const conf = evidenceConfidence(student, school);

  const base = academic * selAdj * majorAdj;
  const score = clamp(base + fit.bonus + narrFit + ctx - flags.totalPenalty, 0, 100);

  // Output label is anchored to the *gap* between the score and the
  // school's selectivity floor. Highly competitive applicants sit
  // comfortably above; reach applicants are below.
  const overallAdmit = school.cds?.overallAdmitRate ?? 0.3;
  // Anchor = where the median admit would land. Selective schools push
  // the anchor upward because the median admit is themselves elite.
  const anchor =
    overallAdmit < 0.07 ? 75 :
    overallAdmit < 0.15 ? 67 :
    overallAdmit < 0.30 ? 60 :
    overallAdmit < 0.50 ? 53 :
    47;

  const gap = score - anchor;
  let label;
  if (gap >= 8) label = "Highly competitive";
  else if (gap >= 0) label = "Competitive";
  else if (gap >= -10) label = "Reach";
  else label = "High reach";

  // Strategy guidance follows from the dominant deficit.
  const strategy = strategyFor({ academic, majorAdj, fit, narrFit, flags, school, student, label });

  return {
    school: school.name,
    major: student.intendedMajor,
    label,
    score: round1(score),
    components: {
      academicReadiness: round1(academic),
      selectivityAdjustment: round2(selAdj),
      majorCompetitiveness: round2(majorAdj),
      priorityFitBonus: round1(fit.bonus),
      narrativeFitBonus: round1(narrFit),
      contextualBonus: round1(ctx),
      redFlagPenalty: round1(flags.totalPenalty),
      differentiation: round1(diff),
    },
    capacityRisk: capRisk,
    redFlags: flags.flags.map((f) => f.msg),
    priorityMatches: fit.matches,
    evidenceConfidence: conf,
    strategy,
  };
}

function strategyFor({ academic, majorAdj, fit, narrFit, flags, school, label }) {
  const tips = [];
  if (academic < 60) tips.push("Lift academic readiness — focus on senior-year rigor and major-relevant courses.");
  if (majorAdj < 0.85) tips.push(`Major is competitive at ${school.name}. Consider an alternative major or explicit transfer path.`);
  if (fit.bonus < 4) tips.push(`Add specific reasoning that ties to ${school.name}'s documented institutional priorities.`);
  if (narrFit < 6) tips.push("Strengthen narrative coherence and add a school-specific paragraph in the supplements.");
  if (flags.totalPenalty >= 10) tips.push("Address red flags before submission — they're collectively significant.");
  if (label === "High reach") tips.push("Treat as a stretch school in a balanced list with strong matches and likelies.");
  if (tips.length === 0) tips.push("Maintain the current trajectory; ensure supplements echo the strongest evidence.");
  return tips;
}

// ─── helpers ───
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function round1(v) { return Math.round(v * 10) / 10; }
function round2(v) { return Math.round(v * 100) / 100; }

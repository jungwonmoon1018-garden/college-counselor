import { clamp01, matchMajorBucket } from "./ec-vectorizer.js";

export const C7_RATING_VALUES = Object.freeze({
  very_important: 1,
  important: 0.7,
  considered: 0.35,
  not_considered: 0,
});

export const MAJOR_DEMAND_BASE = Object.freeze({
  computer_science: 0.92,
  data_science: 0.88,
  computational_biology: 0.82,
  biomedical_engineering: 0.8,
  engineering: 0.78,
  business: 0.74,
  economics: 0.7,
  biology: 0.69,
  neuroscience: 0.72,
  chemistry: 0.62,
  physics: 0.58,
  mathematics: 0.56,
  political_science: 0.55,
  international_relations: 0.57,
  public_policy: 0.6,
  journalism: 0.5,
  english: 0.48,
  music: 0.46,
  art: 0.45,
  theater: 0.44,
  education: 0.47,
  public_health: 0.66,
  environmental_science: 0.63,
});

// MVP proxy until full CIP-driven IPEDS ingest lands.
export const IPEDS_CIP_GROWTH_PROXY = Object.freeze({
  computer_science: 0.86,
  data_science: 0.84,
  computational_biology: 0.74,
  biomedical_engineering: 0.72,
  engineering: 0.7,
  business: 0.62,
  economics: 0.54,
  biology: 0.52,
  neuroscience: 0.64,
  chemistry: 0.42,
  physics: 0.38,
  mathematics: 0.4,
  public_health: 0.71,
  environmental_science: 0.6,
});

const MAJOR_KEYWORDS = Object.freeze({
  computer_science: ["computer science", "cs", "programming", "software", "data structures", "algorithms", "machine learning", "python", "java", "javascript", "ap computer science"],
  data_science: ["data science", "statistics", "data", "analytics", "ap statistics", "probability"],
  computational_biology: ["biology", "bioinformatics", "genomics", "computational", "biostatistics", "ap biology"],
  biomedical_engineering: ["engineering", "biomedical", "physics", "biology", "calculus"],
  engineering: ["engineering", "physics", "calculus", "mechanics", "robotics", "cad"],
  business: ["business", "economics", "finance", "accounting", "entrepreneurship", "deca", "fbla"],
  economics: ["economics", "microeconomics", "macroeconomics", "statistics", "finance"],
  biology: ["biology", "ap biology", "chemistry", "anatomy", "physiology"],
  chemistry: ["chemistry", "ap chemistry", "organic", "lab"],
  physics: ["physics", "ap physics", "mechanics", "electricity", "magnetism"],
  mathematics: ["math", "calculus", "statistics", "linear algebra", "number theory"],
  political_science: ["government", "politics", "ap government", "history", "debate"],
  international_relations: ["international", "government", "history", "foreign policy", "model un"],
  public_policy: ["policy", "government", "economics", "statistics", "debate"],
  journalism: ["journalism", "newspaper", "writing", "english"],
  english: ["english", "literature", "writing", "composition"],
  education: ["education", "teaching", "psychology", "child development"],
  public_health: ["public health", "biology", "statistics", "chemistry"],
  environmental_science: ["environmental", "biology", "chemistry", "geography"],
});

function round1(x) {
  return Math.round(Number(x || 0) * 10) / 10;
}

function round2(x) {
  return Math.round(Number(x || 0) * 100) / 100;
}

function avg(values) {
  const nums = (values || []).map(Number).filter((n) => Number.isFinite(n));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

// Maximum half-width (in score points) of the uncertainty band shown when
// evidence confidence is at its floor. At full confidence the band collapses
// to the point estimate; at zero confidence a displayed score spreads ±this.
const CONFIDENCE_BAND_MAX_HALFWIDTH = 18;

// Turn a point score + normalized evidence confidence (0..1) into an honest
// display band. Low evidence → wide band, so a thin-data "73" is shown as a
// range (e.g. 58–88) instead of a crisp number it does not deserve.
function confidenceBand(score, confidenceNormalized) {
  const s = Math.max(0, Math.min(100, Number(score) || 0));
  const c = clamp01(Number(confidenceNormalized ?? 0.5));
  const halfWidth = (1 - c) * CONFIDENCE_BAND_MAX_HALFWIDTH;
  return {
    point: round1(s),
    low: round1(Math.max(0, s - halfWidth)),
    high: round1(Math.min(100, s + halfWidth)),
    halfWidth: round1(halfWidth),
  };
}

function normalizePercentValue(value) {
  // Guard null/undefined/"" explicitly: Number(null) === 0, which would
  // otherwise read a school with an UNKNOWN admit rate as 0% (maximally
  // selective) and wrongly apply a selectivity boost. Unknown must stay null.
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n > 1 ? n / 100 : n;
}

function c7RatingValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const normalized = String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (normalized === "very_important" || normalized === "vi") return 1;
  if (normalized === "important" || normalized === "i") return 0.7;
  if (normalized === "considered" || normalized === "c") return 0.35;
  if (normalized === "not_considered" || normalized === "nc") return 0;
  return null;
}

function c7Value(c7, keys, fallback) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(c7 || {}, key)) {
      const value = c7RatingValue(c7[key]);
      if (value != null) return value;
    }
  }
  return fallback;
}

function safeJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; }
  catch { return fallback; }
}

function normalizeCourseName(course) {
  return String(course?.name || course?.title || course || "").toLowerCase();
}

function gradeToPoints(raw) {
  if (raw == null || raw === "") return null;
  const str = String(raw).trim().toUpperCase();
  if (/^\d+(\.\d+)?$/.test(str)) {
    const num = Number(str);
    if (num <= 4.5) return num;
    if (num >= 90) return 4;
    if (num >= 80) return 3;
    if (num >= 70) return 2;
    if (num >= 60) return 1;
    return 0;
  }
  if (str.startsWith("A")) return 4;
  if (str.startsWith("B")) return 3;
  if (str.startsWith("C")) return 2;
  if (str.startsWith("D")) return 1;
  if (str.startsWith("F")) return 0;
  return null;
}

function getMajorKeywords(major) {
  const bucket = matchMajorBucket(major || "");
  return { bucket, keywords: MAJOR_KEYWORDS[bucket] || [] };
}

export function buildStudentModel(snapshot, strengthRows = [], narrative = null, context = {}) {
  const courses = Array.isArray(snapshot?.courses) ? snapshot.courses : safeJson(snapshot?.courses_json, []);
  const testScores = Array.isArray(snapshot?.testScores) ? snapshot.testScores : safeJson(snapshot?.test_scores_json, []);
  const activities = Array.isArray(snapshot?.activities) ? snapshot.activities : safeJson(snapshot?.activities_json, []);
  const majorInterest = snapshot?.majorInterest || snapshot?.major_interest || context.majorInterest || null;
  const { bucket: majorBucket, keywords } = getMajorKeywords(majorInterest);

  const gpa = Number(snapshot?.gpa?.unweighted ?? snapshot?.gpa_unweighted ?? snapshot?.gpaUnweighted ?? 0) || null;
  const weightedGpa = Number(snapshot?.gpa?.weighted ?? snapshot?.gpa_weighted ?? snapshot?.gpaWeighted ?? 0) || null;
  const sat = testScores.find((t) => String(t.test || "").toLowerCase() === "sat")?.totalScore || null;
  const act = testScores.find((t) => String(t.test || "").toLowerCase() === "act")?.totalScore || null;
  const rankPercentile = Number(snapshot?.classRankPercentile ?? context.classRankPercentile ?? 0) || null;

  const relevantCourses = courses.filter((course) => {
    const name = normalizeCourseName(course);
    return keywords.some((kw) => name.includes(kw));
  });
  const rigorousCourseCount = courses.filter((course) => {
    const level = String(course?.type || course?.level || "").toLowerCase();
    return ["ap", "ib", "a-level", "alevel", "dual_enrollment", "dual enrollment", "de"].includes(level);
  }).length;
  const seniorRigorCount = courses.filter((course) => {
    const year = String(course?.year || course?.gradeLevel || "").toLowerCase();
    const level = String(course?.type || course?.level || "").toLowerCase();
    return /(12|senior)/.test(year) && ["ap", "ib", "a-level", "alevel", "dual_enrollment", "dual enrollment", "de"].includes(level);
  }).length;

  const majorRelevantGpa = avg(relevantCourses.map((course) => gradeToPoints(course.grade)));
  const academicAwardsCount = activities.filter((a) => /(award|winner|finalist|olympiad|medal|honor|scholar)/i.test(`${a.name || ""} ${a.description || ""}`)).length;
  const ecImpactTier = avg(strengthRows.map((row) => {
    switch (row.tier_label) {
      case "tier_1_distinctive": return 5;
      case "tier_2_strong": return 4;
      case "tier_3_developing": return 3;
      case "tier_4_foundational": return 2;
      default: return 2;
    }
  })) || 2;
  const ecMajorAlignment = avg(strengthRows.map((row) => Number(row.major_spike || row.narrative_fit || 0) * 100)) || 0;
  const narrativeCoherence = narrative
    ? round1(clamp01(avg(strengthRows.map((row) => Number(row.narrative_fit || 0))) || 0.35) * 100)
    : 25;

  return {
    gpa,
    weightedGpa,
    sat,
    act,
    rankPercentile,
    courses,
    relevantCourses,
    rigorousCourseCount,
    seniorRigorCount,
    majorRelevantGpa,
    majorInterest,
    majorBucket,
    academicAwardsCount,
    ecImpactTier,
    ecMajorAlignment,
    narrativeCoherence,
    strengthRows,
    activities,
  };
}

export function scoreTestPercentile(student, college, cdsResult) {
  const policy = cdsResult?.parsed?.testPolicy || "test_considered_or_required";
  if (!student.sat && !student.act) return policy === "test_optional_or_deemphasized" ? 50 : 20;

  const sat = student.sat || null;
  const act = student.act || null;
  const sat25 = Number(college?.sat25 ?? college?.sat_25 ?? cdsResult?.parsed?.satComposite?.low ?? 0) || null;
  const sat75 = Number(college?.sat75 ?? college?.sat_75 ?? cdsResult?.parsed?.satComposite?.high ?? 0) || null;
  const act25 = Number(college?.act25 ?? college?.act_25 ?? cdsResult?.parsed?.actComposite?.low ?? 0) || null;
  const act75 = Number(college?.act75 ?? college?.act_75 ?? cdsResult?.parsed?.actComposite?.high ?? 0) || null;

  let score = 50;
  if (sat && sat25 && sat75) {
    if (sat >= sat75) score = 92;
    else if (sat >= sat25) score = 65 + ((sat - sat25) / Math.max(1, sat75 - sat25)) * 25;
    else score = Math.max(20, 60 - ((sat25 - sat) / 8));
  } else if (act && act25 && act75) {
    if (act >= act75) score = 92;
    else if (act >= act25) score = 65 + ((act - act25) / Math.max(1, act75 - act25)) * 25;
    else score = Math.max(20, 60 - ((act25 - act) * 6));
  }
  if (policy === "test_optional_or_deemphasized" && !student.sat && !student.act) score = Math.max(score, 55);
  return round1(clamp01(score / 100) * 100);
}

export function scoreAcademicReadiness(student, college, cdsResult) {
  const c7 = cdsResult?.parsed?.c7 || {};
  const featureWeights = {
    gpa: 0.27 + 0.08 * c7Value(c7, ["academicGpa", "academic_gpa", "gpa"], 0.7),
    rigor: 0.2 + 0.08 * c7Value(c7, ["rigor"], 0.7),
    majorPrep: 0.18,
    test: 0.14 + 0.08 * c7Value(c7, ["standardizedTests", "standardized_tests", "test_scores"], 0.35),
    awards: 0.08,
    trend: 0.07,
    rank: 0.06 + 0.03 * c7Value(c7, ["classRank", "class_rank"], 0.35),
  };
  const totalWeight = Object.values(featureWeights).reduce((a, b) => a + b, 0);
  for (const key of Object.keys(featureWeights)) featureWeights[key] /= totalWeight;

  const targetGpa = Number(college?.avgGpaAdmitted ?? college?.avg_gpa_admitted ?? cdsResult?.parsed?.gpaAverage ?? 3.75) || 3.75;
  const gpaScore = student.gpa != null
    ? clamp01((student.gpa - (targetGpa - 0.45)) / 0.75) * 100
    : 35;
  const rigorExpectation = Math.max(4, Math.round((targetGpa - 3.2) * 10));
  const rigorScore = clamp01((student.rigorousCourseCount + student.seniorRigorCount * 0.5) / Math.max(1, rigorExpectation)) * 100;
  const majorPrepScore = clamp01(((student.relevantCourses.length / 5) * 0.55) + (((student.majorRelevantGpa ?? student.gpa ?? 3.2) / 4) * 0.45)) * 100;
  const testScore = scoreTestPercentile(student, college, cdsResult);
  const awardsScore = Math.min(100, student.academicAwardsCount * 18 + 25);
  const trendScore = 60;
  const rankScore = student.rankPercentile != null ? clamp01(student.rankPercentile / 100) * 100 : 50;

  const componentScores = { gpaScore, rigorScore, majorPrepScore, testScore, awardsScore, trendScore, rankScore };
  const score =
    gpaScore * featureWeights.gpa +
    rigorScore * featureWeights.rigor +
    majorPrepScore * featureWeights.majorPrep +
    testScore * featureWeights.test +
    awardsScore * featureWeights.awards +
    trendScore * featureWeights.trend +
    rankScore * featureWeights.rank;

  // ─── C7 transparency breakdown ────────────────────────────────────
  // Surfaces, for each C7 factor used, its rating label, the numeric
  // weight (1.0 / 0.7 / 0.35 / 0.0), and the resulting modulation on
  // the dynamic weight. Lets the AI assistant explain "why Princeton's
  // academic readiness scored higher than Stanford's for the same student".
  const c7Breakdown = [
    { factor: "academic_gpa",       rating: c7?.academicGpa ?? c7?.academic_gpa ?? c7?.gpa ?? null, numericWeight: c7Value(c7, ["academicGpa","academic_gpa","gpa"], 0.7), affectsDynamicWeight: "gpa" },
    { factor: "rigor",              rating: c7?.rigor ?? null, numericWeight: c7Value(c7, ["rigor"], 0.7), affectsDynamicWeight: "rigor" },
    { factor: "standardized_tests", rating: c7?.standardizedTests ?? c7?.standardized_tests ?? c7?.test_scores ?? null, numericWeight: c7Value(c7, ["standardizedTests","standardized_tests","test_scores"], 0.35), affectsDynamicWeight: "test" },
    { factor: "class_rank",         rating: c7?.classRank ?? c7?.class_rank ?? null, numericWeight: c7Value(c7, ["classRank","class_rank"], 0.35), affectsDynamicWeight: "rank" },
  ];

  return {
    score: round1(score),
    componentScores,
    dynamicWeights: Object.fromEntries(Object.entries(featureWeights).map(([k, v]) => [k, round2(v)])),
    c7Breakdown,
  };
}

export function scoreMajorCompetitiveness(student, collegeContext, options = {}) {
  const bucket = student.majorBucket;
  const baseDemand = MAJOR_DEMAND_BASE[bucket] ?? 0.6;
  const ipedsGrowth = options.ipedsGrowthByBucket?.[bucket] ?? IPEDS_CIP_GROWTH_PROXY[bucket] ?? null;
  const schoolSpecificSaturation = (() => {
    const majors = (collegeContext.topMajors || []).map((m) => String(m).toLowerCase());
    if (majors.length === 0) return 0.5;
    return majors.some((m) => m.includes(bucket.replace(/_/g, " "))) ? 0.7 : 0.45;
  })();
  const majorPolicy = options.majorPolicy || null;
  const policyPenalty =
    majorPolicy?.policyType === "capped" ? 0.16 :
    majorPolicy?.policyType === "direct_admit" ? 0.18 :
    majorPolicy?.policyType === "restricted" ? 0.14 : 0;
  const internalTransferPenalty = majorPolicy?.internalTransferDifficulty === "high" ? 0.08 : majorPolicy?.internalTransferDifficulty === "medium" ? 0.04 : 0;
  const capacityOffset = clamp01(Number(majorPolicy?.capacityExpansionOffset ?? 0));

  const difficultyIndex = clamp01((baseDemand * 0.38) + ((ipedsGrowth ?? 0.55) * 0.22) + (schoolSpecificSaturation * 0.22) + policyPenalty + internalTransferPenalty - (capacityOffset * 0.14));
  const competitivenessScore = round1((1 - difficultyIndex) * 100);
  const capacityRiskFlag =
    majorPolicy?.policyType ? `${majorPolicy.policyType}:${majorPolicy.evidenceStrength || "stated"}` :
    difficultyIndex >= 0.72 ? "elevated" :
    difficultyIndex >= 0.58 ? "moderate" : "normal";

  return {
    score: competitivenessScore,
    difficultyIndex: round2(difficultyIndex),
    baseDemand: round2(baseDemand),
    ipedsGrowthProxy: ipedsGrowth != null ? round2(ipedsGrowth) : null,
    schoolSpecificSaturation: round2(schoolSpecificSaturation),
    policyPenalty: round2(policyPenalty + internalTransferPenalty),
    capacityOffset: round2(capacityOffset),
    capacityRiskFlag,
  };
}

export function scoreInstitutionalPriorityFit(student, cdsResult) {
  const c7 = cdsResult?.parsed?.c7 || {};
  const essayWeight = c7Value(c7, ["essay", "application_essay"], 0.35);
  const ecWeight = c7Value(c7, ["extracurriculars", "ec"], 0.35);
  const characterWeight = c7Value(c7, ["character"], 0.35);
  const recWeight = c7Value(c7, ["recommendation", "recommendations"], 0.35);

  const ecStrength = clamp01((student.ecImpactTier - 1) / 4) * 100;
  const majorAlignment = clamp01(student.ecMajorAlignment / 100) * 100;
  const narrative = clamp01(student.narrativeCoherence / 100) * 100;
  const recProxy = clamp01((narrative * 0.6 + majorAlignment * 0.4) / 100) * 100;

  const raw =
    ecStrength * (0.32 + ecWeight * 0.18) +
    majorAlignment * 0.24 +
    narrative * (0.22 + essayWeight * 0.14 + characterWeight * 0.08) +
    recProxy * (0.08 + recWeight * 0.08);
  const normalized = raw / (0.32 + ecWeight * 0.18 + 0.24 + 0.22 + essayWeight * 0.14 + characterWeight * 0.08 + 0.08 + recWeight * 0.08);

  return {
    score: round1(normalized),
    c7SignalsUsed: {
      essay: round2(essayWeight),
      extracurriculars: round2(ecWeight),
      character: round2(characterWeight),
      recommendation: round2(recWeight),
    },
  };
}

export function scoreStrategicFocusBonus(strategicSignals = [], majorPolicy = null) {
  if (!Array.isArray(strategicSignals) || strategicSignals.length === 0) {
    return { bonus: 0, evidenceCount: 0, averageStrength: 0 };
  }
  const avgStrength = avg(strategicSignals.map((signal) => ((Number(signal.evidenceStrength || 0) * 0.65) + (Number(signal.recencyScore || 0) * 0.35)) * 100)) || 0;
  const policyOffset = majorPolicy?.capacityExpansionOffset ? Number(majorPolicy.capacityExpansionOffset) * 6 : 0;
  const bonus = round1(Math.min(12, (avgStrength / 100) * 10 + policyOffset));
  return {
    bonus,
    evidenceCount: strategicSignals.length,
    averageStrength: round1(avgStrength),
  };
}

export function scoreNarrativeFit(student) {
  const coherence = round1(student.narrativeCoherence);
  const specificity = round1((student.ecMajorAlignment * 0.55) + (clamp01((student.relevantCourses.length || 0) / 5) * 45));
  const authenticity = round1(Math.min(100, 40 + student.strengthRows.length * 8));
  const score = round1((coherence * 0.5) + (specificity * 0.35) + (authenticity * 0.15));
  return { score, coherence, specificity, authenticity };
}

export function scoreDifferentiationStrength(student) {
  const spike = avg(student.strengthRows.map((row) => Number(row.major_spike || 0))) || 0;
  const prestige = avg(student.strengthRows.map((row) => Number(row.prestige || 0))) || 0;
  const leadership = avg(student.strengthRows.map((row) => Number(row.leadership || 0))) || 0;
  const achievement = avg(student.strengthRows.map((row) => Number(row.achievement || 0))) || 0;
  const score = round1(clamp01(spike * 0.4 + prestige * 0.18 + leadership * 0.16 + achievement * 0.16 + (student.ecImpactTier / 5) * 0.1) * 100);
  return {
    score,
    majorSpike: round1(spike * 100),
    prestige: round1(prestige * 100),
    leadership: round1(leadership * 100),
    achievement: round1(achievement * 100),
  };
}

export function scoreInstitutionalSelectivityAdjustment(collegeContext) {
  const admitRate = normalizePercentValue(collegeContext.acceptanceRate ?? collegeContext.acceptance ?? collegeContext.admission_rate ?? null);
  if (admitRate == null) return { adjustment: 1, selectivityIndex: null };
  const selectivityIndex = clamp01(1 - admitRate);
  const adjustment = round2(0.8 + (selectivityIndex * 0.35));
  return { adjustment, selectivityIndex: round2(selectivityIndex) };
}

export function scoreEvidenceConfidence({ cdsResult, collegeContext, majorPolicy, ipedsGrowthAvailable }) {
  const sourceQuality = cdsResult?.sourceUrl ? 0.78 : 0.5;
  const directness = cdsResult?.fetchStatus === "ok" ? 0.82 : cdsResult?.fetchStatus === "listed_without_direct_link" ? 0.35 : 0.2;
  const recency = cdsResult?.repositoryMatch?.latestAvailableYear?.startsWith("2024") ? 0.85 : 0.68;
  const consistency = collegeContext?.avgGpaAdmitted || collegeContext?.sat25 ? 0.76 : 0.5;
  const missingDataPenalty = [
    cdsResult?.parsed?.c7 ? 0 : 0.08,
    cdsResult?.parsed?.admitRatePercent != null || collegeContext?.acceptanceRate != null ? 0 : 0.08,
    ipedsGrowthAvailable ? 0 : 0.08,
    majorPolicy ? 0 : 0.06,
  ].reduce((a, b) => a + b, 0);
  const marketingLanguagePenalty = 0;
  // Live-parsed CDS that hasn't been checked against ground truth is real
  // data but unverified — a positional PDF parse can mis-read a number. Dock
  // confidence and cap it below "High" so an unvalidated record can never
  // present as authoritative as a curated/validated one.
  const isUnvalidated = cdsResult?.validated === false;
  const unvalidatedPenalty = isUnvalidated ? 0.12 : 0;
  const raw = sourceQuality * 0.28 + recency * 0.18 + directness * 0.22 + consistency * 0.2 - missingDataPenalty - marketingLanguagePenalty - unvalidatedPenalty;
  let normalized = clamp01(raw);
  if (isUnvalidated) normalized = Math.min(normalized, 0.74); // never "High" while unverified
  const label = normalized >= 0.78 ? "High" : normalized >= 0.58 ? "Medium" : normalized >= 0.35 ? "Low" : "Very Low";
  return { score: round1(normalized * 100), label, normalized: round2(normalized), validated: !isUnvalidated };
}

export function buildRedFlags(student, collegeContext, majorCompetitiveness, narrativeFit) {
  const flags = [];
  if (student.relevantCourses.length <= 1 && ["computer_science", "engineering", "computational_biology", "data_science", "business"].includes(student.majorBucket)) {
    flags.push("Weak major-relevant coursework for an ambitious intended major.");
  }
  if (student.activities.length >= 8 && student.strengthRows.length > 0 && (avg(student.strengthRows.map((row) => Number(row.dedication || 0))) || 0) < 0.35) {
    flags.push("Many shallow extracurriculars without enough sustained depth.");
  }
  if ((student.majorInterest || "").match(/\b(ai|medicine|business)\b/i) && narrativeFit.specificity < 45) {
    flags.push("Narrative risks sounding generic for a crowded major lane.");
  }
  if (narrativeFit.coherence < 45) {
    flags.push("Narrative coherence is weak and may read as a list rather than a story.");
  }
  if (majorCompetitiveness.capacityRiskFlag !== "normal" && student.relevantCourses.length <= 2) {
    flags.push("Applying to a capped or capacity-constrained major without enough preparation.");
  }
  if ((collegeContext.acceptanceRate ?? 100) < 15 && student.gpa != null && (collegeContext.avgGpaAdmitted ?? 3.9) - student.gpa > 0.2) {
    flags.push("Transcript looks light relative to this university's admitted academic range.");
  }
  return flags;
}

export function classifyPositioningLabel(finalScore) {
  if (finalScore >= 82) return "Highly competitive";
  if (finalScore >= 67) return "Competitive";
  if (finalScore >= 48) return "Reach";
  return "High reach";
}

export function recommendStrategy(positioningLabel, redFlags, majorCompetitiveness) {
  if (positioningLabel === "Highly competitive") return "Lean into fit, specificity, and proof of contribution. Avoid sounding generic because the academic case is already strong.";
  if (positioningLabel === "Competitive") return majorCompetitiveness.capacityRiskFlag !== "normal"
    ? "Present the application as academically ready but major-aware. Emphasize preparation, alternatives, and concrete evidence for the intended field."
    : "Strengthen school-specific fit and make the narrative more concrete. The academic floor is plausible; the decision may hinge on differentiation.";
  if (positioningLabel === "Reach") return redFlags.length > 0
    ? "Treat this as a selective reach. Fix the most visible preparation gaps and make the major story sharper and more school-specific."
    : "Treat this as an aspirational reach. Keep the school, but balance with more targets and use essays to maximize fit.";
  return "Treat this as a high reach. Keep only if it is emotionally worth it, and balance with a healthier college list.";
}

export function buildPositioningForTarget(student, collegeContext, cdsResult, options = {}) {
  const academic = scoreAcademicReadiness(student, collegeContext, cdsResult);
  const selectivity = scoreInstitutionalSelectivityAdjustment(collegeContext);
  const majorComp = scoreMajorCompetitiveness(student, collegeContext, options);
  const fit = scoreInstitutionalPriorityFit(student, cdsResult);
  const narrative = scoreNarrativeFit(student);
  const differentiation = scoreDifferentiationStrength(student);
  const strategicFocus = scoreStrategicFocusBonus(options.strategicSignals || [], options.majorPolicy || null);
  const redFlags = buildRedFlags(student, collegeContext, majorComp, narrative);

  // ── Displayed competitiveness blends intended-major crowding with the
  // school's ACTUAL institutional selectivity (admit rate). Previously the
  // displayed number came only from major demand, so a 4%-admit Ivy and a
  // 60%-admit state school scored identical competitiveness for the same
  // major — which reads as badly inflated for the selective school. The raw
  // major-pool signal is preserved separately for transparency. finalScore
  // math below is left untouched (it applies selectivity.adjustment on its
  // own), so this does not double-count.
  const selectivityPressure = selectivity.selectivityIndex; // 0..1, null if admit rate unknown
  const displayedCompetitivenessScore = selectivityPressure != null
    ? round1((1 - clamp01(majorComp.difficultyIndex * 0.35 + selectivityPressure * 0.65)) * 100)
    : majorComp.score; // no selectivity data → fall back to the raw major-pool score

  const contextBonus = options.contextualAchievementBonus ?? 0;
  const redFlagPenalty = Math.min(24, redFlags.length * 5);
  const finalScore =
    (academic.score * selectivity.adjustment * (0.82 + ((majorComp.score / 100) * 0.33))) +
    (fit.score * 0.12) +
    (narrative.score * 0.08) +
    strategicFocus.bonus +
    contextBonus -
    redFlagPenalty;
  const boundedFinal = round1(Math.max(0, Math.min(100, finalScore / 1.15)));
  const confidence = scoreEvidenceConfidence({
    cdsResult,
    collegeContext,
    majorPolicy: options.majorPolicy || null,
    ipedsGrowthAvailable: majorComp.ipedsGrowthProxy != null,
  });
  const label = classifyPositioningLabel(boundedFinal);

  // Honest uncertainty bands for the displayed dimensions, widened in
  // inverse proportion to evidence confidence. The confidence dimension
  // itself is not banded.
  const scoreRanges = {
    admissibility: confidenceBand(academic.score, confidence.normalized),
    competitiveness: confidenceBand(displayedCompetitivenessScore, confidence.normalized),
    fit: confidenceBand(fit.score, confidence.normalized),
  };

  return {
    schoolName: collegeContext.name || cdsResult?.schoolName || "Unknown school",
    intendedMajor: student.majorInterest || options.major || null,
    overallPositioningLabel: label,
    finalPositioningScore: boundedFinal,
    admissibility: {
      academicReadinessScore: academic.score,
      summary: academic.score >= 75 ? "academically in-range" : academic.score >= 58 ? "academically plausible but not comfortable" : "academically stretched",
    },
    competitiveness: {
      // Blended: intended-major crowding + the school's real admit-rate
      // selectivity. This is what the UI shows. Higher = more attainable.
      majorCompetitivenessScore: displayedCompetitivenessScore,
      // Raw intended-major-pool signal only (no institutional selectivity),
      // kept for transparency / explainability.
      majorPoolCompetitivenessScore: majorComp.score,
      institutionalSelectivityIndex: selectivityPressure,
      institutionalSelectivityAdjustment: selectivity.adjustment,
      majorCompetitivenessAdjustment: round2(0.82 + ((majorComp.score / 100) * 0.33)),
    },
    fit: {
      institutionalPriorityFitScore: fit.score,
      c7SignalsUsed: fit.c7SignalsUsed,
      strategicFocusBonus: strategicFocus.bonus,
      narrativeCoherenceScore: narrative.score,
      differentiationStrength: differentiation.score,
    },
    confidence: {
      evidenceConfidence: confidence.label,
      evidenceConfidenceScore: confidence.score,
      evidenceValidated: confidence.validated,
    },
    scoreRanges,
    capacityRiskFlag: majorComp.capacityRiskFlag,
    mainRedFlags: redFlags,
    recommendedPositioningStrategy: recommendStrategy(label, redFlags, majorComp),
    featureBreakdown: {
      gpa: round1(student.gpa ?? 0),
      courseRigor: round1(academic.componentScores.rigorScore),
      majorRelevantCoursework: round1(academic.componentScores.majorPrepScore),
      testScorePercentile: round1(academic.componentScores.testScore),
      ecImpactTier: round1(student.ecImpactTier),
      ecMajorAlignment: round1(student.ecMajorAlignment),
      essayNarrativeCoherence: narrative.coherence,
      overallAdmitRate: collegeContext.acceptanceRate ?? cdsResult?.parsed?.admitRatePercent ?? null,
      cdsC7FactorWeights: cdsResult?.parsed?.c7 || {},
      appliedAcademicDynamicWeights: academic.dynamicWeights,
      satGpaEnrolledRange: {
        sat25: collegeContext.sat25 ?? null,
        sat75: collegeContext.sat75 ?? null,
        avgGpaAdmitted: collegeContext.avgGpaAdmitted ?? null,
      },
      ipedsCompletionsGrowthByCip: majorComp.ipedsGrowthProxy,
      cappedDirectAdmitRestrictedMajorFlag: options.majorPolicy?.policyType || null,
    },
    evidence: {
      cdsRepositoryMatch: cdsResult?.repositoryMatch || null,
      cdsSourceUrl: cdsResult?.sourceUrl || null,
      strategicSignals: options.strategicSignals || [],
      dataSources: [
        cdsResult?.source || "College Transitions CDS repository",
        collegeContext.source || "baseline_colleges",
      ].filter(Boolean),
    },
  };
}

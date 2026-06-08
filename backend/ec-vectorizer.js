// EC VECTORIZER - deterministic EC heuristics + planner helpers

export const EC_FACTORS = Object.freeze([
  "impact_and_scope",
  "leadership_and_initiative",
  "passion_and_consistency",
  "talents_and_awards",
  "relevance_to_intended_major",
]);

export const EC_FACTOR_WEIGHTS_DEFAULT = Object.freeze({
  impact_and_scope: 0.22,
  leadership_and_initiative: 0.22,
  passion_and_consistency: 0.22,
  talents_and_awards: 0.18,
  relevance_to_intended_major: 0.16,
});

export const WELLBEING_LIMITS = Object.freeze({
  sustainable_weekly_hours: 25,
  caution_weekly_hours: 30,
  hard_ceiling_weekly_hours: 40,
  min_sleep_hours_per_night: 8,
});

export const LEXICON = {
  impact: {
    high: ["nonprofit", "501(c)", "published", "patent", "nationwide", "international", "thousands", "million", "statewide", "city council", "mayor", "congress", "open source", "production", "clinical trial", "raised $", "beneficiar", "launched", "deployed to", "users", "downloads", "press coverage", "featured in", "newspaper", "news article", "media"],
    mid: ["community", "district", "region", "hundreds", "fundraiser", "donated", "organized event", "hosted", "partnership", "local business", "public", "library", "hospital", "shelter", "food bank", "workshop", "camp"],
    low: ["school", "club meeting", "class project", "homework", "practice"],
  },
  leadership: {
    founder: ["founded", "co-founded", "started", "created", "launched the", "initiated", "established"],
    top_rank: ["president", "captain", "editor-in-chief", "chief", "director", "head of", "lead ", "ceo", "chair ", "chairperson", "chairman"],
    mid_rank: ["vice president", "vp ", "officer", "coordinator", "manager", "treasurer", "secretary", "section leader", "lead organizer"],
    initiative: ["organized", "led a", "spearheaded", "built a team", "recruited", "ran a", "managed a", "planned", "introduced", "pitched", "proposed"],
    rank_progression: ["promoted", "moved up", "was elected", "appointed", "advanced from", "rose to"],
  },
  passion: {
    output: ["portfolio", "website", "repository", "github", "published", "performances", "exhibits", "pieces", "songs", "albums", "papers", "videos", "articles", "posts", "blog", "series", "matches played"],
    time_phrases: ["since 9th grade", "since 8th grade", "since middle school", "for 4 years", "for 3 years", "for 2 years", "every week", "every day", "daily", "weekly"],
  },
  awards: {
    international: ["international", "world championship", "imo", "ipho", "icho", "ibo", "intel isef", "isef finalist", "olympiad gold"],
    national: ["national", "usamo", "usaco platinum", "aime", "siemens", "regeneron", "davidson fellow", "national merit", "nationals", "first place nationally", "gold medal", "all-state"],
    state: ["state champion", "state finalist", "state qualifier", "all-state", "state level"],
    regional: ["regional", "district champion", "county", "invitational"],
    recognition: ["award", "prize", "honor", "scholarship", "recognized", "selected as", "finalist", "winner", "certified", "ranked"],
  },
  majorBuckets: {
    computer_science: ["code", "coding", "programming", "software", "algorithm", "ai ", "ml ", "machine learning", "data", "python", "javascript", "web dev", "app ", "robotics", "usaco", "github", "open source", "hackathon"],
    computational_biology: ["computational biology", "comp bio", "bioinformatics", "genomics", "proteomics", "mitochondrial", "dna sequencing", "genome", "protein folding", "computational genomics", "systems biology", "biostatistics", "cellular modeling"],
    data_science: ["data science", "statistics", "statistical", "r programming", "regression", "inference", "data analysis", "kaggle", "analytics"],
    neuroscience: ["neuroscience", "neural", "brain", "cognitive", "neurobiology", "neuron", "synapse", "fmri", "eeg"],
    biomedical_engineering: ["biomedical engineering", "bme ", "medical device", "prosthetics", "bioengineer", "tissue engineering"],
    engineering: ["engineering", "robotics", "cad", "mechanical", "electrical", "circuit", "3d print", "prototype", "maker", "fabrication"],
    materials_science: ["materials science", "metallurgy", "polymer", "nanotech", "nanomaterial", "crystallography"],
    biology: ["biology", "bio ", "genetics", "lab", "dissect", "microbio", "ecology", "pre-med", "hospital volunteer", "clinical", "research"],
    chemistry: ["chemistry", "chem ", "lab", "synthesis", "reaction", "usnco"],
    physics: ["physics", "astronomy", "mechanics", "optics", "usapho", "ipho"],
    mathematics: ["math", "mathematics", "proof", "olympiad", "amc", "aime", "competition math", "usamo"],
    economics: ["economics", "econ", "finance", "investing", "market", "business", "entrepreneur", "startup"],
    business: ["business", "entrepreneur", "startup", "founder", "sales", "marketing", "deca", "fbla"],
    public_policy: ["public policy", "policy analyst", "think tank", "nonprofit", "ngo", "advocacy campaign"],
    international_relations: ["international relations", "diplomacy", "foreign policy", "un ", "world affairs", "geopolitics"],
    political_science: ["politic", "government", "debate", "model un", "mun", "policy", "advocacy", "campaign"],
    history: ["history", "archiv", "museum", "historical"],
    english: ["writing", "poetry", "novel", "literary magazine", "blog", "author"],
    journalism: ["journalism", "reporter", "newspaper", "reporting", "editor in chief", "press release", "news editor"],
    linguistics: ["linguistics", "phonology", "syntax", "language acquisition", "translator", "translation", "multilingual"],
    psychology: ["psychology", "mental health", "counseling", "peer support"],
    philosophy: ["philosophy", "ethics", "bioethics", "moral reasoning", "logic"],
    anthropology: ["anthropology", "ethnography", "cultural studies", "fieldwork"],
    art: ["art", "painting", "drawing", "sculpture", "ceramics", "portfolio", "exhibit", "gallery"],
    architecture: ["architecture", "architectural", "urban design", "studio design", "blueprint"],
    film: ["film", "cinematography", "screenplay", "short film", "documentary", "editing reel"],
    music: ["music", "orchestra", "band", "choir", "piano", "violin", "composition", "recital"],
    theater: ["theater", "theatre", "acting", "play ", "musical", "director"],
    environmental_science: ["environment", "climate", "sustainability", "ecology", "conservation"],
    public_health: ["public health", "epidemiology", "hospital", "clinic", "health equity"],
    education: ["education", "teaching", "tutoring", "pedagogy", "curriculum", "classroom", "early childhood"],
  },
};

const COMPETITION_PATTERNS = {
  math_olympiad: [
    { pattern: /\bimo\b.*\b(team|member|gold|silver|bronze)\b/i, level_index: 5 },
    { pattern: /\busamo\b/i, level_index: 4 },
    { pattern: /\baime\b.*\b(qualif|score)/i, level_index: 3 },
    { pattern: /\baime\b/i, level_index: 3 },
    { pattern: /\bamc\s*(10|12).*\b(dhr|distinguished|honor\s*roll|perfect)\b/i, level_index: 2 },
    { pattern: /\bamc\s*(10|12)\b/i, level_index: 1 },
    { pattern: /\bamc\s*8\b/i, level_index: 0 },
    { pattern: /\bmath\s*olympiad\b/i, level_index: 1 },
    { pattern: /\bmathcounts\b.*\b(state|national)\b/i, level_index: 3 },
    { pattern: /\bmathcounts\b/i, level_index: 1 },
    { pattern: /\bcompetition\s*math\b/i, level_index: 0 },
  ],
  science_olympiad: [
    { pattern: /\bsci(ence)?\s*olympiad\b.*\bnational/i, level_index: 3 },
    { pattern: /\bsci(ence)?\s*olympiad\b.*\bstate/i, level_index: 2 },
    { pattern: /\bsci(ence)?\s*olympiad\b.*\bregion/i, level_index: 1 },
    { pattern: /\bsci(ence)?\s*olympiad\b.*\binvitational/i, level_index: 0 },
    { pattern: /\bscience\s*olympiad\b/i, level_index: 1 },
    { pattern: /\bscioly\b/i, level_index: 1 },
  ],
  deca: [
    { pattern: /\bdeca\b.*\b(icdc|international|national)/i, level_index: 3 },
    { pattern: /\bdeca\b.*\bstate/i, level_index: 2 },
    { pattern: /\bdeca\b.*\bdistrict/i, level_index: 1 },
    { pattern: /\bdeca\b/i, level_index: 0 },
  ],
  fbla: [
    { pattern: /\bfbla\b.*\b(nlc|national)/i, level_index: 3 },
    { pattern: /\bfbla\b.*\bstate/i, level_index: 2 },
    { pattern: /\bfbla\b.*\bdistrict/i, level_index: 1 },
    { pattern: /\bfbla\b/i, level_index: 0 },
  ],
  debate: [
    { pattern: /\bnsda\s*national/i, level_index: 4 },
    { pattern: /\bnational\s*(qualif|finalist).*\bdebate/i, level_index: 3 },
    { pattern: /\btoc\b.*\b(qualif|bid)/i, level_index: 2 },
    { pattern: /\btoc\b/i, level_index: 2 },
    { pattern: /\b(circuit|bid)\s*(tournament|round)/i, level_index: 1 },
    { pattern: /\bdebate\b.*\b(tournament|compete)/i, level_index: 0 },
    { pattern: /\b(lincoln.?douglas|ld\b)/i, level_index: 0 },
    { pattern: /\bpublic\s*forum\b/i, level_index: 0 },
    { pattern: /\bpolicy\s*debate\b/i, level_index: 0 },
  ],
  first_robotics: [
    { pattern: /\b(chairman|chairman's|impact)\s*award\b/i, level_index: 3 },
    { pattern: /\b(frc|ftc|fll)\b.*\b(world|championship|champs)/i, level_index: 2 },
    { pattern: /\bfirst\s*robotics\b.*\b(world|championship)/i, level_index: 2 },
    { pattern: /\b(frc|ftc|fll)\b.*\b(regional|qualifier|district)/i, level_index: 1 },
    { pattern: /\bfirst\s*robotics\b.*\bregional/i, level_index: 1 },
    { pattern: /\b(frc|ftc|fll)\b/i, level_index: 0 },
    { pattern: /\bfirst\s*robotics\b/i, level_index: 0 },
    { pattern: /\bfirst\s*lego\b/i, level_index: 0 },
  ],
};

const COMPETITION_LEVEL_SCORES = {
  math_olympiad: [0.12, 0.18, 0.35, 0.55, 0.82, 0.95],
  science_olympiad: [0.12, 0.25, 0.5, 0.78],
  deca: [0.1, 0.2, 0.45, 0.78],
  fbla: [0.1, 0.2, 0.45, 0.78],
  debate: [0.12, 0.3, 0.58, 0.72, 0.9],
  first_robotics: [0.12, 0.3, 0.58, 0.85],
};

const COMPETITION_MAJOR_TIERS = {
  math_olympiad: { mathematics: 1, computer_science: 1, physics: 2, engineering: 2, economics: 3 },
  science_olympiad: { biology: 1, chemistry: 1, physics: 1, engineering: 2, environmental_science: 2 },
  deca: { business: 1, economics: 1 },
  fbla: { business: 1, economics: 2, computer_science: 3 },
  debate: { political_science: 1, english: 2, psychology: 3 },
  first_robotics: { engineering: 1, computer_science: 1, physics: 3 },
};

export function detectCompetitiveActivity(text) {
  let best = null;
  for (const [activityId, patterns] of Object.entries(COMPETITION_PATTERNS)) {
    for (const { pattern, level_index } of patterns) {
      if (pattern.test(text)) {
        if (!best || level_index > best.levelIndex) best = { activityId, levelIndex: level_index };
        break;
      }
    }
  }
  return best;
}

export function competitionLevelToScore(activityId, levelIndex) {
  const scores = COMPETITION_LEVEL_SCORES[activityId];
  if (!scores) return 0;
  return scores[Math.min(levelIndex, scores.length - 1)] || 0;
}

export function getCompetitionMajorRelevance(activityId, majorInterest) {
  const tiers = COMPETITION_MAJOR_TIERS[activityId];
  if (!tiers || !majorInterest) return 0;
  const bucket = matchMajorBucket(majorInterest);
  const tier = tiers[bucket];
  if (tier === 1) return 0.9;
  if (tier === 2) return 0.7;
  if (tier === 3) return 0.5;
  return 0.15;
}

export function vectorizeEC(ec, majorInterest = null) {
  const desc = normalizeText([
    ec.name, ec.role, ec.description, ec.category,
    Array.isArray(ec.awards) ? ec.awards.join(" ") : ec.awards,
    Array.isArray(ec.outputs) ? ec.outputs.join(" ") : ec.outputs,
  ].filter(Boolean).join(" "));

  const reasoning = {
    impact_and_scope: [],
    leadership_and_initiative: [],
    passion_and_consistency: [],
    talents_and_awards: [],
    relevance_to_intended_major: [],
  };

  let impact = 0;
  const highHits = countHits(desc, LEXICON.impact.high);
  const midHits = countHits(desc, LEXICON.impact.mid);
  const lowHits = countHits(desc, LEXICON.impact.low);
  if (highHits > 0) { impact += Math.min(0.6, 0.3 * highHits); reasoning.impact_and_scope.push(`High-reach signals: ${highHits}`); }
  if (midHits > 0) { impact += Math.min(0.3, 0.12 * midHits); reasoning.impact_and_scope.push(`Community-level signals: ${midHits}`); }
  if (highHits === 0 && midHits === 0 && lowHits > 0) { impact += 0.1; reasoning.impact_and_scope.push("School-only scope detected"); }
  const numericSignals = extractNumericImpact(desc);
  if (numericSignals.people >= 1000) { impact += 0.25; reasoning.impact_and_scope.push(`Reach ~${numericSignals.people} people`); }
  else if (numericSignals.people >= 100) { impact += 0.12; reasoning.impact_and_scope.push(`Reach ~${numericSignals.people} people`); }
  if (numericSignals.dollars >= 10000) { impact += 0.2; reasoning.impact_and_scope.push(`Raised $${numericSignals.dollars}+`); }
  else if (numericSignals.dollars >= 1000) { impact += 0.1; reasoning.impact_and_scope.push(`Raised $${numericSignals.dollars}+`); }
  impact = clamp01(impact);

  let leadership = 0;
  const role = normalizeText(ec.role || "");
  if (LEXICON.leadership.founder.some((k) => desc.includes(k) || role.includes(k))) { leadership += 0.55; reasoning.leadership_and_initiative.push("Founder / creator signal"); }
  if (LEXICON.leadership.top_rank.some((k) => role.includes(k) || desc.includes(k))) { leadership += 0.35; reasoning.leadership_and_initiative.push("Top-rank role"); }
  else if (LEXICON.leadership.mid_rank.some((k) => role.includes(k) || desc.includes(k))) { leadership += 0.2; reasoning.leadership_and_initiative.push("Mid-rank role"); }
  const initiativeHits = countHits(desc, LEXICON.leadership.initiative);
  if (initiativeHits > 0) { leadership += Math.min(0.25, 0.08 * initiativeHits); reasoning.leadership_and_initiative.push(`Initiative verbs: ${initiativeHits}`); }
  if (LEXICON.leadership.rank_progression.some((k) => desc.includes(k))) { leadership += 0.15; reasoning.leadership_and_initiative.push("Rank progression signal"); }
  leadership = clamp01(leadership);

  let passion = 0;
  const years = Number(ec.yearsOfParticipation || ec.years || 0);
  if (years >= 4) { passion += 0.5; reasoning.passion_and_consistency.push(`${years}+ years active`); }
  else if (years >= 3) { passion += 0.38; reasoning.passion_and_consistency.push(`${years} years active`); }
  else if (years >= 2) { passion += 0.25; reasoning.passion_and_consistency.push(`${years} years active`); }
  else if (years >= 1) { passion += 0.1; reasoning.passion_and_consistency.push("1 year active"); }
  const hours = Number(ec.hoursPerWeek || 0);
  const weeks = Number(ec.weeksPerYear || 40);
  const totalHours = hours * weeks * Math.max(years, 1);
  if (totalHours >= 500) { passion += 0.3; reasoning.passion_and_consistency.push(`~${Math.round(totalHours)} lifetime hours`); }
  else if (totalHours >= 200) { passion += 0.18; reasoning.passion_and_consistency.push(`~${Math.round(totalHours)} lifetime hours`); }
  else if (totalHours >= 60) { passion += 0.08; reasoning.passion_and_consistency.push(`~${Math.round(totalHours)} lifetime hours`); }
  const outputHits = countHits(desc, LEXICON.passion.output);
  if (outputHits > 0) { passion += Math.min(0.2, 0.07 * outputHits); reasoning.passion_and_consistency.push(`Output / artifact signals: ${outputHits}`); }
  passion = clamp01(passion);

  const competition = detectCompetitiveActivity(desc);

  let awards = 0;
  if (LEXICON.awards.international.some((k) => desc.includes(k))) { awards += 0.7; reasoning.talents_and_awards.push("International-level recognition"); }
  else if (LEXICON.awards.national.some((k) => desc.includes(k))) { awards += 0.55; reasoning.talents_and_awards.push("National-level recognition"); }
  else if (LEXICON.awards.state.some((k) => desc.includes(k))) { awards += 0.35; reasoning.talents_and_awards.push("State-level recognition"); }
  else if (LEXICON.awards.regional.some((k) => desc.includes(k))) { awards += 0.2; reasoning.talents_and_awards.push("Regional recognition"); }
  const recogHits = countHits(desc, LEXICON.awards.recognition);
  if (recogHits > 0 && awards < 0.55) { awards += Math.min(0.2, 0.06 * recogHits); reasoning.talents_and_awards.push(`Recognition verbs: ${recogHits}`); }
  if (Array.isArray(ec.awards) && ec.awards.length > 0) { awards += Math.min(0.2, 0.07 * ec.awards.length); reasoning.talents_and_awards.push(`${ec.awards.length} listed award(s)`); }
  if (competition) {
    const compScore = competitionLevelToScore(competition.activityId, competition.levelIndex);
    if (compScore > awards) { awards = compScore; reasoning.talents_and_awards.push(`Competitive: ${competition.activityId} level ${competition.levelIndex} (score ${compScore})`); }
  }
  awards = clamp01(awards);

  let relevance = 0;
  if (majorInterest) {
    const bucketKey = matchMajorBucket(majorInterest);
    const keywords = LEXICON.majorBuckets[bucketKey] || [];
    const hits = countHits(desc, keywords);
    if (hits >= 4) { relevance += 0.85; reasoning.relevance_to_intended_major.push(`Strong overlap with ${majorInterest} (${hits} signals)`); }
    else if (hits >= 2) { relevance += 0.55; reasoning.relevance_to_intended_major.push(`Moderate overlap with ${majorInterest}`); }
    else if (hits === 1) { relevance += 0.3; reasoning.relevance_to_intended_major.push(`Partial overlap with ${majorInterest}`); }
    else { reasoning.relevance_to_intended_major.push(`Low direct overlap with ${majorInterest}`); }
    if (competition) {
      const compRelevance = getCompetitionMajorRelevance(competition.activityId, majorInterest);
      if (compRelevance > relevance) { relevance = compRelevance; reasoning.relevance_to_intended_major.push(`${competition.activityId} is tier-relevant for ${majorInterest}`); }
    }
    if (relevance < 0.15 && (leadership >= 0.5 || desc.includes("volunteer"))) { relevance = 0.15; reasoning.relevance_to_intended_major.push("Universal leadership/service support"); }
  } else {
    relevance = 0.2;
    reasoning.relevance_to_intended_major.push("No major declared — showing neutral relevance");
  }
  relevance = clamp01(relevance);

  const vector = {
    impact_and_scope: round2(impact),
    leadership_and_initiative: round2(leadership),
    passion_and_consistency: round2(passion),
    talents_and_awards: round2(awards),
    relevance_to_intended_major: round2(relevance),
  };
  const composite = computeComposite(vector);
  const label = compositeLabel(composite);
  return { vector, reasoning, composite, label };
}

function computeComposite(vector, weights = EC_FACTOR_WEIGHTS_DEFAULT) {
  let sum = 0;
  for (const k of EC_FACTORS) sum += (vector[k] || 0) * weights[k];
  return round2(sum);
}

function compositeLabel(composite) {
  if (composite >= 0.8) return "exceptional";
  if (composite >= 0.65) return "strong";
  if (composite >= 0.45) return "developing";
  if (composite >= 0.25) return "emerging";
  return "early_stage";
}

// Academic strength helpers
/**
 * Per updated directive: academic strength is interpreted ONLY via
 * GPA and APs relative to target universities. Nothing else.
 *
 * @param {object} academics - { gpaUnweighted, gpaWeighted, apCourses, apScores }
 * @param {Array} targetColleges - array of college profile rows
 * @returns {{
 *   gpaFitVsTargets: number,          // 0..1 vs avg_gpa_admitted of targets
 *   apRigorVsExpectations: number,    // 0..1 vs expected AP count at targets
 *   overallAcademicLabel: string,
 *   perCollege: Array,
 *   reasoning: Array<string>
 * }}
 */
export function scoreAcademicStrength(academics = {}, targetColleges = []) {
  const reasoning = [];
  const gpa = Number(
    academics.gpaUnweighted ?? academics.gpa?.unweighted ?? 0
  );
  const apCourses = Array.isArray(academics.apCourses)
    ? academics.apCourses
    : (academics.courses || []).filter((c) => c.type === "ap" || c.level === "AP");
  const apScores = Array.isArray(academics.apScores) ? academics.apScores : [];

  if (!targetColleges || targetColleges.length === 0) {
    reasoning.push("No target colleges supplied ??returning neutral academic read.");
    return {
      gpaFitVsTargets: null,
      apRigorVsExpectations: null,
      overallAcademicLabel: "insufficient_targets",
      perCollege: [],
      reasoning,
      gpaUnweighted: gpa || null,
      apCount: apCourses.length,
    };
  }

  const perCollege = [];
  let gpaFitSum = 0;
  let gpaFitN = 0;
  let apFitSum = 0;
  let apFitN = 0;

  for (const c of targetColleges) {
    const avgAdmitted = Number(c.avg_gpa_admitted || c.avgGpaAdmitted || 0);
    let gpaFit = null;
    if (gpa && avgAdmitted) {
      // A GPA at or above the average maps to 1.0; 0.5 below maps to 0.
      const diff = gpa - avgAdmitted;
      gpaFit = clamp01(0.5 + diff / 0.5);
      gpaFitSum += gpaFit;
      gpaFitN += 1;
    }

    const valuedAPs = safeArray(c.ap_courses_valued_json || c.apCoursesValued);
    // Rough expectation: selective schools imply higher AP counts
    const acceptance = Number(c.acceptance_rate || c.acceptance || 1);
    const expectedAPs = acceptance <= 0.15 ? 8
      : acceptance <= 0.3 ? 6
      : acceptance <= 0.5 ? 4
      : 3;
    let apFit = null;
    if (apCourses.length >= 0) {
      apFit = clamp01(apCourses.length / expectedAPs);
      // Bonus if the student's APs overlap with courses the college values
      if (valuedAPs.length > 0) {
        const overlap = apCourses.filter((ac) =>
          valuedAPs.some((v) => (ac.name || "").toLowerCase().includes(String(v).toLowerCase()))
        ).length;
        if (overlap > 0) apFit = clamp01(apFit + 0.1 * overlap);
      }
      apFitSum += apFit;
      apFitN += 1;
    }

    perCollege.push({
      college: c.name || c.unit_id,
      avgGpaAdmitted: avgAdmitted || null,
      expectedAPs,
      gpaFit: gpaFit != null ? round2(gpaFit) : null,
      apFit: apFit != null ? round2(apFit) : null,
    });
  }

  const gpaFitVsTargets = gpaFitN > 0 ? round2(gpaFitSum / gpaFitN) : null;
  const apRigorVsExpectations = apFitN > 0 ? round2(apFitSum / apFitN) : null;

  const combined = [gpaFitVsTargets, apRigorVsExpectations]
    .filter((x) => x != null);
  const mean = combined.length ? combined.reduce((a, b) => a + b, 0) / combined.length : 0;
  const label = mean >= 0.8 ? "strong_for_targets"
    : mean >= 0.6 ? "competitive_for_targets"
    : mean >= 0.4 ? "reach_for_targets"
    : "needs_strengthening";

  if (gpaFitVsTargets != null) reasoning.push(`Avg GPA fit across targets: ${gpaFitVsTargets}`);
  if (apRigorVsExpectations != null) reasoning.push(`AP rigor vs expectations: ${apRigorVsExpectations}`);
  reasoning.push("Academic strength is computed from GPA and APs only, per policy.");

  return {
    gpaFitVsTargets,
    apRigorVsExpectations,
    overallAcademicLabel: label,
    perCollege,
    reasoning,
    gpaUnweighted: gpa || null,
    apCount: apCourses.length,
    apScoreCount: apScores.length,
  };
}

// Next-step planner (well-being first)
/**
 * Produces a list of next-step suggestions for the student, always
 * filtered by a burnout / balance check. Never returns suggestions
 * that would push the student past the hard ceiling of weekly hours.
 *
 * @param {object} params
 * @param {Array} params.ecVectors       - legacy-compatible projected vectors or vectorizeEC results
 * @param {object} params.academicScore  - output of scoreAcademicStrength
 * @param {Array} params.activities      - raw activity objects (for hour totals)
 * @param {string} [params.majorInterest]
 * @param {string} [params.locale]
 * @returns {object}
 */
export function buildNextStepPlan({
  ecVectors = [],
  strengthVectors = [],
  academicScore = null,
  activities = [],
  majorInterest = null,
  locale = "en-US",
}) {
  // Aggregate current weekly load
  const totalWeeklyHours = activities.reduce(
    (sum, a) => sum + Number(a.hoursPerWeek || 0), 0
  );
  const wellbeing = assessWellbeing(totalWeeklyHours);

  // Detect the student's weakest EC factor (where growth has most headroom)
  const factorAverages = {};
  for (const f of EC_FACTORS) {
    const vals = ecVectors.map((v) => Number(v[f] ?? v.vector?.[f] ?? 0)).filter((n) => !isNaN(n));
    factorAverages[f] = vals.length ? round2(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  }
  const sortedFactors = [...EC_FACTORS].sort(
    (a, b) => factorAverages[a] - factorAverages[b]
  );
  const weakestFactor = sortedFactors[0];
  const secondWeakest = sortedFactors[1];
  const spikeProfile = analyzeMajorSpikeProfile({
    ecVectors,
    strengthVectors,
    activities,
    majorInterest,
  });

  const suggestions = [];

  // Well-being is the foundation ??always first.
  suggestions.push({
    category: "well_being",
    priority: "foundation",
    title: locale === "ko"
      ? "Sleep, rest, and mental health come first"
      : "Protect sleep, rest, and mental health first",
    detail: wellbeing.message,
    timeCostPerWeek: 0,
  });

  if (wellbeing.status === "overloaded") {
    // Only produce protective suggestions; do not add more to the plate.
    suggestions.push({
      category: "reduce_load",
      priority: "high",
      title: locale === "ko"
        ? "Consider trimming your current activity load"
        : "Consider trimming your current activity load",
      detail: `You're at ${totalWeeklyHours} hrs/week of ECs. We recommend pulling back the lowest-impact activities before adding anything new. A sustainable range is up to ${WELLBEING_LIMITS.sustainable_weekly_hours} hrs/week.`,
      timeCostPerWeek: 0,
      refuseMoreLoad: true,
    });

    return finalizePlan(suggestions, {
      totalWeeklyHours, wellbeing, factorAverages,
      weakestFactor, academicScore, majorInterest, spikeProfile,
    });
  }

  const headroomHours = Math.max(0, WELLBEING_LIMITS.sustainable_weekly_hours - totalWeeklyHours);

  // Factor-targeted coaching suggestions (bounded by headroom)
  const factorSuggestions = {
    impact_and_scope: {
      title: "Extend one existing activity beyond the school",
      detail: "Pick the one activity you already love and find a way to touch people outside your school: a workshop at a library, a partnership with a local nonprofit, or sharing your work publicly. Depth of impact beats stacking new clubs.",
      timeCostPerWeek: Math.min(3, headroomHours),
    },
    leadership_and_initiative: {
      title: "Take an initiative inside an activity you're already in",
      detail: "Do not start a new club. Propose one project inside a club you already belong to: organize a tournament, redesign a process, or mentor younger members. Leadership shows best through what you start, not titles you collect.",
      timeCostPerWeek: Math.min(2, headroomHours),
    },
    passion_and_consistency: {
      title: "Create a small body of output you can point to",
      detail: "For an activity you genuinely enjoy, build a visible portfolio: a repo, a blog, a performance reel, a notebook of pieces. Colleges read consistency through artifacts, not hour counts.",
      timeCostPerWeek: Math.min(2, headroomHours),
    },
    talents_and_awards: {
      title: "Enter ONE appropriately-sized competition",
      detail: "Don't chase prestige. Pick a competition that's one step above your current level (regional if you've done school, state if you've done regional). The goal is stretching, not anxiety.",
      timeCostPerWeek: Math.min(2, headroomHours),
    },
    relevance_to_intended_major: majorInterest ? {
      title: `Make one current activity visibly connect to ${majorInterest}`,
      detail: `You do not need a new ${majorInterest} activity. Take something you already do and add a ${majorInterest}-shaped project to it. For example, if you are in debate and interested in CS, build a tool to organize your evidence.`,
      timeCostPerWeek: Math.min(2, headroomHours),
    } : {
      title: "Explore 2-3 possible majors lightly before committing",
      detail: "Without a declared major, relevance is hard to score. Try a short, low-commitment exploration (a summer course, an online project, an informational interview) before reshaping your ECs.",
      timeCostPerWeek: 1,
    },
  };

  // Suggest the weakest factor first, then the second-weakest if time allows.
  for (const factor of [weakestFactor, secondWeakest]) {
    const s = factorSuggestions[factor];
    if (!s) continue;
    if (totalWeeklyHours + s.timeCostPerWeek > WELLBEING_LIMITS.sustainable_weekly_hours) {
      suggestions.push({
        category: "ec_growth_deferred",
        priority: "low",
        factor,
        title: `${s.title} (deferred to protect your time)`,
        detail: `${s.detail}\n\nWe're holding this suggestion back until your weekly load drops below ${WELLBEING_LIMITS.sustainable_weekly_hours} hrs.`,
        timeCostPerWeek: 0,
      });
    } else {
      suggestions.push({
        category: "ec_growth",
        priority: factor === weakestFactor ? "high" : "medium",
        factor,
        title: s.title,
        detail: s.detail,
        timeCostPerWeek: s.timeCostPerWeek,
      });
    }
  }

  if (spikeProfile.primarySuggestion) {
    const spikeSuggestion = {
      category: "ec_spike_strategy",
      priority: spikeProfile.primarySuggestion.priority,
      mode: spikeProfile.mode,
      title: spikeProfile.primarySuggestion.title,
      detail: spikeProfile.primarySuggestion.detail,
      timeCostPerWeek: Math.min(spikeProfile.primarySuggestion.timeCostPerWeek, headroomHours),
      anchorActivities: spikeProfile.anchorActivities,
    };
    if (totalWeeklyHours + spikeSuggestion.timeCostPerWeek > WELLBEING_LIMITS.sustainable_weekly_hours) {
      suggestions.push({
        ...spikeSuggestion,
        category: "ec_spike_strategy_deferred",
        priority: "low",
        timeCostPerWeek: 0,
        title: `${spikeSuggestion.title} (deferred to protect your time)`,
        detail: `${spikeSuggestion.detail}\n\nKeep the idea, but wait until your weekly load drops below ${WELLBEING_LIMITS.sustainable_weekly_hours} hrs before adding more scope.`,
      });
    } else {
      suggestions.push(spikeSuggestion);
    }
  }

  // Academics coaching only via GPA and APs (per policy).
  if (academicScore) {
    if (academicScore.overallAcademicLabel === "needs_strengthening") {
      suggestions.push({
        category: "academics",
        priority: "high",
        title: "Stabilize GPA before stretching further",
        detail: "Your GPA is below average for your current targets. Work with a teacher or tutor on the course where you're losing the most points. GPA stability matters more than adding another AP.",
        timeCostPerWeek: Math.min(3, headroomHours),
      });
    } else if (academicScore.overallAcademicLabel === "reach_for_targets") {
      suggestions.push({
        category: "academics",
        priority: "medium",
        title: "Consider ONE additional AP aligned to your major",
        detail: "You're in the reach zone for your targets. If (and only if) your GPA is stable, adding one AP that matches your intended major is higher-leverage than stacking unrelated APs.",
        timeCostPerWeek: Math.min(4, headroomHours),
      });
    } else if (academicScore.overallAcademicLabel === "competitive_for_targets") {
      suggestions.push({
        category: "academics",
        priority: "low",
        title: "Your GPA + AP load looks competitive; do not over-add",
        detail: "Academically, you're in range for your targets. Protect your GPA, maintain AP quality, and put marginal effort into the EC factor we flagged above.",
        timeCostPerWeek: 0,
      });
    }
  }

  // Invitation for corrections; we never treat our vector as ground truth.
  suggestions.push({
    category: "open_for_correction",
    priority: "informational",
    title: "These estimates are open to your corrections",
    detail: "The EC strength numbers above are an automated read of your descriptions, not a verdict. If any factor looks wrong, you can override it and we'll preserve your override on every recompute.",
    timeCostPerWeek: 0,
  });

  return finalizePlan(suggestions, {
    totalWeeklyHours, wellbeing, factorAverages,
    weakestFactor, academicScore, majorInterest, spikeProfile,
  });
}

export function analyzeMajorSpikeProfile({
  ecVectors = [],
  strengthVectors = [],
  activities = [],
  majorInterest = null,
} = {}) {
  if (!majorInterest) {
    return {
      mode: "explore_before_committing",
      score: 0.2,
      anchorActivities: [],
      primarySuggestion: {
        priority: "medium",
        title: "Explore before forcing a major spike",
        detail: "Your major is still open, so the best move is light exploration rather than prematurely optimizing every EC around one lane.",
        timeCostPerWeek: 1,
      },
    };
  }

  const namedActivities = Array.isArray(activities) ? activities : [];
  const activityByName = new Map(
    namedActivities
      .filter((a) => a?.name)
      .map((a) => [String(a.name), a]),
  );

  const sourceRows = (Array.isArray(strengthVectors) && strengthVectors.length > 0)
    ? strengthVectors.map((row) => ({
        ecName: row.ecName || row.ec_name || row.name || "Unnamed EC",
        spike: Number(row.major_spike ?? row.factors?.major_spike ?? 0),
        leadership: Number(row.leadership ?? row.factors?.leadership ?? 0),
        prestige: Number(row.prestige ?? row.factors?.prestige ?? 0),
        achievement: Number(row.achievement ?? row.factors?.achievement ?? 0),
      }))
    : (Array.isArray(ecVectors) ? ecVectors : []).map((row, index) => ({
        ecName: row.ecName || row.ec_name || namedActivities[index]?.name || `EC ${index + 1}`,
        spike: Number(row.relevance_to_intended_major ?? row.vector?.relevance_to_intended_major ?? 0),
        leadership: Number(row.leadership_and_initiative ?? row.vector?.leadership_and_initiative ?? 0),
        prestige: Number(row.talents_and_awards ?? row.vector?.talents_and_awards ?? 0),
        achievement: Number(row.talents_and_awards ?? row.vector?.talents_and_awards ?? 0),
      }));

  const ranked = sourceRows
    .map((row) => ({
      ...row,
      hours: Number(activityByName.get(row.ecName)?.hoursPerWeek || 0),
    }))
    .sort((a, b) => b.spike - a.spike);

  const top = ranked[0] || null;
  const second = ranked[1] || null;
  const avgSpike = ranked.length
    ? round2(ranked.reduce((sum, row) => sum + row.spike, 0) / ranked.length)
    : 0;
  const anchorActivities = ranked.filter((row) => row.spike >= 0.55).slice(0, 3).map((row) => row.ecName);

  let mode = "build_spike";
  let primarySuggestion = {
    priority: "high",
    title: `Start building one clear ${majorInterest} lane`,
    detail: `Right now your EC list does not yet show a convincing ${majorInterest} spike. Instead of adding random filler, pick one activity and add a concrete ${majorInterest}-shaped project, output, or leadership move to it.`,
    timeCostPerWeek: 2,
  };

  if (top && top.spike >= 0.78 && second && second.spike >= 0.55) {
    const leadershipFloor = round2(ranked.reduce((sum, row) => sum + row.leadership, 0) / Math.max(1, ranked.length));
    if (leadershipFloor < 0.45) {
      mode = "balance_spike_with_leadership";
      primarySuggestion = {
        priority: "medium",
        title: `Keep your ${majorInterest} spike, but add leadership around it`,
        detail: `You already have a real ${majorInterest} lane through ${anchorActivities[0] || "one anchor activity"}. The next unlock is not a new lane. It is giving that lane more ownership: mentor younger students, lead a team, or ship something that other people use.`,
        timeCostPerWeek: 2,
      };
    } else {
      mode = "strengthen_spike";
      primarySuggestion = {
        priority: "medium",
        title: `Double down on your strongest ${majorInterest} lane`,
        detail: `Your profile already shows a credible ${majorInterest} spike anchored by ${anchorActivities[0] || "a top activity"}. Keep reinforcing that lane with harder outputs, stronger external validation, and one clear next-level milestone.`,
        timeCostPerWeek: 2,
      };
    }
  } else if (top && top.spike >= 0.55) {
    mode = "strengthen_spike";
    primarySuggestion = {
      priority: "high",
      title: `Turn your emerging ${majorInterest} spike into something unmistakable`,
      detail: `You have an emerging lane through ${top.ecName}. The next step is coherence: make a stronger artifact, pursue a more selective opportunity, or connect a second activity back to the same ${majorInterest} story.`,
      timeCostPerWeek: 2,
    };
  }

  return {
    mode,
    score: top ? round2(Math.max(avgSpike, top.spike)) : avgSpike,
    averageSpike: avgSpike,
    anchorActivities,
    topActivity: top?.ecName || null,
    supportingActivity: second?.ecName || null,
    primarySuggestion,
  };
}

function finalizePlan(suggestions, context) {
  return {
    wellbeing: context.wellbeing,
    currentLoad: {
      weeklyHours: context.totalWeeklyHours,
      sustainableCap: WELLBEING_LIMITS.sustainable_weekly_hours,
      hardCeiling: WELLBEING_LIMITS.hard_ceiling_weekly_hours,
    },
    factorAverages: context.factorAverages,
    weakestFactor: context.weakestFactor,
    majorInterest: context.majorInterest,
    spikeProfile: context.spikeProfile || null,
    academicSummary: context.academicScore ? {
      label: context.academicScore.overallAcademicLabel,
      gpaFitVsTargets: context.academicScore.gpaFitVsTargets,
      apRigorVsExpectations: context.academicScore.apRigorVsExpectations,
      note: "Academic strength uses GPA and APs only.",
    } : null,
    suggestions,
    openForCorrection: true,
    disclaimer: "This plan is an automated starting point, not a prescription. A human counselor, and most importantly the student's own judgment about what feels healthy, should always override this.",
  };
}

function assessWellbeing(totalWeeklyHours) {
  if (totalWeeklyHours >= WELLBEING_LIMITS.hard_ceiling_weekly_hours) {
    return {
      status: "overloaded",
      message: `You're currently at ${totalWeeklyHours} hrs/week of ECs, above the ${WELLBEING_LIMITS.hard_ceiling_weekly_hours}-hr hard ceiling. This is unsustainable. Please talk to a trusted adult about what to drop.`,
      weeklyHours: totalWeeklyHours,
    };
  }
  if (totalWeeklyHours >= WELLBEING_LIMITS.caution_weekly_hours) {
    return {
      status: "caution",
      message: `You're at ${totalWeeklyHours} hrs/week of ECs, above the caution line of ${WELLBEING_LIMITS.caution_weekly_hours}. New suggestions will only be additive if you have real headroom.`,
      weeklyHours: totalWeeklyHours,
    };
  }
  if (totalWeeklyHours >= WELLBEING_LIMITS.sustainable_weekly_hours) {
    return {
      status: "full",
      message: `You're at ${totalWeeklyHours} hrs/week of ECs, at the edge of our sustainable range. We will suggest depth, not breadth.`,
      weeklyHours: totalWeeklyHours,
    };
  }
  return {
    status: "healthy",
    message: `You're at ${totalWeeklyHours} hrs/week of ECs, within a sustainable range. Protect at least ${WELLBEING_LIMITS.min_sleep_hours_per_night} hours of sleep nightly as a non-negotiable foundation.`,
    weeklyHours: totalWeeklyHours,
  };
}

// Utilities
export function normalizeText(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function countHits(text, keywords) {
  let n = 0;
  for (const k of keywords) {
    if (text.includes(k)) n += 1;
  }
  return n;
}

export function extractNumericImpact(text) {
  const result = { people: 0, dollars: 0 };
  const peopleMatch = text.match(/(\d[\d,]*)\s*(people|students|users|attendees|beneficiaries|volunteers|kids|children|members)/);
  if (peopleMatch) {
    const n = Number(peopleMatch[1].replace(/,/g, ""));
    if (!isNaN(n)) result.people = n;
  }
  const dollarMatch = text.match(/\$\s*(\d[\d,]*)/);
  if (dollarMatch) {
    const n = Number(dollarMatch[1].replace(/,/g, ""));
    if (!isNaN(n)) result.dollars = n;
  }
  return result;
}

// Student directionality vectorization
// Represents overall student trajectory across academics, interests, and tests.
// Five independent factors (not merged into a single score per Korea AI Act):
//   1. academic_momentum: GPA trend + position
//   2. test_score_strength: SAT/ACT vs T20 percentile
//   3. major_academic_fit: AP/GPA alignment with intended major
//   4. rigor_and_challenge: AP load vs GPA ratio
//   5. overall_academic_standing: composite readiness
// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??
export function initDirectionalityTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS student_directionality (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,

      -- Five independent directionality factors (0.0-1.0 each)
      academic_momentum REAL DEFAULT 0,
      test_score_strength REAL DEFAULT 0,
      major_academic_fit REAL DEFAULT 0,
      rigor_and_challenge REAL DEFAULT 0,
      overall_academic_standing REAL DEFAULT 0,

      -- Composite label (coarse, non-ranking)
      directionality_label TEXT,

      -- Supporting metrics (for explanation)
      gpa_unweighted REAL,
      gpa_percentile_t20 REAL,
      ap_count INTEGER,
      sat_total INTEGER,
      sat_percentile_t20 REAL,
      act_total INTEGER,
      act_percentile_t20 REAL,
      major_interest TEXT,

      -- Override support
      is_overridden INTEGER DEFAULT 0,
      override_json TEXT,

      -- Reasoning and metadata
      reasoning_json TEXT,

      computed_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_student_directionality_student
      ON student_directionality(student_id, computed_at DESC);
  `);
}

export function prepareDirectionalityStatements(db) {
  return {
    upsertDirectionality: db.prepare(`
      INSERT INTO student_directionality
        (id, student_id,
         academic_momentum, test_score_strength, major_academic_fit,
         rigor_and_challenge, overall_academic_standing,
         directionality_label,
         gpa_unweighted, gpa_percentile_t20, ap_count,
         sat_total, sat_percentile_t20, act_total, act_percentile_t20,
         major_interest,
         reasoning_json, is_overridden, override_json,
         computed_at, updated_at)
      VALUES (?,?,?,?,?, ?,?,?, ?,?,?, ?,?,?,?, ?, ?,?,?, datetime('now'), datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        academic_momentum = excluded.academic_momentum,
        test_score_strength = excluded.test_score_strength,
        major_academic_fit = excluded.major_academic_fit,
        rigor_and_challenge = excluded.rigor_and_challenge,
        overall_academic_standing = excluded.overall_academic_standing,
        directionality_label = excluded.directionality_label,
        gpa_percentile_t20 = excluded.gpa_percentile_t20,
        reasoning_json = excluded.reasoning_json,
        updated_at = datetime('now')
    `),
    getByStudent: db.prepare(`
      SELECT * FROM student_directionality
      WHERE student_id = ?
      ORDER BY computed_at DESC LIMIT 1
    `),
    getByStudentHistory: db.prepare(`
      SELECT * FROM student_directionality
      WHERE student_id = ?
      ORDER BY computed_at DESC LIMIT 10
    `),
    deleteByStudent: db.prepare(`
      DELETE FROM student_directionality WHERE student_id = ?
    `),
    applyOverride: db.prepare(`
      UPDATE student_directionality
      SET academic_momentum = COALESCE(?, academic_momentum),
          test_score_strength = COALESCE(?, test_score_strength),
          major_academic_fit = COALESCE(?, major_academic_fit),
          rigor_and_challenge = COALESCE(?, rigor_and_challenge),
          overall_academic_standing = COALESCE(?, overall_academic_standing),
          is_overridden = 1,
          override_json = ?,
          updated_at = datetime('now')
      WHERE student_id = ?
    `)
  };
}

/**
 * Compute overall student directionality across academics, test scores, and major fit.
 * Returns five independent factors (not merged into a single score).
 *
 * @param {object} params
 * @param {object} params.academics - { gpaUnweighted, apCourses, courses }
 * @param {Array} params.testScores - [{ test: "sat"|"act", totalScore }]
 * @param {string} params.majorInterest - intended major
 * @param {object} params.priorSnapshot - previous profile snapshot (for trend detection)
 * @param {object} params.gpaBaselines - baseline GPA percentile data
 * @param {object} params.satBaselines - baseline SAT percentile data
 * @param {object} params.actBaselines - baseline ACT percentile data
 * @param {Array} params.collegeProfiles - baseline college profiles
 * @returns {{ factors, label, metrics, reasoning }}
 */
export function vectorizeDirectionality({
  academics = {},
  testScores = [],
  majorInterest = null,
  priorSnapshot = null,
  gpaBaselines = [],
  satBaselines = [],
  actBaselines = [],
  collegeProfiles = [],
} = {}) {
  const reasoning = [];
  const factors = {};
  const metrics = {};

  // Extract current data
  const gpaUw = Number(academics.gpaUnweighted ?? academics.gpa?.unweighted ?? 0);
  const apCourses = Array.isArray(academics.apCourses)
    ? academics.apCourses
    : (academics.courses || []).filter((c) => c.type === "ap" || c.level === "AP");

  // ??? Factor 1: Academic Momentum (GPA trend + position) ???
  // Momentum = GPA position + trend adjustment. Trend adjustment applies
  // regardless of whether baseline tables are available ??a decline of
  // several tenths of a point is a real signal even in the absence of
  // percentile data.
  let momentum = 0.5; // neutral default
  let trendDirection = null; // "improving" | "flat" | "declining" | null
  if (gpaUw > 0) {
    const t20Baseline = gpaBaselines.find(b => b.scope === "t20_admitted");
    const normalizedGPA = Math.min(gpaUw / 4.0, 1.0);
    // When a baseline is available, reserve headroom so that improving
    // students have a way to climb; otherwise use the raw normalized GPA.
    momentum = t20Baseline ? normalizedGPA * 0.7 : normalizedGPA;

    // Trend: apply in both branches, scaling the adjustment with the size
    // of the GPA delta so dramatic swings get proportionally weighted.
    if (priorSnapshot) {
      const priorGPA = Number(priorSnapshot.gpa_unweighted ?? 0);
      if (priorGPA > 0) {
        const gpaDelta = gpaUw - priorGPA;
        if (gpaDelta > 0.1) {
          trendDirection = "improving";
          momentum += Math.min(0.3, 0.5 * gpaDelta + 0.1);
        } else if (gpaDelta < -0.1) {
          trendDirection = "declining";
          momentum -= Math.min(0.5, 0.5 * Math.abs(gpaDelta) + 0.2);
        } else {
          trendDirection = "flat";
        }
      }
    }
  }
  factors.academic_momentum = round2(clamp01(momentum));
  reasoning.push(`Academic momentum: ${factors.academic_momentum} (GPA ${gpaUw.toFixed(2)}${priorSnapshot ? `, trend: ${trendDirection || 'unknown'}` : ''})`);

  // ??? Factor 2: Test Score Strength (SAT/ACT vs T20) ???
  let testStrength = 0.5; // neutral if no test yet
  let satPercentile = null;
  let actPercentile = null;
  let satScore = null;
  let actScore = null;

  const satEntry = testScores.find(t => t.test === "sat");
  if (satEntry) {
    satScore = satEntry.totalScore;
    // Simple percentile: SAT ranges 400-1600; T20 is roughly 1450-1570
    // Map 1450+ to 90th percentile, 1200 to 50th, 800 to 0th
    if (satScore >= 1450) satPercentile = 0.9;
    else if (satScore >= 1350) satPercentile = 0.75;
    else if (satScore >= 1200) satPercentile = 0.5;
    else if (satScore >= 1000) satPercentile = 0.25;
    else satPercentile = 0.0;
    testStrength = satPercentile;
  }

  const actEntry = testScores.find(t => t.test === "act");
  if (actEntry) {
    actScore = actEntry.totalScore;
    // ACT ranges 1-36; T20 is roughly 33-35
    if (actScore >= 33) actPercentile = 0.9;
    else if (actScore >= 31) actPercentile = 0.75;
    else if (actScore >= 28) actPercentile = 0.5;
    else if (actScore >= 24) actPercentile = 0.25;
    else actPercentile = 0.0;
    if (testStrength === 0.5) testStrength = actPercentile;
  }

  factors.test_score_strength = round2(clamp01(testStrength));
  metrics.satTotal = satScore;
  metrics.satPercentileT20 = satPercentile;
  metrics.actTotal = actScore;
  metrics.actPercentileT20 = actPercentile;
  reasoning.push(`Test score strength: ${factors.test_score_strength}${satScore ? ` (SAT ${satScore})` : ''}${actScore ? ` (ACT ${actScore})` : ''}${!satScore && !actScore ? ' (no tests yet)' : ''}`);

  // ??? Factor 3: Major-Academic Fit (AP/GPA alignment with major) ???
  let majorFit = 0.5; // neutral default
  if (majorInterest) {
    const majorBucket = matchMajorBucket(majorInterest);
    const majorExpectedAPs = {
      computer_science: ["Calculus BC", "Computer Science A", "Physics"],
      engineering: ["Calculus BC", "Physics", "Chemistry"],
      biology: ["Biology", "Chemistry", "AP Lab", "Physics"],
      chemistry: ["Chemistry", "Calculus BC", "Physics"],
      physics: ["Physics C", "Calculus BC", "Physics B"],
      mathematics: ["Calculus BC", "Calculus AB"],
      economics: ["Micro/Macro", "Calculus"],
      business: ["Micro/Macro", "Statistics"],
    };

    const expected = majorExpectedAPs[majorBucket] || [];
    let apOverlap = 0;
    if (expected.length > 0) {
      apOverlap = apCourses.filter((ac) =>
        expected.some((e) => (ac.name || "").toLowerCase().includes(e.toLowerCase()))
      ).length;
    }

    // AP alignment: what % of expected do they have?
    const apAlignment = expected.length > 0 ? clamp01(apOverlap / expected.length) : 0.5;

    // GPA alignment: match GPA vs colleges that offer this major
    let gpaAlignment = 0.5;
    const collegesWithMajor = collegeProfiles.filter((c) => {
      const topMajors = safeArray(c.top_majors_json || c.topMajors || []);
      return topMajors.some((m) => normalizeText(m).includes(normalizeText(majorInterest)));
    });
    if (collegesWithMajor.length > 0) {
      const avgAdmitted = collegesWithMajor.reduce((sum, c) => sum + (Number(c.avg_gpa_admitted) || 0), 0) / collegesWithMajor.length;
      if (avgAdmitted > 0) {
        gpaAlignment = clamp01(0.5 + (gpaUw - avgAdmitted) / 0.5);
      }
    }

    majorFit = (apAlignment + gpaAlignment) / 2;
  }
  factors.major_academic_fit = round2(clamp01(majorFit));
  metrics.majorInterest = majorInterest;
  reasoning.push(`Major-academic fit: ${factors.major_academic_fit}${majorInterest ? ` (${majorInterest})` : ''}`);

  // ??? Factor 4: Rigor and Challenge (AP load vs GPA) ???
  let rigor = 0.2; // default for 0 APs
  const apCount = apCourses.length;
  if (apCount >= 6 && gpaUw >= 3.7) rigor = 1.0; // managing lots of rigor well
  else if (apCount >= 4 && gpaUw >= 3.5) rigor = 0.8;
  else if (apCount >= 3 && gpaUw >= 3.3) rigor = 0.6;
  else if (apCount >= 1 && gpaUw >= 3.0) rigor = 0.4;
  else if (apCount === 0) rigor = 0.2;
  else rigor = 0.5; // mixed signals

  // Penalize if GPA is too low for AP load
  if (apCount > 0 && gpaUw < 3.0) rigor *= 0.7;

  factors.rigor_and_challenge = round2(clamp01(rigor));
  metrics.apCount = apCount;
  reasoning.push(`Rigor & challenge: ${factors.rigor_and_challenge} (${apCount} APs, GPA ${gpaUw.toFixed(2)})`);

  // ??? Factor 5: Overall Academic Standing (composite) ???
  // Weighted composite of GPA, AP count, and test score
  const gpaComponent = clamp01(gpaUw / 4.0); // 0-1 normalized GPA
  const apComponent = clamp01(apCount / 8); // 8 APs is typical for T20
  const testComponent = testStrength; // already 0-1 from Factor 2
  const standing = (gpaComponent * 0.4) + (apComponent * 0.3) + (testComponent * 0.3);

  factors.overall_academic_standing = round2(clamp01(standing));
  reasoning.push(`Overall academic standing: ${factors.overall_academic_standing}`);

  // Directionality label (coarse, categorical)
  // Priority, per the implementation plan:
  //   declining    negative GPA trend OR momentum < 0.4
  //   early_stage  no APs yet (insufficient rigor evidence, even if the
  //                  student already has a test score)
  //   strong_upward high momentum + standing AND trend is not flat
  //   stable_strong high momentum + standing, flat/unknown trend
  //   stable_developing otherwise
  let label;
  if (trendDirection === "declining" || factors.academic_momentum < 0.4) {
    label = "declining";
  } else if (apCount === 0) {
    label = "early_stage";
  } else if (
    factors.academic_momentum >= 0.7 &&
    factors.overall_academic_standing >= 0.7 &&
    trendDirection !== "flat"
  ) {
    label = "strong_upward";
  } else if (
    factors.academic_momentum >= 0.6 &&
    factors.overall_academic_standing >= 0.6
  ) {
    label = "stable_strong";
  } else if (
    factors.academic_momentum >= 0.4 &&
    factors.overall_academic_standing >= 0.4
  ) {
    label = "stable_developing";
  } else {
    label = "stable_developing";
  }

  return {
    factors,
    label,
    metrics: {
      gpaUnweighted: gpaUw,
      gpaPercentileT20: satPercentile, // proxy
      apCount,
      satTotal: satScore,
      satPercentileT20: satPercentile,
      actTotal: actScore,
      actPercentileT20: actPercentile,
      majorInterest,
    },
    reasoning,
  };
}

/**
 * Recompute directionality for a student, preserving overrides.
 * Called automatically on every syncStudentData().
 *
 * @param {object} dirStmts - prepared statements for directionality table
 * @param {string} studentId - student UUID
 * @param {object} currentSnapshot - current profile snapshot
 * @param {object} priorSnapshot - prior profile snapshot (if exists)
 * @param {object} allSnapshots - all profile snapshots (for trend data)
 * @param {Array} gpaBaselines - baseline GPA data
 * @param {Array} satBaselines - baseline SAT data
 * @param {Array} actBaselines - baseline ACT data
 * @param {Array} collegeProfiles - baseline college profiles
 * @returns {{ id, factors, label, metrics, reasoning, isOverridden, computedAt }}
 */
export function recomputeStudentDirectionality(
  dirStmts,
  studentId,
  currentSnapshot,
  priorSnapshot = null,
  allSnapshots = [],
  gpaBaselines = [],
  satBaselines = [],
  actBaselines = [],
  collegeProfiles = []
) {
  const academics = {
    gpaUnweighted: currentSnapshot.gpa_unweighted,
    apCourses: safeArray(currentSnapshot.ap_scores_json),
    courses: safeArray(currentSnapshot.courses_json),
  };

  const testScores = safeArray(currentSnapshot.test_scores_json);
  const majorInterest = currentSnapshot.major_interest;

  // Compute fresh vector
  const { factors, label, metrics, reasoning } = vectorizeDirectionality({
    academics,
    testScores,
    majorInterest,
    priorSnapshot,
    gpaBaselines,
    satBaselines,
    actBaselines,
    collegeProfiles,
  });

  // Check if student has previously overridden directionality
  const existing = dirStmts.getByStudent.get(studentId);
  let finalFactors = factors;
  let isOverridden = 0;
  let overrideJson = null;

  if (existing && existing.is_overridden) {
    isOverridden = 1;
    overrideJson = existing.override_json;
    // Preserve override values
    try {
      const overrides = JSON.parse(overrideJson);
      if (overrides.academic_momentum !== undefined) finalFactors.academic_momentum = overrides.academic_momentum;
      if (overrides.test_score_strength !== undefined) finalFactors.test_score_strength = overrides.test_score_strength;
      if (overrides.major_academic_fit !== undefined) finalFactors.major_academic_fit = overrides.major_academic_fit;
      if (overrides.rigor_and_challenge !== undefined) finalFactors.rigor_and_challenge = overrides.rigor_and_challenge;
      if (overrides.overall_academic_standing !== undefined) finalFactors.overall_academic_standing = overrides.overall_academic_standing;
    } catch (e) {
      // Ignore parse errors, use computed values
    }
  }

  const id = existing?.id || crypto.randomUUID();
  dirStmts.upsertDirectionality.run(
    id, studentId,
    finalFactors.academic_momentum,
    finalFactors.test_score_strength,
    finalFactors.major_academic_fit,
    finalFactors.rigor_and_challenge,
    finalFactors.overall_academic_standing,
    label,
    metrics.gpaUnweighted,
    metrics.gpaPercentileT20,
    metrics.apCount,
    metrics.satTotal,
    metrics.satPercentileT20,
    metrics.actTotal,
    metrics.actPercentileT20,
    majorInterest,
    JSON.stringify(reasoning),
    isOverridden,
    overrideJson,
  );

  return {
    id,
    factors: finalFactors,
    label,
    metrics,
    reasoning,
    isOverridden: Boolean(isOverridden),
    computedAt: new Date().toISOString(),
  };
}

export function matchMajorBucket(major) {
  const m = normalizeText(major);
  // Order is deliberate: MORE-specific buckets before their generic parents
  // so "computational biology" doesn't collapse to "biology".
  if (/computational biology|comp bio|bioinformatic|biostat|genomic|mitochondrial/.test(m)) return "computational_biology";
  if (/biomedical engineer|bme\b|medical device/.test(m)) return "biomedical_engineering";
  if (/materials science|nanotech|metallurgy|polymer/.test(m)) return "materials_science";
  if (/data science|statistic|\banalytics\b/.test(m)) return "data_science";
  if (/neuroscience|neural|\bbrain\b|cognitive/.test(m)) return "neuroscience";
  if (/\b(cs|comp sci|computer sci|computer science|software)\b/.test(m)) return "computer_science";
  if (/engineer/.test(m)) return "engineering";
  if (/bio|pre.?med/.test(m)) return "biology";
  if (/chem/.test(m)) return "chemistry";
  if (/physic|astrophys/.test(m)) return "physics";
  if (/math/.test(m)) return "mathematics";
  if (/econ/.test(m)) return "economics";
  if (/business|finance|entrepreneur/.test(m)) return "business";
  if (/public policy|think tank|nonprofit/.test(m)) return "public_policy";
  if (/international relations|ir\b|diplomac|foreign policy|geopolitic/.test(m)) return "international_relations";
  if (/politic|government/.test(m)) return "political_science";
  if (/history/.test(m)) return "history";
  if (/journalism|reporter|newspaper/.test(m)) return "journalism";
  if (/linguistic|phonolog/.test(m)) return "linguistics";
  if (/philosoph|ethic|bioethic/.test(m)) return "philosophy";
  if (/anthropolog|ethnograph/.test(m)) return "anthropology";
  if (/english|literature|writing/.test(m)) return "english";
  if (/psych/.test(m)) return "psychology";
  if (/architecture|urban design/.test(m)) return "architecture";
  if (/\bfilm\b|cinematograph|screenplay/.test(m)) return "film";
  if (/\bart\b|fine arts|visual/.test(m)) return "art";
  if (/music/.test(m)) return "music";
  if (/theat(er|re)|drama/.test(m)) return "theater";
  if (/environment|climate|sustainab/.test(m)) return "environmental_science";
  if (/public health|epidemiolog/.test(m)) return "public_health";
  if (/education|teaching|pedagog|tutoring/.test(m)) return "education";
  return "computer_science"; // sensible neutral default
}

export function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

export function round2(x) {
  return Math.round((x || 0) * 100) / 100;
}

function safeArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}



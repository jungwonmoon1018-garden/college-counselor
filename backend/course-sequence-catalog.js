// ═══════════════════════════════════════════════════════════════════════
// COURSE SEQUENCE CATALOG — major-aligned reference course ladders
// ═══════════════════════════════════════════════════════════════════════
// A static, auditable reference of the courses that a coherent transcript
// for a given major bucket typically demonstrates, ordered foundational →
// advanced. This is the qualitative companion to the AP-concept mastery
// vectors: where ap-concept-vectorizer.js tells us how deeply a student
// understands a subject they've taken, this catalog tells us which courses
// a major-aligned student is *expected* to have on the transcript at all.
//
// DESIGN CONSTRAINTS (mirrors competition-research.js OFFICIAL_* tables and
// ap-concept-catalog.js):
//   • Bucket keys MUST match positioning-engine.js MAJOR_DEMAND_BASE /
//     ec-vectorizer.js matchMajorBucket output, so the same major resolves
//     to the same ladder everywhere in the app.
//   • Each course carries `match` keywords used to detect whether the
//     student already has it on their transcript (lowercased substring).
//   • `apSubject` ties a course to an AP_* subject id from
//     ap-concept-catalog.js so the recommender can pull concept-level
//     mastery / gap signals. null = no direct AP analog.
//   • `level`: foundational → core → advanced → recommended. The first
//     three form the spine; `recommended` courses strengthen the spike but
//     are not strictly expected.
//   • `why`: a one-line, major-specific rationale. This is COACHING/
//     INFERENCE content — never presented as a verified requirement unless
//     a cited school expectation backs it (see server.js lane assignment).
//
// This catalog encodes typical US high-school → selective-admit
// expectations. It is intentionally conservative and small; extend it
// rather than letting the model invent sequences at runtime.
// ═══════════════════════════════════════════════════════════════════════

export const COURSE_SEQUENCES = Object.freeze({
  computer_science: {
    label: "Computer Science",
    courses: [
      { id: "precalc", name: "Precalculus", level: "foundational", match: ["precalc", "pre-calc", "pre calculus"], apSubject: "AP_PRECALCULUS", why: "Establishes the functions-and-limits groundwork every calculus-based CS curriculum assumes." },
      { id: "calc_ab", name: "AP Calculus AB", level: "core", match: ["calculus ab", "calc ab", "ap calc"], apSubject: "AP_CALCULUS_AB", why: "Selective CS programs read calculus as the baseline signal of quantitative readiness." },
      { id: "calc_bc", name: "AP Calculus BC", level: "advanced", match: ["calculus bc", "calc bc"], apSubject: "AP_CALCULUS_BC", why: "BC over AB shows you can carry a faster math pace — useful for a high-demand major like CS." },
      { id: "csa", name: "AP Computer Science A", level: "core", match: ["computer science a", "cs a", "csa", "ap computer science"], apSubject: "AP_COMPUTER_SCIENCE_A", why: "The single most direct demonstration of programming proficiency in the intended field." },
      { id: "stats", name: "AP Statistics", level: "recommended", match: ["statistics", "ap stat"], apSubject: "AP_STATISTICS", why: "Probability and inference underpin machine learning and data-heavy CS subfields." },
      { id: "physics_c", name: "AP Physics C: Mechanics", level: "recommended", match: ["physics c", "physics c mechanics"], apSubject: "AP_PHYSICS_C_MECHANICS", why: "Calculus-based physics reinforces the modeling mindset and rounds out STEM rigor." },
    ],
  },
  data_science: {
    label: "Data Science",
    courses: [
      { id: "precalc", name: "Precalculus", level: "foundational", match: ["precalc", "pre-calc"], apSubject: "AP_PRECALCULUS", why: "Function fluency is the precondition for both calculus and statistical modeling." },
      { id: "calc_ab", name: "AP Calculus AB", level: "core", match: ["calculus ab", "calc ab", "ap calc"], apSubject: "AP_CALCULUS_AB", why: "Calculus grounds the optimization math behind data-science methods." },
      { id: "stats", name: "AP Statistics", level: "core", match: ["statistics", "ap stat"], apSubject: "AP_STATISTICS", why: "The most major-relevant course you can take — inference is the core of the field." },
      { id: "csa", name: "AP Computer Science A", level: "core", match: ["computer science a", "cs a", "csa", "ap computer science"], apSubject: "AP_COMPUTER_SCIENCE_A", why: "Programming is the tool data is wrangled and modeled with." },
      { id: "calc_bc", name: "AP Calculus BC", level: "recommended", match: ["calculus bc", "calc bc"], apSubject: "AP_CALCULUS_BC", why: "Deeper calculus helps with the math behind advanced models." },
    ],
  },
  engineering: {
    label: "Engineering",
    courses: [
      { id: "precalc", name: "Precalculus", level: "foundational", match: ["precalc", "pre-calc"], apSubject: "AP_PRECALCULUS", why: "Trigonometry and functions are used constantly in engineering coursework." },
      { id: "calc_ab", name: "AP Calculus AB", level: "core", match: ["calculus ab", "calc ab", "ap calc"], apSubject: "AP_CALCULUS_AB", why: "Engineering is calculus-saturated from the first college term." },
      { id: "calc_bc", name: "AP Calculus BC", level: "advanced", match: ["calculus bc", "calc bc"], apSubject: "AP_CALCULUS_BC", why: "BC signals readiness for the accelerated math engineering programs expect." },
      { id: "physics1", name: "AP Physics 1", level: "core", match: ["physics 1", "ap physics 1"], apSubject: "AP_PHYSICS_1", why: "Mechanics is the conceptual backbone of most engineering disciplines." },
      { id: "physics_c", name: "AP Physics C: Mechanics", level: "advanced", match: ["physics c", "physics c mechanics"], apSubject: "AP_PHYSICS_C_MECHANICS", why: "Calculus-based physics is the strongest pre-engineering signal available." },
      { id: "chem", name: "AP Chemistry", level: "recommended", match: ["chemistry", "ap chem"], apSubject: "AP_CHEMISTRY", why: "Materials, chemical, and biomedical tracks lean on chemistry foundations." },
    ],
  },
  biomedical_engineering: {
    label: "Biomedical Engineering",
    courses: [
      { id: "calc_ab", name: "AP Calculus AB", level: "core", match: ["calculus ab", "calc ab", "ap calc"], apSubject: "AP_CALCULUS_AB", why: "Calculus is required infrastructure for any engineering track." },
      { id: "calc_bc", name: "AP Calculus BC", level: "advanced", match: ["calculus bc", "calc bc"], apSubject: "AP_CALCULUS_BC", why: "Shows you can sustain the math pace BME demands." },
      { id: "physics_c", name: "AP Physics C: Mechanics", level: "core", match: ["physics c", "physics c mechanics"], apSubject: "AP_PHYSICS_C_MECHANICS", why: "Calculus-based physics is the canonical engineering-readiness signal." },
      { id: "bio", name: "AP Biology", level: "core", match: ["biology", "ap bio"], apSubject: "AP_BIOLOGY", why: "The 'biomedical' half of the major rests on a real biology foundation." },
      { id: "chem", name: "AP Chemistry", level: "recommended", match: ["chemistry", "ap chem"], apSubject: "AP_CHEMISTRY", why: "Biochemistry and materials work draw directly on chemistry." },
    ],
  },
  computational_biology: {
    label: "Computational Biology",
    courses: [
      { id: "calc_ab", name: "AP Calculus AB", level: "core", match: ["calculus ab", "calc ab", "ap calc"], apSubject: "AP_CALCULUS_AB", why: "Quantitative modeling of biological systems starts with calculus." },
      { id: "bio", name: "AP Biology", level: "core", match: ["biology", "ap bio"], apSubject: "AP_BIOLOGY", why: "The biological substance the computation is applied to." },
      { id: "csa", name: "AP Computer Science A", level: "core", match: ["computer science a", "cs a", "csa", "ap computer science"], apSubject: "AP_COMPUTER_SCIENCE_A", why: "Bioinformatics is programming applied to biology — this is the bridge course." },
      { id: "stats", name: "AP Statistics", level: "recommended", match: ["statistics", "ap stat"], apSubject: "AP_STATISTICS", why: "Biostatistics and genomics analysis are inference-heavy." },
    ],
  },
  biology: {
    label: "Biology",
    courses: [
      { id: "bio", name: "AP Biology", level: "core", match: ["biology", "ap bio"], apSubject: "AP_BIOLOGY", why: "The most major-relevant course you can take for a biology applicant." },
      { id: "chem", name: "AP Chemistry", level: "core", match: ["chemistry", "ap chem"], apSubject: "AP_CHEMISTRY", why: "Molecular and cellular biology rest on a chemistry foundation." },
      { id: "calc_ab", name: "AP Calculus AB", level: "recommended", match: ["calculus ab", "calc ab", "ap calc"], apSubject: "AP_CALCULUS_AB", why: "Calculus broadens options into quantitative and pre-med tracks." },
      { id: "stats", name: "AP Statistics", level: "recommended", match: ["statistics", "ap stat"], apSubject: "AP_STATISTICS", why: "Experimental biology depends on statistical reasoning." },
    ],
  },
  chemistry: {
    label: "Chemistry",
    courses: [
      { id: "chem", name: "AP Chemistry", level: "core", match: ["chemistry", "ap chem"], apSubject: "AP_CHEMISTRY", why: "The defining course for the major." },
      { id: "calc_ab", name: "AP Calculus AB", level: "core", match: ["calculus ab", "calc ab", "ap calc"], apSubject: "AP_CALCULUS_AB", why: "Physical chemistry and kinetics are calculus-based." },
      { id: "physics1", name: "AP Physics 1", level: "recommended", match: ["physics 1", "ap physics 1"], apSubject: "AP_PHYSICS_1", why: "Physical chemistry sits at the chemistry–physics boundary." },
      { id: "bio", name: "AP Biology", level: "recommended", match: ["biology", "ap bio"], apSubject: "AP_BIOLOGY", why: "Opens biochemistry and pre-health directions." },
    ],
  },
  physics: {
    label: "Physics",
    courses: [
      { id: "calc_ab", name: "AP Calculus AB", level: "core", match: ["calculus ab", "calc ab", "ap calc"], apSubject: "AP_CALCULUS_AB", why: "Physics is calculus expressed in the physical world." },
      { id: "calc_bc", name: "AP Calculus BC", level: "advanced", match: ["calculus bc", "calc bc"], apSubject: "AP_CALCULUS_BC", why: "Upper-level physics assumes BC-level fluency." },
      { id: "physics_c_mech", name: "AP Physics C: Mechanics", level: "core", match: ["physics c mechanics", "physics c mech"], apSubject: "AP_PHYSICS_C_MECHANICS", why: "Calculus-based mechanics is the strongest physics-readiness signal." },
      { id: "physics_c_em", name: "AP Physics C: E&M", level: "advanced", match: ["physics c e&m", "physics c em", "electricity"], apSubject: "AP_PHYSICS_C_EM", why: "E&M completes the calculus-based physics pair top programs look for." },
    ],
  },
  mathematics: {
    label: "Mathematics",
    courses: [
      { id: "calc_ab", name: "AP Calculus AB", level: "core", match: ["calculus ab", "calc ab", "ap calc"], apSubject: "AP_CALCULUS_AB", why: "The entry point to the major's core sequence." },
      { id: "calc_bc", name: "AP Calculus BC", level: "advanced", match: ["calculus bc", "calc bc"], apSubject: "AP_CALCULUS_BC", why: "BC is effectively expected for a math applicant." },
      { id: "stats", name: "AP Statistics", level: "recommended", match: ["statistics", "ap stat"], apSubject: "AP_STATISTICS", why: "Broadens the mathematical base into probability and inference." },
      { id: "csa", name: "AP Computer Science A", level: "recommended", match: ["computer science a", "cs a", "csa", "ap computer science"], apSubject: "AP_COMPUTER_SCIENCE_A", why: "Computational math and proofs-via-code are increasingly central." },
    ],
  },
  economics: {
    label: "Economics",
    courses: [
      { id: "calc_ab", name: "AP Calculus AB", level: "core", match: ["calculus ab", "calc ab", "ap calc"], apSubject: "AP_CALCULUS_AB", why: "Selective economics programs are quantitative and assume calculus." },
      { id: "micro", name: "AP Microeconomics", level: "core", match: ["microeconomics", "ap micro"], apSubject: "AP_MICROECONOMICS", why: "Direct demonstration of interest and aptitude in the field." },
      { id: "macro", name: "AP Macroeconomics", level: "core", match: ["macroeconomics", "ap macro"], apSubject: "AP_MACROECONOMICS", why: "The complementary half of the introductory economics pair." },
      { id: "stats", name: "AP Statistics", level: "recommended", match: ["statistics", "ap stat"], apSubject: "AP_STATISTICS", why: "Econometrics rests on statistical inference." },
    ],
  },
  business: {
    label: "Business",
    courses: [
      { id: "micro", name: "AP Microeconomics", level: "core", match: ["microeconomics", "ap micro"], apSubject: "AP_MICROECONOMICS", why: "Grounds business interest in real economic reasoning." },
      { id: "macro", name: "AP Macroeconomics", level: "recommended", match: ["macroeconomics", "ap macro"], apSubject: "AP_MACROECONOMICS", why: "Adds the systems-level view of markets." },
      { id: "calc_ab", name: "AP Calculus AB", level: "core", match: ["calculus ab", "calc ab", "ap calc"], apSubject: "AP_CALCULUS_AB", why: "Quantitative business and finance tracks expect calculus." },
      { id: "stats", name: "AP Statistics", level: "recommended", match: ["statistics", "ap stat"], apSubject: "AP_STATISTICS", why: "Data-driven decision-making is the modern business baseline." },
    ],
  },
  neuroscience: {
    label: "Neuroscience",
    courses: [
      { id: "bio", name: "AP Biology", level: "core", match: ["biology", "ap bio"], apSubject: "AP_BIOLOGY", why: "Neuroscience is built on a cellular-and-systems biology foundation." },
      { id: "chem", name: "AP Chemistry", level: "core", match: ["chemistry", "ap chem"], apSubject: "AP_CHEMISTRY", why: "Neurochemistry and pre-health tracks require chemistry." },
      { id: "psych", name: "AP Psychology", level: "recommended", match: ["psychology", "ap psych"], apSubject: "AP_PSYCHOLOGY", why: "Bridges the biological and behavioral sides of the field." },
      { id: "calc_ab", name: "AP Calculus AB", level: "recommended", match: ["calculus ab", "calc ab", "ap calc"], apSubject: "AP_CALCULUS_AB", why: "Computational neuroscience and pre-med both benefit from calculus." },
    ],
  },
  public_health: {
    label: "Public Health",
    courses: [
      { id: "bio", name: "AP Biology", level: "core", match: ["biology", "ap bio"], apSubject: "AP_BIOLOGY", why: "Epidemiology rests on a biology foundation." },
      { id: "stats", name: "AP Statistics", level: "core", match: ["statistics", "ap stat"], apSubject: "AP_STATISTICS", why: "Public health is fundamentally a statistical discipline." },
      { id: "chem", name: "AP Chemistry", level: "recommended", match: ["chemistry", "ap chem"], apSubject: "AP_CHEMISTRY", why: "Toxicology and environmental health draw on chemistry." },
    ],
  },
  environmental_science: {
    label: "Environmental Science",
    courses: [
      { id: "apes", name: "AP Environmental Science", level: "core", match: ["environmental science", "apes", "ap es"], apSubject: "AP_ENVIRONMENTAL_SCIENCE", why: "The most direct demonstration of field interest." },
      { id: "bio", name: "AP Biology", level: "core", match: ["biology", "ap bio"], apSubject: "AP_BIOLOGY", why: "Ecology and conservation rest on biology." },
      { id: "chem", name: "AP Chemistry", level: "recommended", match: ["chemistry", "ap chem"], apSubject: "AP_CHEMISTRY", why: "Pollution and climate chemistry require a chemistry base." },
      { id: "stats", name: "AP Statistics", level: "recommended", match: ["statistics", "ap stat"], apSubject: "AP_STATISTICS", why: "Environmental data analysis is statistics-heavy." },
    ],
  },
  political_science: {
    label: "Political Science",
    courses: [
      { id: "usgov", name: "AP US Government", level: "core", match: ["us government", "ap gov", "american government"], apSubject: "AP_US_GOVERNMENT", why: "The most major-relevant course for a government applicant." },
      { id: "compgov", name: "AP Comparative Government", level: "recommended", match: ["comparative government", "comp gov"], apSubject: "AP_COMPARATIVE_GOVERNMENT", why: "Adds a cross-national lens valued by political-science programs." },
      { id: "ush", name: "AP US History", level: "core", match: ["us history", "apush", "american history"], apSubject: "AP_US_HISTORY", why: "Historical depth supports political analysis and writing." },
      { id: "stats", name: "AP Statistics", level: "recommended", match: ["statistics", "ap stat"], apSubject: "AP_STATISTICS", why: "Quantitative political science increasingly expects statistics." },
    ],
  },
  english: {
    label: "English",
    courses: [
      { id: "lang", name: "AP English Language", level: "core", match: ["english language", "ap lang"], apSubject: "AP_ENGLISH_LANGUAGE", why: "Rhetoric and argument are the spine of an English application." },
      { id: "lit", name: "AP English Literature", level: "core", match: ["english literature", "ap lit"], apSubject: "AP_ENGLISH_LITERATURE", why: "Literary analysis is the defining skill of the major." },
      { id: "ush", name: "AP US History", level: "recommended", match: ["us history", "apush"], apSubject: "AP_US_HISTORY", why: "Historical context deepens literary reading." },
    ],
  },
});

// Major buckets without a bespoke ladder fall back to a broad rigor sequence
// — never invent a major-specific course list we can't stand behind.
export const GENERIC_SEQUENCE = Object.freeze({
  label: "Broad academic rigor",
  courses: [
    { id: "calc_ab", name: "AP Calculus AB", level: "recommended", match: ["calculus", "calc", "ap calc"], apSubject: "AP_CALCULUS_AB", why: "Calculus keeps quantitative majors open and signals general rigor." },
    { id: "lang", name: "AP English Language", level: "recommended", match: ["english language", "ap lang"], apSubject: "AP_ENGLISH_LANGUAGE", why: "Strong writing supports applications in every field." },
    { id: "stats", name: "AP Statistics", level: "recommended", match: ["statistics", "ap stat"], apSubject: "AP_STATISTICS", why: "Statistical literacy is broadly valued across disciplines." },
  ],
});

const LEVEL_ORDER = Object.freeze({ foundational: 0, core: 1, advanced: 2, recommended: 3 });

/**
 * Resolve the reference course ladder for a major bucket. Always returns a
 * sequence (falls back to GENERIC_SEQUENCE) so callers never have to branch.
 */
export function getCourseSequence(bucket) {
  const seq = (bucket && COURSE_SEQUENCES[bucket]) || GENERIC_SEQUENCE;
  return { bucket: bucket || null, isGeneric: !bucket || !COURSE_SEQUENCES[bucket], ...seq };
}

function courseNameOf(course) {
  return String(course?.name || course?.title || course || "").toLowerCase();
}

/**
 * Diff a student's transcript against the reference ladder for a bucket.
 * Pure function — no DB, no LLM. Returns:
 *   {
 *     bucket, label, isGeneric,
 *     have:    [{...ref, matchedCourse}],   // ladder courses already taken
 *     missing: [{...ref}],                  // foundational/core not yet taken
 *     next:    [{...ref}],                  // the 1-3 highest-priority gaps
 *   }
 * `next` prioritizes foundational → core → advanced → recommended order so
 * the recommender suggests the courses that most build a coherent transcript.
 */
export function diffCoursesAgainstSequence(studentCourses, bucket) {
  const seq = getCourseSequence(bucket);
  const taken = (Array.isArray(studentCourses) ? studentCourses : []).map(courseNameOf);

  const have = [];
  const missing = [];
  for (const ref of seq.courses) {
    const matchedName = taken.find((name) => ref.match.some((kw) => name.includes(kw)));
    if (matchedName) {
      have.push({ ...ref, matchedCourse: matchedName });
    } else {
      missing.push({ ...ref });
    }
  }

  const next = [...missing]
    .sort((a, b) => (LEVEL_ORDER[a.level] ?? 9) - (LEVEL_ORDER[b.level] ?? 9))
    .slice(0, 3);

  return {
    bucket: seq.bucket,
    label: seq.label,
    isGeneric: seq.isGeneric,
    have,
    missing,
    next,
  };
}

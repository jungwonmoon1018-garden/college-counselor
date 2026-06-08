import { buildStudentModel, buildPositioningForTarget } from "../positioning-engine.js";

function makeStudent({
  gpa,
  weightedGpa,
  major,
  sat,
  courses,
  activities,
  strengthRows,
  narrativeText,
}) {
  return buildStudentModel({
    gpa_unweighted: gpa,
    gpa_weighted: weightedGpa,
    major_interest: major,
    courses_json: JSON.stringify(courses),
    test_scores_json: JSON.stringify(sat ? [{ test: "sat", totalScore: sat }] : []),
    activities_json: JSON.stringify(activities),
  }, strengthRows, narrativeText ? { narrativeText } : null);
}

const CDS_STRONG = {
  source: "College Transitions CDS repository",
  sourceUrl: "https://example.edu/cds.pdf",
  fetchStatus: "ok",
  repositoryMatch: { schoolName: "Example", latestAvailableYear: "2024-25" },
  parsed: {
    testPolicy: "test_considered_or_required",
    c7: {
      academicGpa: 1,
      rigor: 1,
      standardizedTests: 0.7,
      essay: 0.7,
      extracurriculars: 0.35,
      recommendation: 0.7,
      character: 0.35,
      classRank: 0.35,
    },
  },
};

const COLLEGE_BANDS = {
  mit_cs: {
    name: "MIT",
    acceptanceRate: 4.5,
    avgGpaAdmitted: 3.95,
    sat25: 1510,
    sat75: 1570,
    topMajors: ["Computer Science", "Engineering", "Physics"],
    source: "synthetic-top20",
  },
  columbia_bio: {
    name: "Columbia",
    acceptanceRate: 3.9,
    avgGpaAdmitted: 3.94,
    sat25: 1500,
    sat75: 1560,
    topMajors: ["Biology", "Economics", "Political Science"],
    source: "synthetic-top20",
  },
  emory_bio: {
    name: "Emory",
    acceptanceRate: 11.2,
    avgGpaAdmitted: 3.86,
    sat25: 1450,
    sat75: 1530,
    topMajors: ["Biology", "Public Health", "Business"],
    source: "synthetic-subivy",
  },
  nyu_business: {
    name: "NYU",
    acceptanceRate: 8.0,
    avgGpaAdmitted: 3.88,
    sat25: 1450,
    sat75: 1540,
    topMajors: ["Business", "Economics", "Computer Science"],
    source: "synthetic-subivy",
  },
  uiuc_engineering: {
    name: "UIUC",
    acceptanceRate: 43.0,
    avgGpaAdmitted: 3.72,
    sat25: 1370,
    sat75: 1510,
    topMajors: ["Engineering", "Computer Science", "Business"],
    source: "synthetic-top100",
  },
  rutgers_humanities: {
    name: "Rutgers",
    acceptanceRate: 66.0,
    avgGpaAdmitted: 3.58,
    sat25: 1270,
    sat75: 1450,
    topMajors: ["English", "History", "Political Science"],
    source: "synthetic-top100",
  },
};

const scenarios = [
  {
    id: "t20_cs_spike_kis",
    label: "Top-20 CS spike from Korean international school",
    student: makeStudent({
      gpa: 3.96,
      weightedGpa: 4.57,
      major: "Computer Science",
      sat: 1560,
      courses: [
        { name: "AP Calculus BC", type: "ap", grade: "A", year: "11" },
        { name: "AP Computer Science A", type: "ap", grade: "A", year: "11" },
        { name: "AP Physics C", type: "ap", grade: "A", year: "12" },
        { name: "Linear Algebra", type: "dual_enrollment", grade: "A", year: "12" },
      ],
      activities: [
        { name: "ML Research", description: "Published a paper on medical imaging models." },
        { name: "Coding nonprofit", description: "Founded a coding education nonprofit." },
      ],
      strengthRows: [
        { tier_label: "tier_1_distinctive", major_spike: 0.94, prestige: 0.82, leadership: 0.74, achievement: 0.81, narrative_fit: 0.87 },
        { tier_label: "tier_2_strong", major_spike: 0.77, prestige: 0.55, leadership: 0.59, achievement: 0.63, narrative_fit: 0.76 },
      ],
      narrativeText: "I want to build trustworthy AI systems for health care access.",
    }),
    college: COLLEGE_BANDS.mit_cs,
    cds: { ...CDS_STRONG, schoolName: "MIT", parsed: { ...CDS_STRONG.parsed, admitRatePercent: 4.5, gpaAverage: 3.95 } },
    options: {
      majorPolicy: { policyType: "direct_admit", internalTransferDifficulty: "high", evidenceStrength: "official", capacityExpansionOffset: 0.05 },
      strategicSignals: [{ signalTitle: "Schwarzman College of Computing", evidenceStrength: 0.95, recencyScore: 0.82 }],
      ipedsGrowthByBucket: { computer_science: 0.82 },
    },
  },
  {
    id: "t20_bio_generic_kis",
    label: "Top-20 biology applicant with generic profile",
    student: makeStudent({
      gpa: 3.9,
      weightedGpa: 4.42,
      major: "Biology",
      sat: 1500,
      courses: [
        { name: "AP Biology", type: "ap", grade: "A-", year: "11" },
        { name: "AP Chemistry", type: "ap", grade: "A-", year: "11" },
        { name: "AP Calculus AB", type: "ap", grade: "A", year: "12" },
      ],
      activities: [
        { name: "Hospital volunteer", description: "Volunteered weekly at a hospital." },
        { name: "Biology club", description: "Member of biology club and science fair participant." },
        { name: "Tutoring", description: "Tutored younger students in science." },
      ],
      strengthRows: [
        { tier_label: "tier_3_developing", major_spike: 0.45, prestige: 0.22, leadership: 0.28, achievement: 0.34, narrative_fit: 0.41 },
        { tier_label: "tier_3_developing", major_spike: 0.38, prestige: 0.18, leadership: 0.26, achievement: 0.3, narrative_fit: 0.4 },
      ],
      narrativeText: "I want to study biology and eventually work in medicine.",
    }),
    college: COLLEGE_BANDS.columbia_bio,
    cds: { ...CDS_STRONG, schoolName: "Columbia", parsed: { ...CDS_STRONG.parsed, admitRatePercent: 3.9, gpaAverage: 3.94 } },
    options: {
      strategicSignals: [{ signalTitle: "New biomedical initiatives", evidenceStrength: 0.72, recencyScore: 0.65 }],
      ipedsGrowthByBucket: { biology: 0.52 },
    },
  },
  {
    id: "subivy_public_health_upward",
    label: "Sub-Ivy public health with strong service and coherent story",
    student: makeStudent({
      gpa: 3.83,
      weightedGpa: 4.31,
      major: "Public Health",
      sat: 1480,
      courses: [
        { name: "AP Biology", type: "ap", grade: "A", year: "11" },
        { name: "AP Statistics", type: "ap", grade: "A", year: "11" },
        { name: "AP Psychology", type: "ap", grade: "A-", year: "12" },
        { name: "AP Chemistry", type: "ap", grade: "B+", year: "11" },
      ],
      activities: [
        { name: "Refugee health nonprofit", description: "Led health-access workshops for migrant families." },
        { name: "Research", description: "Public-health survey project with local clinic." },
      ],
      strengthRows: [
        { tier_label: "tier_2_strong", major_spike: 0.8, prestige: 0.42, leadership: 0.71, achievement: 0.57, narrative_fit: 0.82 },
        { tier_label: "tier_2_strong", major_spike: 0.68, prestige: 0.34, leadership: 0.55, achievement: 0.49, narrative_fit: 0.74 },
      ],
      narrativeText: "Growing up between languages made me care about health systems people can actually navigate.",
    }),
    college: COLLEGE_BANDS.emory_bio,
    cds: { ...CDS_STRONG, schoolName: "Emory", parsed: { ...CDS_STRONG.parsed, admitRatePercent: 11.2, gpaAverage: 3.86 } },
    options: {
      strategicSignals: [{ signalTitle: "Expanded public health initiatives", evidenceStrength: 0.84, recencyScore: 0.8 }],
      ipedsGrowthByBucket: { public_health: 0.71 },
    },
  },
  {
    id: "subivy_business_prestige_but_shallow",
    label: "Sub-Ivy business applicant with prestige but shallow depth",
    student: makeStudent({
      gpa: 3.78,
      weightedGpa: 4.18,
      major: "Business",
      sat: 1490,
      courses: [
        { name: "AP Microeconomics", type: "ap", grade: "A-", year: "11" },
        { name: "AP Macroeconomics", type: "ap", grade: "A-", year: "12" },
        { name: "AP Statistics", type: "ap", grade: "B+", year: "12" },
      ],
      activities: [
        { name: "DECA", description: "Competed in DECA and attended conferences." },
        { name: "Internship", description: "Short summer internship at family friend's firm." },
        { name: "Investment club", description: "Member of investment club." },
        { name: "Startup idea", description: "Explored an app idea with friends." },
        { name: "Volunteer", description: "Occasional volunteering." },
      ],
      strengthRows: [
        { tier_label: "tier_3_developing", major_spike: 0.44, prestige: 0.47, leadership: 0.22, achievement: 0.39, narrative_fit: 0.36 },
        { tier_label: "tier_4_foundational", major_spike: 0.2, prestige: 0.18, leadership: 0.12, achievement: 0.15, narrative_fit: 0.28 },
      ],
      narrativeText: "I like business, entrepreneurship, and leadership.",
    }),
    college: COLLEGE_BANDS.nyu_business,
    cds: { ...CDS_STRONG, schoolName: "NYU", parsed: { ...CDS_STRONG.parsed, admitRatePercent: 8.0, gpaAverage: 3.88 } },
    options: {
      majorPolicy: { policyType: "direct_admit", internalTransferDifficulty: "medium", evidenceStrength: "official" },
      ipedsGrowthByBucket: { business: 0.62 },
    },
  },
  {
    id: "top100_engineering_borderline_but_real",
    label: "Top-100 engineering applicant with solid academics and modest distinction",
    student: makeStudent({
      gpa: 3.68,
      weightedGpa: 4.05,
      major: "Engineering",
      sat: 1430,
      courses: [
        { name: "AP Calculus AB", type: "ap", grade: "A-", year: "11" },
        { name: "AP Physics 1", type: "ap", grade: "A-", year: "11" },
        { name: "Robotics", type: "ib", grade: "A", year: "12" },
      ],
      activities: [
        { name: "Robotics captain", description: "Led robotics team to state competition." },
        { name: "Maker project", description: "Built low-cost sensor system for school lab." },
      ],
      strengthRows: [
        { tier_label: "tier_2_strong", major_spike: 0.74, prestige: 0.33, leadership: 0.63, achievement: 0.51, narrative_fit: 0.72 },
      ],
      narrativeText: "I like building practical systems that solve physical problems.",
    }),
    college: COLLEGE_BANDS.uiuc_engineering,
    cds: { ...CDS_STRONG, schoolName: "UIUC", parsed: { ...CDS_STRONG.parsed, admitRatePercent: 43.0, gpaAverage: 3.72 } },
    options: {
      majorPolicy: { policyType: "capped", internalTransferDifficulty: "high", evidenceStrength: "official" },
      strategicSignals: [{ signalTitle: "Engineering expansion initiative", evidenceStrength: 0.78, recencyScore: 0.76 }],
      ipedsGrowthByBucket: { engineering: 0.7 },
    },
  },
  {
    id: "top100_humanities_underrated",
    label: "Top-100 humanities applicant with strong narrative and lighter raw prestige",
    student: makeStudent({
      gpa: 3.74,
      weightedGpa: 4.12,
      major: "English",
      sat: 1450,
      courses: [
        { name: "AP English Literature", type: "ap", grade: "A", year: "12" },
        { name: "AP US History", type: "ap", grade: "A-", year: "11" },
        { name: "AP Psychology", type: "ap", grade: "A", year: "11" },
      ],
      activities: [
        { name: "Literary magazine editor", description: "Edited school literary magazine and launched translation issue." },
        { name: "Essay project", description: "Published essays about multilingual identity." },
      ],
      strengthRows: [
        { tier_label: "tier_2_strong", major_spike: 0.69, prestige: 0.24, leadership: 0.61, achievement: 0.48, narrative_fit: 0.88 },
      ],
      narrativeText: "At an international school, language became the way I understood belonging and power.",
    }),
    college: COLLEGE_BANDS.rutgers_humanities,
    cds: { ...CDS_STRONG, schoolName: "Rutgers", parsed: { ...CDS_STRONG.parsed, admitRatePercent: 66.0, gpaAverage: 3.58 } },
    options: {
      strategicSignals: [{ signalTitle: "Humanities initiative", evidenceStrength: 0.7, recencyScore: 0.72 }],
      ipedsGrowthByBucket: { english: 0.34 },
    },
  },
];

const results = scenarios.map((scenario) => {
  const result = buildPositioningForTarget(
    scenario.student,
    scenario.college,
    scenario.cds,
    scenario.options,
  );
  return {
    id: scenario.id,
    label: scenario.label,
    school: scenario.college.name,
    major: scenario.student.majorInterest,
    positioning: result.overallPositioningLabel,
    finalScore: result.finalPositioningScore,
    academic: result.admissibility.academicReadinessScore,
    competitiveness: result.competitiveness.majorCompetitivenessScore,
    fit: result.fit.institutionalPriorityFitScore,
    narrative: result.fit.narrativeCoherenceScore,
    differentiation: result.fit.differentiationStrength,
    confidence: result.confidence.evidenceConfidence,
    capacityRisk: result.capacityRiskFlag,
    redFlags: result.mainRedFlags,
    strategy: result.recommendedPositioningStrategy,
  };
});

console.log(JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));

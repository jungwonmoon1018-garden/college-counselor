// ═══════════════════════════════════════════════════════════════════════
// jiyeon-positioning-test.js — runs the positioning engine across three
// Jiyeon variants × twelve target schools × two majors.
// ═══════════════════════════════════════════════════════════════════════
// Persona: Park Jiyeon, 11th grader at a Korean international school
// (curriculum: AP). She is desperate to land at a US elite for
// computational biology. The "desperate" lens shows up in three places:
//   1. EC profile is curated for application optics rather than depth.
//   2. Senior-year activity spike is a real risk (red flag).
//   3. Narrative reads as "love AI + medicine" without specificity unless
//      she's done the supplemental work.
//
// We model her at three preparation levels — top-tier, mid-tier, baseline-
// strugler — to show how the engine separates Admissibility / Competitive-
// ness / Fit / Confidence cleanly across the same student archetype.
//
// School data is mock-realistic: numbers approximate publicly-known CDS
// 2023-2024 figures but should be re-grounded against each school's actual
// CDS before production use. Format mirrors the spec's MVP feature set.
// ═══════════════════════════════════════════════════════════════════════

import { position } from "./positioning-engine.js";

// ─── Personas ────────────────────────────────────────────────────────
// Common context shared across Jiyeon variants.
const KOREAN_INTL_CONTEXT = {
  internationalCurriculum: false,         // her school is AP-track, not IB
  esl: true,                              // bilingual, but English supplements
                                          // are second-language work
  limitedResourceSchool: false,           // top-tier intl school, full AP
  firstGenLowIncome: false,
  significantWorkOrFamily: false,
  maximizedRigor: true,                   // she takes everything offered
};

// VARIANT A — top-tier Jiyeon. The version her admissions consultant
// wants her to be. National-level distinctions, real research, specific
// narrative grounded in coursework.
const JIYEON_TOP = {
  id: "jiyeon_top",
  label: "Jiyeon (top-tier prep)",
  gpa: 4.00,
  rigor: { apsTaken: 11, apsAvailable: 11, seniorRigor: 1.0, dualEnrollment: 0.6 },
  test: { submitted: true, sat: 1570 },
  awards: [
    { name: "ISEF Finalist (Computational Biology)", tier: "international" },
    { name: "USABO Semifinalist", tier: "national" },
    { name: "Regeneron STS Scholar", tier: "national" },
    { name: "Korean National Math Olympiad Bronze", tier: "national" },
  ],
  intendedMajor: "Computational Biology",
  majorPrep: {
    relevantCoursesTaken: 7,
    relevantGPA: 4.0,
    researchExperience: 0.95,    // co-authored one paper (under review)
    portfolio: 0.85,             // GitHub w/ reproduced bioinformatics pipelines
  },
  ecs: [
    { name: "Independent research — gene-expression ML", role: "Lead", category: "research", hoursPerWeek: 12,
      tier: "national", evidence: { publication: true, codeOrPortfolio: true } },
    { name: "Bioinformatics club", role: "Founder/President", category: "club", hoursPerWeek: 6,
      tier: "school", evidence: { codeOrPortfolio: true } },
    { name: "Asan Medical Center summer internship", role: "Research intern", category: "research", hoursPerWeek: 30,
      tier: "regional", evidence: { press: true } },
    { name: "Korean Biology Olympiad team", role: "Team captain", category: "academic", hoursPerWeek: 4,
      tier: "national" },
    { name: "Volunteer tutoring (math + biology)", role: "Tutor", category: "service", hoursPerWeek: 3,
      tier: "school" },
  ],
  narrative: {
    themes: ["computational biology", "drug response prediction", "open-source bioinformatics"],
    coherence: 0.92,
    intellectualVitality: 0.90,
    authenticity: 0.85,
    originality: 0.80,
    specificity: 0.85,
    activityListRecycle: 0.10,
    schoolSpecificReasoning: {
      mit: 0.85, stanford: 0.70, harvard: 0.65, jhu: 0.90, duke: 0.55,
      princeton: 0.55, columbia: 0.45, upenn: 0.45, caltech: 0.65, yale: 0.40,
      cornell: 0.55, brown: 0.40, dartmouth: 0.30, vandy: 0.45, rice: 0.50,
      wustl: 0.55, northwestern: 0.45,
      umich: 0.55, ucla: 0.50, gatech: 0.65, uiuc: 0.55, ucsd: 0.65,
      bu: 0.40, nyu: 0.30, usc: 0.30, uw: 0.50, purdue: 0.40, wisc: 0.30, osu: 0.20, msu: 0.20,
    },
  },
  context: { ...KOREAN_INTL_CONTEXT, seniorYearSpike: false },
};

// VARIANT B — mid-tier Jiyeon. Strong academically but EC profile is
// broad-not-deep, with one clear capstone missing. Narrative leans on
// "AI for medicine" without grounding.
const JIYEON_MID = {
  id: "jiyeon_mid",
  label: "Jiyeon (mid-tier prep)",
  gpa: 3.85,
  rigor: { apsTaken: 7, apsAvailable: 11, seniorRigor: 0.8, dualEnrollment: 0.0 },
  test: { submitted: true, sat: 1480 },
  awards: [
    { name: "Korean Bio Olympiad regional silver", tier: "regional" },
    { name: "School science fair 1st place", tier: "school" },
    { name: "AP Scholar with Distinction", tier: "school" },
  ],
  intendedMajor: "Computational Biology",
  majorPrep: {
    relevantCoursesTaken: 4,
    relevantGPA: 3.9,
    researchExperience: 0.45,
    portfolio: 0.30,
  },
  ecs: [
    { name: "Computational Biology Club", role: "Vice President", category: "club", hoursPerWeek: 4,
      tier: "school" },
    { name: "Hospital volunteering", role: "Volunteer", category: "service", hoursPerWeek: 4,
      tier: "school" },
    { name: "Personal coding projects", role: "Self-directed", category: "research", hoursPerWeek: 5,
      tier: "school", evidence: { codeOrPortfolio: true } },
    { name: "Model UN", role: "Delegate", category: "club", hoursPerWeek: 3, tier: "school" },
    { name: "Piano lessons", role: "Student", category: "arts", hoursPerWeek: 2, tier: "school" },
    { name: "Tutoring younger students", role: "Tutor", category: "service", hoursPerWeek: 2, tier: "school" },
  ],
  narrative: {
    themes: ["AI", "medicine", "helping people"],
    coherence: 0.55,
    intellectualVitality: 0.50,
    authenticity: 0.55,
    originality: 0.30,
    specificity: 0.30,
    activityListRecycle: 0.55,
    schoolSpecificReasoning: {
      mit: 0.20, stanford: 0.15, jhu: 0.30, duke: 0.20, gatech: 0.30, ucsd: 0.30,
      umich: 0.25, usc: 0.20, bu: 0.30, nyu: 0.25, wustl: 0.25, uw: 0.25,
    },
  },
  context: { ...KOREAN_INTL_CONTEXT, seniorYearSpike: true },
};

// VARIANT C — baseline-struggler Jiyeon. The version where desperation
// shows: aiming at MIT/Stanford with a profile that the engine should
// honestly call high-reach. Tests that the model surfaces useful
// alternatives, not just gloomy labels.
const JIYEON_LOW = {
  id: "jiyeon_low",
  label: "Jiyeon (struggling, desperate)",
  gpa: 3.55,
  rigor: { apsTaken: 4, apsAvailable: 11, seniorRigor: 0.55, dualEnrollment: 0.0 },
  test: { submitted: true, sat: 1340 },
  awards: [
    { name: "School honor roll", tier: "school" },
    { name: "Science fair participant", tier: "school" },
  ],
  intendedMajor: "Computer Science",
  majorPrep: {
    relevantCoursesTaken: 2,
    relevantGPA: 3.6,
    researchExperience: 0.10,
    portfolio: 0.20,
  },
  ecs: [
    { name: "Coding club", role: "Member", category: "club", hoursPerWeek: 2, tier: "school" },
    { name: "Hospital volunteering", role: "Volunteer", category: "service", hoursPerWeek: 2, tier: "school" },
    { name: "School newspaper", role: "Writer", category: "club", hoursPerWeek: 2, tier: "school" },
    { name: "Korean Red Cross", role: "Volunteer", category: "service", hoursPerWeek: 2, tier: "school",
      claimsBigImpact: true /* but no evidence */ },
    { name: "Math tutoring", role: "Tutor", category: "service", hoursPerWeek: 2, tier: "school" },
    { name: "Robotics club", role: "Member", category: "club", hoursPerWeek: 2, tier: "school" },
    { name: "Choir", role: "Member", category: "arts", hoursPerWeek: 2, tier: "school" },
  ],
  narrative: {
    themes: ["AI", "machine learning", "tech for good", "passion for coding"],
    coherence: 0.35,
    intellectualVitality: 0.30,
    authenticity: 0.40,
    originality: 0.15,
    specificity: 0.15,
    activityListRecycle: 0.75,
    schoolSpecificReasoning: {
      // Almost none — the giveaway of an under-prepared application.
      umich: 0.15, gatech: 0.15, uw: 0.15, uiuc: 0.10,
    },
  },
  context: { ...KOREAN_INTL_CONTEXT, seniorYearSpike: true },
};

// ─── School matrix ────────────────────────────────────────────────────
// Tiered set of US targets. CDS numbers are illustrative (rounded to the
// nearest commonly-cited figure as of 2023–2024 disclosures); replace
// with the actual CDS file for production use. The `priorities` field
// reflects publicly-announced strategic plans / new institutes / major
// gifts; `evidenceStrength` 1.0 = primary source, 0.5 = press release,
// 0.3 = secondhand summary.

const COMP_BIO_PRIORITIES = ["computational biology", "drug response prediction", "open-source bioinformatics", "genomics", "AI for science"];
const CS_PRIORITIES = ["AI", "machine learning", "systems", "open-source", "robotics"];

function major(c, overrides = {}) {
  return {
    nationalDemand: 0.85,
    schoolSaturation: 0.7,
    capped: false,
    directAdmit: false,
    internalTransferDifficulty: 0.4,
    ipedsCompletionsGrowth5y: 0.25,
    capacityExpansion: 0.10,
    ...c, ...overrides,
  };
}

const SCHOOLS = [
  // ── TOP 20 ────────────────────────────────────────────────────────
  { id: "mit", name: "MIT", testPolicy: "test_required", tier: "T20",
    cds: { year: 2024, overallAdmitRate: 0.046, enrolledGPA:{p25:3.95,p75:4.0}, enrolledSAT:{p25:1530,p75:1580},
      c7: { gpa:"very_important", rigor:"very_important", test_scores:"very_important", recommendations:"very_important",
            application_essay:"very_important", ec:"very_important", talent_ability:"very_important", character:"very_important",
            class_rank:"considered", level_of_interest:"not_considered" } },
    majors: {
      "Computational Biology": major({ schoolSaturation:0.85, capped:false, directAdmit:false, internalTransferDifficulty:0.3, capacityExpansion:0.20 }),
      "Computer Science":     major({ schoolSaturation:0.95, capped:true, directAdmit:false, internalTransferDifficulty:0.5, capacityExpansion:0.10 }),
    },
    priorities: [
      { label:"Schwarzman College of Computing", themes:["AI","computational biology","AI for science"], evidenceStrength:1.0, ageMonths:8 },
      { label:"Broad Institute partnership", themes:["computational biology","genomics","drug response prediction"], evidenceStrength:1.0, ageMonths:14 },
    ],
  },

  { id: "stanford", name: "Stanford", testPolicy: "test_required", tier: "T20",
    cds: { year: 2024, overallAdmitRate: 0.038, enrolledGPA:{p25:3.94,p75:4.0}, enrolledSAT:{p25:1510,p75:1580},
      c7: { gpa:"very_important", rigor:"very_important", test_scores:"very_important", recommendations:"very_important",
            application_essay:"very_important", ec:"very_important", talent_ability:"very_important", character:"very_important",
            class_rank:"considered", level_of_interest:"not_considered" } },
    majors: {
      "Computational Biology": major({ schoolSaturation:0.80, capacityExpansion:0.15 }),
      "Computer Science":     major({ schoolSaturation:0.95, internalTransferDifficulty:0.2 }),
    },
    priorities: [
      { label:"Stanford HAI institute", themes:["AI","AI for science","machine learning"], evidenceStrength:1.0, ageMonths:10 },
      { label:"BioX program", themes:["computational biology","genomics"], evidenceStrength:1.0, ageMonths:18 },
    ],
  },

  { id: "harvard", name: "Harvard", testPolicy: "test_required", tier: "T20",
    cds: { year: 2024, overallAdmitRate: 0.035, enrolledGPA:{p25:3.95,p75:4.0}, enrolledSAT:{p25:1500,p75:1580},
      c7: { gpa:"very_important", rigor:"very_important", test_scores:"important", recommendations:"very_important",
            application_essay:"very_important", ec:"very_important", talent_ability:"very_important", character:"very_important" } },
    majors: {
      "Computational Biology": major({ schoolSaturation:0.7, capacityExpansion:0.10 }),
      "Computer Science":     major({ schoolSaturation:0.85 }),
    },
    priorities: [
      { label:"Harvard Data Science Initiative", themes:["AI","computational biology","AI for science"], evidenceStrength:1.0, ageMonths:14 },
    ],
  },

  { id: "princeton", name: "Princeton", testPolicy: "test_required", tier: "T20",
    cds: { year: 2024, overallAdmitRate: 0.045, enrolledGPA:{p25:3.93,p75:4.0}, enrolledSAT:{p25:1500,p75:1570},
      c7: { gpa:"very_important", rigor:"very_important", test_scores:"important", recommendations:"very_important", application_essay:"very_important", ec:"very_important", talent_ability:"important", character:"very_important" } },
    majors: {
      "Computational Biology": major({ schoolSaturation:0.6, capacityExpansion:0.08 }),
      "Computer Science":     major({ schoolSaturation:0.85, internalTransferDifficulty:0.3 }),
    },
    priorities: [
      { label:"Princeton Precision Health", themes:["computational biology","drug response prediction"], evidenceStrength:0.9, ageMonths:18 },
    ],
  },

  { id: "yale", name: "Yale", testPolicy: "test_required", tier: "T20",
    cds: { year: 2024, overallAdmitRate: 0.045, enrolledGPA:{p25:3.91,p75:4.0}, enrolledSAT:{p25:1490,p75:1560},
      c7: { gpa:"very_important", rigor:"very_important", test_scores:"important", recommendations:"very_important", application_essay:"very_important", ec:"very_important", talent_ability:"important", character:"very_important" } },
    majors: { "Computational Biology": major({ schoolSaturation:0.55 }), "Computer Science": major({ schoolSaturation:0.75 }) },
    priorities: [{ label:"Yale Quantitative Biology cluster", themes:["computational biology","genomics"], evidenceStrength:0.7, ageMonths:24 }],
  },

  { id: "caltech", name: "Caltech", testPolicy: "test_required", tier: "T20",
    cds: { year: 2024, overallAdmitRate: 0.030, enrolledGPA:{p25:3.97,p75:4.0}, enrolledSAT:{p25:1530,p75:1580},
      c7: { gpa:"very_important", rigor:"very_important", test_scores:"very_important", recommendations:"very_important", application_essay:"important", ec:"important", talent_ability:"very_important", character:"important" } },
    majors: { "Computational Biology": major({ schoolSaturation:0.7, capacityExpansion:0.20 }), "Computer Science": major({ schoolSaturation:0.95 }) },
    priorities: [{ label:"Tianqiao & Chrissy Chen Institute (neurobio + computation)", themes:["computational biology","AI for science"], evidenceStrength:1.0, ageMonths:10 }],
  },

  { id: "jhu", name: "Johns Hopkins", testPolicy: "test_required", tier: "T20",
    cds: { year: 2024, overallAdmitRate: 0.072, enrolledGPA:{p25:3.91,p75:4.0}, enrolledSAT:{p25:1500,p75:1560},
      c7: { gpa:"very_important", rigor:"very_important", test_scores:"important", recommendations:"important", application_essay:"very_important", ec:"important", talent_ability:"important", character:"important" } },
    majors: {
      "Computational Biology": major({ schoolSaturation:0.65, capacityExpansion:0.20 }),
      "Computer Science":     major({ schoolSaturation:0.90, internalTransferDifficulty:0.5 }),
    },
    priorities: [{ label:"Bloomberg Distinguished Professorships in computational medicine", themes:["computational biology","drug response prediction"], evidenceStrength:1.0, ageMonths:6 }],
  },

  { id: "duke", name: "Duke", testPolicy: "test_optional", tier: "T20",
    cds: { year: 2024, overallAdmitRate: 0.063, enrolledGPA:{p25:3.92,p75:4.0}, enrolledSAT:{p25:1500,p75:1560},
      c7: { gpa:"very_important", rigor:"very_important", test_scores:"considered", recommendations:"very_important", application_essay:"very_important", ec:"important", talent_ability:"important", character:"very_important" } },
    majors: { "Computational Biology": major({ schoolSaturation:0.6 }), "Computer Science": major({ schoolSaturation:0.85, internalTransferDifficulty:0.4 }) },
    priorities: [{ label:"Duke Initiative for Science & Society", themes:["computational biology","AI for science"], evidenceStrength:0.7, ageMonths:18 }],
  },

  { id: "upenn", name: "UPenn", testPolicy: "test_optional", tier: "T20",
    cds: { year: 2024, overallAdmitRate: 0.058, enrolledGPA:{p25:3.90,p75:4.0}, enrolledSAT:{p25:1500,p75:1570},
      c7: { gpa:"very_important", rigor:"very_important", test_scores:"important", recommendations:"important", application_essay:"very_important", ec:"important", talent_ability:"important", character:"important" } },
    majors: { "Computational Biology": major({ schoolSaturation:0.7 }), "Computer Science": major({ schoolSaturation:0.95, capped:true }) },
    priorities: [{ label:"Penn Institute for Biomedical Informatics", themes:["computational biology","drug response prediction"], evidenceStrength:0.8, ageMonths:14 }],
  },

  { id: "columbia", name: "Columbia", testPolicy: "test_required", tier: "T20",
    cds: { year: 2024, overallAdmitRate: 0.039, enrolledGPA:{p25:3.91,p75:4.0}, enrolledSAT:{p25:1500,p75:1570},
      c7: { gpa:"very_important", rigor:"very_important", test_scores:"important", recommendations:"important", application_essay:"very_important", ec:"important", talent_ability:"important", character:"important" } },
    majors: { "Computational Biology": major({ schoolSaturation:0.7 }), "Computer Science": major({ schoolSaturation:0.95 }) },
    priorities: [{ label:"Columbia Data Science Institute", themes:["AI","computational biology","AI for science"], evidenceStrength:0.8, ageMonths:16 }],
  },

  // ── SUB-IVY (T20-T30 selective non-Ivy) ─────────────────────────────
  { id: "northwestern", name: "Northwestern", testPolicy: "test_optional", tier: "Sub-Ivy",
    cds: { year: 2024, overallAdmitRate: 0.072, enrolledGPA:{p25:3.85,p75:4.0}, enrolledSAT:{p25:1500,p75:1560},
      c7: { gpa:"very_important", rigor:"very_important", test_scores:"considered", recommendations:"important", application_essay:"very_important", ec:"important", talent_ability:"important", character:"important" } },
    majors: { "Computational Biology": major({ schoolSaturation:0.55 }), "Computer Science": major({ schoolSaturation:0.85, internalTransferDifficulty:0.4 }) },
    priorities: [{ label:"NU AI Institute", themes:["AI","AI for science"], evidenceStrength:0.8, ageMonths:8 }],
  },

  { id: "cornell", name: "Cornell", testPolicy: "test_optional", tier: "Sub-Ivy",
    cds: { year: 2024, overallAdmitRate: 0.075, enrolledGPA:{p25:3.86,p75:4.0}, enrolledSAT:{p25:1480,p75:1560},
      c7: { gpa:"very_important", rigor:"very_important", test_scores:"considered", recommendations:"important", application_essay:"important", ec:"important", talent_ability:"important", character:"important" } },
    majors: {
      "Computational Biology": major({ schoolSaturation:0.6, directAdmit:true /* CALS direct */ }),
      "Computer Science":     major({ schoolSaturation:0.95, capped:true, directAdmit:true, internalTransferDifficulty:0.7 }),
    },
    priorities: [{ label:"Cornell Bowers CIS expansion", themes:["AI","computational biology"], evidenceStrength:1.0, ageMonths:10 }],
  },

  { id: "rice", name: "Rice", testPolicy: "test_optional", tier: "Sub-Ivy",
    cds: { year: 2024, overallAdmitRate: 0.083, enrolledGPA:{p25:3.85,p75:4.0}, enrolledSAT:{p25:1490,p75:1560},
      c7: { gpa:"very_important", rigor:"very_important", test_scores:"considered", recommendations:"important", application_essay:"important", ec:"important", talent_ability:"important", character:"important" } },
    majors: { "Computational Biology": major({ schoolSaturation:0.5, capacityExpansion:0.15 }), "Computer Science": major({ schoolSaturation:0.85 }) },
    priorities: [{ label:"Rice Ken Kennedy Institute", themes:["computational biology","AI for science"], evidenceStrength:0.7, ageMonths:18 }],
  },

  { id: "wustl", name: "WashU St Louis", testPolicy: "test_optional", tier: "Sub-Ivy",
    cds: { year: 2024, overallAdmitRate: 0.110, enrolledGPA:{p25:3.84,p75:4.0}, enrolledSAT:{p25:1490,p75:1560},
      c7: { gpa:"very_important", rigor:"very_important", test_scores:"considered", recommendations:"important", application_essay:"important", ec:"important", talent_ability:"important", character:"important" } },
    majors: { "Computational Biology": major({ schoolSaturation:0.6, capacityExpansion:0.15 }), "Computer Science": major({ schoolSaturation:0.85 }) },
    priorities: [{ label:"WashU Computational Biology PhD growth", themes:["computational biology","genomics"], evidenceStrength:0.7, ageMonths:14 }],
  },

  // ── TOP 50–100 (state flagships and selective privates) ─────────────
  { id: "umich", name: "U Michigan", testPolicy: "test_optional", tier: "T50",
    cds: { year: 2024, overallAdmitRate: 0.179, enrolledGPA:{p25:3.85,p75:4.0}, enrolledSAT:{p25:1370,p75:1530},
      c7: { gpa:"very_important", rigor:"very_important", test_scores:"considered", recommendations:"important", application_essay:"important", ec:"important", talent_ability:"important", character:"important" } },
    majors: {
      "Computational Biology": major({ schoolSaturation:0.55, capacityExpansion:0.15 }),
      "Computer Science":     major({ schoolSaturation:0.95, capped:true, internalTransferDifficulty:0.7 }),
    },
    priorities: [{ label:"Michigan Institute for Data Science (MIDAS)", themes:["computational biology","AI for science"], evidenceStrength:0.8, ageMonths:10 }],
  },

  { id: "gatech", name: "Georgia Tech", testPolicy: "test_required", tier: "T50",
    cds: { year: 2024, overallAdmitRate: 0.170, enrolledGPA:{p25:3.92,p75:4.0}, enrolledSAT:{p25:1390,p75:1520},
      c7: { gpa:"very_important", rigor:"very_important", test_scores:"important", recommendations:"considered", application_essay:"important", ec:"considered", talent_ability:"considered", character:"considered" } },
    majors: {
      "Computational Biology": major({ schoolSaturation:0.6, capacityExpansion:0.20 }),
      "Computer Science":     major({ schoolSaturation:0.95, capped:true, directAdmit:true, internalTransferDifficulty:0.8 }),
    },
    priorities: [{ label:"GT Bioinformatics & Quantitative Biosciences program growth", themes:["computational biology","AI for science"], evidenceStrength:0.7, ageMonths:14 }],
  },

  { id: "ucsd", name: "UC San Diego", testPolicy: "test_blind", tier: "T50",
    cds: { year: 2024, overallAdmitRate: 0.243, enrolledGPA:{p25:3.96,p75:4.0}, enrolledSAT:{p25:1300,p75:1500} /* unused — test blind */,
      c7: { gpa:"very_important", rigor:"very_important", test_scores:"not_considered", recommendations:"not_considered", application_essay:"important", ec:"considered", talent_ability:"considered" } },
    majors: {
      "Computational Biology": major({ schoolSaturation:0.55, capacityExpansion:0.20 }),
      "Computer Science":     major({ schoolSaturation:0.95, capped:true, internalTransferDifficulty:0.8 }),
    },
    priorities: [{ label:"UCSD Halıcıoğlu Data Science Institute", themes:["AI","computational biology","AI for science"], evidenceStrength:0.9, ageMonths:6 }],
  },

  { id: "uw", name: "U Washington — Seattle", testPolicy: "test_optional", tier: "T50",
    cds: { year: 2024, overallAdmitRate: 0.43, enrolledGPA:{p25:3.75,p75:3.96}, enrolledSAT:{p25:1240,p75:1450},
      c7: { gpa:"very_important", rigor:"very_important", test_scores:"considered", recommendations:"considered", application_essay:"important", ec:"considered", talent_ability:"considered" } },
    majors: {
      "Computational Biology": major({ schoolSaturation:0.5, capacityExpansion:0.15 }),
      "Computer Science":     major({ schoolSaturation:0.99, capped:true, directAdmit:true, internalTransferDifficulty:0.95 /* CSE direct admit is brutal */ }),
    },
    priorities: [{ label:"UW Allen School + eScience computational biology", themes:["computational biology","AI for science"], evidenceStrength:0.9, ageMonths:8 }],
  },

  { id: "uiuc", name: "UIUC", testPolicy: "test_optional", tier: "T50",
    cds: { year: 2024, overallAdmitRate: 0.45, enrolledGPA:{p25:3.62,p75:3.97}, enrolledSAT:{p25:1340,p75:1500},
      c7: { gpa:"very_important", rigor:"very_important", test_scores:"considered", recommendations:"considered", application_essay:"important", ec:"considered", talent_ability:"considered" } },
    majors: {
      "Computational Biology": major({ schoolSaturation:0.55, capacityExpansion:0.10 }),
      "Computer Science":     major({ schoolSaturation:0.99, capped:true, directAdmit:true, internalTransferDifficulty:0.95 }),
    },
    priorities: [{ label:"UIUC Carl R Woese Institute for Genomic Biology", themes:["computational biology","genomics"], evidenceStrength:0.8, ageMonths:14 }],
  },

  { id: "purdue", name: "Purdue", testPolicy: "test_optional", tier: "T100",
    cds: { year: 2024, overallAdmitRate: 0.50, enrolledGPA:{p25:3.5,p75:3.9}, enrolledSAT:{p25:1190,p75:1440},
      c7: { gpa:"very_important", rigor:"important", test_scores:"considered", recommendations:"considered", application_essay:"considered", ec:"considered", talent_ability:"considered" } },
    majors: {
      "Computational Biology": major({ schoolSaturation:0.4 }),
      "Computer Science":     major({ schoolSaturation:0.85, capped:true, internalTransferDifficulty:0.7 }),
    },
    priorities: [{ label:"Purdue Computes initiative", themes:["AI","computational biology"], evidenceStrength:0.7, ageMonths:6 }],
  },

  { id: "wisc", name: "U Wisconsin–Madison", testPolicy: "test_optional", tier: "T100",
    cds: { year: 2024, overallAdmitRate: 0.43, enrolledGPA:{p25:3.6,p75:3.95}, enrolledSAT:{p25:1320,p75:1470},
      c7: { gpa:"very_important", rigor:"important", test_scores:"considered", recommendations:"considered", application_essay:"considered", ec:"considered", talent_ability:"considered" } },
    majors: {
      "Computational Biology": major({ schoolSaturation:0.45 }),
      "Computer Science":     major({ schoolSaturation:0.85, capped:true, internalTransferDifficulty:0.7 }),
    },
    priorities: [{ label:"Morgridge Institute for Research", themes:["computational biology","genomics"], evidenceStrength:0.7, ageMonths:18 }],
  },

  { id: "msu", name: "Michigan State", testPolicy: "test_optional", tier: "T100",
    cds: { year: 2024, overallAdmitRate: 0.83, enrolledGPA:{p25:3.5,p75:3.9}, enrolledSAT:{p25:1100,p75:1330},
      c7: { gpa:"very_important", rigor:"important", test_scores:"considered", recommendations:"considered", application_essay:"considered", ec:"considered", talent_ability:"considered" } },
    majors: {
      "Computational Biology": major({ schoolSaturation:0.35 }),
      "Computer Science":     major({ schoolSaturation:0.7 }),
    },
    priorities: [{ label:"MSU BEACON evolutionary computation center", themes:["computational biology","AI for science"], evidenceStrength:0.6, ageMonths:24 }],
  },
];

// ─── Test runner ──────────────────────────────────────────────────────
const STUDENTS = [JIYEON_TOP, JIYEON_MID, JIYEON_LOW];
const SCHOOLS_TO_RUN = SCHOOLS;
const MAJORS_TO_RUN = ["Computational Biology", "Computer Science"];

function pad(s, n) { s = String(s); return s.length >= n ? s : s + " ".repeat(n - s.length); }
function dim(s) { return `\x1b[2m${s}\x1b[0m`; }
function bold(s) { return `\x1b[1m${s}\x1b[0m`; }
function color(label) {
  if (label === "Highly competitive") return `\x1b[32m${label}\x1b[0m`;
  if (label === "Competitive")        return `\x1b[36m${label}\x1b[0m`;
  if (label === "Reach")              return `\x1b[33m${label}\x1b[0m`;
  return `\x1b[31m${label}\x1b[0m`;
}

function runMatrix() {
  const out = [];
  for (const student of STUDENTS) {
    out.push("");
    out.push(bold(`══════════════════════════════════════════════════════════════════════`));
    out.push(bold(`  ${student.label}`));
    out.push(bold(`══════════════════════════════════════════════════════════════════════`));
    out.push(dim(`  GPA ${student.gpa}  ·  SAT ${student.test?.sat ?? "n/a"}  ·  ${student.rigor.apsTaken}/${student.rigor.apsAvailable} APs  ·  intended major: ${student.intendedMajor}`));
    out.push("");

    for (const majorName of MAJORS_TO_RUN) {
      const s = { ...student, intendedMajor: majorName };
      out.push(dim(`  ── Major: ${majorName} ────────────────────────────────────────────`));
      out.push("  " + pad("School", 22) + pad("Tier", 9) + pad("Score", 8) + pad("Acad", 7) + pad("MajAdj", 8) + pad("Fit", 7) + pad("Flags", 7) + pad("Conf", 8) + "Label");
      for (const school of SCHOOLS_TO_RUN) {
        const r = position(s, school);
        const flagShort = r.redFlags.length;
        const line =
          "  " + pad(school.name, 22) + pad(school.tier, 9) +
          pad(r.score.toFixed(1), 8) +
          pad(r.components.academicReadiness.toFixed(0), 7) +
          pad(r.components.majorCompetitiveness.toFixed(2), 8) +
          pad(r.components.priorityFitBonus.toFixed(1), 7) +
          pad(`-${r.components.redFlagPenalty.toFixed(0)} (${flagShort})`, 7) +
          pad(`${r.evidenceConfidence.label}`, 8) +
          color(r.label);
        out.push(line);
      }
      out.push("");
    }

    // Per-student deep dive on three signature schools
    out.push(dim(`  ── Strategy detail: MIT, Cornell, U Washington ─────────────────────`));
    for (const id of ["mit", "cornell", "uw"]) {
      const school = SCHOOLS.find((x) => x.id === id);
      const r = position({ ...student, intendedMajor: student.intendedMajor }, school);
      out.push(`  ${bold(school.name)} (${student.intendedMajor})  →  ${color(r.label)}  [${r.score.toFixed(1)}]`);
      out.push(`     Academic ${r.components.academicReadiness.toFixed(0)}  ·  Selectivity ×${r.components.selectivityAdjustment}  ·  Major ×${r.components.majorCompetitiveness}  ·  Fit +${r.components.priorityFitBonus}  ·  Narrative +${r.components.narrativeFitBonus}  ·  Context +${r.components.contextualBonus}  ·  Flags -${r.components.redFlagPenalty}`);
      if (r.priorityMatches.length) {
        out.push(`     ${dim("Priority matches:")} ${r.priorityMatches.map((m) => `${m.priority} (${m.themes.join("/")})`).join("; ")}`);
      } else {
        out.push(`     ${dim("Priority matches:")} ${dim("none documented")}`);
      }
      if (r.capacityRisk?.constrained) {
        out.push(`     ${dim("Capacity risk:")} ${r.capacityRisk.capped ? "CAPPED" : ""}${r.capacityRisk.directAdmit ? " DIRECT-ADMIT" : ""}  saturation=${r.capacityRisk.saturation}  atRisk=${r.capacityRisk.atRisk}`);
      }
      if (r.redFlags.length) {
        out.push(`     ${dim("Red flags:")} ${r.redFlags.slice(0,3).join("  /  ")}`);
      }
      out.push(`     ${dim("Strategy:")} ${r.strategy[0]}`);
      out.push("");
    }
  }

  return out.join("\n");
}

console.log(runMatrix());

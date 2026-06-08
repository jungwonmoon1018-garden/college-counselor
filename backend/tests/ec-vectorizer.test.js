// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??// TESTS: EC Vectorizer
// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EC_FACTORS,
  WELLBEING_LIMITS,
  vectorizeEC,
  scoreAcademicStrength,
  buildNextStepPlan,
  analyzeMajorSpikeProfile,
  detectCompetitiveActivity,
} from "../ec-vectorizer.js";

describe("EC_FACTORS", () => {
  it("exposes the five factors in fixed order", () => {
    assert.equal(EC_FACTORS.length, 5);
    assert.ok(EC_FACTORS.includes("impact_and_scope"));
    assert.ok(EC_FACTORS.includes("leadership_and_initiative"));
    assert.ok(EC_FACTORS.includes("passion_and_consistency"));
    assert.ok(EC_FACTORS.includes("talents_and_awards"));
    assert.ok(EC_FACTORS.includes("relevance_to_intended_major"));
  });
});

describe("vectorizeEC", () => {
  it("scores a founder / high-impact EC highly on leadership and impact", () => {
    const { vector, composite, label, reasoning } = vectorizeEC({
      name: "Code for Community",
      role: "Founder and President",
      description: "I founded a 501(c)(3) nonprofit that taught coding to over 500 students across the district. We raised $15,000 in grants and were featured in the local newspaper.",
      hoursPerWeek: 6,
      weeksPerYear: 40,
      yearsOfParticipation: 3,
    }, "Computer Science");

    assert.ok(vector.leadership_and_initiative >= 0.7, `leadership too low: ${vector.leadership_and_initiative}`);
    assert.ok(vector.impact_and_scope >= 0.6, `impact too low: ${vector.impact_and_scope}`);
    assert.ok(vector.relevance_to_intended_major >= 0.5, `relevance too low: ${vector.relevance_to_intended_major}`);
    assert.ok(composite >= 0.5);
    assert.ok(["strong", "exceptional", "developing"].includes(label));
    assert.ok(Array.isArray(reasoning.leadership_and_initiative));
  });

  it("scores a school-only club with no role as low impact / low leadership", () => {
    const { vector, label } = vectorizeEC({
      name: "Anime Club",
      role: "Member",
      description: "I attend weekly meetings at school.",
      hoursPerWeek: 1,
      weeksPerYear: 30,
      yearsOfParticipation: 1,
    }, "Computer Science");

    assert.ok(vector.leadership_and_initiative <= 0.25);
    assert.ok(vector.impact_and_scope <= 0.25);
    assert.ok(["early_stage", "emerging"].includes(label));
  });

  it("rewards sustained multi-year commitment via passion factor", () => {
    const { vector } = vectorizeEC({
      name: "Violin",
      role: "Performer",
      description: "I have been practicing violin daily for 6 years and maintain a portfolio of recital recordings.",
      hoursPerWeek: 7,
      weeksPerYear: 50,
      yearsOfParticipation: 6,
    }, "Music");
    assert.ok(vector.passion_and_consistency >= 0.6);
  });

  it("detects international awards as top-tier talent signal", () => {
    const { vector } = vectorizeEC({
      name: "Physics Olympiad",
      role: "Team member",
      description: "I earned a gold medal at the International Physics Olympiad (IPhO).",
      hoursPerWeek: 5,
      weeksPerYear: 30,
      yearsOfParticipation: 2,
    }, "Physics");
    assert.ok(vector.talents_and_awards >= 0.6);
  });

  it("scores relevance higher when description matches intended major", () => {
    const csActivity = {
      name: "Hackathon Winner",
      role: "Team lead",
      description: "I built a machine learning model in Python and won a regional hackathon.",
      hoursPerWeek: 4,
      weeksPerYear: 20,
      yearsOfParticipation: 2,
    };
    const cs = vectorizeEC(csActivity, "Computer Science");
    const art = vectorizeEC(csActivity, "Art History");
    assert.ok(cs.vector.relevance_to_intended_major > art.vector.relevance_to_intended_major);
  });

  it("produces values in [0,1] for every factor", () => {
    const { vector } = vectorizeEC({
      name: "Test",
      description: "random text",
    });
    for (const f of EC_FACTORS) {
      assert.ok(vector[f] >= 0 && vector[f] <= 1, `${f} out of range: ${vector[f]}`);
    }
  });
});


describe("scoreAcademicStrength", () => {
  it("returns insufficient_targets when no colleges supplied", () => {
    const result = scoreAcademicStrength(
      { gpaUnweighted: 3.9, courses: [{ name: "AP Calc", type: "ap" }] },
      [],
    );
    assert.equal(result.overallAcademicLabel, "insufficient_targets");
  });

  it("scores a student above avg admitted GPA as strong", () => {
    const result = scoreAcademicStrength(
      {
        gpaUnweighted: 4.0,
        apCourses: [
          { name: "AP Calculus BC", type: "ap" },
          { name: "AP Physics C", type: "ap" },
          { name: "AP English", type: "ap" },
          { name: "AP CS A", type: "ap" },
          { name: "AP Stats", type: "ap" },
          { name: "AP Chemistry", type: "ap" },
          { name: "AP Biology", type: "ap" },
          { name: "AP History", type: "ap" },
        ],
      },
      [{ name: "Test U", avg_gpa_admitted: 3.7, acceptance_rate: 0.2 }],
    );
    assert.ok(["strong_for_targets", "competitive_for_targets"].includes(result.overallAcademicLabel));
    assert.ok(result.gpaFitVsTargets >= 0.5);
  });

  it("scores a student well below avg as needs_strengthening", () => {
    const result = scoreAcademicStrength(
      { gpaUnweighted: 3.0, apCourses: [] },
      [{ name: "Elite U", avg_gpa_admitted: 3.95, acceptance_rate: 0.05 }],
    );
    assert.equal(result.overallAcademicLabel, "needs_strengthening");
  });

  it("states the GPA+AP-only policy in reasoning", () => {
    const result = scoreAcademicStrength(
      { gpaUnweighted: 3.8, apCourses: [{ name: "AP Calc", type: "ap" }] },
      [{ name: "Test U", avg_gpa_admitted: 3.8, acceptance_rate: 0.3 }],
    );
    assert.ok(result.reasoning.some(r => r.toLowerCase().includes("gpa") && r.toLowerCase().includes("ap")));
  });
});

describe("buildNextStepPlan ??well-being first", () => {
  it("always starts with a well-being suggestion", () => {
    const plan = buildNextStepPlan({
      ecVectors: [{
        impact_and_scope: 0.2, leadership_and_initiative: 0.2,
        passion_and_consistency: 0.2, talents_and_awards: 0.2,
        relevance_to_intended_major: 0.2,
      }],
      academicScore: null,
      activities: [{ hoursPerWeek: 10 }],
      majorInterest: "Computer Science",
    });
    assert.ok(plan.suggestions.length > 0);
    assert.equal(plan.suggestions[0].category, "well_being");
    assert.equal(plan.suggestions[0].priority, "foundation");
  });

  it("refuses to add load when student is overloaded", () => {
    const plan = buildNextStepPlan({
      ecVectors: [],
      activities: Array.from({ length: 5 }, () => ({ hoursPerWeek: 9 })), // 45 hrs
      majorInterest: "Biology",
    });
    assert.equal(plan.wellbeing.status, "overloaded");
    const hasRefuse = plan.suggestions.some(s => s.refuseMoreLoad === true);
    assert.ok(hasRefuse);
    // No ec_growth suggestions in overloaded mode
    const hasGrowth = plan.suggestions.some(s => s.category === "ec_growth");
    assert.equal(hasGrowth, false);
  });

  it("targets the weakest factor first when student is healthy", () => {
    const plan = buildNextStepPlan({
      ecVectors: [{
        impact_and_scope: 0.8, leadership_and_initiative: 0.8,
        passion_and_consistency: 0.8, talents_and_awards: 0.1, // weakest
        relevance_to_intended_major: 0.8,
      }],
      activities: [{ hoursPerWeek: 5 }],
      majorInterest: "Mathematics",
    });
    assert.equal(plan.weakestFactor, "talents_and_awards");
    const growth = plan.suggestions.find(s => s.category === "ec_growth");
    assert.ok(growth);
    assert.equal(growth.factor, "talents_and_awards");
  });

  it("respects sustainable weekly-hour cap", () => {
    assert.ok(WELLBEING_LIMITS.sustainable_weekly_hours > 0);
    assert.ok(WELLBEING_LIMITS.hard_ceiling_weekly_hours > WELLBEING_LIMITS.sustainable_weekly_hours);
  });

  it("marks the output as open for correction", () => {
    const plan = buildNextStepPlan({
      ecVectors: [],
      activities: [],
      majorInterest: "English",
    });
    assert.equal(plan.openForCorrection, true);
    assert.ok(plan.disclaimer.toLowerCase().includes("not a prescription") || plan.disclaimer.length > 0);
  });

  it("states academics uses GPA and APs only when academicScore present", () => {
    const plan = buildNextStepPlan({
      ecVectors: [],
      academicScore: {
        overallAcademicLabel: "competitive_for_targets",
        gpaFitVsTargets: 0.7,
        apRigorVsExpectations: 0.75,
      },
      activities: [{ hoursPerWeek: 8 }],
      majorInterest: "History",
    });
    assert.ok(plan.academicSummary);
    assert.ok(plan.academicSummary.note.toLowerCase().includes("gpa"));
    assert.ok(plan.academicSummary.note.toLowerCase().includes("ap"));
  });

  it("adds spike strategy when a major-aligned lane is emerging", () => {
    const plan = buildNextStepPlan({
      ecVectors: [{
        impact_and_scope: 0.45,
        leadership_and_initiative: 0.55,
        passion_and_consistency: 0.7,
        talents_and_awards: 0.45,
        relevance_to_intended_major: 0.82,
        ecName: "AI Research Lab",
      }],
      strengthVectors: [{
        ecName: "AI Research Lab",
        major_spike: 0.83,
        leadership: 0.52,
        achievement: 0.56,
        prestige: 0.48,
      }],
      activities: [{ name: "AI Research Lab", hoursPerWeek: 6 }],
      majorInterest: "Computer Science",
    });
    assert.ok(plan.spikeProfile);
    assert.equal(plan.spikeProfile.mode, "strengthen_spike");
    assert.ok(plan.suggestions.some((s) => s.category === "ec_spike_strategy"));
  });
});

describe("analyzeMajorSpikeProfile", () => {
  it("recommends building a spike when no activity clearly aligns", () => {
    const profile = analyzeMajorSpikeProfile({
      ecVectors: [{
        relevance_to_intended_major: 0.2,
        leadership_and_initiative: 0.5,
        talents_and_awards: 0.3,
      }],
      activities: [{ name: "Choir", hoursPerWeek: 4 }],
      majorInterest: "Biology",
    });
    assert.equal(profile.mode, "build_spike");
  });
});

describe("detectCompetitiveActivity", () => {
  it("detects AIME qualifier", () => {
    const result = detectCompetitiveActivity("i qualified for the aime after scoring well on amc 12");
    assert.ok(result);
    assert.equal(result.activityId, "math_olympiad");
    assert.ok(result.levelIndex >= 3);
  });

  it("detects USAMO", () => {
    const result = detectCompetitiveActivity("i qualified for usamo");
    assert.ok(result);
    assert.equal(result.activityId, "math_olympiad");
    assert.equal(result.levelIndex, 4);
  });

  it("detects Science Olympiad state", () => {
    const result = detectCompetitiveActivity("competed at science olympiad state tournament");
    assert.ok(result);
    assert.equal(result.activityId, "science_olympiad");
    assert.equal(result.levelIndex, 2);
  });

  it("detects DECA ICDC", () => {
    const result = detectCompetitiveActivity("qualified for deca icdc in marketing");
    assert.ok(result);
    assert.equal(result.activityId, "deca");
    assert.equal(result.levelIndex, 3);
  });

  it("detects FBLA nationals", () => {
    const result = detectCompetitiveActivity("competed at fbla national leadership conference");
    assert.ok(result);
    assert.equal(result.activityId, "fbla");
    assert.equal(result.levelIndex, 3);
  });

  it("detects TOC qualifier in debate", () => {
    const result = detectCompetitiveActivity("earned 2 toc bids in lincoln-douglas debate");
    assert.ok(result);
    assert.equal(result.activityId, "debate");
    assert.ok(result.levelIndex >= 2);
  });

  it("detects NSDA nationals", () => {
    const result = detectCompetitiveActivity("competed at nsda national tournament");
    assert.ok(result);
    assert.equal(result.activityId, "debate");
    assert.equal(result.levelIndex, 4);
  });

  it("detects FRC regional", () => {
    const result = detectCompetitiveActivity("our frc team competed at the regional competition");
    assert.ok(result);
    assert.equal(result.activityId, "first_robotics");
    assert.equal(result.levelIndex, 1);
  });

  it("detects Chairman's Award as top-tier FIRST", () => {
    const result = detectCompetitiveActivity("our team won the chairman's award at regionals");
    assert.ok(result);
    assert.equal(result.activityId, "first_robotics");
    assert.equal(result.levelIndex, 3);
  });

  it("returns null for non-competitive activities", () => {
    const result = detectCompetitiveActivity("i attend chess club meetings every week at school");
    assert.equal(result, null);
  });
});

describe("vectorizeEC ??competition integration", () => {
  it("AIME qualifier scores high on talents_and_awards for Math major", () => {
    const { vector, reasoning } = vectorizeEC({
      name: "Math Competitions",
      role: "Team member",
      description: "Competed in AMC 12 and qualified for the AIME. Preparing for USAMO.",
      hoursPerWeek: 5,
      weeksPerYear: 30,
      yearsOfParticipation: 3,
    }, "Mathematics");
    assert.ok(vector.talents_and_awards >= 0.5, `talents too low: ${vector.talents_and_awards}`);
    assert.ok(vector.relevance_to_intended_major >= 0.7, `relevance too low: ${vector.relevance_to_intended_major}`);
    assert.ok(reasoning.talents_and_awards.some(r => r.includes("math_olympiad")));
  });

  it("Science Olympiad state for Biology major gets strong scores", () => {
    const { vector } = vectorizeEC({
      name: "Science Olympiad",
      role: "Team Captain",
      description: "Competed at Science Olympiad state in Anatomy & Physiology and Disease Detectives events.",
      hoursPerWeek: 6,
      weeksPerYear: 30,
      yearsOfParticipation: 3,
    }, "Biology");
    assert.ok(vector.talents_and_awards >= 0.4);
    assert.ok(vector.relevance_to_intended_major >= 0.7);
  });

  it("DECA ICDC for Business major gets top-tier scoring", () => {
    const { vector } = vectorizeEC({
      name: "DECA",
      role: "State Officer",
      description: "Qualified for DECA ICDC in Entrepreneurship and placed top 10 at state.",
      hoursPerWeek: 4,
      weeksPerYear: 30,
      yearsOfParticipation: 3,
    }, "Business");
    assert.ok(vector.talents_and_awards >= 0.6);
    assert.ok(vector.relevance_to_intended_major >= 0.8);
  });

  it("debate TOC qualifier for Political Science scores well", () => {
    const { vector } = vectorizeEC({
      name: "Debate",
      role: "Varsity debater",
      description: "Earned 2 TOC bids in Lincoln-Douglas debate. Qualified for national tournament.",
      hoursPerWeek: 8,
      weeksPerYear: 40,
      yearsOfParticipation: 4,
    }, "Political Science");
    assert.ok(vector.talents_and_awards >= 0.5);
    assert.ok(vector.relevance_to_intended_major >= 0.7);
  });

  it("FRC Chairman's Award for Engineering scores highest tier", () => {
    const { vector } = vectorizeEC({
      name: "FIRST Robotics",
      role: "Team Lead",
      description: "Led our FRC team to win the Chairman's Award at regionals. We built robots and mentored FLL teams.",
      hoursPerWeek: 10,
      weeksPerYear: 30,
      yearsOfParticipation: 4,
    }, "Engineering");
    assert.ok(vector.talents_and_awards >= 0.7);
    assert.ok(vector.relevance_to_intended_major >= 0.8);
  });

  it("plain chess club does NOT trigger competition detection (regression)", () => {
    const { vector } = vectorizeEC({
      name: "Chess Club",
      role: "Member",
      description: "I play chess at school on Tuesdays.",
      hoursPerWeek: 1,
      weeksPerYear: 30,
      yearsOfParticipation: 1,
    }, "Computer Science");
    // Should be low across the board ??no competition boost
    assert.ok(vector.talents_and_awards <= 0.25);
  });
});


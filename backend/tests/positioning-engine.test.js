import test from "node:test";
import assert from "node:assert/strict";

import {
  buildStudentModel,
  scoreAcademicReadiness,
  scoreInstitutionalPriorityFit,
  scoreMajorCompetitiveness,
  buildPositioningForTarget,
  classifyPositioningLabel,
} from "../positioning-engine.js";

function makeStudent() {
  return buildStudentModel({
    gpa_unweighted: 3.92,
    gpa_weighted: 4.48,
    major_interest: "Computer Science",
    courses_json: JSON.stringify([
      { name: "AP Calculus BC", type: "ap", grade: "A", year: "11" },
      { name: "AP Computer Science A", type: "ap", grade: "A", year: "11" },
      { name: "AP Physics C", type: "ap", grade: "A-", year: "12" },
      { name: "Multivariable Calculus", type: "dual_enrollment", grade: "A", year: "12" },
    ]),
    test_scores_json: JSON.stringify([{ test: "sat", totalScore: 1530 }]),
    activities_json: JSON.stringify([{ name: "AI Research", description: "published project" }]),
  }, [
    { tier_label: "tier_1_distinctive", major_spike: 0.92, prestige: 0.74, leadership: 0.7, achievement: 0.76, narrative_fit: 0.84 },
    { tier_label: "tier_2_strong", major_spike: 0.7, prestige: 0.6, leadership: 0.55, achievement: 0.62, narrative_fit: 0.73 },
  ], { narrativeText: "I care about computational systems and real-world ML." });
}

test("scoreAcademicReadiness is strong for an in-range applicant", () => {
  const student = makeStudent();
  const result = scoreAcademicReadiness(student, {
    avgGpaAdmitted: 3.88,
    sat25: 1460,
    sat75: 1560,
  }, {
    parsed: {
      c7: { academicGpa: 1, rigor: 1, standardizedTests: 0.7, classRank: 0.35 },
      testPolicy: "test_considered_or_required",
    },
  });
  assert.ok(result.score >= 60, `expected solid academic score, got ${result.score}`);
  assert.ok(result.componentScores.majorPrepScore >= 55);
});

test("scoreAcademicReadiness dynamic weights respect OCR-normalized C7 values", () => {
  const student = makeStudent();
  const college = { avgGpaAdmitted: 3.88, sat25: 1460, sat75: 1560 };
  const deemphasizedTests = scoreAcademicReadiness(student, college, {
    parsed: {
      c7: { academicGpa: 1, rigor: 1, standardizedTests: 0, classRank: 0.35 },
      testPolicy: "test_considered_or_required",
    },
  });
  const emphasizedTests = scoreAcademicReadiness(student, college, {
    parsed: {
      c7: { academicGpa: 1, rigor: 1, standardizedTests: 1, classRank: 0.35 },
      testPolicy: "test_considered_or_required",
    },
  });

  assert.ok(emphasizedTests.dynamicWeights.test > deemphasizedTests.dynamicWeights.test);
  assert.equal(deemphasizedTests.dynamicWeights.test < 0.15, true);
});

test("scoreInstitutionalPriorityFit exposes C7 signals used from normalized OCR weights", () => {
  const student = makeStudent();
  const result = scoreInstitutionalPriorityFit(student, {
    parsed: {
      c7: {
        essay: 1,
        extracurriculars: 1,
        character: 1,
        recommendation: 1,
      },
    },
  });
  assert.equal(result.c7SignalsUsed.essay, 1);
  assert.equal(result.c7SignalsUsed.extracurriculars, 1);
  assert.equal(result.c7SignalsUsed.character, 1);
  assert.equal(result.c7SignalsUsed.recommendation, 1);
});

test("scoreMajorCompetitiveness penalizes capped majors", () => {
  const student = makeStudent();
  const baseline = scoreMajorCompetitiveness(student, { topMajors: ["Computer Science", "Engineering"] }, {});
  const capped = scoreMajorCompetitiveness(student, { topMajors: ["Computer Science", "Engineering"] }, {
    majorPolicy: { policyType: "capped", internalTransferDifficulty: "high", capacityExpansionOffset: 0 },
  });
  assert.ok(capped.score < baseline.score);
  assert.notEqual(capped.capacityRiskFlag, "normal");
});

test("buildPositioningForTarget returns evidence-backed target output", () => {
  const student = makeStudent();
  const result = buildPositioningForTarget(student, {
    unitId: "166683",
    name: "Example Tech",
    acceptanceRate: 9.8,
    avgGpaAdmitted: 3.91,
    sat25: 1480,
    sat75: 1560,
    topMajors: ["Computer Science", "Engineering"],
    source: "baseline_colleges",
  }, {
    schoolName: "Example Tech",
    source: "College Transitions CDS repository",
    sourceUrl: "https://example.edu/cds.pdf",
    fetchStatus: "ok",
    repositoryMatch: { schoolName: "Example Tech", latestAvailableYear: "2024-25" },
    parsed: {
      admitRatePercent: 9.8,
      gpaAverage: 3.91,
      testPolicy: "test_considered_or_required",
      c7: { academicGpa: 1, rigor: 1, standardizedTests: 0.7, essay: 0.7, extracurriculars: 0.35, recommendation: 0.35, character: 0.35 },
    },
  }, {
    majorPolicy: { policyType: "direct_admit", internalTransferDifficulty: "high", evidenceStrength: "official" },
  });

  assert.ok(["Highly competitive", "Competitive", "Reach", "High reach"].includes(result.overallPositioningLabel));
  assert.ok(typeof result.admissibility.academicReadinessScore === "number");
  assert.ok(typeof result.competitiveness.majorCompetitivenessScore === "number");
  assert.ok(typeof result.fit.institutionalPriorityFitScore === "number");
  assert.deepEqual(result.fit.c7SignalsUsed, {
    essay: 0.7,
    extracurriculars: 0.35,
    character: 0.35,
    recommendation: 0.35,
  });
  assert.ok(typeof result.confidence.evidenceConfidenceScore === "number");
  assert.ok(result.featureBreakdown.appliedAcademicDynamicWeights);
  assert.ok(typeof result.featureBreakdown.appliedAcademicDynamicWeights.gpa === "number");
  assert.ok(Array.isArray(result.mainRedFlags));
});

test("classifyPositioningLabel uses the four requested bands", () => {
  assert.equal(classifyPositioningLabel(85), "Highly competitive");
  assert.equal(classifyPositioningLabel(70), "Competitive");
  assert.equal(classifyPositioningLabel(52), "Reach");
  assert.equal(classifyPositioningLabel(30), "High reach");
});

test("unknown admit rate is NOT treated as maximally selective", () => {
  const student = makeStudent();
  // collegeContext with no acceptanceRate must give a neutral selectivity
  // adjustment (1.0), never a 1.15 boost from Number(null) === 0.
  const r = buildPositioningForTarget(student, { name: "Mystery U", topMajors: [] }, {
    schoolName: "Mystery U", fetchStatus: "not_found", parsed: null,
  }, { major: "Computer Science" });
  assert.equal(r.competitiveness.institutionalSelectivityAdjustment, 1);
  assert.equal(r.competitiveness.institutionalSelectivityIndex, null);
  // With no selectivity data, displayed competitiveness == raw major-pool signal.
  assert.equal(r.competitiveness.majorCompetitivenessScore, r.competitiveness.majorPoolCompetitivenessScore);
});

test("displayed competitiveness reflects institutional selectivity", () => {
  const student = makeStudent();
  const base = { name: "X", topMajors: [] };
  const cds = { schoolName: "X", fetchStatus: "ok", parsed: { c7: {} } };
  const selective = buildPositioningForTarget(student, { ...base, acceptanceRate: 4.2 }, cds, { major: "Computer Science" });
  const open = buildPositioningForTarget(student, { ...base, acceptanceRate: 65 }, cds, { major: "Computer Science" });
  // Same major pool, but the 4%-admit school must read as far more competitive
  // (lower attainability score) than the 65%-admit school.
  assert.ok(
    selective.competitiveness.majorCompetitivenessScore < open.competitiveness.majorCompetitivenessScore,
    `expected selective < open, got ${selective.competitiveness.majorCompetitivenessScore} vs ${open.competitiveness.majorCompetitivenessScore}`
  );
});

test("unvalidated CDS records get a confidence penalty and never read High", () => {
  const student = makeStudent();
  const ctx = { name: "X", acceptanceRate: 9, sat25: 1480, sat75: 1560, avgGpaAdmitted: 3.9, topMajors: [] };
  const richParsed = {
    schoolName: "X", fetchStatus: "ok", sourceUrl: "https://x.edu/cds.pdf",
    repositoryMatch: { latestAvailableYear: "2024-25" },
    parsed: { c7: { academicGpa: 1, rigor: 1 }, admitRatePercent: 9 },
  };
  const validated = buildPositioningForTarget(student, ctx, { ...richParsed, validated: true }, { major: "Computer Science", majorPolicy: { policyType: "capped" } });
  const unvalidated = buildPositioningForTarget(student, ctx, { ...richParsed, validated: false }, { major: "Computer Science", majorPolicy: { policyType: "capped" } });

  assert.ok(
    unvalidated.confidence.evidenceConfidenceScore < validated.confidence.evidenceConfidenceScore,
    `unvalidated (${unvalidated.confidence.evidenceConfidenceScore}) should score lower than validated (${validated.confidence.evidenceConfidenceScore})`
  );
  assert.notEqual(unvalidated.confidence.evidenceConfidence, "High");
  assert.equal(unvalidated.confidence.evidenceValidated, false);
  assert.equal(validated.confidence.evidenceValidated, true);
});

test("low evidence confidence widens the displayed score bands", () => {
  const student = makeStudent();
  const ctx = { name: "X", acceptanceRate: 9, sat25: 1480, sat75: 1560, topMajors: [] };
  // Thin evidence: no source, fetch failed, no parsed CDS → Very Low confidence.
  const thin = buildPositioningForTarget(student, ctx, { schoolName: "X", fetchStatus: "not_found", parsed: null, sourceUrl: null }, { major: "Computer Science" });
  // Rich evidence: direct source, fetched, full c7, recent → high confidence.
  const rich = buildPositioningForTarget(student, ctx, {
    schoolName: "X", fetchStatus: "ok", sourceUrl: "https://x.edu/cds.pdf",
    repositoryMatch: { latestAvailableYear: "2024-25" },
    parsed: { c7: { academicGpa: 1, rigor: 1 }, admitRatePercent: 9 },
  }, { major: "Computer Science", majorPolicy: { policyType: "capped" } });

  const thinW = thin.scoreRanges.admissibility.high - thin.scoreRanges.admissibility.low;
  const richW = rich.scoreRanges.admissibility.high - rich.scoreRanges.admissibility.low;
  assert.ok(thinW > richW, `low-confidence band (${thinW}) should be wider than high-confidence (${richW})`);
  // Band brackets the point estimate.
  assert.ok(thin.scoreRanges.admissibility.low <= thin.admissibility.academicReadinessScore);
  assert.ok(thin.scoreRanges.admissibility.high >= thin.admissibility.academicReadinessScore);
});

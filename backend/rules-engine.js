// ═══════════════════════════════════════════════════════════════════════
// RULES ENGINE — Deterministic logic for FAFSA, deadlines, percentiles
// ═══════════════════════════════════════════════════════════════════════
// Handles all logic that can be computed without an LLM call.
// This module is the T0 (cost=$0) tier of the architecture.
// ═══════════════════════════════════════════════════════════════════════

import crypto from "node:crypto";

// ═══════════════════════════════════════════════════════════
// FAFSA ELIGIBILITY PRE-CHECK
// ═══════════════════════════════════════════════════════════
// Deterministic checklist based on published FAFSA eligibility rules.
// Source: https://studentaid.gov/apply-for-aid/fafsa/eligibility

const FAFSA_ELIGIBILITY_RULES = [
  {
    id: "citizenship",
    label: "U.S. Citizenship or Eligible Noncitizen Status",
    description: "Must be a U.S. citizen, U.S. national, or eligible noncitizen (e.g., permanent resident with Green Card).",
    required: true,
    source: "https://studentaid.gov/apply-for-aid/fafsa/eligibility/citizenship-status",
  },
  {
    id: "ssn",
    label: "Valid Social Security Number",
    description: "Must have a valid Social Security number (exceptions: students from the Freely Associated States).",
    required: true,
    source: "https://studentaid.gov/apply-for-aid/fafsa/eligibility",
  },
  {
    id: "enrollment",
    label: "Enrollment in an Eligible Program",
    description: "Must be enrolled or accepted as a regular student in an eligible degree or certificate program.",
    required: true,
    source: "https://studentaid.gov/apply-for-aid/fafsa/eligibility",
  },
  {
    id: "high_school_completion",
    label: "High School Diploma, GED, or Equivalent",
    description: "Must have a high school diploma, GED, or completed homeschool at secondary level.",
    required: true,
    source: "https://studentaid.gov/apply-for-aid/fafsa/eligibility",
  },
  {
    id: "satisfactory_progress",
    label: "Satisfactory Academic Progress",
    description: "Must maintain satisfactory academic progress (SAP) in college, as defined by your school.",
    required: true,
    source: "https://studentaid.gov/apply-for-aid/fafsa/eligibility",
  },
  {
    id: "selective_service",
    label: "Selective Service Registration (if applicable)",
    description: "Males aged 18-25 must be registered with Selective Service. Register at sss.gov.",
    required: true,
    appliesTo: "male_18_25",
    source: "https://www.sss.gov",
  },
  {
    id: "no_drug_conviction",
    label: "No Drug Conviction During Federal Aid Period",
    description: "As of the FAFSA Simplification Act (2024-2025 onward), drug convictions no longer affect eligibility for federal student aid.",
    required: false,
    note: "This rule was removed starting with the 2024-2025 FAFSA. Previous years had restrictions.",
    source: "https://studentaid.gov/apply-for-aid/fafsa/eligibility",
  },
  {
    id: "not_in_default",
    label: "Not in Default on Federal Student Loans",
    description: "Must not be in default on a federal student loan or owe a refund on a federal grant.",
    required: true,
    source: "https://studentaid.gov/apply-for-aid/fafsa/eligibility",
  },
];

export function runFAFSAEligibilityCheck(studentData = {}) {
  const results = FAFSA_ELIGIBILITY_RULES.map((rule) => {
    const fieldValue = studentData[rule.id];
    let status = "unknown"; // unknown, pass, fail, not_applicable

    if (rule.appliesTo === "male_18_25") {
      const isMale = studentData.gender === "male";
      const age = studentData.age;
      if (!isMale || (age && age < 18)) {
        status = "not_applicable";
      } else if (fieldValue === true) {
        status = "pass";
      } else if (fieldValue === false) {
        status = "fail";
      }
    } else if (!rule.required) {
      status = "not_applicable";
    } else if (fieldValue === true) {
      status = "pass";
    } else if (fieldValue === false) {
      status = "fail";
    }

    return {
      ruleId: rule.id,
      label: rule.label,
      description: rule.description,
      required: rule.required,
      status,
      source: rule.source,
      note: rule.note || null,
    };
  });

  const allPassed = results
    .filter((r) => r.required && r.status !== "not_applicable")
    .every((r) => r.status === "pass" || r.status === "unknown");

  const anyFailed = results.some((r) => r.status === "fail" && r.required);
  const unknownCount = results.filter((r) => r.status === "unknown" && r.required).length;

  return {
    eligible: anyFailed ? false : unknownCount === 0 ? true : null,
    summary: anyFailed
      ? "Based on the information provided, you may not meet one or more FAFSA eligibility requirements. Please review the items below and consult StudentAid.gov for official guidance."
      : unknownCount > 0
        ? `${unknownCount} eligibility item(s) have not been confirmed yet. Complete all items for a full eligibility assessment.`
        : "Based on the information provided, you appear to meet the basic FAFSA eligibility requirements. This is an informal assessment only — submit your FAFSA at StudentAid.gov for an official determination.",
    results,
    advisory: "This is NOT an official eligibility determination. Only the U.S. Department of Education can make official FAFSA eligibility decisions. Submit your FAFSA at https://studentaid.gov.",
    source: "https://studentaid.gov/apply-for-aid/fafsa/eligibility",
  };
}

// ═══════════════════════════════════════════════════════════
// DEADLINE CALCULATIONS
// ═══════════════════════════════════════════════════════════

export function calculateDeadlineStatus(deadlineDate, applicationType = "regular_decision") {
  if (!deadlineDate) {
    return { status: "unknown", daysRemaining: null, message: "No deadline date available." };
  }

  const now = new Date();
  const deadline = new Date(deadlineDate);
  if (isNaN(deadline.getTime())) {
    return { status: "invalid", daysRemaining: null, message: "Invalid deadline date format." };
  }

  const msRemaining = deadline.getTime() - now.getTime();
  const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));

  let status, urgency;
  if (daysRemaining < 0) {
    status = "passed";
    urgency = "none";
  } else if (daysRemaining <= 7) {
    status = "imminent";
    urgency = "critical";
  } else if (daysRemaining <= 30) {
    status = "approaching";
    urgency = "high";
  } else if (daysRemaining <= 90) {
    status = "upcoming";
    urgency = "medium";
  } else {
    status = "future";
    urgency = "low";
  }

  return {
    status,
    urgency,
    daysRemaining,
    deadlineDate: deadline.toISOString().slice(0, 10),
    applicationType,
    message:
      status === "passed"
        ? `This deadline has passed (${Math.abs(daysRemaining)} day(s) ago).`
        : `${daysRemaining} day(s) remaining until the ${applicationType.replace(/_/g, " ")} deadline.`,
  };
}

// ═══════════════════════════════════════════════════════════
// DOCUMENT COMPLETENESS CHECKS
// ═══════════════════════════════════════════════════════════

const APPLICATION_REQUIREMENTS = {
  common_app: {
    required: [
      { id: "personal_essay", label: "Common App Personal Essay (250-650 words)" },
      { id: "activities_list", label: "Activities List (up to 10 activities)" },
      { id: "demographics", label: "Demographics and personal information" },
      { id: "education_section", label: "Education section (GPA, courses, honors)" },
      { id: "testing", label: "Testing section (SAT/ACT, or test-optional acknowledgment)" },
    ],
    optional: [
      { id: "additional_info", label: "Additional Information section (context, explanations)" },
      { id: "fee_waiver", label: "Fee waiver (if applicable)" },
    ],
  },
  fafsa: {
    required: [
      { id: "fsa_id", label: "FSA ID (for student and each contributor)" },
      { id: "ssn", label: "Social Security Number" },
      { id: "tax_info", label: "Federal tax return information (or non-filing statement)" },
      { id: "school_selection", label: "Selected colleges to receive FAFSA results" },
    ],
    optional: [
      { id: "dependency_override", label: "Dependency status documentation (if unusual circumstances)" },
    ],
  },
  css_profile: {
    required: [
      { id: "parent_financials", label: "Detailed parent/guardian financial information" },
      { id: "business_farm", label: "Business/farm information (if applicable)" },
      { id: "noncustodial_parent", label: "Noncustodial parent information (if parents are separated)" },
    ],
    optional: [],
  },
};

export function runDocumentCompletenessCheck(applicationType, submittedItems = []) {
  const requirements = APPLICATION_REQUIREMENTS[applicationType];
  if (!requirements) {
    return { error: `Unknown application type: ${applicationType}. Valid types: ${Object.keys(APPLICATION_REQUIREMENTS).join(", ")}` };
  }

  const submittedSet = new Set(submittedItems.map((i) => (typeof i === "string" ? i : i.id)));

  const requiredResults = requirements.required.map((req) => ({
    ...req,
    status: submittedSet.has(req.id) ? "complete" : "missing",
  }));

  const optionalResults = requirements.optional.map((opt) => ({
    ...opt,
    status: submittedSet.has(opt.id) ? "complete" : "not_submitted",
  }));

  const missingRequired = requiredResults.filter((r) => r.status === "missing");

  return {
    applicationType,
    complete: missingRequired.length === 0,
    requiredItems: requiredResults,
    optionalItems: optionalResults,
    missingCount: missingRequired.length,
    missingItems: missingRequired.map((r) => r.label),
    summary: missingRequired.length === 0
      ? `All required items for ${applicationType.replace(/_/g, " ")} appear to be complete.`
      : `${missingRequired.length} required item(s) still needed for ${applicationType.replace(/_/g, " ")}: ${missingRequired.map((r) => r.label).join("; ")}.`,
  };
}

// ═══════════════════════════════════════════════════════════
// PERCENTILE COMPUTATION (deterministic interpolation)
// ═══════════════════════════════════════════════════════════

export function computePercentile(distribution, value, field = "score") {
  if (!distribution || distribution.length === 0 || value == null) return null;

  for (let i = 0; i < distribution.length; i++) {
    const row = distribution[i];
    const rowVal = row[field];
    if (rowVal == null) continue;

    if (value <= rowVal) {
      if (i === 0) return row.percentile;
      const prev = distribution[i - 1];
      const prevVal = prev[field];
      if (prevVal == null) return row.percentile;
      const frac = (value - prevVal) / (rowVal - prevVal);
      return Math.round(prev.percentile + frac * (row.percentile - prev.percentile));
    }
  }

  return Math.min(99, distribution[distribution.length - 1].percentile + 2);
}

// ═══════════════════════════════════════════════════════════
// AP RIGOR INDEX (deterministic)
// ═══════════════════════════════════════════════════════════

export function computeAPRigorIndex(courses, apRigorTable) {
  if (!courses || courses.length === 0) return { index: 0, details: [] };
  const table = apRigorTable || {};

  const apCourses = courses.filter((c) => c.type === "ap" || c.level === "AP");
  const details = apCourses.map((c) => {
    const rigor = table[c.name] || table[c.exam] || null;
    const tierWeight = rigor ? 6 - rigor.tier : 1; // tier1=5, tier2=4, ..., tier5=1
    return {
      course: c.name || c.exam,
      tier: rigor?.tier || 5,
      tierLabel: rigor?.label || "Unknown",
      weight: tierWeight,
    };
  });

  const index = details.reduce((sum, d) => sum + d.weight, 0);

  return {
    index,
    courseCount: apCourses.length,
    details,
    interpretation:
      index >= 20 ? "Extremely rigorous course load"
        : index >= 15 ? "Very rigorous course load"
          : index >= 10 ? "Rigorous course load"
            : index >= 5 ? "Moderately rigorous"
              : "Limited AP rigor — consider adding challenging courses",
  };
}

// ═══════════════════════════════════════════════════════════
// NET PRICE ESTIMATE (deterministic formula)
// ═══════════════════════════════════════════════════════════

export function estimateNetPrice(collegeData, familyIncome, isInState = false) {
  if (!collegeData) return { error: "College data not available." };

  const sticker = isInState ? collegeData.tuition_in : collegeData.tuition_out;
  if (!sticker) return { error: "Tuition data not available for this college." };

  // Use the college's reported average net price if available
  if (collegeData.avg_net_price) {
    return {
      stickerPrice: sticker,
      estimatedNetPrice: collegeData.avg_net_price,
      estimatedAid: sticker - collegeData.avg_net_price,
      method: "college_reported_average",
      note: "This is the college-reported average net price across all income levels. Your actual net price may differ. Use the college's official Net Price Calculator for a personalized estimate.",
      source: "College Scorecard (U.S. Dept. of Education)",
    };
  }

  // Rough estimate based on income bracket + Pell eligibility
  const pellEligible = familyIncome && familyIncome < 60000;
  const estimatedGrant = pellEligible ? Math.min(7395, sticker * 0.4) : sticker * 0.15;
  const estimatedNet = Math.max(0, sticker - estimatedGrant);

  return {
    stickerPrice: sticker,
    estimatedNetPrice: Math.round(estimatedNet),
    estimatedAid: Math.round(estimatedGrant),
    method: "rough_estimate",
    note: "This is a rough estimate only. Use the college's official Net Price Calculator (required on every college website) for an accurate estimate.",
    pellEligible,
  };
}

// ═══════════════════════════════════════════════════════════
// COMPLIANCE GATE EVALUATION
// ═══════════════════════════════════════════════════════════

export function evaluateComplianceGate(topicType, evidenceObjects = [], options = {}) {
  // For regulated topics: must have at least one verified evidence object from trusted source
  if (topicType === "regulated" || topicType === "high_stakes") {
    const verified = evidenceObjects.filter(
      (e) => e.confidence === "verified" && e.trust_level === "official"
    );

    if (verified.length === 0 && !options.allowUnverified) {
      return {
        allowed: false,
        reason: "No verified evidence from trusted sources available for this regulated topic.",
        action: "return_no_verified_answer",
        evidenceCount: evidenceObjects.length,
        verifiedCount: 0,
      };
    }

    return {
      allowed: true,
      reason: `${verified.length} verified evidence item(s) available from trusted sources.`,
      action: "proceed",
      evidenceCount: evidenceObjects.length,
      verifiedCount: verified.length,
    };
  }

  // For coaching: evidence is recommended but not required
  return {
    allowed: true,
    reason: "Coaching topic — evidence grounding recommended but not gated.",
    action: "proceed",
    evidenceCount: evidenceObjects.length,
  };
}

// ═══════════════════════════════════════════════════════════
// CRISIS RESPONSE (deterministic — no model call)
// ═══════════════════════════════════════════════════════════

export function buildCrisisResponse(locale = "en-US") {
  return {
    topicType: "crisis",
    modelUsed: "none",
    verified_facts: [],
    model_inferences: [],
    coaching_suggestions: [],
    crisis_response: {
      message: locale === "ko"
        ? "도움이 필요하신 것 같습니다. 아래 자원을 이용해 주세요."
        : "It sounds like you may be going through a difficult time. Please reach out to one of these resources:",
      resources: [
        { name: "Emergency Services", contact: "911", description: "For immediate danger", type: "emergency" },
        { name: "Suicide & Crisis Lifeline", contact: "988", description: "24/7 mental health support", type: "crisis" },
        { name: "Crisis Text Line", contact: "Text HOME to 741741", description: "Free 24/7 crisis texting", type: "crisis" },
        ...(locale === "ko" ? [
          { name: "한국 자살예방상담전화", contact: "1393", description: "24시간 상담", type: "crisis" },
          { name: "정신건강위기상담전화", contact: "1577-0199", description: "정신건강 위기 상담", type: "crisis" },
        ] : []),
      ],
      disclaimer: "I'm an AI assistant and cannot provide crisis counseling. Please contact a trained professional.",
    },
    ai_disclosure: {
      session_disclosure: "This is a deterministic safety response, not an AI-generated message.",
      model_disclosure: "No AI model was used for this response.",
    },
  };
}

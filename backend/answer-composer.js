// ═══════════════════════════════════════════════════════════════════════
// ANSWER COMPOSER — Three-lane output + AI disclosure + citations
// ═══════════════════════════════════════════════════════════════════════
// Every response must separate:
//   1. verified_facts:      From canonical_facts with confidence='verified'
//   2. model_inferences:    Model-generated, must reference evidence objects
//   3. coaching_suggestions: Non-binding guidance with coaching label
//
// For regulated/high_stakes topics:
//   - verified_facts can ONLY come from fact store
//   - If no verified source → return "no verified answer available"
//   - Model cannot add claims to verified_facts lane
//
// Every response includes session-level AI disclosure.
// ═══════════════════════════════════════════════════════════════════════

import crypto from "node:crypto";
import { TOPIC_TYPES } from "./policy-router.js";

// ─── Build AI disclosure block ───
function buildAIDisclosure(modelUsed, locale = "en-US") {
  const disclosures = {
    "en-US": {
      session: "This response was generated with AI assistance. Verified facts are sourced from official publications. Inferences and suggestions are AI-generated and should not be treated as professional advice.",
      advisory: "This tool provides informational guidance only. It is not a substitute for professional college counseling, financial advice, or official determinations by educational institutions or government agencies.",
      fafsa: "This is NOT an official FAFSA tool and does not replace StudentAid.gov. Only the U.S. Department of Education can make official financial aid determinations.",
    },
    ko: {
      session: "이 응답은 AI 지원으로 생성되었습니다. 확인된 사실은 공식 출판물에서 가져왔습니다. 추론 및 제안은 AI가 생성한 것이며 전문적인 조언으로 취급해서는 안 됩니다.",
      advisory: "이 도구는 정보 안내만 제공합니다. 전문 대학 상담, 재정 조언 또는 교육 기관이나 정부 기관의 공식 결정을 대체하지 않습니다.",
      fafsa: "이것은 공식 FAFSA 도구가 아니며 StudentAid.gov를 대체하지 않습니다.",
    },
  };

  const strings = disclosures[locale] || disclosures["en-US"];

  return {
    session_disclosure: strings.session,
    advisory_disclosure: strings.advisory,
    model_disclosure: modelUsed && modelUsed !== "none"
      ? `Model: Claude ${modelUsed.charAt(0).toUpperCase() + modelUsed.slice(1)} via Anthropic API`
      : "No AI model was used for this response.",
    generated_by: modelUsed && modelUsed !== "none" ? "ai" : "rules_engine",
  };
}

// ─── Build response for regulated topics with no-source-no-answer ───
function composeRegulatedAnswer(classification, verifiedEvidence, modelOutput, locale) {
  const { subIntent } = classification;

  // Filter to only verified evidence from trusted sources
  const trustedEvidence = verifiedEvidence.filter(
    (e) => e.confidence === "verified" && (e.trust_level === "official" || e.trust_level === "verified")
  );

  // Build verified facts lane (ONLY from fact store)
  const verified_facts = trustedEvidence.map((e) => ({
    statement: e.fact_value || e.claim,
    source: {
      url: e.source_url,
      domain: e.source_domain,
      title: e.source_title,
      extracted_at: e.extracted_at || e.source_accessed_at,
      confidence: e.confidence,
    },
    fact_id: e.id,
    fact_key: e.fact_key || e.claim_category,
  }));

  // Items that had no verified source
  const noVerifiedItems = [];
  if (trustedEvidence.length === 0) {
    noVerifiedItems.push({
      query_aspect: subIntent,
      message: "No verified answer available for this question.",
      suggested_source: getSuggestedSource(subIntent),
      reason: "No official source matched this query in our verified database.",
    });
  }

  // Model inferences: only if model was used AND had grounding
  const model_inferences = [];
  if (modelOutput && modelOutput.text && trustedEvidence.length > 0) {
    model_inferences.push({
      statement: modelOutput.text,
      label: "AI-generated inference grounded in verified sources",
      grounding_sources: trustedEvidence.map((e) => e.id),
      model: modelOutput.model || "sonnet",
      confidence_note: "This is a model-generated synthesis of verified data, not an independent claim.",
    });
  }

  return { verified_facts, model_inferences, coaching_suggestions: [], noVerifiedItems };
}

// ─── Build response for coaching topics ───
function composeCoachingAnswer(classification, evidence, modelOutput, locale) {
  const verified_facts = evidence
    .filter((e) => e.confidence === "verified" || e.evidence_type === 1)
    .map((e) => ({
      statement: e.fact_value || e.claim,
      source: {
        url: e.source_url,
        domain: e.source_domain,
        extracted_at: e.extracted_at || e.source_accessed_at,
        confidence: e.confidence || e.trust_level,
      },
      fact_id: e.id,
    }));

  const model_inferences = [];
  if (modelOutput?.analysis) {
    model_inferences.push({
      statement: modelOutput.analysis,
      label: "AI-generated inference",
      grounding_sources: evidence.map((e) => e.id).filter(Boolean),
      model: modelOutput.model || "sonnet",
      confidence_note: "This is a model-generated assessment, not an admissions decision.",
    });
  }

  const coaching_suggestions = [];
  if (modelOutput?.suggestions) {
    for (const suggestion of modelOutput.suggestions) {
      coaching_suggestions.push({
        statement: typeof suggestion === "string" ? suggestion : suggestion.text,
        label: "Non-binding coaching suggestion",
        basis: typeof suggestion === "object" ? suggestion.basis : null,
      });
    }
  } else if (modelOutput?.text) {
    coaching_suggestions.push({
      statement: modelOutput.text,
      label: "Non-binding coaching suggestion",
      basis: evidence.length > 0
        ? `Based on ${evidence.length} evidence item(s) from official and verified sources.`
        : null,
    });
  }

  return { verified_facts, model_inferences, coaching_suggestions, noVerifiedItems: [] };
}

// ─── Main compose function ───
export function composeAnswer({
  classification,
  evidence = [],
  modelOutput = null,
  locale = "en-US",
  studentId = null,
}) {
  const { topicType, subIntent, modelTier } = classification;
  const modelUsed = modelOutput?.model || modelTier || "none";
  const isRegulated = topicType === TOPIC_TYPES.REGULATED || topicType === TOPIC_TYPES.HIGH_STAKES;

  // Compose based on topic type
  let lanes;
  if (topicType === TOPIC_TYPES.CRISIS) {
    // Crisis responses are handled by rules-engine.js buildCrisisResponse()
    // This shouldn't normally be called for crisis topics
    lanes = { verified_facts: [], model_inferences: [], coaching_suggestions: [], noVerifiedItems: [] };
  } else if (isRegulated) {
    lanes = composeRegulatedAnswer(classification, evidence, modelOutput, locale);
  } else {
    lanes = composeCoachingAnswer(classification, evidence, modelOutput, locale);
  }

  // Build sources list (deduped)
  const sourceMap = new Map();
  for (const e of evidence) {
    const key = e.source_url || e.source_domain;
    if (key && !sourceMap.has(key)) {
      sourceMap.set(key, {
        url: e.source_url,
        title: e.source_title,
        domain: e.source_domain,
        accessed: e.extracted_at || e.source_accessed_at,
        trust_level: e.trust_level || e.confidence,
      });
    }
  }

  // FAFSA-specific disclosure
  const isFAFSA = subIntent === "fafsa" || subIntent === "financial_aid_policy";
  const disclosure = buildAIDisclosure(modelUsed, locale);
  if (isFAFSA) {
    const fafsaStrings = locale === "ko"
      ? "이것은 공식 FAFSA 도구가 아니며 StudentAid.gov를 대체하지 않습니다."
      : "This is NOT an official FAFSA tool and does not replace StudentAid.gov. Only the U.S. Department of Education can make official financial aid determinations.";
    disclosure.fafsa_disclosure = fafsaStrings;
  }

  return {
    response_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    topic_type: topicType,
    sub_intent: subIntent,
    model_used: modelUsed,

    // Three output lanes
    verified_facts: lanes.verified_facts,
    model_inferences: lanes.model_inferences,
    coaching_suggestions: lanes.coaching_suggestions,

    // Evidence panel
    sources: [...sourceMap.values()],

    // AI disclosure (session-level)
    ai_disclosure: {
      ...disclosure,
      content_labels: {
        verified_facts_count: lanes.verified_facts.length,
        model_inferences_count: lanes.model_inferences.length,
        coaching_suggestions_count: lanes.coaching_suggestions.length,
      },
    },

    // Official-source mode
    official_source_mode: {
      active: isRegulated,
      topic: subIntent,
      no_verified_answer_items: lanes.noVerifiedItems,
    },

    // Explanation capability (Korea AI Basic Act)
    explanation: {
      routing: classification.rationale,
      model_tier: modelUsed,
      evidence_count: evidence.length,
      source_count: sourceMap.size,
      gates_applied: classification.gates || [],
    },
  };
}

// ─── Compose a deterministic answer (T0 — no model) ───
export function composeDeterministicAnswer({
  classification,
  result,
  evidence = [],
  locale = "en-US",
}) {
  return composeAnswer({
    classification,
    evidence,
    modelOutput: null,
    locale,
  });
}

function getSuggestedSource(subIntent) {
  const map = {
    fafsa: { url: "https://studentaid.gov", label: "StudentAid.gov" },
    ferpa: { url: "https://studentprivacy.ed.gov", label: "Student Privacy Policy Office" },
    financial_aid_policy: { url: "https://studentaid.gov", label: "StudentAid.gov" },
    eligibility: { url: "https://studentaid.gov/apply-for-aid/fafsa/eligibility", label: "FAFSA Eligibility" },
    deadlines: { url: null, label: "Check the college's official admissions website" },
    financial_amounts: { url: null, label: "Contact the college's financial aid office" },
    school_policies: { url: null, label: "Check the college's official admissions website" },
    official_stats: { url: "https://collegescorecard.ed.gov", label: "College Scorecard" },
  };
  return map[subIntent] || { url: null, label: "Consult the relevant official source" };
}

// Claim-level answer composition. No model text is promoted to a verified fact.

import crypto from "node:crypto";
import {
  TOPIC_TYPES,
  isVerifiedEvidenceForTopic,
} from "./policy-router.js";

export const CLAIM_LANES = Object.freeze({
  VERIFIED: "verified_fact",
  STUDENT: "student_provided_fact",
  COACHING: "coaching_suggestion",
});

const TIER_DISCLOSURE_LABELS = {
  haiku: "small",
  sonnet: "medium",
  opus: "large",
  small: "small",
  medium: "medium",
  large: "large",
  council: "strategy council",
};

function normalizeTopicType(value) {
  return String(value || "").toLowerCase();
}

function normalizeSubIntent(value) {
  const intent = String(value || "").toLowerCase();
  if (intent.includes("fafsa")) return "fafsa";
  if (intent.includes("deadline")) return "deadlines";
  return intent;
}

function sourceDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function evidenceStatement(evidence) {
  return String(
    evidence?.fact_value ??
    evidence?.claim ??
    evidence?.statement ??
    ""
  ).trim();
}

function evidenceId(evidence) {
  return evidence?.id || evidence?.fact_id || null;
}

function sourceFromEvidence(evidence) {
  const url = evidence?.source_url || evidence?.source || null;
  return {
    id: evidenceId(evidence),
    url,
    domain: evidence?.source_domain || sourceDomain(url),
    title: evidence?.source_title || null,
    accessedAt: evidence?.extracted_at || evidence?.source_accessed_at || null,
    expiresAt: evidence?.expires_at || evidence?.expiresAt || null,
    academicYear: evidence?.academic_year || evidence?.academicYear || null,
  };
}

function isStudentProvidedEvidence(evidence) {
  const trust = String(evidence?.trust_level || "").toLowerCase();
  return trust === "student_provided" ||
    trust === "student" ||
    String(evidence?.entity_type || "").toLowerCase() === "student" ||
    evidence?.evidence_type === 2 && !evidence?.source_url;
}

function makeClaim({ lane, statement, source = null, basis = null, origin = null }) {
  const sourceIds = source?.id ? [source.id] : [];
  return {
    id: crypto.randomUUID(),
    lane,
    statement: String(statement || "").trim(),
    sourceIds,
    source,
    basis,
    origin,
  };
}

function dedupeClaims(claims) {
  const seen = new Set();
  return claims.filter((claim) => {
    if (!claim.statement) return false;
    const key = claim.lane + ":" + claim.statement.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildEvidenceClaims(evidence, subIntent) {
  const claims = [];
  for (const item of evidence) {
    const statement = evidenceStatement(item);
    if (!statement) continue;
    if (isVerifiedEvidenceForTopic(item, subIntent)) {
      claims.push(makeClaim({
        lane: CLAIM_LANES.VERIFIED,
        statement,
        source: sourceFromEvidence(item),
        origin: "evidence_store",
      }));
    } else if (isStudentProvidedEvidence(item)) {
      claims.push(makeClaim({
        lane: CLAIM_LANES.STUDENT,
        statement,
        source: evidenceId(item) ? { id: evidenceId(item) } : null,
        origin: "student",
      }));
    }
  }
  return claims;
}

function buildModelClaims(modelOutput, evidenceClaims) {
  if (!modelOutput) return [];
  const sourceIds = evidenceClaims
    .filter((claim) => claim.lane === CLAIM_LANES.VERIFIED)
    .flatMap((claim) => claim.sourceIds);
  const claims = [];
  const add = (value, basis) => {
    const statement = typeof value === "string" ? value : value?.text;
    if (!statement) return;
    const claim = makeClaim({
      lane: CLAIM_LANES.COACHING,
      statement,
      basis: basis || value?.basis || null,
      origin: "model",
    });
    claim.sourceIds = [...sourceIds];
    claims.push(claim);
  };

  if (Array.isArray(modelOutput.suggestions)) {
    for (const suggestion of modelOutput.suggestions) add(suggestion);
  } else if (modelOutput.text) {
    add(modelOutput.text, sourceIds.length ? "Synthesized from the cited evidence." : null);
  }
  if (modelOutput.analysis && modelOutput.analysis !== modelOutput.text) {
    add(modelOutput.analysis, sourceIds.length ? "Analysis grounded only in the cited evidence." : null);
  }
  return claims;
}

function deterministicClaims(classification, result) {
  if (!result) return [];
  const intent = normalizeSubIntent(classification?.subIntent);
  const claims = [];

  if (intent === "fafsa" || intent === "eligibility") {
    const rules = result.results || result.rules || [];
    for (const rule of rules) {
      const sourceUrl = rule.source || result.source || null;
      const officialEvidence = {
        id: rule.ruleId || rule.id || null,
        topic_type: "fafsa",
        fact_key: rule.ruleId || rule.id || "eligibility_rule",
        fact_value: rule.description || rule.message || rule.label,
        source_url: sourceUrl,
        source_domain: rule.sourceDomain || sourceDomain(sourceUrl),
        source_title: rule.sourceTitle || result.sourceTitle || null,
        extracted_at: rule.effectiveAt || result.effectiveAt || null,
        expires_at: rule.expiresAt || result.expiresAt || null,
        academic_year: rule.academicYear || result.academicYear || null,
        confidence: "verified",
        trust_level: "official",
      };
      const statement = evidenceStatement(officialEvidence);
      if (statement && isVerifiedEvidenceForTopic(officialEvidence, "fafsa")) {
        claims.push(makeClaim({
          lane: CLAIM_LANES.VERIFIED,
          statement,
          source: sourceFromEvidence(officialEvidence),
          origin: "rules_engine",
        }));
      }
      if (rule.status && rule.status !== "not_applicable") {
        claims.push(makeClaim({
          lane: CLAIM_LANES.STUDENT,
          statement: (rule.label || rule.ruleId || rule.id || "Eligibility item") + ": " + rule.status,
          basis: "Calculated from information supplied by the student.",
          origin: "rules_engine",
        }));
      }
    }
  } else if (intent === "deadlines") {
    const deadline = result.deadlineDate || result.deadline;
    const statement = result.message || (
      deadline
        ? "Using the provided deadline " + deadline + ", " + String(result.daysRemaining) + " day(s) remain."
        : "No deadline date was available."
    );
    const sourceUrl = result.source_url || result.source || null;
    const deadlineEvidence = {
      id: result.fact_id || null,
      topic_type: "deadlines",
      fact_key: "deadline",
      fact_value: statement,
      source_url: sourceUrl,
      source_domain: result.source_domain || sourceDomain(sourceUrl),
      source_title: result.source_title || null,
      expires_at: result.expires_at || null,
      confidence: result.confidence || (sourceUrl ? "verified" : "student_provided"),
      trust_level: result.trust_level || (sourceUrl ? "official" : "student_provided"),
    };
    claims.push(makeClaim({
      lane: isVerifiedEvidenceForTopic(deadlineEvidence, "deadlines")
        ? CLAIM_LANES.VERIFIED
        : CLAIM_LANES.STUDENT,
      statement,
      source: sourceUrl ? sourceFromEvidence(deadlineEvidence) : null,
      basis: sourceUrl ? null : "Calculated from a deadline supplied by the student or caller.",
      origin: "rules_engine",
    }));
  } else if (result.summary || result.message) {
    claims.push(makeClaim({
      lane: CLAIM_LANES.STUDENT,
      statement: result.summary || result.message,
      basis: "Deterministic calculation from supplied information.",
      origin: "rules_engine",
    }));
  }

  return claims;
}

function buildAIDisclosure(modelUsed, locale) {
  const korean = locale === "ko";
  const usedModel = modelUsed && modelUsed !== "none";
  return {
    session_disclosure: korean
      ? "AI가 생성한 제안은 코칭으로 표시되며 공식 사실과 분리됩니다."
      : "AI-generated suggestions are labeled as coaching and kept separate from verified and student-provided facts.",
    advisory_disclosure: korean
      ? "이 도구는 정보 제공용이며 공식 입학 또는 재정 지원 결정을 대신하지 않습니다."
      : "This tool provides informational guidance and does not replace official admissions or financial-aid determinations.",
    model_disclosure: usedModel
      ? "AI reasoning tier: " + (TIER_DISCLOSURE_LABELS[modelUsed] || modelUsed) + "."
      : "No AI model was used for this response.",
    generated_by: usedModel ? "ai" : "rules_engine",
  };
}

function suggestedSource(subIntent) {
  const sources = {
    fafsa: { url: "https://studentaid.gov", label: "StudentAid.gov" },
    eligibility: { url: "https://studentaid.gov", label: "StudentAid.gov" },
    ferpa: { url: "https://studentprivacy.ed.gov", label: "Student Privacy Policy Office" },
    financial_aid_policy: { url: "https://studentaid.gov", label: "StudentAid.gov" },
    deadlines: { url: null, label: "The college's official admissions website" },
    financial_amounts: { url: null, label: "The college's financial aid office" },
    school_policies: { url: null, label: "The college's official admissions website" },
    official_stats: { url: "https://collegescorecard.ed.gov", label: "College Scorecard" },
  };
  return sources[subIntent] || { url: null, label: "The relevant official source" };
}

function answerText(result, modelOutput, claims, regulated) {
  if (result?.summary) return result.summary;
  if (result?.message) return result.message;
  if (modelOutput?.text) return modelOutput.text;
  if (modelOutput?.analysis) return modelOutput.analysis;
  const verified = claims.filter((claim) => claim.lane === CLAIM_LANES.VERIFIED);
  if (verified.length) return verified.map((claim) => claim.statement).join("\n");
  return regulated
    ? "No verified answer is available for this question."
    : "There is not enough information to produce a specific suggestion.";
}

export function composeAnswer({
  classification = {},
  evidence = [],
  modelOutput = null,
  deterministicResult = null,
  locale = "en-US",
}) {
  const topicType = normalizeTopicType(classification.topicType);
  const subIntent = normalizeSubIntent(classification.subIntent);
  const regulated = topicType === TOPIC_TYPES.REGULATED || topicType === TOPIC_TYPES.HIGH_STAKES;
  const modelUsed = modelOutput?.model || classification.modelTier || "none";

  const claims = dedupeClaims([
    ...buildEvidenceClaims(evidence, subIntent),
    ...deterministicClaims(classification, deterministicResult),
  ]);
  claims.push(...buildModelClaims(modelOutput, claims));
  const finalClaims = dedupeClaims(claims);

  const verifiedFacts = finalClaims
    .filter((claim) => claim.lane === CLAIM_LANES.VERIFIED)
    .map((claim) => ({
      statement: claim.statement,
      source: claim.source,
      fact_id: claim.sourceIds[0] || null,
    }));
  const modelClaims = finalClaims.filter(
    (claim) => claim.lane === CLAIM_LANES.COACHING && claim.origin === "model"
  );
  const noVerified = regulated && verifiedFacts.length === 0;
  const sourceMap = new Map();
  for (const claim of finalClaims) {
    if (!claim.source?.url) continue;
    sourceMap.set(claim.source.url, claim.source);
  }

  const limitations = [];
  if (noVerified) limitations.push("No relevant, unexpired official source matched this question.");
  if (deterministicResult?.advisory) limitations.push(deterministicResult.advisory);
  if (modelClaims.length) limitations.push("AI coaching suggestions are not admissions predictions or official determinations.");
  const actions = noVerified ? [{ type: "consult_official_source", ...suggestedSource(subIntent) }] : [];
  const disclosure = buildAIDisclosure(modelUsed, locale);
  if (subIntent === "fafsa") {
    disclosure.fafsa_disclosure = "This is not an official FAFSA tool and does not replace StudentAid.gov.";
  }

  return {
    response_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    topic_type: topicType,
    sub_intent: subIntent,
    model_used: modelUsed,
    answer: answerText(deterministicResult, modelOutput, finalClaims, regulated),
    claims: finalClaims,
    limitations,
    actions,
    usage: modelOutput?.usage || { input_tokens: 0, output_tokens: 0, estimated_cost_usd: 0 },

    // Compatibility fields for clients migrating to claim-level lanes.
    verified_facts: verifiedFacts,
    model_inferences: modelClaims.map((claim) => ({
      statement: claim.statement,
      label: "AI-generated coaching inference",
      grounding_sources: claim.sourceIds,
      model: modelUsed,
    })),
    coaching_suggestions: finalClaims
      .filter((claim) => claim.lane === CLAIM_LANES.COACHING)
      .map((claim) => ({
        statement: claim.statement,
        label: "Non-binding coaching suggestion",
        basis: claim.basis,
      })),
    sources: [...sourceMap.values()],
    no_verified_answer: noVerified,
    ai_disclosure: {
      ...disclosure,
      content_labels: {
        verified_facts_count: verifiedFacts.length,
        student_provided_facts_count: finalClaims.filter((claim) => claim.lane === CLAIM_LANES.STUDENT).length,
        coaching_suggestions_count: finalClaims.filter((claim) => claim.lane === CLAIM_LANES.COACHING).length,
      },
    },
    official_source_mode: {
      active: regulated,
      topic: subIntent,
      no_verified_answer_items: noVerified ? [{
        query_aspect: subIntent,
        message: "No verified answer available for this question.",
        suggested_source: suggestedSource(subIntent),
      }] : [],
    },
    explanation: {
      routing: classification.rationale || null,
      model_tier: modelUsed,
      evidence_count: evidence.length,
      source_count: sourceMap.size,
      gates_applied: classification.gates || [],
    },
  };
}

export function composeDeterministicAnswer({
  classification,
  result,
  evidence = [],
  locale = "en-US",
}) {
  return composeAnswer({
    classification,
    evidence,
    deterministicResult: result,
    modelOutput: null,
    locale,
  });
}

export function composeCouncilAnswer({ envelope, locale = "en-US" } = {}) {
  if (!envelope) return null;
  const lines = [envelope.recommendation || "(no recommendation)"];
  const dissents = envelope.dissents || (envelope.dissent ? [envelope.dissent] : []);
  for (const dissent of dissents) {
    lines.push("");
    lines.push("> **" + dissent.from + " flagged:** " + dissent.text);
  }
  const citations = (envelope.citations || []).filter((citation) => citation.validated !== false);
  if (citations.length) {
    lines.push("");
    lines.push("_Citations: " + citations.slice(0, 8).map((citation) =>
      "[[" + citation.type + ":" + citation.id + "]]"
    ).join(" ") + "_");
  }
  return {
    lane: "council",
    body: lines.join("\n"),
    confidence: envelope.confidence,
    moderator_rule: envelope.moderator_rule,
    council_breakdown: envelope.council_breakdown,
    ai_disclosure: buildAIDisclosure("council", locale),
  };
}

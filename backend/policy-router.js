// ═══════════════════════════════════════════════════════════════════════
// POLICY ROUTER — Deterministic topic classification and compliance gates
// ═══════════════════════════════════════════════════════════════════════
// This module is the first layer in the request pipeline. It classifies
// every incoming query into a topic type, determines source constraints,
// selects the appropriate model tier, and enforces compliance gates.
//
// IMPORTANT: This module is 100% deterministic — no LLM calls.
// ═══════════════════════════════════════════════════════════════════════

// ─── Topic Type Definitions ───
// regulated:     FAFSA, FERPA, eligibility, legal, compliance
// high_stakes:   Deadlines, school policies, financial aid amounts, scholarship eligibility
// coaching:      EC strategy, essay brainstorming, activity suggestions, college list building
// administrative: Profile updates, data export, account management
// crisis:        Self-harm, abuse, emergency
export const TOPIC_TYPES = {
  REGULATED: "regulated",
  HIGH_STAKES: "high_stakes",
  COACHING: "coaching",
  ADMINISTRATIVE: "administrative",
  CRISIS: "crisis",
};

// ─── Model Tiers ───
// The tier enum keeps the HAIKU / SONNET / OPUS names for backward
// compatibility (existing call sites across orchestration-engine,
// ec-strength-vectorizer, and ap-concept-vectorizer reference them
// directly). The SMALL / MEDIUM / LARGE aliases point at the same
// values — new code should prefer the provider-agnostic names.
//   small  = routing, extraction, classification, moderation, OCR validation
//   medium = source-grounded coaching, synthesis, trend analysis
//   large  = complex synthesis, conflict resolution, essay critique
export const MODEL_TIERS = {
  NONE: "none",
  HAIKU: "haiku",
  SONNET: "sonnet",
  OPUS: "opus",
  // Provider-agnostic aliases — mapped 1:1 to the names above.
  SMALL: "haiku",
  MEDIUM: "sonnet",
  LARGE: "opus",
};

// ─── Escalation threshold: Sonnet must report confidence below this to escalate to Opus ───
const OPUS_ESCALATION_THRESHOLD = 0.45;

// ─── Keyword patterns for topic classification ───
const PATTERNS = {
  crisis: [
    /\b(suicid|kill\s*my\s*self|self[- ]?harm|want\s*to\s*die|end\s*(my|it\s*all)|hurt\s*myself)\b/i,
    /\b(abuse|abused|molest|assault|domestic\s*violence)\b/i,
    /\b(emergency|danger|unsafe|threatened)\b/i,
  ],
  regulated: {
    fafsa: /\bfafsa\b|\bstudent\s*aid\s*index\b|\bsai\b|\befc\b|\bexpected\s*family\s*contribution\b|\bfederal\s*student\s*aid\b|\bstudentaid\.gov\b|\bfsa\s*id\b|\bcontributor\b.*\bfafsa\b/i,
    ferpa: /\bferpa\b|\bfamily\s*educational\s*rights\b|\beducation\s*records?\b|\bstudent\s*privacy\b|\bschool\s*records?\b/i,
    financial_aid_policy: /\bneed[- ]blind\b|\bneed[- ]aware\b|\bcss\s*profile\b|\binstitutional\s*aid\b|\binstitutional\s*methodology\b|\bfinancial\s*aid\s*policy\b/i,
    eligibility: /\b(am\s*i|do\s*i)\s*(eligible|qualify)\b|\beligibility\b|\bqualification\b|\bcitizenship\s*requirement\b|\bselective\s*service\b/i,
    legal_compliance: /\blegal\b|\bcompliance\b|\bregulation\b|\bpolicy\b.*\brequir/i,
  },
  high_stakes: {
    deadlines: /\bdeadline\b|\bdue\s*date\b|\bwhen\s*(is|are|do)\b.*\b(due|deadline|close|open)\b|\bearly\s*(decision|action)\b|\bpriority\s*deadline\b|\brolling\s*admission\b/i,
    financial_amounts: /\b(how\s*much|cost|tuition|price|net\s*price|afford)\b|\bgrant\b|\bloan\b|\bpell\b|\bscholarship\b|\bstipend\b|\bmerit\s*aid\b/i,
    school_policies: /\btest[- ]optional\b|\btest[- ]required\b|\bsuperscore\b|\bscore\s*choice\b|\bapplication\s*requirement\b|\brequired\s*document\b/i,
    official_stats: /\bacceptance\s*rate\b|\badmission\s*rate\b|\bclass\s*profile\b|\bmiddle\s*50\b|\b(25th|75th)\s*percentile\b/i,
  },
  coaching: {
    ec_strategy: /\bextracurricular\b|\bec\b|\bactivit(y|ies)\b|\bspike\b|\bhook\b|\bsummer\s*(program|activit|plan)\b|\bleadership\b|\bvolunteer\b|\binternship\b|\bresearch\b/i,
    essay: /\bessay\b|\bnarrative\b|\bpersonal\s*statement\b|\bsupplement\b|\bcommon\s*app\s*essay\b|\bwriting\b.*\b(help|review|feedback)\b/i,
    college_list: /\bcollege\s*list\b|\bschool\s*list\b|\breach\b|\bmatch\b|\bsafety\b|\btarget\b|\bchance\s*me\b|\bcan\s*i\s*get\s*in\b|\bfit\b|\bcompare\s*college/i,
    strategy: /\bstrategy\b|\bplan\b|\broadmap\b|\b4[- ]year\b|\bjunior\s*year\b|\bsenior\s*year\b|\btimeline\b/i,
    gpa_benchmark: /\bgpa\b|\bsat\b|\bact\b|\bpercentile\b|\bbenchmark\b|\bhow\s*(do|does)\s*(my|i)\s*(compare|stack)\b/i,
  },
};

// ─── Main classification function ───
export function classifyTopic(query, conversationContext = {}) {
  const text = (query || "").trim().toLowerCase();
  if (!text) {
    return {
      topicType: TOPIC_TYPES.ADMINISTRATIVE,
      intent: "empty_query",
      subIntent: null,
      sourceConstraint: "none",
      modelTier: MODEL_TIERS.NONE,
      gates: [],
      confidence: 1.0,
      rationale: "Empty query — no classification needed.",
    };
  }

  // 1. Crisis detection — always first, highest priority
  for (const pattern of PATTERNS.crisis) {
    if (pattern.test(text)) {
      return {
        topicType: TOPIC_TYPES.CRISIS,
        intent: "crisis_detected",
        subIntent: null,
        sourceConstraint: "none",
        modelTier: MODEL_TIERS.NONE,
        gates: ["crisis_protocol"],
        confidence: 0.95,
        rationale: "Crisis keywords detected. Route to deterministic crisis response.",
      };
    }
  }

  // 2. Regulated topics
  for (const [subIntent, pattern] of Object.entries(PATTERNS.regulated)) {
    if (pattern.test(text)) {
      return {
        topicType: TOPIC_TYPES.REGULATED,
        intent: "regulated",
        subIntent,
        sourceConstraint: "trusted_only",
        modelTier: MODEL_TIERS.NONE, // Start with rules engine, escalate if needed
        gates: ["source_verification", "no_source_no_answer", "advisory_only_disclosure"],
        confidence: 0.88,
        rationale: `Regulated topic (${subIntent}). Rules engine first, trusted sources only, no-source-no-answer enforced.`,
      };
    }
  }

  // 3. High-stakes topics
  for (const [subIntent, pattern] of Object.entries(PATTERNS.high_stakes)) {
    if (pattern.test(text)) {
      return {
        topicType: TOPIC_TYPES.HIGH_STAKES,
        intent: "high_stakes",
        subIntent,
        sourceConstraint: "official_required",
        modelTier: subIntent === "deadlines" || subIntent === "official_stats"
          ? MODEL_TIERS.NONE   // Pure lookup
          : MODEL_TIERS.SONNET, // May need synthesis for financial amounts
        gates: ["source_verification", "official_source_mode"],
        confidence: 0.82,
        rationale: `High-stakes topic (${subIntent}). Official source required. Speculative responses blocked.`,
      };
    }
  }

  // 4. Coaching topics
  // Reasoning-heavy subintents (EC strategy, essay review, college-list
  // building, 4-year strategy) need to weigh multiple signals at once:
  // student profile + each school's published values + competitive
  // context. Pin those to LARGE/Opus from the first attempt so the
  // model has the headroom to produce strategic answers instead of
  // surface-level suggestions. Cheaper subintents stay on SONNET.
  const HEAVY_COACHING_SUBINTENTS = new Set([
    "ec_strategy", "essay", "college_list", "strategy",
  ]);
  for (const [subIntent, pattern] of Object.entries(PATTERNS.coaching)) {
    if (pattern.test(text)) {
      let modelTier = MODEL_TIERS.SONNET;
      if (subIntent === "gpa_benchmark") modelTier = MODEL_TIERS.NONE;
      else if (HEAVY_COACHING_SUBINTENTS.has(subIntent)) modelTier = MODEL_TIERS.OPUS;
      return {
        topicType: TOPIC_TYPES.COACHING,
        intent: "coaching",
        subIntent,
        sourceConstraint: "evidence_grounded",
        modelTier,
        gates: ["coaching_label"],
        confidence: 0.78,
        rationale: `Coaching topic (${subIntent}). ${modelTier === MODEL_TIERS.OPUS ? "Cross-source strategy — large model required." : "Evidence-grounded synthesis with coaching label."}`,
      };
    }
  }

  // 5. Default: general coaching
  return {
    topicType: TOPIC_TYPES.COACHING,
    intent: "coaching",
    subIntent: "general",
    sourceConstraint: "evidence_grounded",
    modelTier: MODEL_TIERS.SONNET,
    gates: ["coaching_label"],
    confidence: 0.5,
    rationale: "No specific topic matched. Default to evidence-grounded coaching.",
  };
}

// ─── Compliance gate enforcement ───
export function enforceGates(topicType, subIntent, availableEvidence = []) {
  const results = [];

  if (topicType === TOPIC_TYPES.CRISIS) {
    results.push({
      gate: "crisis_protocol",
      passed: true,
      action: "deterministic_crisis_response",
      reason: "Crisis detected — bypass all model calls, return crisis resources.",
    });
    return { allowed: true, gates: results, fallback: null };
  }

  if (topicType === TOPIC_TYPES.REGULATED || topicType === TOPIC_TYPES.HIGH_STAKES) {
    // Check if we have any verified evidence for this topic
    const verifiedEvidence = availableEvidence.filter(
      (e) => e.confidence === "verified" || e.confidence === "extracted"
    );

    if (verifiedEvidence.length === 0) {
      results.push({
        gate: "no_source_no_answer",
        passed: false,
        action: "return_no_verified_answer",
        reason: "No verified source available for this regulated/high-stakes topic.",
      });
      return {
        allowed: false,
        gates: results,
        fallback: {
          message: "No verified answer available for this question.",
          suggestedSource: getSuggestedOfficialSource(subIntent),
          reason: "No official source matched this query in our verified database.",
        },
      };
    }

    results.push({
      gate: "source_verification",
      passed: true,
      action: "proceed_with_evidence",
      reason: `${verifiedEvidence.length} verified evidence item(s) available.`,
    });
  }

  if (topicType === TOPIC_TYPES.COACHING) {
    results.push({
      gate: "coaching_label",
      passed: true,
      action: "label_as_coaching",
      reason: "Output will be labeled as non-binding coaching suggestion.",
    });
  }

  return { allowed: true, gates: results, fallback: null };
}

// ─── Model tier selection with escalation logic ───
export function selectModelTier(topicType, subIntent, queryComplexity = "normal", priorAttempt = null) {
  // Crisis: never use a model
  if (topicType === TOPIC_TYPES.CRISIS) return MODEL_TIERS.NONE;

  // Administrative: never use a model
  if (topicType === TOPIC_TYPES.ADMINISTRATIVE) return MODEL_TIERS.NONE;

  // Regulated: start with rules engine
  if (topicType === TOPIC_TYPES.REGULATED) {
    if (!priorAttempt) return MODEL_TIERS.NONE;
    // If rules engine couldn't fully answer, escalate to Sonnet for grounded synthesis
    if (priorAttempt.tier === MODEL_TIERS.NONE && priorAttempt.needsSynthesis) {
      return MODEL_TIERS.SONNET;
    }
    // If Sonnet couldn't resolve (low confidence), escalate to Opus
    if (priorAttempt.tier === MODEL_TIERS.SONNET &&
        priorAttempt.confidence < OPUS_ESCALATION_THRESHOLD) {
      return MODEL_TIERS.OPUS;
    }
    return priorAttempt.tier;
  }

  // High-stakes: deadlines and stats are lookup-only
  if (topicType === TOPIC_TYPES.HIGH_STAKES) {
    if (subIntent === "deadlines" || subIntent === "official_stats") return MODEL_TIERS.NONE;
    if (!priorAttempt) return MODEL_TIERS.SONNET;
    if (priorAttempt.tier === MODEL_TIERS.SONNET &&
        priorAttempt.confidence < OPUS_ESCALATION_THRESHOLD) {
      return MODEL_TIERS.OPUS;
    }
    return MODEL_TIERS.SONNET;
  }

  // Coaching
  if (topicType === TOPIC_TYPES.COACHING) {
    if (subIntent === "gpa_benchmark") return MODEL_TIERS.NONE;
    // EC strategy + essay + college-list strategy all need cross-source
    // reasoning (student profile + school values + competitive context).
    // Pin these to LARGE/Opus from the first attempt so the model has
    // the headroom to weigh trade-offs instead of producing surface-level
    // suggestions. Cost-conscious deployments can lower this in their
    // own fork.
    if (subIntent === "ec_strategy" || subIntent === "essay" || subIntent === "college_list" || subIntent === "strategy") {
      return MODEL_TIERS.OPUS;
    }
    if (!priorAttempt) return MODEL_TIERS.SONNET;
    // Escalate any other complex coaching turn to Opus on retry.
    if (priorAttempt.tier === MODEL_TIERS.SONNET &&
        priorAttempt.confidence < OPUS_ESCALATION_THRESHOLD &&
        queryComplexity === "complex") {
      return MODEL_TIERS.OPUS;
    }
    return MODEL_TIERS.SONNET;
  }

  return MODEL_TIERS.SONNET;
}

// ─── Check if query can be fully handled by rules engine (T0) ───
export function canHandleDeterministically(topicType, subIntent) {
  const deterministicRoutes = new Set([
    `${TOPIC_TYPES.CRISIS}:crisis_detected`,
    `${TOPIC_TYPES.REGULATED}:fafsa`,        // Eligibility checks
    `${TOPIC_TYPES.REGULATED}:eligibility`,
    `${TOPIC_TYPES.HIGH_STAKES}:deadlines`,
    `${TOPIC_TYPES.HIGH_STAKES}:official_stats`,
    `${TOPIC_TYPES.COACHING}:gpa_benchmark`,
    `${TOPIC_TYPES.ADMINISTRATIVE}:empty_query`,
  ]);
  return deterministicRoutes.has(`${topicType}:${subIntent}`);
}

// ─── Check Opus budget ───
export function checkOpusBudget(studentId, opusUsageToday, config = {}) {
  const dailyCap = config.OPUS_DAILY_CAP || 5;
  const monthlyCap = config.OPUS_MONTHLY_CAP || 50;

  return {
    allowed: opusUsageToday.daily < dailyCap && opusUsageToday.monthly < monthlyCap,
    dailyRemaining: Math.max(0, dailyCap - opusUsageToday.daily),
    monthlyRemaining: Math.max(0, monthlyCap - opusUsageToday.monthly),
    reason: opusUsageToday.daily >= dailyCap
      ? "Daily Opus budget exceeded. Complex queries will use Sonnet."
      : opusUsageToday.monthly >= monthlyCap
        ? "Monthly Opus budget exceeded."
        : null,
  };
}

// ─── Build full routing decision ───
export function routeRequest(query, conversationContext = {}, availableEvidence = [], config = {}) {
  const classification = classifyTopic(query, conversationContext);
  const gateResult = enforceGates(classification.topicType, classification.subIntent, availableEvidence);

  if (!gateResult.allowed) {
    return {
      classification,
      gateResult,
      modelTier: MODEL_TIERS.NONE,
      action: "return_fallback",
      fallback: gateResult.fallback,
    };
  }

  const modelTier = selectModelTier(
    classification.topicType,
    classification.subIntent,
    conversationContext.queryComplexity || "normal",
    conversationContext.priorAttempt || null,
  );

  const isDeterministic = canHandleDeterministically(classification.topicType, classification.subIntent);

  return {
    classification,
    gateResult,
    modelTier,
    isDeterministic,
    action: isDeterministic ? "rules_engine" : modelTier === MODEL_TIERS.NONE ? "fact_store_lookup" : "model_synthesis",
  };
}

// ─── Helper: suggest official source for a regulated sub-intent ───
function getSuggestedOfficialSource(subIntent) {
  const sources = {
    fafsa: { url: "https://studentaid.gov", label: "StudentAid.gov" },
    ferpa: { url: "https://studentprivacy.ed.gov", label: "Student Privacy Policy Office" },
    financial_aid_policy: { url: "https://studentaid.gov", label: "StudentAid.gov" },
    eligibility: { url: "https://studentaid.gov/apply-for-aid/fafsa/eligibility", label: "FAFSA Eligibility (StudentAid.gov)" },
    legal_compliance: { url: "https://ed.gov", label: "U.S. Department of Education" },
    deadlines: { url: null, label: "Check the college's official admissions website" },
    financial_amounts: { url: null, label: "Contact the college's financial aid office directly" },
    school_policies: { url: null, label: "Check the college's official admissions website" },
    official_stats: { url: "https://collegescorecard.ed.gov", label: "College Scorecard (U.S. Dept. of Education)" },
  };
  return sources[subIntent] || { url: null, label: "Consult the relevant official source directly" };
}

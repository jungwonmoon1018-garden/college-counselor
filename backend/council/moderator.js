// Deterministic final Council stage. Role identity alone never acts as a veto,
// with one exception preserved from the original harness: a Compliance Reviewer
// "oppose" is a HARD veto (the council must not ship a non-compliant plan).

const STRONG_CONFIDENCE = 0.7;
// An ungrounded "support" is clamped here — below STRONG_CONFIDENCE so a
// rubber-stamp can't count toward consensus on volume alone.
const SYCOPHANCY_CAP = 0.6;

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// Anti-sycophancy + anti-hallucination calibration, applied to every seat
// before the tally. A seat that votes "support" with high confidence but cites
// nothing is an ungrounded rubber-stamp: agreement not backed by the shared
// context. Clamp its confidence so it cannot manufacture consensus, and flag it
// so the breakdown/audit trail shows why. The seat prompts ask for the same
// discipline; this is the deterministic backstop. `grounded` reflects raw
// citation presence — the councilor's separate validation layer still governs
// which citations are surfaced as evidence.
function calibrateSeat(seat) {
  const citations = Array.isArray(seat.citations) ? seat.citations : [];
  const grounded = citations.length > 0;
  let confidence = clamp01(Number(seat.confidence));
  let calibrated = null;
  if (seat.stance === "support" && !grounded && confidence >= STRONG_CONFIDENCE) {
    confidence = SYCOPHANCY_CAP;
    calibrated = "ungrounded_support_clamped";
  }
  return { ...seat, confidence, grounded, calibrated };
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function validatedCitations(seats) {
  const seen = new Set();
  const citations = [];
  for (const seat of seats) {
    for (const citation of seat.citations || []) {
      if (citation.validated !== true) continue;
      const key = citation.type + ":" + citation.id;
      if (seen.has(key)) continue;
      seen.add(key);
      citations.push(citation);
    }
  }
  return citations;
}

function dissentFrom(seat) {
  return {
    from: seat.role,
    text: seat.reasoning || seat.recommendation,
    recommendation: seat.recommendation,
    citations: (seat.citations || []).filter((citation) => citation.validated === true),
  };
}

function summarizeSeats(seats) {
  return seats.map((seat) => ({
    role: seat.role,
    stance: seat.stance,
    confidence: seat.confidence,
    model: seat.model,
    provider: seat.provider,
    abstained: Boolean(seat.abstained),
    citation_validation: seat.citation_validation || { valid: 0, invalid: 0 },
    // Grounding transparency: did the seat cite anything, and was its
    // confidence clamped for ungrounded agreement (anti-sycophancy)?
    grounded: Boolean(seat.grounded),
    calibrated: seat.calibrated || null,
  }));
}

export function moderate(councilorEnvelopes) {
  // Calibrate first; every rule below reads the calibrated confidences.
  const seats = (councilorEnvelopes || []).filter(Boolean).map(calibrateSeat);
  const active = seats.filter((seat) => !seat.abstained);
  const strategist = seats.find((seat) => seat.role === "Strategist");
  const dataChecker = seats.find((seat) => seat.role === "Data Checker");
  const compliance = seats.find((seat) => seat.role === "Compliance Reviewer");
  const citations = validatedCitations(seats);
  const breakdown = summarizeSeats(seats);

  // Rule 1 (hard veto, highest priority): a Compliance "oppose" means the
  // council cannot ship the recommendation as advice. Preserved from the
  // original harness — role identity is never otherwise a veto.
  if (compliance && compliance.stance === "oppose") {
    return {
      recommendation:
        "The Compliance Reviewer flagged this recommendation as non-compliant. " +
        "We can't surface it as advice. Consider consulting a human counselor or " +
        "rephrasing your question without the constraint that triggered the flag.",
      confidence: 0.95,
      dissent: dissentFrom(compliance),
      dissents: [dissentFrom(compliance)],
      citations,
      moderator_rule: "compliance_veto",
      council_breakdown: breakdown,
    };
  }

  if (!strategist || strategist.abstained || !strategist.recommendation) {
    return {
      recommendation: "The Council could not produce a primary recommendation from the available context.",
      confidence: 0,
      dissent: null,
      dissents: active.filter((seat) => seat.stance !== "support").map(dissentFrom),
      citations,
      moderator_rule: "no_primary_recommendation",
      council_breakdown: breakdown,
    };
  }

  const dissents = active
    .filter((seat) => seat.role !== "Strategist" && ["oppose", "modify"].includes(seat.stance))
    .map(dissentFrom);
  const strategistSupported = (strategist.citations || []).some((citation) => citation.validated === true);
  const checkerDisputesEvidence = dataChecker?.stance === "oppose";
  const invalidPrimaryCitations = Number(strategist.citation_validation?.invalid || 0) > 0;
  const baseConfidence = average(active.map((seat) => Number(seat.confidence) || 0));
  let recommendation = strategist.recommendation;
  let confidence = baseConfidence;
  let rule = "supported_consensus";

  if (checkerDisputesEvidence || invalidPrimaryCitations || !strategistSupported) {
    recommendation += "\n\nEvidence limitation: the Council could not validate every load-bearing claim. Treat this as exploratory coaching.";
    confidence = Math.min(confidence, 0.45);
    rule = "evidence_disputed";
  } else if (dissents.some((item) => item.from === "Skeptic" || item.from === "Devil's Advocate")) {
    recommendation += "\n\nSubstantive dissent remains unresolved and is shown with this recommendation.";
    confidence = Math.min(confidence, 0.65);
    rule = "dissent_preserved";
  } else if (dissents.length) {
    recommendation += "\n\nThe recommendation is qualified by the modifications shown below.";
    confidence = Math.min(confidence, 0.7);
    rule = "qualified_recommendation";
  }

  if (active.length < 4) {
    confidence = Math.min(confidence, 0.4);
    rule = "partial_panel";
  }

  return {
    recommendation,
    confidence: Math.max(0, Math.min(1, Math.round(confidence * 1000) / 1000)),
    dissent: dissents[0] || null,
    dissents,
    citations,
    moderator_rule: rule,
    council_breakdown: breakdown,
  };
}

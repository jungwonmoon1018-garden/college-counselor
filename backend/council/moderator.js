// Deterministic final Council stage. Role identity alone never acts as a veto.

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
  }));
}

export function moderate(councilorEnvelopes) {
  const seats = (councilorEnvelopes || []).filter(Boolean);
  const active = seats.filter((seat) => !seat.abstained);
  const strategist = seats.find((seat) => seat.role === "Strategist");
  const dataChecker = seats.find((seat) => seat.role === "Data Checker");
  const citations = validatedCitations(seats);
  const breakdown = summarizeSeats(seats);

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

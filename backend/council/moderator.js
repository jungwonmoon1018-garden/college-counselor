// ═══════════════════════════════════════════════════════════════════════
// MODERATOR — deterministic vote tally for the Strategy Council
// ═══════════════════════════════════════════════════════════════════════
// Reads the 5 councilor envelopes and produces a single recommendation
// envelope for the student. No LLM call — pure rules.
//
// Rules (in priority order):
//   1. Compliance HARD veto: if Compliance Reviewer stance == "oppose",
//      the council cannot ship the recommendation. Output explains which
//      line was crossed and recommends consulting a human counselor.
//   2. Data Checker soft veto: if Data Checker stance == "oppose" (i.e.
//      fabricated claims detected), output flags "low evidence" and
//      surfaces the Skeptic's modification as the primary recommendation
//      where possible.
//   3. Strong consensus: ≥4 councilors with stance "support" AND
//      confidence ≥ 0.7 → ship the Strategist's recommendation verbatim
//      with high confidence.
//   4. Modify consensus: 3+ "support" + 2 "modify" → present both
//      with the modification as a "consider also" block.
//   5. Dissent: 1+ "oppose" (non-veto seats) → present the recommendation
//      AND the dissenting view verbatim, recommend the student think
//      through both before deciding.
//   6. Hung panel: no majority → present the question back as
//      under-determined, recommend the student get more evidence
//      (more EC details, a parent conversation, a counselor meeting).
// ═══════════════════════════════════════════════════════════════════════

const STRONG_CONFIDENCE = 0.7;

export function moderate(councilorEnvelopes) {
  const seats = councilorEnvelopes.filter(Boolean);
  if (seats.length === 0) {
    return {
      recommendation: "The council could not deliberate — no councilor envelopes received.",
      confidence: 0,
      dissent: null,
      citations: [],
      moderator_rule: "no_seats",
      council_breakdown: [],
    };
  }

  const bySeat = Object.fromEntries(seats.map((s) => [s.role, s]));
  const strategist = bySeat["Strategist"] || null;
  const skeptic = bySeat["Skeptic"] || null;
  const dataChecker = bySeat["Data Checker"] || null;
  const compliance = bySeat["Compliance Reviewer"] || null;
  const devilsAdvocate = bySeat["Devil's Advocate"] || null;

  // Rule 1: Compliance HARD veto
  if (compliance && compliance.stance === "oppose") {
    return {
      recommendation:
        "The Compliance Reviewer flagged this recommendation as non-compliant. " +
        "We can't surface it as advice. Consider consulting a human counselor or " +
        "rephrasing your question without the constraint that triggered the flag.",
      confidence: 0.95,
      dissent: {
        from: "Compliance Reviewer",
        text: compliance.reasoning || compliance.recommendation,
        citations: compliance.citations || [],
      },
      citations: collectCitations(seats),
      moderator_rule: "compliance_veto",
      council_breakdown: summarizeSeats(seats),
    };
  }

  // Rule 2: Data Checker soft veto (any "oppose")
  if (dataChecker && dataChecker.stance === "oppose") {
    const fallback = skeptic && skeptic.stance === "modify"
      ? skeptic.recommendation
      : strategist?.recommendation || "(no fallback recommendation available)";
    return {
      recommendation: `${fallback}\n\n— Caveat: Data Checker flagged claims with insufficient evidence. Treat this as exploratory, not as a vetted plan.`,
      confidence: Math.min(0.5, (strategist?.confidence ?? 0.4)),
      dissent: {
        from: "Data Checker",
        text: dataChecker.reasoning || dataChecker.recommendation,
        citations: dataChecker.citations || [],
      },
      citations: collectCitations(seats),
      moderator_rule: "data_soft_veto",
      council_breakdown: summarizeSeats(seats),
    };
  }

  // Tally non-veto seats (Strategist, Skeptic, Devil's Advocate) + Data Checker
  const tallySeats = [strategist, skeptic, devilsAdvocate, dataChecker].filter(Boolean);
  const supports = tallySeats.filter((s) => s.stance === "support" && s.confidence >= STRONG_CONFIDENCE);
  const modifies = tallySeats.filter((s) => s.stance === "modify");
  const opposes = tallySeats.filter((s) => s.stance === "oppose");

  // Rule 3: Strong consensus
  if (supports.length >= 4 && opposes.length === 0) {
    return {
      recommendation: strategist?.recommendation || supports[0].recommendation,
      confidence: avg(supports.map((s) => s.confidence)),
      dissent: null,
      citations: collectCitations(seats),
      moderator_rule: "strong_consensus",
      council_breakdown: summarizeSeats(seats),
    };
  }

  // Rule 4: Modify consensus
  if (modifies.length >= 2 && opposes.length === 0) {
    const primary = strategist?.recommendation || tallySeats[0].recommendation;
    const considerAlso = modifies.map((m) => `- ${m.role}: ${m.recommendation}`).join("\n");
    return {
      recommendation:
        `${primary}\n\n**Consider also:**\n${considerAlso}`,
      confidence: 0.65,
      dissent: null,
      citations: collectCitations(seats),
      moderator_rule: "modify_consensus",
      council_breakdown: summarizeSeats(seats),
    };
  }

  // Rule 5: Dissent
  if (opposes.length >= 1) {
    const dissenter = opposes[0];
    return {
      recommendation:
        `${strategist?.recommendation || "(no Strategist recommendation)"}\n\n` +
        `**${dissenter.role} disagrees:** ${dissenter.recommendation}\n\n` +
        `Think through both before deciding. The dissent here is substantive, not a procedural objection.`,
      confidence: 0.55,
      dissent: {
        from: dissenter.role,
        text: dissenter.reasoning || dissenter.recommendation,
        citations: dissenter.citations || [],
      },
      citations: collectCitations(seats),
      moderator_rule: "dissent_present",
      council_breakdown: summarizeSeats(seats),
    };
  }

  // Rule 6: Hung panel
  return {
    recommendation:
      "The council didn't reach a clear answer with the available evidence. " +
      "Consider adding more detail to your narrative or EC evidence and re-asking, " +
      "or talk this one through with a human counselor.",
    confidence: 0.35,
    dissent: null,
    citations: collectCitations(seats),
    moderator_rule: "hung_panel",
    council_breakdown: summarizeSeats(seats),
  };
}

function avg(nums) {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function collectCitations(seats) {
  const seen = new Set();
  const out = [];
  for (const s of seats) {
    for (const c of s.citations || []) {
      const key = `${c.type}:${c.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
  }
  return out;
}

function summarizeSeats(seats) {
  return seats.map((s) => ({
    role: s.role,
    stance: s.stance,
    confidence: s.confidence,
    model: s.model,
    provider: s.provider,
    fallback_used: !!s.fallback_used,
    abstained: !!s.abstained,
  }));
}

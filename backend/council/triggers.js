// ═══════════════════════════════════════════════════════════════════════
// COUNCIL TRIGGERS — when to convene the 5-seat Strategy Council (Pillar 9)
// ═══════════════════════════════════════════════════════════════════════
// The council is expensive (median ~5k tokens / 3-5s latency) so it only
// fires for genuinely high-stakes strategic decisions, not for routine Q&A.
//
// A decision triggers the council if ANY of:
//   1. User explicitly invokes /council (decision_type set by caller).
//   2. Policy router classifies subIntent into STRATEGY_COUNCIL_SUBINTENTS
//      (see policy-router.js).
//   3. Confidence escalation — single-model coaching answer comes back with
//      confidence < 0.55 (handled by orchestration-engine, not here).
// ═══════════════════════════════════════════════════════════════════════

import { STRATEGY_COUNCIL_SUBINTENTS } from "../policy-router.js";

export const DECISION_TYPES = Object.freeze({
  COLLEGE_LIST: "college-list",
  MAJOR_PIVOT: "major-pivot",
  NARRATIVE_ARC: "narrative-arc",
  EC_STRATEGY: "ec-strategy",
  ED_EA: "ed-ea",
  LATE_CYCLE: "late-cycle",
  OTHER: "other",
});

const SUBINTENT_TO_DECISION = {
  college_list: DECISION_TYPES.COLLEGE_LIST,
  ec_strategy: DECISION_TYPES.EC_STRATEGY,
  essay: DECISION_TYPES.NARRATIVE_ARC,
  strategy: DECISION_TYPES.OTHER,
};

/** Map a policy-router subintent to a council decision type. */
export function subIntentToDecisionType(subIntent) {
  return SUBINTENT_TO_DECISION[subIntent] || DECISION_TYPES.OTHER;
}

/** True iff the subintent should escalate to the council. */
export function shouldConveneForSubIntent(subIntent) {
  return STRATEGY_COUNCIL_SUBINTENTS.has(subIntent);
}

/** Confidence-escalation threshold — below this, coaching answers fall back to council. */
export const COUNCIL_CONFIDENCE_ESCALATION_THRESHOLD = Number(
  process.env.COUNCIL_CONFIDENCE_THRESHOLD || 0.55,
);

// ═══════════════════════════════════════════════════════════════════════
// STRATEGY COUNCIL — public API (Pillar 9)
// ═══════════════════════════════════════════════════════════════════════
// One function: convene(). Takes a student question + decision type +
// dependencies (db statements, BYOK row, Logseq creds), runs all 5
// councilors in parallel against a shared context envelope, tallies via
// the deterministic moderator, persists the audit trail, returns the
// recommendation envelope.
//
// The five seats (per Pillar 9 plan):
//   1. Strategist     — embedded
//   2. Skeptic        — embedded
//   3. Devil's Advocate — embedded
//   4. Data Checker   — BYOK medium
//   5. Compliance     — BYOK medium
//
// PIPA: when STRATEGY_COUNCIL_CROSS_BORDER consent is missing AND the
// student's BYOK provider is foreign-hosted, Data Checker and Compliance
// fall back to embedded. The audit trail records the fallback so the
// student knows the assurance is lower than usual.
// ═══════════════════════════════════════════════════════════════════════

import { Councilor } from "./councilor.js";
import * as strategistRole from "./roles/strategist.js";
import * as skepticRole from "./roles/skeptic.js";
import * as devilsAdvocateRole from "./roles/devils-advocate.js";
import * as dataCheckerRole from "./roles/data-checker.js";
import * as complianceRole from "./roles/compliance.js";
import { moderate } from "./moderator.js";
import { buildCouncilContext } from "./context-builder.js";
import { recordConvening } from "./audit-trail.js";
import { DECISION_TYPES, subIntentToDecisionType } from "./triggers.js";

const FOREIGN_PROVIDERS = new Set(["openai", "openrouter", "google", "deepseek", "together", "zhipu", "openai_compat"]);

function buildCouncilors({ student, byok, crossBorderConsent }) {
  const allowForeign = crossBorderConsent || !byok || !byok.provider || !FOREIGN_PROVIDERS.has(byok.provider);
  // Embedded seats — always embedded.
  const seats = [
    new Councilor({ role: strategistRole.ROLE, getSystemPrompt: strategistRole.getSystemPrompt, tier: strategistRole.TIER, preferEmbedded: true }),
    new Councilor({ role: skepticRole.ROLE, getSystemPrompt: skepticRole.getSystemPrompt, tier: skepticRole.TIER, preferEmbedded: true }),
    new Councilor({ role: devilsAdvocateRole.ROLE, getSystemPrompt: devilsAdvocateRole.getSystemPrompt, tier: devilsAdvocateRole.TIER, preferEmbedded: true }),
  ];

  // Data Checker + Compliance — BYOK medium when consent allows, else embedded fallback.
  seats.push(new Councilor({
    role: dataCheckerRole.ROLE,
    getSystemPrompt: dataCheckerRole.getSystemPrompt,
    tier: dataCheckerRole.TIER,
    preferEmbedded: !allowForeign, // force embedded when consent missing
  }));
  seats.push(new Councilor({
    role: complianceRole.ROLE,
    getSystemPrompt: complianceRole.getSystemPrompt,
    tier: complianceRole.TIER,
    preferEmbedded: !allowForeign,
  }));

  return { seats, allowForeign };
}

/**
 * Convene the 5-seat Strategy Council.
 *
 * @param {object} opts
 * @param {string} opts.studentId
 * @param {string} opts.dataDir
 * @param {string} opts.question
 * @param {string} [opts.decisionType]    — see triggers.DECISION_TYPES
 * @param {string} [opts.subIntent]       — for confidence-escalation callers
 * @param {object} opts.student           — student profile (no PII)
 * @param {object} [opts.byok]            — {provider, apiKey, baseUrl, model}
 * @param {boolean} [opts.crossBorderConsent=false]
 * @param {object} opts.councilStmts      — from prepareCouncilStatements()
 * @param {object} [opts.factStmts]
 * @param {object} [opts.evidenceStmts]
 * @param {object} [opts.logseq]          — {httpEndpoint, token}
 * @param {AbortSignal} [opts.signal]
 */
export async function convene(opts) {
  const {
    studentId,
    dataDir,
    question,
    student,
    byok,
    crossBorderConsent = false,
    councilStmts,
    factStmts,
    evidenceStmts,
    logseq = {},
    signal,
  } = opts;

  if (!studentId) throw new Error("convene() requires studentId");
  if (!question) throw new Error("convene() requires question");
  if (!councilStmts) throw new Error("convene() requires councilStmts (run prepareCouncilStatements)");

  const decisionType = opts.decisionType
    || subIntentToDecisionType(opts.subIntent)
    || DECISION_TYPES.OTHER;

  // 1. Build the shared context envelope.
  const context = await buildCouncilContext({
    studentId,
    dataDir,
    question,
    student,
    factStmts,
    evidenceStmts,
    logseq,
  });

  // 2. Spin up the 5 seats with PIPA-aware composition.
  const { seats } = buildCouncilors({ student, byok, crossBorderConsent });

  // 3. Parallel deliberation. Each seat catches its own errors and
  //    returns an abstention envelope on failure, so a single seat's
  //    blow-up doesn't kill the whole council.
  const results = await Promise.all(
    seats.map((seat) =>
      seat.deliberate({
        question,
        decisionType,
        student,
        context,
        byok,
        signal,
      }).catch((err) => ({
        role: seat.role,
        stance: "modify",
        recommendation: `(${seat.role} errored: ${err.message})`,
        confidence: 0,
        citations: [],
        reasoning: err.stack || err.message,
        abstained: true,
      })),
    ),
  );

  // 4. Deterministic tally.
  const envelope = moderate(results);

  // 5. Persist audit trail (Logseq + SQLite). Don't block the response on
  //    Logseq failures — the SQLite row is the source of truth.
  const totalTokens = results.reduce((acc, r) => {
    const u = r.usage || {};
    return {
      input: acc.input + (u.input_tokens | 0),
      output: acc.output + (u.output_tokens | 0),
    };
  }, { input: 0, output: 0 });

  const convening_id = await recordConvening({
    stmts: councilStmts,
    studentId,
    dataDir,
    decisionType,
    question,
    envelope,
    totalTokens,
    logseq,
  });

  return {
    convening_id,
    recommendation: envelope.recommendation,
    confidence: envelope.confidence,
    dissent: envelope.dissent,
    citations: envelope.citations,
    council_breakdown: envelope.council_breakdown,
    moderator_rule: envelope.moderator_rule,
    decision_type: decisionType,
    total_tokens: totalTokens,
  };
}

export { DECISION_TYPES } from "./triggers.js";
export { initCouncilTables, prepareCouncilStatements } from "./audit-trail.js";

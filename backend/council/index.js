// Explicit sequential Strategy Council:
// Strategist -> Data Checker -> Skeptic -> Devil's Advocate -> Moderator.

import { Councilor } from "./councilor.js";
import * as strategistRole from "./roles/strategist.js";
import * as dataCheckerRole from "./roles/data-checker.js";
import * as skepticRole from "./roles/skeptic.js";
import * as devilsAdvocateRole from "./roles/devils-advocate.js";
import { moderate } from "./moderator.js";
import { buildCouncilContext } from "./context-builder.js";
import { recordConvening } from "./audit-trail.js";
import { DECISION_TYPES, subIntentToDecisionType } from "./triggers.js";

export const COUNCIL_STAGE_ORDER = Object.freeze([
  "Strategist",
  "Data Checker",
  "Skeptic",
  "Devil's Advocate",
  "Moderator",
]);

function buildCouncilors(callModel) {
  return [
    new Councilor({
      role: strategistRole.ROLE,
      getSystemPrompt: strategistRole.getSystemPrompt,
      tier: strategistRole.TIER,
      callModel,
    }),
    new Councilor({
      role: dataCheckerRole.ROLE,
      getSystemPrompt: dataCheckerRole.getSystemPrompt,
      tier: dataCheckerRole.TIER,
      callModel,
    }),
    new Councilor({
      role: skepticRole.ROLE,
      getSystemPrompt: skepticRole.getSystemPrompt,
      tier: skepticRole.TIER,
      callModel,
    }),
    new Councilor({
      role: devilsAdvocateRole.ROLE,
      getSystemPrompt: devilsAdvocateRole.getSystemPrompt,
      tier: devilsAdvocateRole.TIER,
      callModel,
    }),
  ];
}

function normalizeContext(value) {
  if (!value) return null;
  if (typeof value === "string") return { text: value, evidenceIndex: {}, immutable: true };
  return {
    text: String(value.text || ""),
    evidenceIndex: value.evidenceIndex || {},
    immutable: true,
  };
}

export async function convene(opts = {}) {
  const {
    studentId,
    dataDir,
    question,
    student,
    councilStmts,
    factStmts,
    signal,
    callModel,
    beforeStage,
    afterStage,
  } = opts;
  const llm = opts.llm || opts.byok;
  if (opts.explicit !== true) {
    const error = new Error("Strategy Council requires an explicit, cost-disclosed student action.");
    error.code = "COUNCIL_EXPLICIT_ACTION_REQUIRED";
    throw error;
  }
  if (!studentId) throw new Error("convene() requires studentId");
  if (!question) throw new Error("convene() requires question");
  if (!councilStmts) throw new Error("convene() requires councilStmts");
  if (!llm?.apiKey) throw new Error("convene() requires the administrator's OpenRouter key");
  if (opts.requestId && councilStmts.getByRequestId?.get(opts.requestId, studentId)) {
    const error = new Error("This Council request has already been processed.");
    error.code = "COUNCIL_DUPLICATE_REQUEST";
    throw error;
  }

  const decisionType = opts.decisionType ||
    subIntentToDecisionType(opts.subIntent) ||
    DECISION_TYPES.OTHER;
  const context = normalizeContext(opts.contextOverride) || await buildCouncilContext({
    studentId,
    dataDir,
    question,
    student,
    factStmts,
    evidenceStmts: opts.evidenceStmts,
  });
  const outputs = [];

  for (const [index, seat] of buildCouncilors(callModel).entries()) {
    if (signal?.aborted) throw signal.reason || new Error("Council request aborted");
    const stageInfo = {
      index,
      role: seat.role,
      tier: seat.tier,
      priorOutputs: outputs,
      contextChars: context.text.length,
    };
    const approval = beforeStage ? await beforeStage(stageInfo) : { allowed: true };
    if (approval?.allowed === false) {
      const error = new Error(approval.reason || "Council stage budget was denied.");
      error.code = approval.code || "COUNCIL_BUDGET_DENIED";
      error.stage = seat.role;
      throw error;
    }
    const output = await seat.deliberate({
      question,
      decisionType,
      student,
      context,
      priorOutputs: outputs,
      llm,
      signal,
    });
    outputs.push(output);
    if (afterStage) await afterStage({ ...stageInfo, output, approval });
  }

  const envelope = moderate(outputs);
  const totalTokens = outputs.reduce((totals, output) => {
    const usage = output.usage || {};
    totals.input += Number(usage.input_tokens) || 0;
    totals.output += Number(usage.output_tokens) || 0;
    return totals;
  }, { input: 0, output: 0 });
  const conveningId = await recordConvening({
    stmts: councilStmts,
    studentId,
    decisionType,
    question,
    envelope,
    totalTokens,
    triggerSource: opts.triggerSource || "manual",
    requestId: opts.requestId || null,
  });

  return {
    convening_id: conveningId,
    recommendation: envelope.recommendation,
    confidence: envelope.confidence,
    dissent: envelope.dissent,
    dissents: envelope.dissents,
    citations: envelope.citations,
    council_breakdown: envelope.council_breakdown,
    moderator_rule: envelope.moderator_rule,
    decision_type: decisionType,
    total_tokens: totalTokens,
    stage_order: COUNCIL_STAGE_ORDER,
    sequential: true,
  };
}

export { DECISION_TYPES } from "./triggers.js";
export { initCouncilTables, prepareCouncilStatements } from "./audit-trail.js";

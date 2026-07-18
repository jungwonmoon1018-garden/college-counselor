// Student knowledge-graph and explicit Strategy Council routes.

import {
  rebuildStudentGraph,
  queryStudentGraph,
  getStudentGraphStatus,
} from "./knowledge-graph/index.js";
import {
  convene,
  initCouncilTables,
  prepareCouncilStatements,
  DECISION_TYPES,
} from "./council/index.js";
import {
  restorePII as defaultRestorePII,
  screenInput as defaultScreenInput,
  screenOutput as defaultScreenOutput,
} from "./content-moderation.js";
import { isCrisisText as defaultIsCrisisText } from "./policy-router.js";
import { buildCrisisResponse as defaultBuildCrisisResponse } from "./rules-engine.js";

const VALID_DECISION_TYPES = new Set(Object.values(DECISION_TYPES));

export function mountPillarRoutes(app, deps) {
  const {
    db,
    dataDir,
    requireAuth,
    requireSelf,
    getStudentProfile,
    getOperatorLLM,
    validateAIConsent,
    factStmts,
    evidenceStmts,
    beginCouncilBudget,
    beforeCouncilStage,
    afterCouncilStage,
    releaseCouncilBudget,
    studentLimiter = (_req, _res, next) => next(),
    conveneCouncil = convene,
    screenCouncilInput = defaultScreenInput,
    screenCouncilOutput = defaultScreenOutput,
    restoreCouncilPII = defaultRestorePII,
    isCouncilCrisisText = defaultIsCrisisText,
    buildCouncilCrisisResponse = defaultBuildCrisisResponse,
  } = deps;

  if (!db) throw new Error("mountPillarRoutes requires db");
  if (!dataDir) throw new Error("mountPillarRoutes requires dataDir");
  if (typeof requireAuth !== "function" || typeof requireSelf !== "function") {
    throw new Error("mountPillarRoutes requires authentication middleware");
  }

  initCouncilTables(db);
  const councilStmts = prepareCouncilStatements(db);

  app.post("/api/students/:id/knowledge-graph/rebuild", requireAuth, requireSelf, async (req, res) => {
    try {
      const result = await rebuildStudentGraph(req.params.id, {
        dataDir,
        mode: req.query.mode === "full" ? "full" : "incremental",
      });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message, code: error.code });
    }
  });

  app.get("/api/students/:id/knowledge-graph/query", requireAuth, requireSelf, async (req, res) => {
    const question = String(req.query.q || "").slice(0, 1000).trim();
    if (!question) return res.status(400).json({ error: "missing q parameter" });
    const result = await queryStudentGraph(req.params.id, question, {
      dataDir,
      mode: req.query.dfs ? "dfs" : "bfs",
      budgetTokens: Math.min(Math.max(Number(req.query.budget) || 1500, 100), 4000),
    });
    res.json(result);
  });

  app.get("/api/students/:id/knowledge-graph/status", requireAuth, requireSelf, async (req, res) => {
    res.json(await getStudentGraphStatus(req.params.id, { dataDir }));
  });

  // Notebook/Logseq was removed. Keep only an explicit compatibility response.
  app.use("/api/students/:id/notebook", requireAuth, requireSelf, (_req, res) => {
    res.status(410).json({ error: "Notebook integration has been removed.", code: "FEATURE_REMOVED" });
  });

  app.post("/api/council/convene", studentLimiter, requireAuth, async (req, res) => {
    const studentId = req.user?.studentId;
    if (!studentId) return res.status(401).json({ error: "Authentication required." });
    const questionValue = req.body?.question;
    if (questionValue != null && typeof questionValue !== "string") {
      return res.status(400).json({
        error: "question must be a string",
        code: "COUNCIL_QUESTION_INVALID",
      });
    }
    const rawQuestion = questionValue || "";
    const question = rawQuestion.trim();
    if (!question) return res.status(400).json({ error: "missing question" });
    if (rawQuestion.length > 2000) {
      return res.status(400).json({
        error: "question must be 2,000 characters or fewer",
        code: "COUNCIL_QUESTION_TOO_LONG",
      });
    }

    // Crisis support is deterministic and must not be suppressed by malformed
    // Council metadata. It runs after authentication/size checks but before
    // request-id, explicit-action, consent, budget, or model validation.
    const localeHeader = req.headers["x-collegeapp-locale"] || req.headers["accept-language"] || "";
    const locale = String(localeHeader).toLowerCase().startsWith("ko") ? "ko" : "en-US";
    if (isCouncilCrisisText(question)) {
      const built = buildCouncilCrisisResponse(locale);
      const crisis = built?.crisis_response || built || {};
      return res.json({
        answer: crisis.message || "",
        actions: Array.isArray(crisis.resources) ? crisis.resources : [],
        limitations: [crisis.disclaimer].filter(Boolean),
        crisisSafe: true,
        _meta: { deterministic: true, topicType: "CRISIS", modelTier: "NONE" },
      });
    }

    if (typeof req.body?.request_id !== "string" || !req.body.request_id.trim()) {
      return res.status(400).json({
        error: "request_id is required",
        code: "COUNCIL_REQUEST_ID_REQUIRED",
      });
    }
    const requestId = req.body.request_id.trim();
    const rawRequestId = req.body.request_id;
    if (rawRequestId.length > 128) {
      return res.status(400).json({
        error: "request_id must be 128 characters or fewer",
        code: "COUNCIL_REQUEST_ID_TOO_LONG",
      });
    }
    if (req.body?.explicit !== true || req.body?.auto === true) {
      return res.status(400).json({
        error: "Strategy Council requires an explicit, cost-disclosed student action.",
        code: "COUNCIL_EXPLICIT_ACTION_REQUIRED",
      });
    }
    const requestedDecisionType = req.body?.decision_type;
    if (requestedDecisionType != null && !VALID_DECISION_TYPES.has(requestedDecisionType)) {
      return res.status(400).json({
        error: "decision_type is invalid",
        code: "COUNCIL_DECISION_TYPE_INVALID",
      });
    }
    const decisionType = requestedDecisionType || DECISION_TYPES.OTHER;

    const inputScreen = screenCouncilInput(question);
    if (inputScreen?.blocked) {
      return res.status(400).json({
        error: inputScreen.reason || inputScreen.message || "The Council question was blocked by safety policy.",
        code: "COUNCIL_INPUT_BLOCKED",
        blocked: true,
        category: inputScreen.category || null,
      });
    }
    const screenedQuestion = String(inputScreen?.text ?? inputScreen?.redactedText ?? question).trim();
    if (!screenedQuestion) {
      return res.status(400).json({
        error: "The Council question is empty after safety screening.",
        blocked: true,
      });
    }

    const consent = typeof validateAIConsent === "function" ? validateAIConsent(studentId) : { allowed: false };
    if (!consent.allowed) {
      return res.status(403).json({
        error: "Required AI and cross-border transfer consent has not been granted.",
        missingConsents: consent.missing || [],
      });
    }
    if (
      typeof beginCouncilBudget !== "function" ||
      typeof beforeCouncilStage !== "function" ||
      typeof afterCouncilStage !== "function" ||
      typeof releaseCouncilBudget !== "function"
    ) {
      return res.status(503).json({
        error: "Council budget reservations are unavailable.",
        code: "COUNCIL_BUDGET_UNAVAILABLE",
      });
    }
    const llm = typeof getOperatorLLM === "function" ? getOperatorLLM() : null;
    if (!llm?.apiKey) {
      return res.status(503).json({
        error: "The administrator must configure OpenRouter first.",
        code: "OPENROUTER_NOT_CONFIGURED",
      });
    }

    let budgetSession = null;
    let budgetReleased = false;
    const releaseBudgetOnce = () => {
      if (!budgetSession || budgetReleased) return;
      budgetReleased = true;
      releaseCouncilBudget(budgetSession);
    };
    try {
      budgetSession = await beginCouncilBudget({ studentId, requestId });
      const student = typeof getStudentProfile === "function"
        ? await getStudentProfile(studentId)
        : null;
      const result = await conveneCouncil({
        studentId,
        dataDir,
        question: screenedQuestion,
        explicit: true,
        requestId,
        decisionType,
        student,
        llm,
        councilStmts,
        factStmts,
        evidenceStmts,
        beforeStage: (stage) => beforeCouncilStage({ ...stage, studentId, requestId, budgetSession }),
        afterStage: (stage) => afterCouncilStage({ ...stage, studentId, requestId, budgetSession }),
        triggerSource: "manual",
      });
      const sanitizeText = (value) => {
        if (value == null) return value;
        const screened = screenCouncilOutput(String(value));
        return restoreCouncilPII(screened?.text ?? String(value), inputScreen?.piiTokenMap || {});
      };
      const sanitizeDissent = (item) => {
        if (item == null || typeof item !== "object") return sanitizeText(item);
        return {
          ...item,
          text: sanitizeText(item.text),
          recommendation: sanitizeText(item.recommendation),
        };
      };
      const dissents = Array.isArray(result?.dissents)
        ? result.dissents.map(sanitizeDissent)
        : [];
      const standaloneDissent = sanitizeDissent(result?.dissent);
      const safeResult = {
        ...result,
        recommendation: sanitizeText(result?.recommendation),
        dissents,
        dissent: standaloneDissent || dissents[0] || null,
      };
      releaseBudgetOnce();
      res.json({ ...safeResult, usage: summarizeCouncilBudget(budgetSession) });
    } catch (error) {
      releaseBudgetOnce();
      const status = error.status || (error.code === "COUNCIL_DUPLICATE_REQUEST" ? 409
        : error.code === "BUDGET_EXCEEDED" || error.code === "COUNCIL_BUDGET_DENIED" ? 402
          : 500);
      res.status(status).json({ error: error.message, code: error.code });
    }
  });

  app.get("/api/council/convenings", studentLimiter, requireAuth, (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
    res.json(councilStmts.getRecent.all(req.user.studentId, limit));
  });

  app.get("/api/council/convenings/:id", studentLimiter, requireAuth, (req, res) => {
    const row = councilStmts.getById.get(req.params.id, req.user.studentId);
    if (!row) return res.status(404).json({ error: "convening not found" });
    res.json({
      ...row,
      citations: safeJSON(row.citations_json),
      council_breakdown: safeJSON(row.council_breakdown_json),
    });
  });

  app.use("/api/strategy-council", studentLimiter, requireAuth, (_req, res) => {
    res.status(410).json({ error: "Use the explicit /api/council routes.", code: "route_moved" });
  });
}

function summarizeCouncilBudget(session) {
  const stages = (session?.stages || []).map((stage) => ({
    index: stage.index,
    role: stage.role,
    tier: stage.tier,
    deterministic: stage.deterministic === true,
    reserved_usd: stage.reservation?.reservedUsd || 0,
    actual_usd: stage.reconciliation?.actualUsd || 0,
    input_tokens: stage.usage?.input_tokens || 0,
    output_tokens: stage.usage?.output_tokens || 0,
    status: stage.deterministic ? "deterministic" : (stage.reconciliation ? "reconciled" : "released"),
  }));
  return {
    stages,
    reserved_usd: stages.reduce((sum, stage) => sum + stage.reserved_usd, 0),
    actual_usd: stages.reduce((sum, stage) => sum + stage.actual_usd, 0),
    input_tokens: stages.reduce((sum, stage) => sum + stage.input_tokens, 0),
    output_tokens: stages.reduce((sum, stage) => sum + stage.output_tokens, 0),
  };
}

function safeJSON(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

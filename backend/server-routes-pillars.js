// ═══════════════════════════════════════════════════════════════════════
// SERVER ROUTES — Pillars 1/7/8/9 endpoint module
// ═══════════════════════════════════════════════════════════════════════
// Mount in server.js with one line:
//
//   import { mountPillarRoutes } from "./server-routes-pillars.js";
//   mountPillarRoutes(app, { db, dataDir, requireAuth, getStudentBYOK, getStudentProfile });
//
// Exposes:
//   GET  /api/llm/providers/embedded/status            (Pillar 1)
//   POST /api/students/:id/knowledge-graph/rebuild     (Pillar 7)
//   GET  /api/students/:id/knowledge-graph/query       (Pillar 7)
//   GET  /api/students/:id/knowledge-graph/status      (Pillar 7)
//   GET  /api/students/:id/notebook/pages              (Pillar 8)
//   GET  /api/students/:id/notebook/pages/:name        (Pillar 8)
//   PUT  /api/students/:id/notebook/pages/:name        (Pillar 8)
//   GET  /api/students/:id/notebook/journal/:date      (Pillar 8)
//   POST /api/students/:id/notebook/journal/:date/append (Pillar 8)
//   POST /api/strategy-council/convene                 (Pillar 9)
//
// All routes require auth via the `requireAuth(req, res, next)` middleware
// the caller injects. `getStudentBYOK(studentId)` should return
// {provider, apiKey, baseUrl, model, crossBorderConsent} for the Council
// BYOK seats. `getStudentProfile(studentId)` should return the student
// profile (grade, locale, narrative summary, stated values) without PII.
// ═══════════════════════════════════════════════════════════════════════

import { validateEmbedded } from "./llm-adapters/embedded-llama.js";
import { isEmbeddingsAvailable } from "./llm-adapters/embedded-embeddings.js";
import { resolveTierDefault, isEmbeddedAvailable } from "./llm-adapters/index.js";
import {
  rebuildStudentGraph,
  queryStudentGraph,
  getStudentGraphStatus,
} from "./knowledge-graph/index.js";
import {
  bootstrapStudentVault,
  readPage,
  readJournal,
  listPages,
  appendBlock,
  writeJournalEntry,
  watchStudentVault,
} from "./logseq/index.js";
import {
  convene,
  initCouncilTables,
  prepareCouncilStatements,
  DECISION_TYPES,
} from "./council/index.js";
import {
  CONSENT_TYPES,
  hasActiveConsent,
} from "./consent.js";

const VALID_DECISION_TYPES = new Set(Object.values(DECISION_TYPES));

export function mountPillarRoutes(app, deps) {
  const {
    db,
    dataDir,
    requireAuth,
    getStudentBYOK,
    getStudentProfile,
    consentStmts,
    factStmts,
    evidenceStmts,
  } = deps;

  if (!db) throw new Error("mountPillarRoutes requires db");
  if (!dataDir) throw new Error("mountPillarRoutes requires dataDir");

  // Initialize council tables once.
  initCouncilTables(db);
  const councilStmts = prepareCouncilStatements(db);

  // Per-student Logseq HTTP creds (optional). Stored in counselor.db so they
  // survive restarts. When unset, callers fall back to direct filesystem reads
  // of the vault — the default, robust path. Only the live HTTP endpoint of a
  // running Logseq desktop is stored here; never PII.
  db.exec(`
    CREATE TABLE IF NOT EXISTS logseq_credentials (
      student_id   TEXT PRIMARY KEY,
      http_endpoint TEXT,
      token         TEXT,
      updated_at    TEXT DEFAULT (datetime('now'))
    );
  `);
  const logseqCredStmts = {
    get: db.prepare(`SELECT http_endpoint, token FROM logseq_credentials WHERE student_id = ?`),
    upsert: db.prepare(`
      INSERT INTO logseq_credentials (student_id, http_endpoint, token, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(student_id) DO UPDATE SET
        http_endpoint = excluded.http_endpoint,
        token = excluded.token,
        updated_at = datetime('now')
    `),
    del: db.prepare(`DELETE FROM logseq_credentials WHERE student_id = ?`),
  };

  // Returns {httpEndpoint, token} when the student registered a live Logseq
  // endpoint, else {} so callers transparently use the filesystem path.
  function resolveLogseqCreds(studentId) {
    try {
      const row = logseqCredStmts.get.get(studentId);
      if (row && row.http_endpoint) {
        return { httpEndpoint: row.http_endpoint, token: row.token || "" };
      }
    } catch { /* table optional / read failure → filesystem */ }
    return {};
  }

  // ────────────────────────────────────────────────────────────────
  // Pillar 1 — embedded provider status
  // ────────────────────────────────────────────────────────────────
  app.get("/api/llm/providers/embedded/status", async (req, res) => {
    try {
      const modelId = resolveTierDefault("embedded", "small");
      const validation = await validateEmbedded({ model: modelId });
      const embeddingsOk = await isEmbeddingsAvailable();
      res.json({
        available: validation.valid && embeddingsOk,
        model_downloaded: validation.valid,
        model_path: modelId,
        validation: { code: validation.code, message: validation.message },
        capabilities: {
          small: validation.valid,
          embeddings: embeddingsOk,
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ────────────────────────────────────────────────────────────────
  // Pillar 7 — per-student knowledge graph
  // ────────────────────────────────────────────────────────────────
  app.post("/api/students/:id/knowledge-graph/rebuild", requireAuth, async (req, res) => {
    const studentId = req.params.id;
    try {
      const result = await rebuildStudentGraph(studentId, {
        dataDir,
        mode: req.query.mode === "full" ? "full" : "incremental",
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message, code: err.code });
    }
  });

  app.get("/api/students/:id/knowledge-graph/query", requireAuth, async (req, res) => {
    const studentId = req.params.id;
    const question = String(req.query.q || "").slice(0, 1000);
    if (!question) return res.status(400).json({ error: "missing q parameter" });
    const out = await queryStudentGraph(studentId, question, {
      dataDir,
      mode: req.query.dfs ? "dfs" : "bfs",
      budgetTokens: Number(req.query.budget) || 1500,
    });
    res.json(out);
  });

  app.get("/api/students/:id/knowledge-graph/status", requireAuth, async (req, res) => {
    const studentId = req.params.id;
    const out = await getStudentGraphStatus(studentId, { dataDir });
    res.json(out);
  });

  // ────────────────────────────────────────────────────────────────
  // Pillar 8 — Logseq notebook
  // ────────────────────────────────────────────────────────────────
  function ensureVaultConsent(req, res, next) {
    const studentId = req.params.id;
    if (!consentStmts) return next(); // dev mode — no consent enforcement
    const consent = hasActiveConsent(consentStmts, studentId, CONSENT_TYPES.LOGSEQ_VAULT);
    if (!consent.hasConsent) {
      return res.status(403).json({ error: "LOGSEQ_VAULT consent required" });
    }
    next();
  }

  app.post("/api/students/:id/notebook/init", requireAuth, ensureVaultConsent, async (req, res) => {
    const studentId = req.params.id;
    const parentConsent = consentStmts
      ? hasActiveConsent(consentStmts, studentId, CONSENT_TYPES.LOGSEQ_PARENT_CONVERSATIONS).hasConsent
      : false;
    const out = await bootstrapStudentVault(studentId, dataDir, {
      parentConversationsConsent: parentConsent,
    });
    // Watch the freshly-bootstrapped vault so Logseq/in-app edits debounce a
    // graph rebuild. No-op when chokidar is absent.
    watchStudentVault(studentId, dataDir).catch((err) =>
      console.warn("[notebook/init] watch failed:", err.message),
    );
    res.json(out);
  });

  // Register (or clear) a student's live Logseq HTTP endpoint. Pass a falsy
  // http_endpoint to clear and revert to filesystem-only access.
  app.put("/api/students/:id/notebook/logseq-config", requireAuth, ensureVaultConsent, (req, res) => {
    const studentId = req.params.id;
    const httpEndpoint = String(req.body?.http_endpoint || "").trim().slice(0, 500);
    const token = String(req.body?.token || "").trim().slice(0, 500);
    if (!httpEndpoint) {
      logseqCredStmts.del.run(studentId);
      return res.json({ ok: true, configured: false });
    }
    if (!/^https?:\/\//i.test(httpEndpoint)) {
      return res.status(400).json({ error: "http_endpoint must be an http(s) URL" });
    }
    logseqCredStmts.upsert.run(studentId, httpEndpoint, token);
    res.json({ ok: true, configured: true });
  });

  app.get("/api/students/:id/notebook/pages", requireAuth, ensureVaultConsent, async (req, res) => {
    res.json(await listPages(req.params.id, dataDir));
  });

  app.get("/api/students/:id/notebook/pages/:name", requireAuth, ensureVaultConsent, async (req, res) => {
    const content = await readPage(req.params.id, dataDir, req.params.name, resolveLogseqCreds(req.params.id));
    if (content == null) return res.status(404).json({ error: "page not found" });
    res.type("text/markdown").send(content);
  });

  app.put("/api/students/:id/notebook/pages/:name", requireAuth, ensureVaultConsent, async (req, res) => {
    const body = typeof req.body === "string" ? req.body : (req.body?.content || "");
    if (!body) return res.status(400).json({ error: "empty body" });
    const out = await appendBlock(req.params.id, dataDir, req.params.name, body.slice(0, 8000), resolveLogseqCreds(req.params.id));
    res.json(out);
  });

  app.get("/api/students/:id/notebook/journal/:date", requireAuth, ensureVaultConsent, async (req, res) => {
    if (!isValidJournalDate(req.params.date)) return res.status(400).json({ error: "invalid date" });
    const content = await readJournal(req.params.id, dataDir, req.params.date, resolveLogseqCreds(req.params.id));
    if (content == null) return res.status(404).json({ error: "journal not found" });
    res.type("text/markdown").send(content);
  });

  app.post("/api/students/:id/notebook/journal/:date/append", requireAuth, ensureVaultConsent, async (req, res) => {
    if (!isValidJournalDate(req.params.date)) return res.status(400).json({ error: "invalid date" });
    const body = typeof req.body === "string" ? req.body : (req.body?.content || "");
    if (!body) return res.status(400).json({ error: "empty body" });
    const out = await writeJournalEntry(req.params.id, dataDir, req.params.date, body.slice(0, 4000), resolveLogseqCreds(req.params.id));
    res.json(out);
  });

  // ────────────────────────────────────────────────────────────────
  // Pillar 9 — Strategy Council
  // ────────────────────────────────────────────────────────────────
  app.post("/api/strategy-council/convene", requireAuth, async (req, res) => {
    const studentId = req.user?.studentId || req.body?.student_id;
    if (!studentId) return res.status(400).json({ error: "missing student_id" });

    const question = String(req.body?.question || "").slice(0, 2000).trim();
    if (!question) return res.status(400).json({ error: "missing question" });

    const decisionType = req.body?.decision_type && VALID_DECISION_TYPES.has(req.body.decision_type)
      ? req.body.decision_type
      : DECISION_TYPES.OTHER;

    // Pull BYOK + consent + student profile via the injected accessors.
    let byok = null;
    let crossBorderConsent = false;
    let student = null;
    try {
      if (typeof getStudentBYOK === "function") {
        const row = await getStudentBYOK(studentId);
        byok = row && row.provider ? row : null;
        crossBorderConsent = !!row?.crossBorderConsent;
      } else if (consentStmts) {
        const consent = hasActiveConsent(consentStmts, studentId, CONSENT_TYPES.STRATEGY_COUNCIL_CROSS_BORDER);
        crossBorderConsent = consent.hasConsent;
      }
      if (typeof getStudentProfile === "function") {
        student = await getStudentProfile(studentId);
      }
    } catch (err) {
      console.warn("[strategy-council] dep lookup failed:", err.message);
    }

    try {
      const envelope = await convene({
        studentId,
        dataDir,
        question,
        decisionType,
        student,
        byok,
        crossBorderConsent,
        councilStmts,
        factStmts,
        evidenceStmts,
        logseq: resolveLogseqCreds(studentId),
      });
      res.json(envelope);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/strategy-council/convenings", requireAuth, (req, res) => {
    const studentId = req.user?.studentId || req.query?.student_id;
    if (!studentId) return res.status(400).json({ error: "missing student_id" });
    const limit = Math.min(Number(req.query.limit) || 25, 100);
    const rows = councilStmts.getRecent.all(studentId, limit);
    res.json(rows);
  });

  app.get("/api/strategy-council/convenings/:id", requireAuth, (req, res) => {
    const studentId = req.user?.studentId || req.query?.student_id;
    if (!studentId) return res.status(400).json({ error: "missing student_id" });
    const row = councilStmts.getById.get(req.params.id, studentId);
    if (!row) return res.status(404).json({ error: "convening not found" });
    // Parse the JSON columns for client convenience.
    res.json({
      ...row,
      citations: safeJSON(row.citations_json),
      council_breakdown: safeJSON(row.council_breakdown_json),
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Background hook — auto-convene from non-request triggers (e.g. an EC
  // file upload classified as EC/course-relevant). Same dep assembly as the
  // manual route above, throttled to one auto-convening per student per
  // window so a burst of uploads can't spam the (expensive) Council.
  // ────────────────────────────────────────────────────────────────
  const AUTO_CONVENE_THROTTLE_MS = 10 * 60 * 1000;
  const lastAutoConvene = new Map(); // studentId -> epoch ms

  async function conveneFromUpload({ studentId, question, decisionType, triggerSource = "upload" }) {
    if (!studentId || !question) return { skipped: "missing studentId/question" };
    const now = Date.now();
    const last = lastAutoConvene.get(studentId) || 0;
    if (now - last < AUTO_CONVENE_THROTTLE_MS) {
      return { skipped: "throttled", retryInMs: AUTO_CONVENE_THROTTLE_MS - (now - last) };
    }
    lastAutoConvene.set(studentId, now);

    let byok = null;
    let crossBorderConsent = false;
    let student = null;
    try {
      if (typeof getStudentBYOK === "function") {
        const row = await getStudentBYOK(studentId);
        byok = row && row.provider ? row : null;
        crossBorderConsent = !!row?.crossBorderConsent;
      } else if (consentStmts) {
        crossBorderConsent = hasActiveConsent(consentStmts, studentId, CONSENT_TYPES.STRATEGY_COUNCIL_CROSS_BORDER).hasConsent;
      }
      if (typeof getStudentProfile === "function") student = await getStudentProfile(studentId);
    } catch (err) {
      console.warn("[strategy-council] auto dep lookup failed:", err.message);
    }

    const envelope = await convene({
      studentId,
      dataDir,
      question: String(question).slice(0, 2000),
      decisionType: decisionType && VALID_DECISION_TYPES.has(decisionType) ? decisionType : DECISION_TYPES.OTHER,
      student,
      byok,
      crossBorderConsent,
      councilStmts,
      factStmts,
      evidenceStmts,
      logseq: resolveLogseqCreds(studentId),
    });
    console.log(`[strategy-council] auto-convened from ${triggerSource} for ${studentId.slice(0, 8)} (${decisionType || "other"})`);
    return { convened: true, envelope };
  }

  return { conveneFromUpload };
}

function safeJSON(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// Logseq journal filenames are derived directly from the :date param, so reject
// anything that isn't a strict YYYY-MM-DD to block path traversal.
function isValidJournalDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(date));
}

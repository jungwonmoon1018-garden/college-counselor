// Operational Council audit metadata. Student text belongs in the encrypted vault.

import crypto from "node:crypto";

function ensureColumn(db, name, definition) {
  const columns = db.prepare("PRAGMA table_info(council_convenings)").all().map((row) => row.name);
  if (!columns.includes(name)) db.exec("ALTER TABLE council_convenings ADD COLUMN " + name + " " + definition);
}

export function initCouncilTables(db) {
  db.exec([
    "CREATE TABLE IF NOT EXISTS council_convenings (",
    " id TEXT PRIMARY KEY,",
    " request_id TEXT,",
    " student_id TEXT NOT NULL,",
    " decision_type TEXT NOT NULL,",
    " question TEXT NOT NULL,",
    " question_hash TEXT,",
    " recommendation TEXT NOT NULL,",
    " moderator_rule TEXT NOT NULL,",
    " confidence REAL,",
    " dissent_text TEXT,",
    " citations_json TEXT,",
    " council_breakdown_json TEXT,",
    " total_input_tokens INTEGER DEFAULT 0,",
    " total_output_tokens INTEGER DEFAULT 0,",
    " trigger_source TEXT NOT NULL DEFAULT 'manual',",
    " created_at TEXT DEFAULT (datetime('now'))",
    ");",
    "CREATE INDEX IF NOT EXISTS idx_council_student ON council_convenings(student_id, created_at);",
    "CREATE INDEX IF NOT EXISTS idx_council_rule ON council_convenings(moderator_rule);",
  ].join("\n"));
  ensureColumn(db, "request_id", "TEXT");
  ensureColumn(db, "question_hash", "TEXT");
  ensureColumn(db, "trigger_source", "TEXT NOT NULL DEFAULT 'manual'");
  // The same opaque client request ID may be generated independently by two
  // students. Idempotency is tenant-scoped, so the database constraint must
  // use the same boundary as getByRequestId.
  db.transaction(() => {
    db.exec("DROP INDEX IF EXISTS idx_council_request_student");
    db.exec("DROP INDEX IF EXISTS idx_council_request");
    db.exec("CREATE UNIQUE INDEX idx_council_request ON council_convenings(student_id, request_id) WHERE request_id IS NOT NULL");
  })();
}

export function prepareCouncilStatements(db) {
  return {
    insert: db.prepare([
      "INSERT INTO council_convenings (",
      " id, request_id, student_id, decision_type, question, question_hash, recommendation,",
      " moderator_rule, confidence, dissent_text, citations_json, council_breakdown_json,",
      " total_input_tokens, total_output_tokens, trigger_source",
      ") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ].join("\n")),
    getRecent: db.prepare([
      "SELECT id, decision_type, moderator_rule, confidence, created_at, trigger_source",
      "FROM council_convenings WHERE student_id = ? ORDER BY created_at DESC LIMIT ?",
    ].join("\n")),
    getById: db.prepare("SELECT * FROM council_convenings WHERE id = ? AND student_id = ?"),
    getByRequestId: db.prepare("SELECT id FROM council_convenings WHERE request_id = ? AND student_id = ?"),
  };
}

export async function recordConvening({
  stmts,
  studentId,
  decisionType,
  question,
  envelope,
  totalTokens = { input: 0, output: 0 },
  triggerSource = "manual",
  requestId = null,
}) {
  if (requestId) {
    const existing = stmts.getByRequestId.get(requestId, studentId);
    if (existing) return existing.id;
  }
  const conveningId = crypto.randomUUID();
  const questionHash = crypto.createHash("sha256").update(String(question || "")).digest("hex");
  const citations = (envelope.citations || [])
    .filter((citation) => citation.validated === true)
    .map((citation) => ({ type: citation.type, id: citation.id }));
  const breakdown = (envelope.council_breakdown || []).map((seat) => ({
    role: seat.role,
    stance: seat.stance,
    confidence: seat.confidence,
    model: seat.model,
    provider: seat.provider,
    abstained: seat.abstained,
    citation_validation: seat.citation_validation,
  }));

  stmts.insert.run(
    conveningId,
    requestId,
    studentId,
    decisionType,
    "[redacted; stored only in encrypted student vault]",
    questionHash,
    "[redacted; stored only in encrypted student vault]",
    envelope.moderator_rule,
    envelope.confidence,
    envelope.dissents?.length ? String(envelope.dissents.length) + " dissent(s)" : null,
    JSON.stringify(citations),
    JSON.stringify(breakdown),
    Number(totalTokens.input) || 0,
    Number(totalTokens.output) || 0,
    String(triggerSource || "manual").slice(0, 40),
  );
  return conveningId;
}

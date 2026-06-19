// ═══════════════════════════════════════════════════════════════════════
// COUNCIL AUDIT TRAIL — Logseq journal entry + SQLite row per convening
// ═══════════════════════════════════════════════════════════════════════
// Every council convening lands in two places:
//
//   1. The student's Logseq vault, `pages/strategy-council-log.md`, as
//      an appended block. Format: date, question, recommendation,
//      dissent (if any), citation count, moderator rule. Students can
//      look up "what did the council say about X" in their own notebook.
//
//   2. The operational SQLite database, `council_convenings` table, for
//      the budget UI and any later analytics. Includes per-seat token
//      usage, model id, and which seats fell back to embedded.
//
// initCouncilTables() is called at server boot from the same place
// initFactStore / initEvidenceGraph are called.
// ═══════════════════════════════════════════════════════════════════════

import crypto from "node:crypto";
import { appendBlock, writeJournalEntry } from "../logseq/index.js";

export function initCouncilTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS council_convenings (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      decision_type TEXT NOT NULL,
      question TEXT NOT NULL,
      recommendation TEXT NOT NULL,
      moderator_rule TEXT NOT NULL,
      confidence REAL,
      dissent_text TEXT,
      citations_json TEXT,
      council_breakdown_json TEXT,
      total_input_tokens INTEGER DEFAULT 0,
      total_output_tokens INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_council_student ON council_convenings(student_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_council_rule ON council_convenings(moderator_rule);
  `);
}

export function prepareCouncilStatements(db) {
  return {
    insert: db.prepare(`
      INSERT INTO council_convenings (
        id, student_id, decision_type, question, recommendation,
        moderator_rule, confidence, dissent_text, citations_json,
        council_breakdown_json, total_input_tokens, total_output_tokens
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `),
    getRecent: db.prepare(`
      SELECT id, decision_type, question, recommendation, moderator_rule, confidence, created_at
      FROM council_convenings WHERE student_id = ?
      ORDER BY created_at DESC LIMIT ?
    `),
    getById: db.prepare(`
      SELECT * FROM council_convenings WHERE id = ? AND student_id = ?
    `),
  };
}

/**
 * Persist a convening to SQLite + Logseq. Returns the convening id.
 */
export async function recordConvening({
  stmts,
  studentId,
  dataDir,
  decisionType,
  question,
  envelope,           // moderator output
  totalTokens = { input: 0, output: 0 },
  logseq = {},
}) {
  const convening_id = crypto.randomUUID();
  const dissentText = envelope.dissent ? `${envelope.dissent.from}: ${envelope.dissent.text}` : null;

  // 1. SQLite row
  try {
    stmts.insert.run(
      convening_id,
      studentId,
      decisionType,
      question.slice(0, 2000),
      String(envelope.recommendation || "").slice(0, 8000),
      envelope.moderator_rule,
      envelope.confidence,
      dissentText,
      JSON.stringify(envelope.citations || []),
      JSON.stringify(envelope.council_breakdown || []),
      totalTokens.input | 0,
      totalTokens.output | 0,
    );
  } catch (err) {
    console.error("[council/audit-trail] sqlite insert failed:", err.message);
  }

  // 2. Logseq audit block
  try {
    const date = new Date().toISOString().slice(0, 10);
    const summary = formatLogseqBlock({
      convening_id,
      date,
      decisionType,
      question,
      envelope,
    });
    await appendBlock(studentId, dataDir, "strategy-council-log", summary, logseq);
    // Cross-link in today's daily journal so the student spots the entry
    // when they open Logseq.
    await writeJournalEntry(
      studentId,
      dataDir,
      date,
      `Strategy Council convened: [[strategy-council-log]] #${convening_id.slice(0, 8)}`,
      logseq,
    );
  } catch (err) {
    console.warn("[council/audit-trail] logseq write failed:", err.message);
  }

  return convening_id;
}

function formatLogseqBlock({ convening_id, date, decisionType, question, envelope }) {
  const lines = [
    `### ${date} — ${decisionType} (#${convening_id.slice(0, 8)})`,
    `**Question:** ${question}`,
    `**Recommendation:** ${envelope.recommendation}`,
    `**Confidence:** ${(envelope.confidence ?? 0).toFixed(2)}`,
    `**Rule:** ${envelope.moderator_rule}`,
  ];
  if (envelope.dissent) {
    lines.push(`**Dissent (${envelope.dissent.from}):** ${envelope.dissent.text}`);
  }
  if (envelope.citations?.length) {
    lines.push(
      `**Citations:** ${envelope.citations.slice(0, 6).map((c) => `[[${c.type}:${c.id}]]`).join(" ")}`,
    );
  }
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════
// GRAPH + VAULT CONTEXT — compact structured-memory injection for chat
// ═══════════════════════════════════════════════════════════════════════
// The Strategy Council pulls a rich ~2k-token envelope (graph subgraph +
// four vault pages + a week of journals). Routine chat turns can't afford
// that, but they still benefit from citing the student's own structured
// memory instead of re-deriving context from DB snapshots every turn.
//
// assembleGraphVaultContext() builds a lighter envelope: one BFS subgraph
// (≤500 tokens) plus the two highest-signal vault pages (college-list +
// narrative). Journals are skipped — they're noisy and the chat path wants
// stable facts, not a daily diary. Budget defaults to ~2000 chars (~500
// tokens) so the injection replaces broad retrieval rather than adding to it.
//
// collectVaultExcerpts() and packSections() live here as the single source
// of truth; council/context-builder.js imports them so the two paths can't
// drift apart.
// ═══════════════════════════════════════════════════════════════════════

import { queryStudentGraph } from "../knowledge-graph/index.js";
import { readPage, readJournal } from "../logseq/index.js";

const MAX_VAULT_PAGE_CHARS = 1_500;
const MAX_JOURNAL_BLOCKS = 7;
const DEFAULT_PAGES = ["college-list", "narrative", "ec-evidence", "methodology-notes"];

/**
 * Build a compact graph + vault context string for a single chat turn.
 * Returns "" on any failure or when nothing relevant is found — callers
 * must never let this block a turn.
 *
 * @param {object} opts
 * @param {string} opts.studentId
 * @param {string} opts.dataDir
 * @param {string} opts.query              — the user's message / topic
 * @param {object} [opts.logseq]           — {httpEndpoint, token} or {}
 * @param {number} [opts.budgetChars=2000]
 */
export async function assembleGraphVaultContext({
  studentId,
  dataDir,
  query,
  logseq = {},
  budgetChars = 2_000,
}) {
  if (!studentId || !dataDir) return "";
  const sections = [];

  // 1. BFS subgraph for the question — kept small (≤500 tokens).
  try {
    const graph = await queryStudentGraph(studentId, query || "", {
      dataDir,
      mode: "bfs",
      budgetTokens: 500,
    });
    if (graph?.ok && graph.answer) {
      sections.push({
        label: "KNOWLEDGE GRAPH",
        content: graph.answer.slice(0, Math.floor(budgetChars * 0.6)),
        priority: 1,
      });
    }
  } catch { /* graph optional — degrade silently */ }

  // 2. Two highest-signal vault pages only (no journals on the chat path).
  const vaultSections = await collectVaultExcerpts({
    studentId,
    dataDir,
    httpEndpoint: logseq.httpEndpoint,
    token: logseq.token,
    pages: ["college-list", "narrative"],
    includeJournals: false,
  });
  sections.push(...vaultSections);

  return packSections(sections, budgetChars);
}

/**
 * Read a set of vault pages (and optionally recent journals) into labelled
 * sections. Shared by the council envelope and the compact chat assembler.
 */
export async function collectVaultExcerpts({
  studentId,
  dataDir,
  httpEndpoint,
  token,
  pages = DEFAULT_PAGES,
  includeJournals = true,
}) {
  const out = [];
  const opts = { httpEndpoint, token };
  for (const pageName of pages) {
    try {
      const content = await readPage(studentId, dataDir, pageName, opts);
      if (content && content.trim()) {
        out.push({
          label: `VAULT/${pageName.toUpperCase()}`,
          content: content.slice(0, MAX_VAULT_PAGE_CHARS),
          priority: 3,
        });
      }
    } catch { /* per-page failure non-fatal */ }
  }

  if (!includeJournals) return out;

  const today = new Date();
  const journalLines = [];
  for (let i = 0; i < MAX_JOURNAL_BLOCKS; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const date = d.toISOString().slice(0, 10);
    try {
      const j = await readJournal(studentId, dataDir, date, opts);
      if (j && j.trim()) journalLines.push(`[${date}]\n${j.trim()}`);
    } catch { /* ignore */ }
  }
  if (journalLines.length) {
    out.push({
      label: "RECENT JOURNAL",
      content: journalLines.join("\n\n").slice(0, MAX_VAULT_PAGE_CHARS * 2),
      priority: 4,
    });
  }
  return out;
}

/**
 * Pack labelled sections into a char budget, dropping lowest-priority
 * entries (highest priority number) first. Priority 1 = most important.
 */
export function packSections(sections, budgetChars) {
  const sorted = [...sections].sort((a, b) => a.priority - b.priority);
  const kept = [];
  let used = 0;
  for (const s of sorted) {
    const block = `── ${s.label} ──\n${s.content}\n`;
    if (used + block.length > budgetChars) break;
    kept.push(block);
    used += block.length;
  }
  return kept.join("\n");
}

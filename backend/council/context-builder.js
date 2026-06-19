// ═══════════════════════════════════════════════════════════════════════
// CONTEXT BUILDER — shared 2k-token envelope for all 5 councilors
// ═══════════════════════════════════════════════════════════════════════
// Each councilor sees the same context (so they're disagreeing about
// interpretation, not seeing different facts). The envelope concatenates:
//
//   1. Student profile summary (grade, narrative arc, target list — no PII).
//   2. graphify subgraph relevant to the question (BFS, ~1k tokens).
//   3. Logseq excerpts: college-list, narrative, last 7 daily-journal blocks.
//   4. Baseline facts retrieved from the fact store when present.
//
// Token budget is enforced by truncation — sections drop in reverse
// priority order (journals first, then logseq pages, then graphify, then
// student summary) until the total fits 2k tokens (roughly 8000 chars).
// ═══════════════════════════════════════════════════════════════════════

import { queryStudentGraph } from "../knowledge-graph/index.js";
import { collectVaultExcerpts, packSections } from "../context/graph-vault-context.js";

const TOTAL_CHAR_BUDGET = 8_000;          // ~2k tokens at ~4 chars/token
const MAX_GRAPH_CHARS = 4_000;

export async function buildCouncilContext({
  studentId,
  dataDir,
  question,
  student,
  factStmts,
  evidenceStmts,
  logseq = {},   // {httpEndpoint, token}
}) {
  const sections = [];

  // 1. Student profile summary — short, no PII.
  if (student) {
    const lines = [
      `Grade: ${student.grade || "unknown"}`,
      `Locale: ${student.locale || "en-US"}`,
      student.narrative_summary ? `Narrative arc: ${student.narrative_summary.slice(0, 400)}` : "",
      student.stated_values && student.stated_values.length
        ? `Stated values: ${student.stated_values.join("; ")}`
        : "",
      student.target_majors && student.target_majors.length
        ? `Target majors: ${student.target_majors.join(", ")}`
        : "",
    ].filter(Boolean);
    sections.push({
      label: "STUDENT PROFILE",
      content: lines.join("\n"),
      priority: 1,
    });
  }

  // 2. graphify subgraph — BFS query for the question itself.
  try {
    const graph = await queryStudentGraph(studentId, question, {
      dataDir,
      mode: "bfs",
      budgetTokens: 1000,
    });
    if (graph?.ok && graph.answer) {
      sections.push({
        label: "KNOWLEDGE GRAPH SUBGRAPH",
        content: graph.answer.slice(0, MAX_GRAPH_CHARS),
        priority: 2,
      });
    } else {
      sections.push({
        label: "KNOWLEDGE GRAPH SUBGRAPH",
        content: `(no subgraph: ${graph?.reason || "graph not built yet"})`,
        priority: 2,
      });
    }
  } catch (err) {
    sections.push({
      label: "KNOWLEDGE GRAPH SUBGRAPH",
      content: `(graph query failed: ${err.message})`,
      priority: 2,
    });
  }

  // 3. Logseq excerpts — college-list + narrative + recent journals.
  const vaultSections = await collectVaultExcerpts({
    studentId,
    dataDir,
    httpEndpoint: logseq.httpEndpoint,
    token: logseq.token,
  });
  sections.push(...vaultSections);

  // 4. Baseline facts (if available)
  if (factStmts && typeof factStmts.getFactsByTopic?.all === "function") {
    try {
      const facts = factStmts.getFactsByTopic.all("strategic_baseline").slice(0, 8);
      if (facts.length) {
        sections.push({
          label: "BASELINE FACTS",
          content: facts.map((f) => `- ${f.fact_value || f.claim}`).join("\n"),
          priority: 5,
        });
      }
    } catch { /* fact store optional */ }
  }

  // Pack sections into the budget — drop low-priority entries until it fits.
  return packSections(sections, TOTAL_CHAR_BUDGET);
}

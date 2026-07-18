// Build one immutable, citation-indexed context shared by every Council stage.

import { queryStudentGraph } from "../knowledge-graph/index.js";
import { searchFacts } from "../fact-store.js";
import { searchEvidence } from "../evidence-graph.js";

const TOTAL_CHAR_BUDGET = 8_000;
const MAX_GRAPH_CHARS = 3_000;

function packSections(sections, budget = TOTAL_CHAR_BUDGET) {
  const ordered = [...sections].sort((a, b) => a.priority - b.priority);
  const output = [];
  let used = 0;
  for (const section of ordered) {
    const block = "## " + section.label + "\n" + section.content.trim();
    const remaining = budget - used;
    if (remaining <= 0) break;
    const value = block.length <= remaining ? block : block.slice(0, Math.max(0, remaining - 16)) + "\n[truncated]";
    output.push(value);
    used += value.length + 2;
  }
  return output.join("\n\n");
}

function registerGraphCitations(answer, evidenceIndex) {
  for (const line of String(answer || "").split(/\r?\n/)) {
    const matches = [
      ...line.matchAll(/\[\[([A-Za-z0-9_.:-]{2,120})\]\]/g),
      ...line.matchAll(/\[graph_node:([A-Za-z0-9_.:-]{2,120})\]/g),
      ...line.matchAll(/\bnode[_ -]?id\s*[:=]\s*([A-Za-z0-9_.:-]{2,120})/gi),
    ];
    for (const match of matches) {
      const id = match[1];
      evidenceIndex["graph_node:" + id] = {
        type: "graph_node",
        id,
        text: line.slice(0, 1000),
        source: "student_knowledge_graph",
      };
    }
  }
}

function profileSection(student) {
  if (!student) return null;
  return [
    "Grade: " + (student.grade || "unknown"),
    "Locale: " + (student.locale || "en-US"),
    student.narrative_summary ? "Narrative arc: " + student.narrative_summary.slice(0, 400) : "",
    Array.isArray(student.stated_values) && student.stated_values.length
      ? "Stated values: " + student.stated_values.slice(0, 8).join("; ")
      : "",
    Array.isArray(student.target_majors) && student.target_majors.length
      ? "Target majors: " + student.target_majors.slice(0, 8).join(", ")
      : "",
  ].filter(Boolean).join("\n");
}

export async function buildCouncilContext({
  studentId,
  dataDir,
  question,
  student,
  factStmts,
  evidenceStmts,
}) {
  const sections = [];
  const evidenceIndex = {};
  const profile = profileSection(student);
  if (profile) sections.push({ label: "STUDENT PROFILE", content: profile, priority: 1 });

  try {
    const graph = await queryStudentGraph(studentId, question, {
      dataDir,
      mode: "bfs",
      budgetTokens: 750,
    });
    const answer = graph?.ok && graph.answer
      ? graph.answer.slice(0, MAX_GRAPH_CHARS)
      : "(no relevant student knowledge-graph subgraph)";
    registerGraphCitations(answer, evidenceIndex);
    sections.push({ label: "STUDENT KNOWLEDGE GRAPH", content: answer, priority: 2 });
  } catch {
    sections.push({
      label: "STUDENT KNOWLEDGE GRAPH",
      content: "(knowledge graph unavailable)",
      priority: 2,
    });
  }

  if (factStmts) {
    try {
      const facts = searchFacts(factStmts, question, 12);
      if (facts.length) {
        const lines = [];
        for (const fact of facts) {
          const type = "baseline_fact";
          const id = fact.id;
          const text = String(fact.fact_value || "");
          evidenceIndex[type + ":" + id] = {
            type,
            id,
            text,
            source: fact.source_url || fact.source_domain || null,
            confidence: fact.confidence,
            expiresAt: fact.expires_at || null,
          };
          lines.push("[" + type + ":" + id + "] " + text);
        }
        sections.push({ label: "RETRIEVED FACTS", content: lines.join("\n"), priority: 3 });
      }
    } catch {
      // Fact retrieval is optional; an empty index forces unsupported claims
      // to remain coaching rather than inventing a citation.
    }
  }

  if (evidenceStmts) {
    try {
      const items = searchEvidence(evidenceStmts, question, 10);
      if (items.length) {
        const lines = [];
        for (const item of items) {
          const type = "evidence_item";
          const id = item.id;
          const text = String(item.claim || "");
          evidenceIndex[type + ":" + id] = {
            type,
            id,
            text,
            source: item.source_url || item.source_domain || null,
            trustLevel: item.trust_level,
            expiresAt: item.expires_at || null,
          };
          lines.push("[" + type + ":" + id + "] " + text + " (" + item.trust_level + ")");
        }
        sections.push({ label: "RETRIEVED EVIDENCE", content: lines.join("\n"), priority: 4 });
      }
    } catch {
      // Evidence retrieval is optional.
    }
  }

  return {
    text: packSections(sections),
    evidenceIndex,
    immutable: true,
  };
}

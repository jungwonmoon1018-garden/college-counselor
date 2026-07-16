import { queryStudentGraph } from "../knowledge-graph/index.js";

// Compatibility name retained while callers migrate. This function now reads
// only the encrypted/derived knowledge graph; the plaintext notebook feature
// has been removed.
export async function assembleGraphVaultContext({
  studentId,
  dataDir,
  query,
  budgetChars = 2_000,
}) {
  if (!studentId || !dataDir) return "";
  try {
    const graph = await queryStudentGraph(studentId, query || "", {
      dataDir,
      mode: "bfs",
      budgetTokens: 500,
    });
    if (!graph?.ok || !graph.answer) return "";
    return packSections([
      {
        label: "KNOWLEDGE GRAPH",
        content: graph.answer.slice(0, budgetChars),
        priority: 1,
      },
    ], budgetChars);
  } catch {
    return "";
  }
}

export const assembleGraphContext = assembleGraphVaultContext;

export function packSections(sections, budgetChars) {
  const sorted = [...sections].sort((a, b) => a.priority - b.priority);
  const kept = [];
  let used = 0;
  for (const section of sorted) {
    const block = `-- ${section.label} --\n${section.content}\n`;
    if (used + block.length > budgetChars) break;
    kept.push(block);
    used += block.length;
  }
  return kept.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════
// KNOWLEDGE GRAPH — per-student structured memory layer (Pillar 7)
// ═══════════════════════════════════════════════════════════════════════
// Public API on top of graphify. Every function takes a studentId and
// resolves the student's vault + knowledge-graph paths via student-storage.
//
//   rebuildStudentGraph(studentId, opts)
//   queryStudentGraph(studentId, question, opts)
//   pathStudentGraph(studentId, sourceLabel, targetLabel)
//   explainStudentGraphNode(studentId, nodeId)
//   getStudentGraphStatus(studentId)
//
// The graphify CLI writes its output (graph.json, GRAPH_REPORT.md, etc.)
// into <corpusPath>/graphify-out/. We move that into the student's
// dedicated knowledge-graph dir after each build so callers always read
// from a stable path regardless of staging.
// ═══════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import {
  getStudentKnowledgeGraphPath,
  getStudentVaultPath,
  hasStudentGraph,
} from "../student-storage.js";
import {
  prepareStudentCorpus,
  teardownStudentCorpus,
} from "./student-corpus.js";
import {
  runGraphifyBuild,
  runGraphifyUpdate,
  runGraphifyQuery,
  runGraphifyPath,
  runGraphifyExplain,
  resolveGraphify,
} from "./graphify-runner.js";
import {
  scheduleDebouncedRebuild,
  hasPendingRebuild,
  isFullRebuildDue,
  recordFullRebuild,
} from "./cache-policy.js";

const REBUILD_LOCKS = new Map(); // studentId -> Promise

async function moveGraphifyOutput(stagedCorpusPath, destDir) {
  const generated = path.join(stagedCorpusPath, "graphify-out");
  if (!fs.existsSync(generated)) {
    throw new Error(`graphify did not produce ${generated} — build may have failed.`);
  }
  await fs.promises.mkdir(destDir, { recursive: true });
  // Move (or copy if cross-device) the contents.
  const entries = await fs.promises.readdir(generated);
  for (const e of entries) {
    const src = path.join(generated, e);
    const dst = path.join(destDir, e);
    try {
      await fs.promises.rm(dst, { recursive: true, force: true });
    } catch { /* ignore */ }
    await fs.promises.rename(src, dst).catch(async () => {
      // EXDEV on cross-device — fall back to copy.
      await fs.promises.cp(src, dst, { recursive: true });
      await fs.promises.rm(src, { recursive: true, force: true });
    });
  }
}

/**
 * Rebuild the student's knowledge graph. Serialized per studentId to
 * prevent concurrent graphify runs from clobbering each other.
 *
 * @param {string} studentId
 * @param {object} opts
 * @param {string} opts.dataDir
 * @param {"incremental"|"full"} [opts.mode="incremental"]
 * @param {string[]} [opts.evidenceFiles]
 * @param {boolean} [opts.includeNarrativeHistory]
 * @param {function} [opts.narrativeFetcher]
 */
export async function rebuildStudentGraph(studentId, opts = {}) {
  const existing = REBUILD_LOCKS.get(studentId);
  if (existing) return existing;

  const promise = (async () => {
    const dataDir = opts.dataDir;
    if (!dataDir) throw new Error("rebuildStudentGraph requires opts.dataDir");

    await resolveGraphify(); // surface the install error early
    const { corpusPath, staged } = await prepareStudentCorpus({
      studentId,
      dataDir,
      evidenceFiles: opts.evidenceFiles,
      includeNarrativeHistory: opts.includeNarrativeHistory,
      narrativeFetcher: opts.narrativeFetcher,
    });

    const mode = opts.mode === "full" ? "full" : "incremental";
    const useIncremental = mode === "incremental" && hasStudentGraph(studentId, dataDir);
    try {
      if (useIncremental) {
        await runGraphifyUpdate({ corpusPath });
      } else {
        await runGraphifyBuild({ corpusPath });
        recordFullRebuild(studentId);
      }
      const destDir = getStudentKnowledgeGraphPath(studentId, dataDir);
      await moveGraphifyOutput(corpusPath, destDir);
      return { studentId, mode: useIncremental ? "incremental" : "full", outputDir: destDir };
    } finally {
      if (staged) await teardownStudentCorpus(corpusPath);
    }
  })();

  REBUILD_LOCKS.set(studentId, promise);
  try {
    return await promise;
  } finally {
    REBUILD_LOCKS.delete(studentId);
  }
}

/**
 * BFS/DFS query against the student's graph. Returns the raw graphify
 * answer (stdout) plus a parsed citations list when available.
 */
export async function queryStudentGraph(studentId, question, opts = {}) {
  const dataDir = opts.dataDir;
  if (!dataDir) throw new Error("queryStudentGraph requires opts.dataDir");

  const graphDir = getStudentKnowledgeGraphPath(studentId, dataDir);
  if (!fs.existsSync(path.join(graphDir, "graph.json"))) {
    return {
      ok: false,
      reason: "no_graph",
      message: "Student has no built knowledge graph. Run rebuildStudentGraph first.",
    };
  }
  // graphify query expects to find graphify-out/graph.json under cwd. We
  // re-construct that layout in a temp scratch dir so we don't pollute the
  // student's knowledge-graph dir with new files.
  const scratch = path.join(graphDir, ".query-scratch");
  await fs.promises.mkdir(path.join(scratch, "graphify-out"), { recursive: true });
  await fs.promises.copyFile(
    path.join(graphDir, "graph.json"),
    path.join(scratch, "graphify-out", "graph.json"),
  );
  for (const aux of ["community-labels.json", ".graphify_python"]) {
    const src = path.join(graphDir, aux);
    if (fs.existsSync(src)) {
      await fs.promises.copyFile(src, path.join(scratch, "graphify-out", aux));
    }
  }

  try {
    const { stdout } = await runGraphifyQuery({
      corpusPath: scratch,
      question,
      mode: opts.mode || "bfs",
      budgetTokens: opts.budgetTokens || 1500,
    });
    return { ok: true, answer: stdout.trim(), question };
  } catch (err) {
    return { ok: false, reason: "query_failed", message: err.message };
  } finally {
    await fs.promises.rm(scratch, { recursive: true, force: true }).catch(() => {});
  }
}

/** Shortest path between two named concepts in the student's graph. */
export async function pathStudentGraph(studentId, source, target, opts = {}) {
  const dataDir = opts.dataDir;
  if (!dataDir) throw new Error("pathStudentGraph requires opts.dataDir");
  const graphDir = getStudentKnowledgeGraphPath(studentId, dataDir);
  if (!fs.existsSync(path.join(graphDir, "graph.json"))) {
    return { ok: false, reason: "no_graph" };
  }
  try {
    const { stdout } = await runGraphifyPath({ corpusPath: graphDir, source, target });
    return { ok: true, answer: stdout.trim() };
  } catch (err) {
    return { ok: false, reason: "path_failed", message: err.message };
  }
}

/** Plain-language explanation of a single graph node. */
export async function explainStudentGraphNode(studentId, nodeId, opts = {}) {
  const dataDir = opts.dataDir;
  if (!dataDir) throw new Error("explainStudentGraphNode requires opts.dataDir");
  const graphDir = getStudentKnowledgeGraphPath(studentId, dataDir);
  if (!fs.existsSync(path.join(graphDir, "graph.json"))) {
    return { ok: false, reason: "no_graph" };
  }
  try {
    const { stdout } = await runGraphifyExplain({ corpusPath: graphDir, nodeId });
    return { ok: true, answer: stdout.trim() };
  } catch (err) {
    return { ok: false, reason: "explain_failed", message: err.message };
  }
}

/** Status snapshot for the /api/students/:id/knowledge-graph/status endpoint. */
export async function getStudentGraphStatus(studentId, opts = {}) {
  const dataDir = opts.dataDir;
  if (!dataDir) throw new Error("getStudentGraphStatus requires opts.dataDir");
  const graphDir = getStudentKnowledgeGraphPath(studentId, dataDir);
  const graphPath = path.join(graphDir, "graph.json");
  if (!fs.existsSync(graphPath)) {
    return {
      built: false,
      pending_rebuild: hasPendingRebuild(studentId),
      full_rebuild_due: isFullRebuildDue(studentId),
    };
  }
  const stat = await fs.promises.stat(graphPath);
  let nodeCount = 0;
  let communityCount = 0;
  try {
    const raw = JSON.parse(await fs.promises.readFile(graphPath, "utf-8"));
    nodeCount = Array.isArray(raw.nodes) ? raw.nodes.length : 0;
    communityCount = raw.communities ? Object.keys(raw.communities).length : 0;
  } catch { /* ignore parse errors */ }
  return {
    built: true,
    last_rebuild: stat.mtime.toISOString(),
    node_count: nodeCount,
    community_count: communityCount,
    pending_rebuild: hasPendingRebuild(studentId),
    full_rebuild_due: isFullRebuildDue(studentId),
  };
}

/** Convenience: schedule a debounced rebuild via cache-policy. */
export function scheduleStudentGraphRebuild(studentId, opts = {}) {
  scheduleDebouncedRebuild(studentId, async (id) => {
    await rebuildStudentGraph(id, opts);
  });
}

// Re-export Logseq vault path so server routes can DRY their handlers.
export { getStudentVaultPath, getStudentKnowledgeGraphPath };

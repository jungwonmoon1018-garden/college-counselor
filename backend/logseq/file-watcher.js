// ═══════════════════════════════════════════════════════════════════════
// LOGSEQ FILE WATCHER — debounced rebuild trigger (Pillar 8 + Pillar 7)
// ═══════════════════════════════════════════════════════════════════════
// Watches a student's Logseq vault directory with chokidar. On a stable
// file change (debounce via cache-policy.scheduleDebouncedRebuild), fires
// `knowledge-graph.rebuildStudentGraph(studentId, {mode: "incremental"})`.
//
// One watcher per student. Watchers are cheap (a single fs event handle
// per dir) so we don't lazy-attach — we start them at server boot for
// every student that has an initialized vault.
//
// Falls back gracefully when chokidar isn't installed (logs once, doesn't
// throw — students with no rebuild trigger still get manual rebuild via
// POST /api/students/:id/knowledge-graph/rebuild).
// ═══════════════════════════════════════════════════════════════════════

import { rebuildStudentGraph } from "../knowledge-graph/index.js";
import { scheduleDebouncedRebuild } from "../knowledge-graph/cache-policy.js";
import { getStudentVaultPath, hasStudentVault } from "../student-storage.js";

let CHOKIDAR = null;
let CHOKIDAR_LOAD_TRIED = false;

async function loadChokidar() {
  if (CHOKIDAR_LOAD_TRIED) return CHOKIDAR;
  CHOKIDAR_LOAD_TRIED = true;
  try {
    const mod = await import("chokidar");
    CHOKIDAR = mod.default || mod;
    return CHOKIDAR;
  } catch (err) {
    console.warn("[logseq/file-watcher] chokidar not installed — file-change rebuilds disabled.", err.message);
    return null;
  }
}

const WATCHERS = new Map(); // studentId -> watcher

/**
 * Start watching a student's vault. No-op if already watching, vault
 * missing, or chokidar unavailable.
 */
export async function watchStudentVault(studentId, dataDir) {
  if (!hasStudentVault(studentId, dataDir)) return null;
  if (WATCHERS.has(studentId)) return WATCHERS.get(studentId);
  const chokidar = await loadChokidar();
  if (!chokidar) return null;

  const vault = getStudentVaultPath(studentId, dataDir);
  const watcher = chokidar.watch(vault, {
    ignored: [/(^|[\\/])\../, /node_modules/, /\.partial$/],
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 500 },
  });

  const onChange = () => {
    scheduleDebouncedRebuild(studentId, async (id) => {
      await rebuildStudentGraph(id, { dataDir, mode: "incremental" });
    });
  };
  watcher.on("add", onChange).on("change", onChange).on("unlink", onChange);

  WATCHERS.set(studentId, watcher);
  return watcher;
}

/** Stop watching a student's vault (used on student deletion). */
export async function unwatchStudentVault(studentId) {
  const w = WATCHERS.get(studentId);
  if (!w) return;
  await w.close().catch(() => {});
  WATCHERS.delete(studentId);
}

/** Stop every watcher (used on server shutdown). */
export async function unwatchAll() {
  for (const [id, w] of WATCHERS) {
    await w.close().catch(() => {});
    WATCHERS.delete(id);
  }
}

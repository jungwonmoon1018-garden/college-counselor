// ═══════════════════════════════════════════════════════════════════════
// GRAPHIFY RUNNER — subprocess wrapper for the graphify CLI
// ═══════════════════════════════════════════════════════════════════════
// graphifyy (https://github.com/safishamsi/graphify) is a Python tool. We
// invoke it via child_process so the JS backend stays language-agnostic.
//
// Binary resolution order:
//   1. $GRAPHIFY_BINARY env override (absolute path)
//   2. `graphify` on PATH (npm/pnpm/node usually inherit a usable PATH)
//   3. `uv tool dir` lookup → <dir>/graphifyy/{bin,Scripts}/graphify
//   4. `pipx environment --value PIPX_LOCAL_VENVS` lookup → similar
//   5. Error with install instructions.
//
// Resolved path is cached for the process lifetime.
// ═══════════════════════════════════════════════════════════════════════

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";

const execFileP = promisify(execFile);

let RESOLVED_BINARY = null;
let RESOLVE_ERROR = null;

const isWindows = process.platform === "win32";
const BIN_DIR_NAME = isWindows ? "Scripts" : "bin";
const BIN_FILENAME = isWindows ? "graphify.exe" : "graphify";

async function tryUvLookup() {
  try {
    const { stdout } = await execFileP("uv", ["tool", "dir"], { timeout: 5000 });
    const root = stdout.trim();
    if (!root) return null;
    const candidate = path.join(root, "graphifyy", BIN_DIR_NAME, BIN_FILENAME);
    return fs.existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

async function tryPipxLookup() {
  try {
    const { stdout } = await execFileP("pipx", ["environment", "--value", "PIPX_LOCAL_VENVS"], { timeout: 5000 });
    const root = stdout.trim();
    if (!root) return null;
    const candidate = path.join(root, "graphifyy", BIN_DIR_NAME, BIN_FILENAME);
    return fs.existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

async function tryOnPath() {
  try {
    const { stdout } = await execFileP("graphify", ["--version"], { timeout: 5000 });
    if (stdout) return "graphify";
  } catch {
    return null;
  }
  return null;
}

/** Returns the resolved graphify executable. Throws with install instructions on miss. */
export async function resolveGraphify() {
  if (RESOLVED_BINARY) return RESOLVED_BINARY;
  if (RESOLVE_ERROR) throw RESOLVE_ERROR;

  if (process.env.GRAPHIFY_BINARY && fs.existsSync(process.env.GRAPHIFY_BINARY)) {
    RESOLVED_BINARY = process.env.GRAPHIFY_BINARY;
    return RESOLVED_BINARY;
  }

  const onPath = await tryOnPath();
  if (onPath) {
    RESOLVED_BINARY = onPath;
    return RESOLVED_BINARY;
  }

  const uv = await tryUvLookup();
  if (uv) {
    RESOLVED_BINARY = uv;
    return RESOLVED_BINARY;
  }

  const pipx = await tryPipxLookup();
  if (pipx) {
    RESOLVED_BINARY = pipx;
    return RESOLVED_BINARY;
  }

  RESOLVE_ERROR = new Error(
    "graphify CLI not found. Install with one of:\n" +
    "  uv tool install graphifyy\n" +
    "  pipx install graphifyy\n" +
    "  pip install graphifyy\n" +
    "Or set GRAPHIFY_BINARY to an absolute path."
  );
  RESOLVE_ERROR.code = "graphify_missing";
  throw RESOLVE_ERROR;
}

/**
 * Run a full graphify pipeline on a corpus directory. Output goes into
 * <cwd>/graphify-out/ relative to the corpus dir, matching the CLI default.
 */
export async function runGraphifyBuild({ corpusPath, mode = "default", timeoutMs = 600_000 }) {
  const bin = await resolveGraphify();
  const args = [corpusPath];
  if (mode === "deep") args.push("--mode", "deep");
  return execFileP(bin, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 });
}

/**
 * Incremental rebuild — only re-extracts changed files since the last
 * manifest. ~10–100× faster than a full rebuild on small edits.
 */
export async function runGraphifyUpdate({ corpusPath, timeoutMs = 300_000 }) {
  const bin = await resolveGraphify();
  return execFileP(bin, [corpusPath, "--update"], { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 });
}

/**
 * BFS/DFS graph query. Returns the CLI's plain-text answer; caller can
 * parse or pass through to a UI.
 */
export async function runGraphifyQuery({ corpusPath, question, mode = "bfs", budgetTokens = 1500, timeoutMs = 60_000 }) {
  const bin = await resolveGraphify();
  const args = ["query", question, "--budget", String(budgetTokens)];
  if (mode === "dfs") args.push("--dfs");
  return execFileP(bin, args, { cwd: corpusPath, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
}

/** Shortest path between two named concepts. */
export async function runGraphifyPath({ corpusPath, source, target, timeoutMs = 30_000 }) {
  const bin = await resolveGraphify();
  return execFileP(bin, ["path", source, target], { cwd: corpusPath, timeout: timeoutMs });
}

/** Plain-language explanation of a node. */
export async function runGraphifyExplain({ corpusPath, nodeId, timeoutMs = 30_000 }) {
  const bin = await resolveGraphify();
  return execFileP(bin, ["explain", nodeId], { cwd: corpusPath, timeout: timeoutMs });
}

/** Reset the cached binary (used by tests). */
export function _resetResolver() {
  RESOLVED_BINARY = null;
  RESOLVE_ERROR = null;
}

// ═══════════════════════════════════════════════════════════════════════
// STUDENT CORPUS — assemble the input directory for graphify rebuilds
// ═══════════════════════════════════════════════════════════════════════
// For a typical student the corpus is just their Logseq vault — graphify
// can scan the markdown directly. When richer signals are available
// (evidence files, prior chat transcripts, narrative versions), this
// module copies them into a staging directory so graphify sees one unified
// scan root and the file-watcher only debounces on the vault.
//
// CONSENT: per-PIPA, chat transcripts are excluded unless the student has
// granted CHAT_TRANSCRIPT_GRAPHING consent. Evidence files are always
// in-scope (they were uploaded with intent).
// ═══════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import {
  getStudentVaultPath,
  getStudentEvidenceStagingPath,
  ensureStudentStorage,
} from "../student-storage.js";

/**
 * Stage a per-student corpus. Returns the path graphify should scan.
 *
 * @param {object} opts
 * @param {string} opts.studentId
 * @param {string} opts.dataDir
 * @param {string[]} [opts.evidenceFiles] — absolute paths to additional inputs
 * @param {boolean} [opts.includeNarrativeHistory] — copy narrative versions
 * @param {function} [opts.narrativeFetcher] — (studentId) => [{version,text}]
 */
export async function prepareStudentCorpus(opts) {
  const { studentId, dataDir } = opts;
  ensureStudentStorage(studentId, dataDir, { withVault: true, withGraph: true });

  const vaultPath = getStudentVaultPath(studentId, dataDir);
  const evidenceFiles = Array.isArray(opts.evidenceFiles) ? opts.evidenceFiles.filter(Boolean) : [];
  const hasNarrative = !!opts.includeNarrativeHistory && typeof opts.narrativeFetcher === "function";

  // Fast path: vault only, no extra inputs. graphify can scan the vault dir
  // directly — no staging needed.
  if (evidenceFiles.length === 0 && !hasNarrative) {
    return { corpusPath: vaultPath, staged: false };
  }

  // Slow path: stage to a transient dir.
  const staging = getStudentEvidenceStagingPath(studentId, dataDir);
  // Reset the staging dir each build — graphify caches by content_hash
  // anyway, so this stays incremental.
  await fs.promises.rm(staging, { recursive: true, force: true });
  await fs.promises.mkdir(staging, { recursive: true });

  // Symlink the vault when supported, copy on Windows where symlinks
  // require admin in most setups.
  const vaultLinkTarget = path.join(staging, "vault");
  try {
    await fs.promises.symlink(vaultPath, vaultLinkTarget, "dir");
  } catch {
    await copyRecursive(vaultPath, vaultLinkTarget);
  }

  // Evidence files
  if (evidenceFiles.length > 0) {
    const evDir = path.join(staging, "evidence");
    await fs.promises.mkdir(evDir, { recursive: true });
    for (const src of evidenceFiles) {
      if (!fs.existsSync(src)) continue;
      const dest = path.join(evDir, path.basename(src));
      await fs.promises.copyFile(src, dest);
    }
  }

  // Narrative versions
  if (hasNarrative) {
    const narDir = path.join(staging, "narrative-history");
    await fs.promises.mkdir(narDir, { recursive: true });
    try {
      const versions = await opts.narrativeFetcher(studentId);
      for (const v of versions || []) {
        const filename = `narrative-v${v.version || v.versionNumber || "n"}.md`;
        await fs.promises.writeFile(path.join(narDir, filename), v.text || v.content || "", "utf-8");
      }
    } catch (err) {
      // Non-fatal — narrative history is optional.
      console.warn("[student-corpus] narrative fetch failed:", err.message);
    }
  }

  return { corpusPath: staging, staged: true };
}

/** Best-effort cleanup of a staged corpus. Called by knowledge-graph/index.js. */
export async function teardownStudentCorpus(corpusPath) {
  if (!corpusPath) return;
  // Only remove staging dirs — never delete the vault itself.
  if (!corpusPath.endsWith("evidence-staging")) return;
  try {
    await fs.promises.rm(corpusPath, { recursive: true, force: true });
  } catch (err) {
    console.warn("[student-corpus] teardown failed:", err.message);
  }
}

async function copyRecursive(src, dest) {
  const stat = await fs.promises.stat(src);
  if (stat.isDirectory()) {
    await fs.promises.mkdir(dest, { recursive: true });
    const entries = await fs.promises.readdir(src);
    for (const e of entries) {
      await copyRecursive(path.join(src, e), path.join(dest, e));
    }
  } else if (stat.isFile()) {
    await fs.promises.copyFile(src, dest);
  }
}

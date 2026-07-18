import fs from "node:fs";
import path from "node:path";
import {
  getStudentEvidenceStagingPath,
  ensureStudentStorage,
} from "../student-storage.js";

// Build a transient corpus from explicit evidence and narrative versions. The
// former plaintext notebook vault is intentionally never included.
export async function prepareStudentCorpus(opts) {
  const { studentId, dataDir } = opts;
  ensureStudentStorage(studentId, dataDir, { withGraph: true });
  const staging = getStudentEvidenceStagingPath(studentId, dataDir);
  await fs.promises.rm(staging, { recursive: true, force: true });
  await fs.promises.mkdir(staging, { recursive: true });

  const evidenceFiles = Array.isArray(opts.evidenceFiles) ? opts.evidenceFiles.filter(Boolean) : [];
  if (evidenceFiles.length > 0) {
    const evidenceDir = path.join(staging, "evidence");
    await fs.promises.mkdir(evidenceDir, { recursive: true });
    for (const source of evidenceFiles) {
      if (!fs.existsSync(source)) continue;
      const stat = await fs.promises.stat(source);
      if (!stat.isFile()) continue;
      await fs.promises.copyFile(source, path.join(evidenceDir, path.basename(source)));
    }
  }

  if (opts.includeNarrativeHistory && typeof opts.narrativeFetcher === "function") {
    const narrativeDir = path.join(staging, "narrative-history");
    await fs.promises.mkdir(narrativeDir, { recursive: true });
    try {
      const versions = await opts.narrativeFetcher(studentId);
      for (const version of versions || []) {
        const number = version.version || version.versionNumber || "n";
        await fs.promises.writeFile(
          path.join(narrativeDir, `narrative-v${number}.md`),
          version.text || version.content || "",
          "utf8",
        );
      }
    } catch (error) {
      console.warn("[student-corpus] narrative fetch failed:", error.message);
    }
  }

  return { corpusPath: staging, staged: true };
}

export async function teardownStudentCorpus(corpusPath) {
  if (!corpusPath || !corpusPath.endsWith("evidence-staging")) return;
  await fs.promises.rm(corpusPath, { recursive: true, force: true }).catch(() => {});
}

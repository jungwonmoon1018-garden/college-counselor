import fs from "node:fs";
import path from "node:path";
import archiver from "archiver";
import {
  getLegacyNotebookPath,
  hasLegacyNotebook,
} from "./student-storage.js";

async function collectMarkdownFiles(root, current = root, output = []) {
  const entries = await fs.promises.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await collectMarkdownFiles(root, absolute, output);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      output.push({
        absolute,
        relative: path.relative(root, absolute).split(path.sep).join("/"),
      });
    }
  }
  return output;
}

export async function exportLegacyNotebook(studentId, dataDir, writable) {
  if (!writable || typeof writable.write !== "function") {
    throw new TypeError("A writable output stream is required.");
  }
  if (!hasLegacyNotebook(studentId, dataDir)) {
    const error = new Error("No legacy notebook was found.");
    error.code = "LEGACY_NOTEBOOK_NOT_FOUND";
    throw error;
  }

  const root = getLegacyNotebookPath(studentId, dataDir);
  const files = await collectMarkdownFiles(root);
  const archive = archiver("zip", { zlib: { level: 9 } });
  const completion = new Promise((resolve, reject) => {
    writable.on("finish", resolve);
    writable.on("error", reject);
    archive.on("warning", reject);
    archive.on("error", reject);
  });
  archive.pipe(writable);
  for (const file of files) archive.file(file.absolute, { name: file.relative });
  archive.append(JSON.stringify({
    format: "college-counselor-legacy-notebook",
    exportedAt: new Date().toISOString(),
    markdownFiles: files.length,
  }, null, 2), { name: "EXPORT-MANIFEST.json" });
  await archive.finalize();
  await completion;
  return { markdownFiles: files.length };
}

export async function deleteLegacyNotebook(studentId, dataDir) {
  const notebook = path.resolve(getLegacyNotebookPath(studentId, dataDir));
  const studentRoot = path.dirname(notebook);
  if (notebook !== path.join(studentRoot, "vault")) {
    throw new Error("Refusing to delete an unexpected legacy notebook path.");
  }
  await fs.promises.rm(notebook, { recursive: true, force: true });
}

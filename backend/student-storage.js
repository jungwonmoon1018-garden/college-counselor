import fs from "node:fs";
import path from "node:path";
import { hashValue } from "./pii-vault.js";

const DEFAULT_ROOT_NAME = "student-storage";

function getRoot(dataDir) {
  return process.env.STUDENT_STORAGE_ROOT
    ? path.resolve(process.env.STUDENT_STORAGE_ROOT)
    : path.join(dataDir, DEFAULT_ROOT_NAME);
}

function studentDirHash(studentId) {
  return hashValue(String(studentId), process.env.STUDENT_STORAGE_SALT || "cc_student_storage_salt");
}

export function getStudentRoot(studentId, dataDir) {
  return path.join(getRoot(dataDir), studentDirHash(studentId));
}

// Kept only for one-time export/removal of vaults created by older releases.
// No runtime feature may read from or write to this directory.
export function getLegacyNotebookPath(studentId, dataDir) {
  return path.join(getStudentRoot(studentId, dataDir), "vault");
}

export function getStudentKnowledgeGraphPath(studentId, dataDir) {
  return path.join(getStudentRoot(studentId, dataDir), "knowledge-graph");
}

export function getStudentEvidenceStagingPath(studentId, dataDir) {
  return path.join(getStudentRoot(studentId, dataDir), "evidence-staging");
}

export function ensureStudentStorage(studentId, dataDir, { withGraph = true } = {}) {
  const root = getStudentRoot(studentId, dataDir);
  fs.mkdirSync(root, { recursive: true });
  if (withGraph) fs.mkdirSync(getStudentKnowledgeGraphPath(studentId, dataDir), { recursive: true });
  return root;
}

export function hasLegacyNotebook(studentId, dataDir) {
  return fs.existsSync(getLegacyNotebookPath(studentId, dataDir));
}

export function hasStudentGraph(studentId, dataDir) {
  return fs.existsSync(path.join(getStudentKnowledgeGraphPath(studentId, dataDir), "graph.json"));
}

export async function removeStudentStorage(studentId, dataDir) {
  const root = path.resolve(getStudentRoot(studentId, dataDir));
  const storageRoot = path.resolve(getRoot(dataDir));
  if (root === storageRoot || !root.startsWith(storageRoot + path.sep)) {
    throw new Error("Refusing to remove a path outside student storage.");
  }
  await fs.promises.rm(root, { recursive: true, force: true });
}

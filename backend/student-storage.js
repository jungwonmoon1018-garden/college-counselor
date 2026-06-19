// ═══════════════════════════════════════════════════════════════════════
// STUDENT STORAGE PATHS — per-student vault + knowledge-graph dirs
// ═══════════════════════════════════════════════════════════════════════
// Resolves filesystem paths for per-student artifacts (Logseq vault,
// knowledge-graph outputs, evidence staging) under a single root.
//
// Layout (rooted at $PII_VAULT_ROOT, defaults to <dataDir>/student-storage):
//
//   student-storage/
//     <studentIdHash>/
//       vault/                 # Logseq markdown vault (Pillar 8)
//         journals/
//         pages/
//         logseq/
//       knowledge-graph/       # graphify outputs (Pillar 7)
//         graph.json
//         GRAPH_REPORT.md
//         community-labels.json
//         wiki/
//       evidence-staging/      # transient input for graphify rebuilds
//
// IMPORTANT: this directory tree is NOT encrypted by graphify or by the
// markdown files themselves — Logseq needs plain UTF-8 to read its vault.
// The intended trust boundary is OS-level disk encryption (FileVault,
// BitLocker, LUKS) plus filesystem ACLs that restrict the directory to
// the backend service user. The pii-vault.db sidecar records a mapping
// from studentId → on-disk path; the path itself contains a SHA-256
// hash, so even directory listings don't leak emails or names.
// ═══════════════════════════════════════════════════════════════════════

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
  // Salted hash — same scheme pii-vault uses elsewhere, so a single salt
  // change rotates both lookups.
  return hashValue(String(studentId), process.env.STUDENT_STORAGE_SALT || "cc_student_storage_salt");
}

/** Absolute path to <root>/<studentHash>/. Does not create the dir. */
export function getStudentRoot(studentId, dataDir) {
  return path.join(getRoot(dataDir), studentDirHash(studentId));
}

/** Path to the Logseq vault — <studentRoot>/vault/. */
export function getStudentVaultPath(studentId, dataDir) {
  return path.join(getStudentRoot(studentId, dataDir), "vault");
}

/** Path to the graphify output dir — <studentRoot>/knowledge-graph/. */
export function getStudentKnowledgeGraphPath(studentId, dataDir) {
  return path.join(getStudentRoot(studentId, dataDir), "knowledge-graph");
}

/** Path to the evidence staging dir (transient input for rebuilds). */
export function getStudentEvidenceStagingPath(studentId, dataDir) {
  return path.join(getStudentRoot(studentId, dataDir), "evidence-staging");
}

/** Create the directory tree for a student. Idempotent. */
export function ensureStudentStorage(studentId, dataDir, { withVault = true, withGraph = true } = {}) {
  const root = getStudentRoot(studentId, dataDir);
  fs.mkdirSync(root, { recursive: true });
  if (withVault) {
    const vault = getStudentVaultPath(studentId, dataDir);
    fs.mkdirSync(path.join(vault, "journals"), { recursive: true });
    fs.mkdirSync(path.join(vault, "pages"), { recursive: true });
    fs.mkdirSync(path.join(vault, "logseq"), { recursive: true });
  }
  if (withGraph) {
    fs.mkdirSync(getStudentKnowledgeGraphPath(studentId, dataDir), { recursive: true });
  }
  return root;
}

/** Whether the student has an initialized vault (used by Pillar 7's status endpoint). */
export function hasStudentVault(studentId, dataDir) {
  return fs.existsSync(getStudentVaultPath(studentId, dataDir));
}

/** Whether the student has built a knowledge graph at least once. */
export function hasStudentGraph(studentId, dataDir) {
  return fs.existsSync(path.join(getStudentKnowledgeGraphPath(studentId, dataDir), "graph.json"));
}

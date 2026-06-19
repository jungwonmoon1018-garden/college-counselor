// ═══════════════════════════════════════════════════════════════════════
// LOGSEQ PUBLIC API (Pillar 8)
// ═══════════════════════════════════════════════════════════════════════
// One-stop import for callers (server routes, council audit-trail).
// Re-exports vault bootstrap, HTTP/fs client, and the file-watcher.
// ═══════════════════════════════════════════════════════════════════════

export {
  bootstrapStudentVault,
  isVaultInitialized,
} from "./vault-bootstrap.js";

export {
  readPage,
  readJournal,
  appendBlock,
  writeJournalEntry,
  listPages,
  datalogQuery,
} from "./api-client.js";

export {
  watchStudentVault,
  unwatchStudentVault,
  unwatchAll,
} from "./file-watcher.js";

export { getStudentVaultPath } from "../student-storage.js";

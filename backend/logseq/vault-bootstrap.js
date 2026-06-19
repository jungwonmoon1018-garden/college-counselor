// ═══════════════════════════════════════════════════════════════════════
// LOGSEQ VAULT BOOTSTRAP — create per-student vault + seed pages (Pillar 8)
// ═══════════════════════════════════════════════════════════════════════
// First-touch initializer for a student's Logseq vault. Creates the
// minimal directory structure Logseq expects (`journals/`, `pages/`,
// `logseq/`) and seeds the application-specific pages that the
// counselor backend reads/writes:
//
//   pages/college-list.md          — target school list with #school tags
//   pages/narrative.md             — current narrative arc + revisions
//   pages/ec-evidence.md           — links to EC evidence files
//   pages/strategy-council-log.md  — audit trail of council convenings
//   pages/methodology-notes.md     — per-decision rationale + provenance
//   pages/parent-conversations.md  — only created when LOGSEQ_PARENT
//                                    consent is granted
//   logseq/config.edn              — minimal config (preferred format,
//                                    no plugins enabled by default)
//   logseq/preferred-format        — "Markdown" sentinel
//
// All seed content is empty-but-structured (top-level Logseq block tags
// in place) so a student can start typing immediately.
// ═══════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { ensureStudentStorage, getStudentVaultPath } from "../student-storage.js";

const SEED_PAGES = {
  "college-list.md": `# College List

- ## Reach
- ## Match
- ## Safety
`,
  "narrative.md": `# Narrative

- ## Current
- ## Revisions
`,
  "ec-evidence.md": `# Extracurricular Evidence

- ## Activities
- ## Awards
- ## Attachments
`,
  "strategy-council-log.md": `# Strategy Council Log

> Audit trail of every council convening. Each entry: date, question, recommendation, dissent, citations. Written automatically by the backend — students should not edit this page.

`,
  "methodology-notes.md": `# Methodology Notes

- ## Decision rationale
- ## Data provenance
- ## Open questions
`,
};

const LOGSEQ_CONFIG_EDN = `{:preferred-format :markdown
 :feature/enable-block-timestamps? true
 :feature/enable-journals? true
 :feature/disable-built-in-pages-css? false}
`;

/**
 * Initialize a student's vault. Idempotent — never overwrites existing
 * pages, only creates missing ones.
 *
 * @param {string} studentId
 * @param {string} dataDir
 * @param {object} [opts]
 * @param {boolean} [opts.parentConversationsConsent=false] — when true,
 *   seeds `pages/parent-conversations.md`. Should reflect the current
 *   LOGSEQ_PARENT_CONVERSATIONS consent state.
 */
export async function bootstrapStudentVault(studentId, dataDir, opts = {}) {
  ensureStudentStorage(studentId, dataDir, { withVault: true, withGraph: true });
  const vault = getStudentVaultPath(studentId, dataDir);

  const pagesDir = path.join(vault, "pages");
  const logseqDir = path.join(vault, "logseq");

  for (const [filename, content] of Object.entries(SEED_PAGES)) {
    const p = path.join(pagesDir, filename);
    if (!fs.existsSync(p)) {
      await fs.promises.writeFile(p, content, "utf-8");
    }
  }

  if (opts.parentConversationsConsent) {
    const parent = path.join(pagesDir, "parent-conversations.md");
    if (!fs.existsSync(parent)) {
      await fs.promises.writeFile(
        parent,
        "# Parent Conversations\n\n> PIPA cross-border consent required. Notes from parent meetings, agreements, and shared decisions live here.\n\n",
        "utf-8",
      );
    }
  }

  const configPath = path.join(logseqDir, "config.edn");
  if (!fs.existsSync(configPath)) {
    await fs.promises.writeFile(configPath, LOGSEQ_CONFIG_EDN, "utf-8");
  }
  const preferredFormatPath = path.join(logseqDir, "preferred-format");
  if (!fs.existsSync(preferredFormatPath)) {
    await fs.promises.writeFile(preferredFormatPath, "Markdown\n", "utf-8");
  }

  return { vault, seededPages: Object.keys(SEED_PAGES) };
}

/** Whether a vault has been initialized for this student. */
export function isVaultInitialized(studentId, dataDir) {
  const vault = getStudentVaultPath(studentId, dataDir);
  return fs.existsSync(path.join(vault, "logseq", "preferred-format"));
}

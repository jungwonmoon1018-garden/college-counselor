// ═══════════════════════════════════════════════════════════════════════
// LOGSEQ API CLIENT — HTTP + filesystem fallback (Pillar 8)
// ═══════════════════════════════════════════════════════════════════════
// When Logseq desktop is running with the "Local REST API" community
// plugin enabled, this client routes reads/writes through HTTP so the
// student sees live updates without a vault reload.
//
// When Logseq is NOT running (offline, or student uses only the in-app
// notebook panel), the same calls fall back to direct filesystem reads
// and writes against the vault directory. The markdown is identical in
// both modes — Logseq stores everything as plain UTF-8 markdown.
//
// HTTP base URL + auth token are per-student values stored in pii-vault;
// callers pass them in (`opts.httpEndpoint`, `opts.token`) and we cache
// the "is the endpoint alive" decision per studentId for 30 seconds.
// ═══════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { getStudentVaultPath } from "../student-storage.js";

const LIVE_PROBE_TTL_MS = 30_000;
const PROBE_CACHE = new Map(); // studentId -> { live, checkedAt }

async function probeLive(httpEndpoint, token, signal) {
  if (!httpEndpoint) return false;
  try {
    const res = await fetch(`${httpEndpoint.replace(/\/$/, "")}/api`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token || ""}` },
      body: JSON.stringify({ method: "logseq.App.getCurrentGraph", args: [] }),
      signal,
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function isLogseqLive(studentId, opts) {
  const cached = PROBE_CACHE.get(studentId);
  if (cached && Date.now() - cached.checkedAt < LIVE_PROBE_TTL_MS) return cached.live;
  const live = await probeLive(opts.httpEndpoint, opts.token, opts.signal);
  PROBE_CACHE.set(studentId, { live, checkedAt: Date.now() });
  return live;
}

function safePageName(name) {
  // Logseq page names use any utf-8 chars but can't include /\ for fs
  // safety. We also strip any leading dots so a malicious name can't
  // escape the pages dir.
  return String(name).replace(/[\\/]/g, "_").replace(/^\.+/, "").trim();
}

function pageFilename(name) {
  const safe = safePageName(name);
  return safe.endsWith(".md") ? safe : `${safe}.md`;
}

// Journal filenames come straight from a date string. Enforce strict
// YYYY-MM-DD at the filesystem layer too (not just the route) so no caller
// can traverse out of the journals dir with a crafted date.
function journalFilename(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    throw new Error(`invalid journal date: ${date}`);
  }
  return `${date}.md`;
}

async function logseqHttp(opts, method, args = []) {
  const res = await fetch(`${opts.httpEndpoint.replace(/\/$/, "")}/api`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.token || ""}` },
    body: JSON.stringify({ method, args }),
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(`Logseq API ${method} failed: ${res.status}`);
  return res.json();
}

/** Read a page as markdown. */
export async function readPage(studentId, dataDir, pageName, opts = {}) {
  const vault = getStudentVaultPath(studentId, dataDir);
  const live = await isLogseqLive(studentId, opts);
  if (live) {
    try {
      const blocks = await logseqHttp(opts, "logseq.Editor.getPageBlocksTree", [pageName]);
      // Logseq returns a tree of blocks; flatten to markdown for the API
      // caller. The on-disk file is also kept in sync by Logseq itself.
      return flattenBlocksToMarkdown(blocks);
    } catch {
      // Fall through to filesystem.
    }
  }
  const p = path.join(vault, "pages", pageFilename(pageName));
  if (!fs.existsSync(p)) return null;
  return fs.promises.readFile(p, "utf-8");
}

/** Read a daily journal page (YYYY-MM-DD). */
export async function readJournal(studentId, dataDir, date, opts = {}) {
  const vault = getStudentVaultPath(studentId, dataDir);
  const p = path.join(vault, "journals", journalFilename(date));
  if (!fs.existsSync(p)) return null;
  return fs.promises.readFile(p, "utf-8");
}

/** Append a block to a page. Markdown bullet form. */
export async function appendBlock(studentId, dataDir, pageName, content, opts = {}) {
  const vault = getStudentVaultPath(studentId, dataDir);
  const live = await isLogseqLive(studentId, opts);
  if (live) {
    try {
      await logseqHttp(opts, "logseq.Editor.appendBlockInPage", [pageName, content]);
      return { ok: true, via: "http" };
    } catch {
      // Fall through.
    }
  }
  const p = path.join(vault, "pages", pageFilename(pageName));
  const prefix = fs.existsSync(p) ? "\n" : `# ${safePageName(pageName)}\n\n`;
  await fs.promises.appendFile(p, `${prefix}- ${content}\n`, "utf-8");
  return { ok: true, via: "fs" };
}

/** Write/append a daily journal entry as a single bullet. */
export async function writeJournalEntry(studentId, dataDir, date, content, opts = {}) {
  const vault = getStudentVaultPath(studentId, dataDir);
  const p = path.join(vault, "journals", journalFilename(date));
  const prefix = fs.existsSync(p) ? "" : `# ${date}\n\n`;
  await fs.promises.appendFile(p, `${prefix}- ${content}\n`, "utf-8");
  return { ok: true, path: p };
}

/** List all page filenames in the vault. */
export async function listPages(studentId, dataDir) {
  const vault = getStudentVaultPath(studentId, dataDir);
  const pagesDir = path.join(vault, "pages");
  if (!fs.existsSync(pagesDir)) return [];
  const entries = await fs.promises.readdir(pagesDir);
  return entries.filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""));
}

/** Datalog passthrough — only works when Logseq is live. */
export async function datalogQuery(studentId, dataDir, queryStr, opts = {}) {
  const live = await isLogseqLive(studentId, opts);
  if (!live) {
    return { ok: false, reason: "logseq_offline", message: "Datalog queries require Logseq to be running." };
  }
  const result = await logseqHttp(opts, "logseq.DB.datascriptQuery", [queryStr]);
  return { ok: true, result };
}

// ─── Helpers ─────────────────────────────────────────────────────────
function flattenBlocksToMarkdown(blocks, depth = 0) {
  if (!Array.isArray(blocks)) return "";
  const lines = [];
  for (const b of blocks) {
    const indent = "  ".repeat(depth);
    const content = (b.content || "").trim();
    if (content) lines.push(`${indent}- ${content}`);
    if (Array.isArray(b.children) && b.children.length) {
      lines.push(flattenBlocksToMarkdown(b.children, depth + 1));
    }
  }
  return lines.filter(Boolean).join("\n");
}

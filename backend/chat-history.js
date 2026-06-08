// ═══════════════════════════════════════════════════════════════════════
// CHAT HISTORY — per-student, multi-thread.
// ═══════════════════════════════════════════════════════════════════════
// Threads are persisted server-side so the student sees their history
// from any device. Messages are appended in order; titles auto-generate
// from the first user turn (truncated to 60 chars) if not explicitly set.
// Soft-delete via archived_at — restorable via a future "trash" view.

import crypto from "node:crypto";

const MAX_THREADS_PER_LIST = 50;
const MAX_MESSAGES_PER_THREAD = 500;
const MAX_MESSAGE_CHARS = 50_000;
const DEFAULT_TITLE = "New conversation";

export function createThread(stmts, studentId, title) {
  const id = "thr_" + crypto.randomBytes(8).toString("hex");
  stmts.createThread.run(id, studentId, (title || DEFAULT_TITLE).slice(0, 200));
  return { id, title: title || DEFAULT_TITLE };
}

export function listThreads(stmts, studentId, limit = MAX_THREADS_PER_LIST) {
  return stmts.listThreads.all(studentId, Math.min(Math.max(1, limit), MAX_THREADS_PER_LIST));
}

export function getThreadWithMessages(stmts, studentId, threadId) {
  const thread = stmts.getThread.get(threadId, studentId);
  if (!thread || thread.archived_at) return null;
  const messages = stmts.listMessages.all(threadId, MAX_MESSAGES_PER_THREAD);
  return { thread, messages };
}

// Append one message to a thread; auto-bumps thread updated_at + counter.
// If the thread's title is still the default and this is the first user
// message, derive a title from it (truncated, single-line).
export function appendMessage(stmts, studentId, threadId, role, content, attachmentName = null) {
  const thread = stmts.getThread.get(threadId, studentId);
  if (!thread || thread.archived_at) return { ok: false, error: "thread_not_found" };
  if (!["user", "assistant", "system"].includes(role)) return { ok: false, error: "bad_role" };
  const safe = String(content || "").slice(0, MAX_MESSAGE_CHARS);
  if (!safe.trim() && !attachmentName) return { ok: false, error: "empty_message" };

  stmts.insertMessage.run(threadId, role, safe, attachmentName);
  stmts.touchThread.run(1, threadId);

  // Auto-title from first user turn if title is still the placeholder
  if (role === "user" && thread.message_count === 0 && (thread.title === DEFAULT_TITLE || !thread.title)) {
    const derived = safe.split(/\r?\n/)[0].trim().slice(0, 60) || DEFAULT_TITLE;
    stmts.updateThreadTitle.run(derived, threadId, studentId);
  }
  return { ok: true };
}

export function renameThread(stmts, studentId, threadId, newTitle) {
  const t = String(newTitle || "").trim().slice(0, 200);
  if (!t) return false;
  const r = stmts.updateThreadTitle.run(t, threadId, studentId);
  return r.changes > 0;
}

export function archiveThread(stmts, studentId, threadId) {
  return stmts.archiveThread.run(threadId, studentId).changes > 0;
}

// Hard delete — wipes thread + every message in it. Used by the
// right-to-erasure flow and by explicit per-thread "Delete forever".
export function deleteThread(stmts, studentId, threadId) {
  stmts.deleteThreadMessages.run(threadId, studentId);
  const r = stmts.deleteThreadHard.run(threadId, studentId);
  return r.changes > 0;
}

// Substring search across the student's own (non-archived) threads.
// Lowercase LIKE on content — fast for our scale (sub-100K messages).
export function searchMessages(stmts, studentId, query) {
  const q = String(query || "").trim();
  if (q.length < 2) return [];
  return stmts.searchMessages.all(studentId, `%${q}%`);
}

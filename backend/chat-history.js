import crypto from "node:crypto";
import { decrypt, encrypt } from "./pii-vault.js";
import { isCrisisText } from "./policy-router.js";

const MAX_THREADS_PER_LIST = 50;
const MAX_MESSAGES_PER_THREAD = 500;
const MAX_MESSAGE_CHARS = 50_000;
const MAX_SEARCH_SCAN = 5_000;
const MAX_SEARCH_RESULTS = 30;
const DEFAULT_TITLE = "New conversation";
export const CRISIS_SAFE_TITLE = "Support resources";
const ENCRYPTED_PREFIX = "enc:v1:";

let encryptionKey = null;

export function configureChatEncryption(keyHex) {
  if (!/^[0-9a-f]{64}$/i.test(String(keyHex || ""))) {
    throw new Error("Chat history requires a 32-byte hex encryption key.");
  }
  encryptionKey = keyHex;
}

function requireEncryptionKey() {
  if (!encryptionKey) throw new Error("Chat history encryption is not configured.");
  return encryptionKey;
}

function seal(value) {
  if (value == null) return null;
  return ENCRYPTED_PREFIX + encrypt(String(value), requireEncryptionKey());
}

function open(value, fallback = "") {
  if (value == null) return value;
  const stored = String(value);
  if (!stored.startsWith(ENCRYPTED_PREFIX)) return stored;
  const plaintext = decrypt(stored.slice(ENCRYPTED_PREFIX.length), requireEncryptionKey());
  return plaintext == null ? fallback : plaintext;
}

function publicThread(row) {
  if (!row) return row;
  return { ...row, title: open(row.title, "Conversation unavailable") };
}

function publicMessage(row) {
  if (!row) return row;
  return {
    ...row,
    content: open(row.content, "[Unable to decrypt message]"),
    attachment_name: open(row.attachment_name, null),
  };
}

export function createThread(stmts, studentId, title) {
  const id = "thr_" + crypto.randomBytes(8).toString("hex");
  const safeTitle = String(title || DEFAULT_TITLE).slice(0, 200);
  stmts.createThread.run(id, studentId, seal(safeTitle));
  return { id, title: safeTitle };
}

export function listThreads(stmts, studentId, limit = MAX_THREADS_PER_LIST) {
  return stmts.listThreads
    .all(studentId, Math.min(Math.max(1, limit), MAX_THREADS_PER_LIST))
    .map(publicThread);
}

export function getThreadWithMessages(stmts, studentId, threadId) {
  const storedThread = stmts.getThread.get(threadId, studentId);
  if (!storedThread || storedThread.archived_at) return null;
  const messages = stmts.listMessages
    .all(threadId, MAX_MESSAGES_PER_THREAD)
    .map(publicMessage);
  return { thread: publicThread(storedThread), messages };
}

export function appendMessage(stmts, studentId, threadId, role, content, attachmentName = null) {
  const storedThread = stmts.getThread.get(threadId, studentId);
  if (!storedThread || storedThread.archived_at) return { ok: false, error: "thread_not_found" };
  if (!["user", "assistant", "system"].includes(role)) return { ok: false, error: "bad_role" };
  const safe = String(content || "").slice(0, MAX_MESSAGE_CHARS);
  if (!safe.trim() && !attachmentName) return { ok: false, error: "empty_message" };

  stmts.insertMessage.run(threadId, role, seal(safe), seal(attachmentName));
  stmts.touchThread.run(1, threadId);

  const currentTitle = open(storedThread.title, DEFAULT_TITLE);
  if (role === "user" && storedThread.message_count === 0 && currentTitle === DEFAULT_TITLE) {
    const derived = isCrisisText(safe)
      ? CRISIS_SAFE_TITLE
      : (safe.split(/\r?\n/)[0].trim().slice(0, 60) || DEFAULT_TITLE);
    stmts.updateThreadTitle.run(seal(derived), threadId, studentId);
  }
  return { ok: true };
}

export function renameThread(stmts, studentId, threadId, newTitle) {
  const title = String(newTitle || "").trim().slice(0, 200);
  if (!title) return false;
  return stmts.updateThreadTitle.run(seal(title), threadId, studentId).changes > 0;
}

export function archiveThread(stmts, studentId, threadId) {
  return stmts.archiveThread.run(threadId, studentId).changes > 0;
}

export function deleteThread(stmts, studentId, threadId) {
  stmts.deleteThreadMessages.run(threadId, studentId);
  return stmts.deleteThreadHard.run(threadId, studentId).changes > 0;
}

export function searchMessages(stmts, studentId, query) {
  const normalizedQuery = String(query || "").trim().toLocaleLowerCase();
  if (normalizedQuery.length < 2) return [];

  const matches = [];
  for (const stored of stmts.searchMessages.all(studentId, MAX_SEARCH_SCAN)) {
    const row = {
      ...publicMessage(stored),
      title: open(stored.title, "Conversation unavailable"),
    };
    if (row.content.toLocaleLowerCase().includes(normalizedQuery)) matches.push(row);
    if (matches.length >= MAX_SEARCH_RESULTS) break;
  }
  return matches;
}

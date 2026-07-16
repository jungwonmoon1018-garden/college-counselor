import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  appendMessage,
  configureChatEncryption,
  createThread,
  getThreadWithMessages,
  listThreads,
  searchMessages,
} from "../chat-history.js";

function fixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE chat_threads (
      id TEXT PRIMARY KEY, student_id TEXT NOT NULL, title TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
      message_count INTEGER DEFAULT 0, archived_at TEXT
    );
    CREATE TABLE chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL, attachment_name TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  const stmts = {
    createThread: db.prepare("INSERT INTO chat_threads (id, student_id, title) VALUES (?, ?, ?)"),
    listThreads: db.prepare("SELECT id, title, created_at, updated_at, message_count FROM chat_threads WHERE student_id = ? AND archived_at IS NULL ORDER BY updated_at DESC LIMIT ?"),
    getThread: db.prepare("SELECT * FROM chat_threads WHERE id = ? AND student_id = ?"),
    updateThreadTitle: db.prepare("UPDATE chat_threads SET title = ? WHERE id = ? AND student_id = ?"),
    touchThread: db.prepare("UPDATE chat_threads SET message_count = message_count + ? WHERE id = ?"),
    insertMessage: db.prepare("INSERT INTO chat_messages (thread_id, role, content, attachment_name) VALUES (?, ?, ?, ?)"),
    listMessages: db.prepare("SELECT id, role, content, attachment_name, created_at FROM chat_messages WHERE thread_id = ? ORDER BY id ASC LIMIT ?"),
    searchMessages: db.prepare(`
      SELECT m.id, m.thread_id, m.role, m.content, m.created_at, t.title
      FROM chat_messages m JOIN chat_threads t ON m.thread_id = t.id
      WHERE t.student_id = ? AND t.archived_at IS NULL ORDER BY m.id DESC LIMIT ?
    `),
  };
  return { db, stmts };
}

test("chat titles, messages, and attachment names are encrypted at rest", () => {
  configureChatEncryption("ab".repeat(32));
  const { db, stmts } = fixture();
  const thread = createThread(stmts, "student-1", "Essay planning");
  appendMessage(stmts, "student-1", thread.id, "user", "My private essay idea", "draft.txt");

  const rawThread = db.prepare("SELECT title FROM chat_threads WHERE id = ?").get(thread.id);
  const rawMessage = db.prepare("SELECT content, attachment_name FROM chat_messages WHERE thread_id = ?").get(thread.id);
  assert.match(rawThread.title, /^enc:v1:/);
  assert.match(rawMessage.content, /^enc:v1:/);
  assert.match(rawMessage.attachment_name, /^enc:v1:/);
  assert.doesNotMatch(JSON.stringify({ rawThread, rawMessage }), /private essay|draft\.txt/i);

  assert.equal(listThreads(stmts, "student-1")[0].title, "Essay planning");
  const restored = getThreadWithMessages(stmts, "student-1", thread.id);
  assert.equal(restored.messages[0].content, "My private essay idea");
  assert.equal(restored.messages[0].attachment_name, "draft.txt");
  assert.equal(searchMessages(stmts, "student-1", "PRIVATE essay")[0].thread_id, thread.id);
  db.close();
});

test("chat encryption rejects malformed keys", () => {
  assert.throws(() => configureChatEncryption("not-a-key"), /32-byte hex/);
});

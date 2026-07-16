import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  initAuthStore,
  isLoopbackAddress,
  normalizeEmail,
} from "../security-auth.js";

function store() {
  const db = new Database(":memory:");
  return { db, auth: initAuthStore(db, { sessionTtlMs: 60_000 }) };
}

test("student credentials require a password and duplicate email cannot authenticate", () => {
  const { db, auth } = store();
  assert.throws(() => auth.createStudentCredential("s1", "email-hash", "short"), /12-256/);
  const created = auth.createStudentCredential("s1", "email-hash", "correct horse battery staple", { grade: 11 });
  assert.ok(created.recoveryCode.length >= 30);
  assert.equal(auth.authenticateStudent("email-hash", "wrong password value"), null);
  assert.equal(auth.authenticateStudent("email-hash", "correct horse battery staple").studentId, "s1");
  assert.throws(
    () => auth.createStudentCredential("s2", "email-hash", "another secure password", { grade: 11 }),
    (error) => error.code === "account_exists",
  );
  db.close();
});

test("student sessions are hashed, survive store reads, and logout-all revokes them", () => {
  const { db, auth } = store();
  auth.createStudentCredential("s1", "email-hash", "correct horse battery staple", { grade: 11 });
  const token = auth.issueStudentSession("email-hash", "s1");
  assert.equal(db.prepare("SELECT token_hash FROM session_tokens").get().token_hash.includes(token), false);
  assert.equal(auth.validateStudentSession(token).studentId, "s1");
  auth.revokeAllStudentSessions("s1");
  assert.equal(auth.validateStudentSession(token), null);
  db.close();
});

test("student recovery rotates recovery code and revokes prior sessions", () => {
  const { db, auth } = store();
  const first = auth.createStudentCredential("s1", "email-hash", "correct horse battery staple", { grade: 11 });
  const oldToken = auth.issueStudentSession("email-hash", "s1");
  const recovered = auth.recoverStudent("email-hash", first.recoveryCode, "new correct horse password");
  assert.ok(recovered.recoveryCode);
  assert.equal(auth.validateStudentSession(oldToken), null);
  assert.equal(auth.authenticateStudent("email-hash", "correct horse battery staple"), null);
  assert.equal(auth.authenticateStudent("email-hash", "new correct horse password").studentId, "s1");
  assert.equal(auth.recoverStudent("email-hash", first.recoveryCode, "third correct horse password"), null);
  db.close();
});

test("admin session is cookie-compatible and mutations require its CSRF token", () => {
  const { db, auth } = store();
  const boot = auth.bootstrapAdmin("administrator password 123");
  assert.equal(auth.validateAdminSession(boot.token), true);
  assert.equal(auth.validateAdminSession(boot.token, "wrong", true), false);
  assert.equal(auth.validateAdminSession(boot.token, boot.csrfToken, true), true);
  auth.revokeAdminSession(boot.token);
  assert.equal(auth.validateAdminSession(boot.token), false);
  assert.throws(() => auth.bootstrapAdmin("another administrator password"), (error) => error.code === "admin_exists");
  db.close();
});

test("normalization and loopback checks reject ambiguous identities and remote hosts", () => {
  assert.equal(normalizeEmail("  ＴＥＳＴ@Example.COM  "), "test@example.com");
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("192.168.1.20"), false);
});

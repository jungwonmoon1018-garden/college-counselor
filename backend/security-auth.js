import crypto from "node:crypto";

const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 256;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTIONS = Object.freeze({ N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

function now() {
  return Date.now();
}

export function normalizeEmail(email) {
  return String(email || "").normalize("NFKC").trim().toLowerCase();
}

export function assertValidPassword(password) {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    const err = new Error(`Password must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters.`);
    err.code = "invalid_password";
    throw err;
  }
}

export function hashOpaqueToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function derivePassword(password, salt) {
  return crypto.scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS).toString("hex");
}

function passwordRecord(password) {
  assertValidPassword(password);
  const salt = crypto.randomBytes(16).toString("hex");
  return { salt, hash: derivePassword(password, salt) };
}

function passwordMatches(password, salt, expectedHex) {
  if (typeof password !== "string" || !salt || !expectedHex) return false;
  try {
    const actual = Buffer.from(derivePassword(password, salt), "hex");
    const expected = Buffer.from(expectedHex, "hex");
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function newRecoveryCode() {
  const code = crypto.randomBytes(24).toString("base64url");
  return { code, hash: hashOpaqueToken(code) };
}

function newSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function isLoopbackAddress(address) {
  const value = String(address || "").toLowerCase();
  return value === "127.0.0.1" || value === "::1" || value === "::ffff:127.0.0.1";
}

export function initAuthStore(db, { sessionTtlMs = SESSION_TTL_MS } = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS student_credentials (
      student_id TEXT PRIMARY KEY,
      email_hash TEXT UNIQUE NOT NULL,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      recovery_hash TEXT NOT NULL,
      grade INTEGER NOT NULL CHECK (grade BETWEEN 9 AND 12),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_tokens (
      token_hash TEXT PRIMARY KEY,
      email_hash TEXT NOT NULL,
      student_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_session_expires ON session_tokens(expires_at);
    CREATE INDEX IF NOT EXISTS idx_session_student ON session_tokens(student_id);

    CREATE TABLE IF NOT EXISTS admin_account (
      singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      recovery_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      csrf_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_admin_session_expires ON admin_sessions(expires_at);
  `);
  const adminSessionColumns = db.prepare("PRAGMA table_info(admin_sessions)").all();
  if (!adminSessionColumns.some((column) => column.name === "csrf_hash")) {
    db.exec("ALTER TABLE admin_sessions ADD COLUMN csrf_hash TEXT");
  }
  const credentialColumns = db.prepare("PRAGMA table_info(student_credentials)").all();
  if (!credentialColumns.some((column) => column.name === "grade")) {
    db.exec("ALTER TABLE student_credentials ADD COLUMN grade INTEGER CHECK (grade BETWEEN 9 AND 12)");
  }

  const stmts = {
    credentialByStudent: db.prepare("SELECT * FROM student_credentials WHERE student_id = ?"),
    credentialByEmail: db.prepare("SELECT * FROM student_credentials WHERE email_hash = ?"),
    insertCredential: db.prepare(`INSERT INTO student_credentials
      (student_id, email_hash, password_salt, password_hash, recovery_hash, grade, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    updateGrade: db.prepare("UPDATE student_credentials SET grade = ?, updated_at = ? WHERE student_id = ?"),
    updateCredential: db.prepare(`UPDATE student_credentials
      SET password_salt = ?, password_hash = ?, recovery_hash = ?, updated_at = ?
      WHERE student_id = ?`),
    deleteCredential: db.prepare("DELETE FROM student_credentials WHERE student_id = ?"),
    insertSession: db.prepare(`INSERT INTO session_tokens
      (token_hash, email_hash, student_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`),
    sessionByHash: db.prepare("SELECT email_hash, student_id, expires_at FROM session_tokens WHERE token_hash = ?"),
    touchSession: db.prepare("UPDATE session_tokens SET expires_at = ? WHERE token_hash = ?"),
    deleteSession: db.prepare("DELETE FROM session_tokens WHERE token_hash = ?"),
    deleteStudentSessions: db.prepare("DELETE FROM session_tokens WHERE student_id = ?"),
    cleanSessions: db.prepare("DELETE FROM session_tokens WHERE expires_at < ?"),
    getAdmin: db.prepare("SELECT * FROM admin_account WHERE singleton_id = 1"),
    insertAdmin: db.prepare(`INSERT INTO admin_account
      (singleton_id, password_salt, password_hash, recovery_hash, created_at, updated_at)
      VALUES (1, ?, ?, ?, ?, ?)`),
    updateAdmin: db.prepare(`UPDATE admin_account
      SET password_salt = ?, password_hash = ?, recovery_hash = ?, updated_at = ? WHERE singleton_id = 1`),
    insertAdminSession: db.prepare("INSERT INTO admin_sessions (token_hash, csrf_hash, expires_at, created_at) VALUES (?, ?, ?, ?)"),
    adminSessionByHash: db.prepare("SELECT csrf_hash, expires_at FROM admin_sessions WHERE token_hash = ?"),
    touchAdminSession: db.prepare("UPDATE admin_sessions SET expires_at = ? WHERE token_hash = ?"),
    deleteAdminSession: db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?"),
    deleteAdminSessions: db.prepare("DELETE FROM admin_sessions"),
    cleanAdminSessions: db.prepare("DELETE FROM admin_sessions WHERE expires_at < ?"),
  };

  function issueStudentSession(emailHash, studentId) {
    const token = newSessionToken();
    const createdAt = now();
    stmts.insertSession.run(hashOpaqueToken(token), emailHash, studentId, createdAt + sessionTtlMs, createdAt);
    return token;
  }

  return {
    hasStudentCredential(emailHash) {
      return !!stmts.credentialByEmail.get(emailHash);
    },
    createStudentCredential(studentId, emailHash, password, { grade = null } = {}) {
      if (stmts.credentialByEmail.get(emailHash)) {
        const err = new Error("An account already exists for this email.");
        err.code = "account_exists";
        throw err;
      }
      const pw = passwordRecord(password);
      const recovery = newRecoveryCode();
      const timestamp = now();
      const gradeNumber = Number(grade);
      if (![9, 10, 11, 12].includes(gradeNumber)) {
        const err = new Error("Grade 9-12 is required.");
        err.code = "invalid_grade";
        throw err;
      }
      stmts.insertCredential.run(studentId, emailHash, pw.salt, pw.hash, recovery.hash, gradeNumber, timestamp, timestamp);
      return { recoveryCode: recovery.code };
    },
    getStudentGrade(studentId) {
      const grade = Number(stmts.credentialByStudent.get(studentId)?.grade);
      return [9, 10, 11, 12].includes(grade) ? grade : null;
    },
    setStudentGrade(studentId, grade) {
      const gradeNumber = Number(grade);
      if (![9, 10, 11, 12].includes(gradeNumber)) return false;
      return stmts.updateGrade.run(gradeNumber, now(), studentId).changes === 1;
    },
    authenticateStudent(emailHash, password) {
      const row = stmts.credentialByEmail.get(emailHash);
      if (!row || !passwordMatches(password, row.password_salt, row.password_hash)) return null;
      return { studentId: row.student_id, emailHash: row.email_hash };
    },
    changeStudentPassword(studentId, currentPassword, newPassword) {
      const row = stmts.credentialByStudent.get(studentId);
      if (!row || !passwordMatches(currentPassword, row.password_salt, row.password_hash)) return null;
      const pw = passwordRecord(newPassword);
      const recovery = newRecoveryCode();
      const tx = db.transaction(() => {
        stmts.updateCredential.run(pw.salt, pw.hash, recovery.hash, now(), studentId);
        stmts.deleteStudentSessions.run(studentId);
      });
      tx();
      return { emailHash: row.email_hash, recoveryCode: recovery.code };
    },
    recoverStudent(emailHash, recoveryCode, newPassword) {
      const row = stmts.credentialByEmail.get(emailHash);
      if (!row || !recoveryCode) return null;
      const actual = Buffer.from(hashOpaqueToken(recoveryCode), "hex");
      const expected = Buffer.from(row.recovery_hash || "", "hex");
      if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
      const pw = passwordRecord(newPassword);
      const recovery = newRecoveryCode();
      const tx = db.transaction(() => {
        stmts.updateCredential.run(pw.salt, pw.hash, recovery.hash, now(), row.student_id);
        stmts.deleteStudentSessions.run(row.student_id);
      });
      tx();
      return { studentId: row.student_id, emailHash: row.email_hash, recoveryCode: recovery.code };
    },
    issueStudentSession,
    validateStudentSession(token) {
      if (!token) return null;
      const tokenHash = hashOpaqueToken(token);
      const row = stmts.sessionByHash.get(tokenHash);
      if (!row) return null;
      if (row.expires_at <= now()) {
        stmts.deleteSession.run(tokenHash);
        return null;
      }
      const expiresAt = now() + sessionTtlMs;
      stmts.touchSession.run(expiresAt, tokenHash);
      return { emailHash: row.email_hash, studentId: row.student_id, expiresAt };
    },
    revokeStudentSession(token) {
      if (token) stmts.deleteSession.run(hashOpaqueToken(token));
    },
    revokeAllStudentSessions(studentId) {
      stmts.deleteStudentSessions.run(studentId);
    },
    deleteStudentCredential(studentId) {
      const tx = db.transaction(() => {
        stmts.deleteStudentSessions.run(studentId);
        stmts.deleteCredential.run(studentId);
      });
      tx();
    },
    adminBootstrapped() {
      return !!stmts.getAdmin.get();
    },
    bootstrapAdmin(password) {
      if (stmts.getAdmin.get()) {
        const err = new Error("Administrator account already exists.");
        err.code = "admin_exists";
        throw err;
      }
      const pw = passwordRecord(password);
      const recovery = newRecoveryCode();
      const timestamp = now();
      stmts.insertAdmin.run(pw.salt, pw.hash, recovery.hash, timestamp, timestamp);
      return { ...this.issueAdminSession(), recoveryCode: recovery.code };
    },
    authenticateAdmin(password) {
      const row = stmts.getAdmin.get();
      if (!row || !passwordMatches(password, row.password_salt, row.password_hash)) return null;
      return this.issueAdminSession();
    },
    recoverAdmin(recoveryCode, newPassword) {
      const row = stmts.getAdmin.get();
      if (!row || !recoveryCode) return null;
      const actual = Buffer.from(hashOpaqueToken(recoveryCode), "hex");
      const expected = Buffer.from(row.recovery_hash || "", "hex");
      if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
      const pw = passwordRecord(newPassword);
      const recovery = newRecoveryCode();
      const tx = db.transaction(() => {
        stmts.updateAdmin.run(pw.salt, pw.hash, recovery.hash, now());
        stmts.deleteAdminSessions.run();
      });
      tx();
      return { ...this.issueAdminSession(), recoveryCode: recovery.code };
    },
    issueAdminSession() {
      const token = newSessionToken();
      const csrfToken = newSessionToken();
      const createdAt = now();
      stmts.insertAdminSession.run(hashOpaqueToken(token), hashOpaqueToken(csrfToken), createdAt + sessionTtlMs, createdAt);
      return { token, csrfToken };
    },
    validateAdminSession(token, csrfToken = null, requireCsrf = false) {
      if (!token) return false;
      const tokenHash = hashOpaqueToken(token);
      const row = stmts.adminSessionByHash.get(tokenHash);
      if (!row) return false;
      if (row.expires_at <= now()) {
        stmts.deleteAdminSession.run(tokenHash);
        return false;
      }
      if (requireCsrf) {
        if (!csrfToken || !row.csrf_hash) return false;
        const actual = Buffer.from(hashOpaqueToken(csrfToken), "hex");
        const expected = Buffer.from(row.csrf_hash, "hex");
        if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return false;
      }
      stmts.touchAdminSession.run(now() + sessionTtlMs, tokenHash);
      return true;
    },
    revokeAdminSession(token) {
      if (token) stmts.deleteAdminSession.run(hashOpaqueToken(token));
    },
    revokeAllAdminSessions() {
      stmts.deleteAdminSessions.run();
    },
    cleanup() {
      stmts.cleanSessions.run(now());
      stmts.cleanAdminSessions.run(now());
    },
  };
}

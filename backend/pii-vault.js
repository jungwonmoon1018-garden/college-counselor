// ═══════════════════════════════════════════════════════════════════════
// PII VAULT — Separate encrypted PII store with strict access controls
// ═══════════════════════════════════════════════════════════════════════
// PII vault is physically separate from the operational database.
// It stores: student names, emails, parent contacts, uploaded documents.
//
// ACCESS RULES:
//   - ONLY accessed by: authentication, notification, data export, deletion
//   - NEVER accessed by: model context assembly, RAG retrieval, vector search, audit
//   - Model context uses [STUDENT] placeholder, never real names
//   - Logs use student_id_hash, never email or name
//
// ENCRYPTION: AES-256-GCM with per-field random IV
// ═══════════════════════════════════════════════════════════════════════

import crypto from "node:crypto";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

// ─── Encryption helpers ───

function getKey(keyHex) {
  return Buffer.from(keyHex, "hex");
}

export function encrypt(plaintext, keyHex) {
  const key = getKey(keyHex);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${tag}:${encrypted}`;
}

export function decrypt(blob, keyHex) {
  try {
    const [ivHex, tagHex, encrypted] = blob.split(":");
    const key = getKey(keyHex);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return null;
  }
}

export function hashValue(value, salt = "cc_pii_salt") {
  return crypto.createHash("sha256").update(`${salt}:${value}`).digest("hex");
}

export function hashEmail(email, keyHex) {
  const normalized = String(email || "").normalize("NFKC").trim().toLowerCase();
  return crypto.createHmac("sha256", getKey(keyHex)).update(normalized).digest("hex");
}

// ─── Initialize PII vault database (separate from operational DB) ───
export function initPIIVault(dataDir, encryptionKey, nodeEnv = "development") {
  const vaultPath = path.join(dataDir, "pii-vault.db");
  fs.mkdirSync(path.dirname(vaultPath), { recursive: true });

  const db = new Database(vaultPath, {
    verbose: nodeEnv === "development" ? console.log : undefined,
  });
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    -- Core PII storage
    CREATE TABLE IF NOT EXISTS students_pii (
      student_id TEXT PRIMARY KEY,
      email_hash TEXT UNIQUE NOT NULL,
      name_encrypted TEXT,
      email_encrypted TEXT,
      parent_email_encrypted TEXT,
      phone_encrypted TEXT,
      dob_encrypted TEXT,
      is_minor INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_pii_email_hash ON students_pii(email_hash);

    -- Consent records
    CREATE TABLE IF NOT EXISTS consent_records (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      consent_type TEXT NOT NULL,
      granted_at TEXT NOT NULL,
      granted_by TEXT,
      expires_at TEXT,
      revoked_at TEXT,
      revoked_by TEXT,
      scope TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_consent_student ON consent_records(student_id, consent_type);

    -- Document vault (short retention)
    CREATE TABLE IF NOT EXISTS document_vault (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      doc_type TEXT NOT NULL,
      doc_classification TEXT,
      content_encrypted TEXT NOT NULL,
      content_hash TEXT,
      retention_expires_at TEXT NOT NULL,
      auto_delete INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_doc_retention ON document_vault(retention_expires_at, auto_delete);
    CREATE INDEX IF NOT EXISTS idx_doc_student ON document_vault(student_id);

  `);

  return { db, vaultPath, encryptionKey };
}

// ─── Prepared statements for PII vault ───
export function preparePIIStatements(vault) {
  const { db } = vault;
  return {
    // Student PII
    upsertStudentPII: db.prepare(`
      INSERT INTO students_pii (student_id, email_hash, name_encrypted, email_encrypted, parent_email_encrypted, is_minor)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(student_id) DO UPDATE SET
        name_encrypted=excluded.name_encrypted,
        email_encrypted=excluded.email_encrypted,
        parent_email_encrypted=excluded.parent_email_encrypted,
        is_minor=excluded.is_minor,
        updated_at=datetime('now')
    `),

    getStudentPII: db.prepare(`SELECT * FROM students_pii WHERE student_id = ?`),
    getStudentByEmailHash: db.prepare(`SELECT * FROM students_pii WHERE email_hash = ?`),
    deleteStudentPII: db.prepare(`DELETE FROM students_pii WHERE student_id = ?`),

    // Consent
    insertConsent: db.prepare(`
      INSERT INTO consent_records (id, student_id, consent_type, granted_at, granted_by, expires_at, scope)
      VALUES (?,?,?,?,?,?,?)
    `),
    getActiveConsent: db.prepare(`
      SELECT * FROM consent_records
      WHERE student_id = ? AND consent_type = ? AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > datetime('now'))
      ORDER BY granted_at DESC LIMIT 1
    `),
    revokeConsent: db.prepare(`
      UPDATE consent_records SET revoked_at = datetime('now'), revoked_by = ? WHERE id = ?
    `),
    getAllConsent: db.prepare(`
      SELECT * FROM consent_records WHERE student_id = ? ORDER BY created_at DESC
    `),

    // Documents
    insertDocument: db.prepare(`
      INSERT INTO document_vault (id, student_id, doc_type, doc_classification, content_encrypted, content_hash, retention_expires_at, auto_delete)
      VALUES (?,?,?,?,?,?,?,?)
    `),
    getDocument: db.prepare(`SELECT * FROM document_vault WHERE id = ? AND student_id = ?`),
    deleteExpiredDocs: db.prepare(`
      DELETE FROM document_vault WHERE auto_delete = 1 AND datetime(retention_expires_at) < datetime('now')
    `),
    deleteStudentDocs: db.prepare(`DELETE FROM document_vault WHERE student_id = ?`),
  };
}

// ─── Store student PII ───
export function storeStudentPII(stmts, vault, studentId, data) {
  const { encryptionKey } = vault;
  const emailHash = data.emailHash || hashEmail(data.email, encryptionKey);
  const normalizedEmail = data.email
    ? String(data.email).normalize("NFKC").trim().toLowerCase()
    : null;

  stmts.upsertStudentPII.run(
    studentId,
    emailHash,
    data.name ? encrypt(data.name, encryptionKey) : null,
    normalizedEmail ? encrypt(normalizedEmail, encryptionKey) : null,
    data.parentEmail ? encrypt(data.parentEmail.toLowerCase().trim(), encryptionKey) : null,
    data.isMinor !== false ? 1 : 0,
  );

  return { studentId, emailHash, stored: true };
}

// ─── Retrieve student PII (only for authorized operations) ───
export function retrieveStudentPII(stmts, vault, studentId) {
  const row = stmts.getStudentPII.get(studentId);
  if (!row) return null;

  return {
    studentId: row.student_id,
    emailHash: row.email_hash,
    name: row.name_encrypted ? decrypt(row.name_encrypted, vault.encryptionKey) : null,
    email: row.email_encrypted ? decrypt(row.email_encrypted, vault.encryptionKey) : null,
    parentEmail: row.parent_email_encrypted ? decrypt(row.parent_email_encrypted, vault.encryptionKey) : null,
    isMinor: row.is_minor === 1,
    createdAt: row.created_at,
  };
}

// ─── Store a document with short retention ───
export function storeDocument(stmts, vault, studentId, docType, content, options = {}) {
  const id = crypto.randomUUID();
  const { encryptionKey } = vault;
  const retentionHours = options.retentionHours || 72;
  const expiresAt = new Date(Date.now() + retentionHours * 60 * 60 * 1000).toISOString();

  // Classify document for sensitive handling
  const classification = classifyDocument(docType, content);

  stmts.insertDocument.run(
    id,
    studentId,
    docType,
    classification,
    encrypt(content, encryptionKey),
    hashValue(content, "doc_content_salt"),
    expiresAt,
    options.autoDelete !== false ? 1 : 0,
  );

  return { id, docType, classification, expiresAt, autoDelete: true };
}

// ─── Delete all student PII (right to erasure) ───
export function deleteAllStudentPII(stmts, studentId) {
  stmts.deleteStudentPII.run(studentId);
  stmts.deleteStudentDocs.run(studentId);
  return { deleted: true, studentId };
}

// ─── Clean expired documents ───
export function cleanExpiredDocuments(stmts) {
  const result = stmts.deleteExpiredDocs.run();
  return { cleaned: result.changes };
}

// ─── Document classification ───
function classifyDocument(docType, content) {
  const text = (content || "").toLowerCase();

  if (docType === "sar" || docType === "fafsa_summary" ||
      /student\s*aid\s*report|submission\s*summary|fafsa/i.test(text)) {
    return "SENSITIVE_FINANCIAL";
  }
  if (docType === "tax" || /w-2|1040|tax\s*return|irs/i.test(text)) {
    return "SENSITIVE_FINANCIAL";
  }
  if (docType === "aid_letter" || /financial\s*aid\s*award|aid\s*offer|grant\s*award/i.test(text)) {
    return "SENSITIVE_FINANCIAL";
  }
  if (docType === "transcript" || /transcript|grade\s*report|report\s*card/i.test(text)) {
    return "EDUCATION_RECORD";
  }
  if (docType === "recommendation" || /letter\s*of\s*recommendation|recommender/i.test(text)) {
    return "EDUCATION_RECORD";
  }

  return "GENERAL";
}

// ─── Generate hashed user ID for sending to model providers ───
export function hashStudentIdForProvider(studentId, salt = "anthropic_provider_salt") {
  return crypto.createHash("sha256").update(`${salt}:${studentId}`).digest("hex");
}

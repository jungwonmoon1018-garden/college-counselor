// Tests for pii-vault.js
// Covers: encrypt/decrypt, hashValue, student PII CRUD, document vault,
// expiry cleanup, right-to-erasure, BYOK minor guard, document classification.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import {
  encrypt,
  decrypt,
  hashValue,
  initPIIVault,
  preparePIIStatements,
  storeStudentPII,
  retrieveStudentPII,
  storeDocument,
  cleanExpiredDocuments,
  deleteAllStudentPII,
  lookupStudentBYOK,
  isBYOKAllowed,
  hashStudentIdForProvider,
} from "../pii-vault.js";

// ─── Helpers ───

function tempVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pii-test-"));
  const key = crypto.randomBytes(32).toString("hex");
  const vault = initPIIVault(dir, key, "test");
  const stmts = preparePIIStatements(vault);
  return { vault, stmts, dir };
}

// ─── Crypto primitives ───

test("encrypt produces iv:tag:ciphertext format", () => {
  const key = crypto.randomBytes(32).toString("hex");
  const blob = encrypt("hello world", key);
  const parts = blob.split(":");
  assert.equal(parts.length, 3);
  assert.ok(parts[0].length === 32, "iv should be 16 bytes hex = 32 chars");
  assert.ok(parts[1].length === 32, "tag should be 16 bytes hex = 32 chars");
  assert.ok(parts[2].length > 0, "ciphertext must not be empty");
});

test("decrypt roundtrips plaintext correctly", () => {
  const key = crypto.randomBytes(32).toString("hex");
  const original = "sensitive student data 🔒";
  const blob = encrypt(original, key);
  const result = decrypt(blob, key);
  assert.equal(result, original);
});

test("decrypt returns null on tampered ciphertext", () => {
  const key = crypto.randomBytes(32).toString("hex");
  const blob = encrypt("data", key);
  const tampered = blob.slice(0, -4) + "0000";
  assert.equal(decrypt(tampered, key), null);
});

test("decrypt returns null on wrong key", () => {
  const key1 = crypto.randomBytes(32).toString("hex");
  const key2 = crypto.randomBytes(32).toString("hex");
  const blob = encrypt("private", key1);
  assert.equal(decrypt(blob, key2), null);
});

test("encrypt produces different ciphertext each call (random IV)", () => {
  const key = crypto.randomBytes(32).toString("hex");
  const a = encrypt("same input", key);
  const b = encrypt("same input", key);
  assert.notEqual(a, b);
});

test("hashValue is deterministic with same salt", () => {
  const h1 = hashValue("test@example.com", "salt");
  const h2 = hashValue("test@example.com", "salt");
  assert.equal(h1, h2);
});

test("hashValue differs for different inputs", () => {
  const h1 = hashValue("a@b.com", "salt");
  const h2 = hashValue("c@d.com", "salt");
  assert.notEqual(h1, h2);
});

test("hashValue differs for different salts", () => {
  const h1 = hashValue("same", "salt1");
  const h2 = hashValue("same", "salt2");
  assert.notEqual(h1, h2);
});

// ─── initPIIVault ───

test("initPIIVault creates a vault db file and returns vault object", () => {
  const { vault, dir } = tempVault();
  assert.ok(fs.existsSync(vault.vaultPath));
  assert.ok(vault.encryptionKey.length === 64); // 32 bytes hex
  vault.db.close();
  fs.rmSync(dir, { recursive: true });
});

test("initPIIVault creates all required tables", () => {
  const { vault, dir } = tempVault();
  const tables = vault.db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
    .all()
    .map((r) => r.name);
  assert.ok(tables.includes("students_pii"));
  assert.ok(tables.includes("consent_records"));
  assert.ok(tables.includes("document_vault"));
  assert.ok(tables.includes("student_api_keys"));
  vault.db.close();
  fs.rmSync(dir, { recursive: true });
});

// ─── Student PII CRUD ───

test("storeStudentPII and retrieveStudentPII roundtrip", () => {
  const { vault, stmts, dir } = tempVault();
  const studentId = crypto.randomUUID();

  storeStudentPII(stmts, vault, studentId, {
    name: "Jane Doe",
    email: "jane@example.com",
    parentEmail: "parent@example.com",
    isMinor: true,
  });

  const pii = retrieveStudentPII(stmts, vault, studentId);
  assert.equal(pii.name, "Jane Doe");
  assert.equal(pii.email, "jane@example.com");
  assert.equal(pii.parentEmail, "parent@example.com");
  assert.equal(pii.isMinor, true);
  assert.equal(pii.studentId, studentId);

  vault.db.close();
  fs.rmSync(dir, { recursive: true });
});

test("retrieveStudentPII returns null for unknown student", () => {
  const { vault, stmts, dir } = tempVault();
  const result = retrieveStudentPII(stmts, vault, "nonexistent-id");
  assert.equal(result, null);
  vault.db.close();
  fs.rmSync(dir, { recursive: true });
});

test("storeStudentPII upserts on re-store", () => {
  const { vault, stmts, dir } = tempVault();
  const studentId = crypto.randomUUID();

  storeStudentPII(stmts, vault, studentId, { name: "Old Name", email: "old@example.com" });
  storeStudentPII(stmts, vault, studentId, { name: "New Name", email: "new@example.com" });

  const pii = retrieveStudentPII(stmts, vault, studentId);
  assert.equal(pii.name, "New Name");
  assert.equal(pii.email, "new@example.com");

  vault.db.close();
  fs.rmSync(dir, { recursive: true });
});

test("email is stored lowercase+trimmed", () => {
  const { vault, stmts, dir } = tempVault();
  const studentId = crypto.randomUUID();

  storeStudentPII(stmts, vault, studentId, { email: "  UPPER@Example.COM  " });
  const pii = retrieveStudentPII(stmts, vault, studentId);
  assert.equal(pii.email, "upper@example.com");

  vault.db.close();
  fs.rmSync(dir, { recursive: true });
});

test("email hash is deterministic and used for lookup index", () => {
  const { vault, stmts, dir } = tempVault();
  const studentId = crypto.randomUUID();
  const email = "lookup@example.com";

  storeStudentPII(stmts, vault, studentId, { email });
  const row = stmts.getStudentByEmailHash.get(hashValue(email, "email_salt_cc"));
  assert.ok(row);
  assert.equal(row.student_id, studentId);

  vault.db.close();
  fs.rmSync(dir, { recursive: true });
});

// ─── Document vault ───

test("storeDocument stores and retrieves an encrypted document", () => {
  const { vault, stmts, dir } = tempVault();
  const studentId = crypto.randomUUID();
  const content = "EFC: $12,400\nStudent Aid Report for Jane Doe";

  const result = storeDocument(stmts, vault, studentId, "sar", content);
  assert.ok(result.id);
  assert.equal(result.docType, "sar");
  assert.equal(result.classification, "SENSITIVE_FINANCIAL");
  assert.ok(result.expiresAt);

  const row = stmts.getDocument.get(result.id, studentId);
  assert.ok(row);
  const decrypted = decrypt(row.content_encrypted, vault.encryptionKey);
  assert.equal(decrypted, content);

  vault.db.close();
  fs.rmSync(dir, { recursive: true });
});

test("storeDocument classifies transcript as EDUCATION_RECORD", () => {
  const { vault, stmts, dir } = tempVault();
  const studentId = crypto.randomUUID();
  const result = storeDocument(stmts, vault, studentId, "transcript", "Official Transcript — Grade Report");
  assert.equal(result.classification, "EDUCATION_RECORD");
  vault.db.close();
  fs.rmSync(dir, { recursive: true });
});

test("storeDocument classifies unknown doc as GENERAL", () => {
  const { vault, stmts, dir } = tempVault();
  const studentId = crypto.randomUUID();
  const result = storeDocument(stmts, vault, studentId, "personal_essay", "My story begins...");
  assert.equal(result.classification, "GENERAL");
  vault.db.close();
  fs.rmSync(dir, { recursive: true });
});

test("storeDocument default retention is 72 hours", () => {
  const { vault, stmts, dir } = tempVault();
  const studentId = crypto.randomUUID();
  const before = Date.now();
  const result = storeDocument(stmts, vault, studentId, "doc", "content");
  const after = Date.now();

  const expiry = new Date(result.expiresAt).getTime();
  const expectedLow = before + 72 * 60 * 60 * 1000;
  const expectedHigh = after + 72 * 60 * 60 * 1000;
  assert.ok(expiry >= expectedLow && expiry <= expectedHigh);

  vault.db.close();
  fs.rmSync(dir, { recursive: true });
});

test("storeDocument respects custom retentionHours", () => {
  const { vault, stmts, dir } = tempVault();
  const studentId = crypto.randomUUID();
  const before = Date.now();
  const result = storeDocument(stmts, vault, studentId, "doc", "content", { retentionHours: 1 });
  const after = Date.now();

  const expiry = new Date(result.expiresAt).getTime();
  const expectedLow = before + 1 * 60 * 60 * 1000;
  const expectedHigh = after + 1 * 60 * 60 * 1000;
  assert.ok(expiry >= expectedLow && expiry <= expectedHigh);

  vault.db.close();
  fs.rmSync(dir, { recursive: true });
});

test("getDocument requires matching student_id (isolation)", () => {
  const { vault, stmts, dir } = tempVault();
  const student1 = crypto.randomUUID();
  const student2 = crypto.randomUUID();

  const { id } = storeDocument(stmts, vault, student1, "doc", "secret");
  const row = stmts.getDocument.get(id, student2);
  assert.equal(row, undefined);

  vault.db.close();
  fs.rmSync(dir, { recursive: true });
});

// ─── Expiry / cleanup ───

test("cleanExpiredDocuments removes expired docs, keeps valid ones", () => {
  const { vault, stmts, dir } = tempVault();
  const studentId = crypto.randomUUID();

  // Insert an already-expired doc directly
  const expiredId = crypto.randomUUID();
  const pastDate = new Date(Date.now() - 1000).toISOString();
  stmts.insertDocument.run(expiredId, studentId, "doc", "GENERAL",
    encrypt("expired", vault.encryptionKey), hashValue("expired"), pastDate, 1);

  // Insert a valid doc via storeDocument (72h ahead)
  const valid = storeDocument(stmts, vault, studentId, "doc", "still valid");

  const { cleaned } = cleanExpiredDocuments(stmts);
  assert.equal(cleaned, 1);

  // Valid doc still present
  const row = stmts.getDocument.get(valid.id, studentId);
  assert.ok(row);

  vault.db.close();
  fs.rmSync(dir, { recursive: true });
});

test("cleanExpiredDocuments returns 0 when nothing expired", () => {
  const { vault, stmts, dir } = tempVault();
  const { cleaned } = cleanExpiredDocuments(stmts);
  assert.equal(cleaned, 0);
  vault.db.close();
  fs.rmSync(dir, { recursive: true });
});

// ─── Right to erasure ───

test("deleteAllStudentPII removes PII and documents for student", () => {
  const { vault, stmts, dir } = tempVault();
  const studentId = crypto.randomUUID();

  storeStudentPII(stmts, vault, studentId, { name: "Delete Me", email: "gone@example.com" });
  storeDocument(stmts, vault, studentId, "sar", "content");

  deleteAllStudentPII(stmts, studentId);

  assert.equal(retrieveStudentPII(stmts, vault, studentId), null);
  const docs = vault.db
    .prepare("SELECT COUNT(*) as n FROM document_vault WHERE student_id=?")
    .get(studentId);
  assert.equal(docs.n, 0);

  vault.db.close();
  fs.rmSync(dir, { recursive: true });
});

// ─── BYOK minor guard ───

test("isBYOKAllowed returns false for unknown student", () => {
  const { vault, stmts, dir } = tempVault();
  const result = isBYOKAllowed(stmts, "ghost");
  assert.equal(result.allowed, false);
  vault.db.close();
  fs.rmSync(dir, { recursive: true });
});

test("isBYOKAllowed returns false for minor", () => {
  const { vault, stmts, dir } = tempVault();
  const studentId = crypto.randomUUID();
  storeStudentPII(stmts, vault, studentId, { email: "minor@example.com", isMinor: true });

  const result = isBYOKAllowed(stmts, studentId);
  assert.equal(result.allowed, false);
  assert.equal(result.byokBlocked, true);
  assert.ok(typeof result.reason === "string" && result.reason.length > 0);

  vault.db.close();
  fs.rmSync(dir, { recursive: true });
});

test("isBYOKAllowed returns true for adult", () => {
  const { vault, stmts, dir } = tempVault();
  const studentId = crypto.randomUUID();
  storeStudentPII(stmts, vault, studentId, { email: "adult@example.com", isMinor: false });

  const result = isBYOKAllowed(stmts, studentId);
  assert.equal(result.allowed, true);

  vault.db.close();
  fs.rmSync(dir, { recursive: true });
});

// ─── lookupStudentBYOK ───

test("lookupStudentBYOK returns null when no key stored", () => {
  const { vault, stmts, dir } = tempVault();
  const result = lookupStudentBYOK(stmts, vault, "no-key-student");
  assert.equal(result, null);
  vault.db.close();
  fs.rmSync(dir, { recursive: true });
});

test("lookupStudentBYOK decrypts and returns stored api key", () => {
  const { vault, stmts, dir } = tempVault();
  const studentId = crypto.randomUUID();
  const apiKey = "sk-ant-real-key-12345";

  stmts.upsertApiKey.run(
    studentId,
    encrypt(apiKey, vault.encryptionKey),
    "sk-ant-...2345",
    "anthropic",
    null,
    "claude-haiku-4-5-20251001",
    "claude-sonnet-4-6",
    "claude-opus-4-7",
  );

  const result = lookupStudentBYOK(stmts, vault, studentId);
  assert.ok(result);
  assert.equal(result.apiKey, apiKey);
  assert.equal(result.provider, "anthropic");
  assert.equal(result.models.small, "claude-haiku-4-5-20251001");
  assert.equal(result.models.large, "claude-opus-4-7");

  vault.db.close();
  fs.rmSync(dir, { recursive: true });
});

// ─── hashStudentIdForProvider ───

test("hashStudentIdForProvider is deterministic", () => {
  const h1 = hashStudentIdForProvider("student-abc", "salt");
  const h2 = hashStudentIdForProvider("student-abc", "salt");
  assert.equal(h1, h2);
  assert.equal(h1.length, 64); // sha256 hex
});

test("hashStudentIdForProvider differs for different students", () => {
  const h1 = hashStudentIdForProvider("student-1", "salt");
  const h2 = hashStudentIdForProvider("student-2", "salt");
  assert.notEqual(h1, h2);
});

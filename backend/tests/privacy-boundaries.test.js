import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import {
  CONSENT_TYPES,
  grantConsent,
  validateRequiredConsents,
} from "../consent.js";
import {
  ensureStudentStorage,
  getLegacyNotebookPath,
  getStudentKnowledgeGraphPath,
  hasLegacyNotebook,
  removeStudentStorage,
} from "../student-storage.js";
import {
  deleteLegacyNotebook,
  exportLegacyNotebook,
} from "../legacy-notebook-export.js";

test("college value scoring has no legacy network extraction path", () => {
  const source = fs.readFileSync(new URL("../college-values.js", import.meta.url), "utf8");
  const forbidden = [
    "extractCollegeValues",
    "callLLM",
    "wantsWeb",
    "web_search",
    "web_fetch",
    "BYOK",
  ];
  for (const token of forbidden) {
    assert.equal(source.includes(token), false, `college-values.js must not contain ${token}`);
  }
});

test("consent rejects obsolete or caller-invented types and grantors", () => {
  const inserted = [];
  const stmts = {
    insertConsent: { run: (...args) => inserted.push(args) },
    getActiveConsent: {
      get: (_studentId, type) => type === CONSENT_TYPES.DATA_PROCESSING ? { id: "ok" } : null,
    },
  };
  grantConsent(stmts, "student-1", CONSENT_TYPES.DATA_PROCESSING);
  assert.equal(inserted.length, 1);
  assert.throws(() => grantConsent(stmts, "student-1", "logseq_vault"), /Unsupported/);
  assert.throws(
    () => grantConsent(stmts, "student-1", CONSENT_TYPES.DATA_PROCESSING, { grantedBy: "admin" }),
    /Unsupported/,
  );
  const result = validateRequiredConsents(stmts, "student-1", "ai_interaction");
  assert.equal(result.allowed, false);
  assert.deepEqual(result.missing.sort(), ["ai_interaction", "cross_border_transfer"]);
});

test("student storage no longer creates a plaintext notebook", async () => {
  const dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cc-storage-"));
  try {
    ensureStudentStorage("student-1", dataDir);
    assert.equal(fs.existsSync(getStudentKnowledgeGraphPath("student-1", dataDir)), true);
    assert.equal(hasLegacyNotebook("student-1", dataDir), false);
    await removeStudentStorage("student-1", dataDir);
    assert.equal(fs.existsSync(getStudentKnowledgeGraphPath("student-1", dataDir)), false);
  } finally {
    await fs.promises.rm(dataDir, { recursive: true, force: true });
  }
});

test("legacy export contains Markdown only and requires separate deletion", async () => {
  const dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cc-legacy-"));
  try {
    const legacy = getLegacyNotebookPath("student-1", dataDir);
    await fs.promises.mkdir(path.join(legacy, "pages"), { recursive: true });
    await fs.promises.writeFile(path.join(legacy, "pages", "notes.md"), "# Notes", "utf8");
    await fs.promises.writeFile(path.join(legacy, "token.txt"), "must-not-export", "utf8");

    const chunks = [];
    const stream = new PassThrough();
    stream.on("data", (chunk) => chunks.push(chunk));
    const result = await exportLegacyNotebook("student-1", dataDir, stream);
    const zip = Buffer.concat(chunks);
    assert.equal(result.markdownFiles, 1);
    assert.equal(zip.subarray(0, 2).toString("ascii"), "PK");
    assert.match(zip.toString("latin1"), /pages\/notes\.md/);
    assert.doesNotMatch(zip.toString("latin1"), /token\.txt/);
    assert.equal(hasLegacyNotebook("student-1", dataDir), true);

    await deleteLegacyNotebook("student-1", dataDir);
    assert.equal(hasLegacyNotebook("student-1", dataDir), false);
  } finally {
    await fs.promises.rm(dataDir, { recursive: true, force: true });
  }
});

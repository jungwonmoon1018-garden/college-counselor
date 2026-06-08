#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
// upload-attachment.js — upload a supporting file for an EC
// ═══════════════════════════════════════════════════════════════════════
// Thin wrapper around POST /api/ec/upload. Usage:
//
//   COLLEGEAPP_BACKEND_URL=http://localhost:3001 \
//   COLLEGEAPP_SESSION_TOKEN=...jwt... \
//   node scripts/upload-attachment.js /path/to/file.pdf "EC name here"
//
// The backend extracts text (via file-extractors.js: PDF / DOCX / image
// OCR with tesseract.js / plain text), hashes the content, and links it
// to the named EC. The next /api/ec/strength/recompute call will ingest
// the new evidence.
// ═══════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";

const BACKEND = process.env.COLLEGEAPP_BACKEND_URL || "http://localhost:3001";
const TOKEN = process.env.COLLEGEAPP_SESSION_TOKEN || "";

function usage() {
  console.error("usage: node upload-attachment.js <file-path> <ec-name>");
  process.exit(2);
}

const [, , filePath, ...ecNameParts] = process.argv;
if (!filePath || ecNameParts.length === 0) usage();
const ecName = ecNameParts.join(" ").trim();

if (!TOKEN) {
  console.error("error: COLLEGEAPP_SESSION_TOKEN env var is required");
  process.exit(2);
}

if (!fs.existsSync(filePath)) {
  console.error(`error: file not found: ${filePath}`);
  process.exit(2);
}

async function main() {
  const buf = await fs.promises.readFile(filePath);
  const blob = new Blob([buf]);
  const form = new FormData();
  form.append("file", blob, path.basename(filePath));
  form.append("ec_name", ecName);

  const url = `${BACKEND.replace(/\/$/, "")}/api/ec/upload`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${TOKEN}` },
    body: form,
  });

  const text = await resp.text();
  if (!resp.ok) {
    console.error(`error: HTTP ${resp.status}\n${text}`);
    process.exit(resp.status === 401 || resp.status === 403 ? 3 : 1);
  }

  try {
    process.stdout.write(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    process.stdout.write(text);
  }
  process.stdout.write("\n");
}

main().catch((err) => {
  console.error(`error: ${err?.message || err}`);
  process.exit(1);
});

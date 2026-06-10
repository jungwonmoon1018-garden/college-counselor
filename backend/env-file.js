// ═══════════════════════════════════════════════════════════════════════
// env-file.js — safe, shared helpers for reading/writing the backend .env.
//
// Used by BOTH the operator CLI (scripts/setup-secrets.mjs) and the guarded
// runtime setup endpoint (server.js). Centralizes the safety-critical bits:
//   • atomic write (temp file + rename) so an interrupted write can never
//     truncate .env and orphan the ENCRYPTION_KEY (→ permanent PII loss),
//   • a timestamped backup of any existing .env before each write,
//   • line-preserving edits (comments + ordering kept intact),
//   • restrictive file permissions.
// ═══════════════════════════════════════════════════════════════════════

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const HEX64 = /^[0-9a-fA-F]{64}$/;
export const PLACEHOLDER = /^REPLACE_WITH/i;

export function genHex32() {
  return crypto.randomBytes(32).toString("hex");
}

export function readEnvLines(envPath, examplePath) {
  if (fs.existsSync(envPath)) return fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  if (examplePath && fs.existsSync(examplePath)) {
    return fs.readFileSync(examplePath, "utf8").split(/\r?\n/);
  }
  return [];
}

export function getValue(lines, key) {
  const re = new RegExp(`^\\s*${key}\\s*=(.*)$`);
  for (const line of lines) {
    const m = line.match(re);
    if (m) return m[1].trim();
  }
  return undefined;
}

export function setValue(lines, key, value) {
  const re = new RegExp(`^\\s*${key}\\s*=.*$`);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) { lines[i] = `${key}=${value}`; return lines; }
  }
  if (lines.length && lines[lines.length - 1] !== "") lines.push("");
  lines.push(`${key}=${value}`);
  return lines;
}

/// Write .env atomically with a one-shot backup of the prior file.
/// Returns the backup path (or null if there was no prior file).
export function writeEnvAtomic(envPath, lines) {
  let out = lines.join("\n");
  if (!out.endsWith("\n")) out += "\n";

  let backupPath = null;
  if (fs.existsSync(envPath)) {
    // Stable-ish suffix without Date.now() coupling: use file mtime + a short
    // random tag so repeated writes don't clobber a single backup.
    const tag = crypto.randomBytes(3).toString("hex");
    backupPath = `${envPath}.bak-${tag}`;
    fs.copyFileSync(envPath, backupPath);
  }

  const tmpPath = `${envPath}.tmp-${crypto.randomBytes(4).toString("hex")}`;
  fs.writeFileSync(tmpPath, out, { mode: 0o600 });
  fs.renameSync(tmpPath, envPath); // atomic on the same filesystem
  try { fs.chmodSync(envPath, 0o600); } catch { /* no-op on Windows/NTFS */ }
  return backupPath;
}

/// Resolve the encryption-key value to persist on first-run setup WITHOUT
/// orphaning data: if a valid dev key already exists on disk, promote it
/// (keeps any already-encrypted dev data decryptable after restart);
/// otherwise generate a fresh one.
export function resolveFirstRunEncryptionKey(devKeyPath) {
  try {
    if (devKeyPath && fs.existsSync(devKeyPath)) {
      const existing = fs.readFileSync(devKeyPath, "utf8").trim();
      if (HEX64.test(existing)) return { key: existing, promotedDevKey: true };
    }
  } catch { /* fall through to generate */ }
  return { key: genHex32(), promotedDevKey: false };
}

export function defaultPaths(backendDir) {
  return {
    envPath: path.join(backendDir, ".env"),
    examplePath: path.join(backendDir, ".env.example"),
    devKeyPath: path.join(backendDir, ".dev-encryption-key"),
  };
}

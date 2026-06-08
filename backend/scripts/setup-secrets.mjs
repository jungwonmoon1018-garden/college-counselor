#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
// setup-secrets.mjs — operator setup "UI" for backend deployment secrets.
//
// These are SERVER-SIDE secrets, never collected from the student app:
//   • ENCRYPTION_KEY      — AES-256-GCM master key for the PII vault. Protects
//                           EVERY student's PII + their encrypted BYOK key.
//   • JWT_SECRET          — signs session tokens.
//   • SCORECARD_API_KEY   — the federal College Scorecard / IPEDS data API
//                           (https://api.data.gov). Enables live college data;
//                           without it the backend runs in offline baseline mode.
//
// Run from the backend directory:
//   node scripts/setup-secrets.mjs                # interactive
//   node scripts/setup-secrets.mjs --scorecard=KEY --yes   # non-interactive
//
// SAFETY: an existing, valid ENCRYPTION_KEY is NEVER overwritten unless you
// pass --force-encryption AND type the confirmation. Rotating it makes all
// previously-stored PII permanently undecryptable.
// ═══════════════════════════════════════════════════════════════════════

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.join(__dirname, "..");
const ENV_PATH = path.join(BACKEND_DIR, ".env");
const EXAMPLE_PATH = path.join(BACKEND_DIR, ".env.example");

const HEX64 = /^[0-9a-fA-F]{64}$/;
const PLACEHOLDER = /^REPLACE_WITH/i;

// ─── CLI args ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--") && !a.includes("=")));
const opts = Object.fromEntries(
  args.filter((a) => a.includes("=")).map((a) => {
    const [k, ...rest] = a.replace(/^--/, "").split("=");
    return [k, rest.join("=")];
  })
);
const NON_INTERACTIVE = flags.has("--yes") || flags.has("--non-interactive");
const FORCE_ENCRYPTION = flags.has("--force-encryption");

// ─── .env line helpers (preserve comments + ordering) ────────────────────
function readEnvLines() {
  if (fs.existsSync(ENV_PATH)) return fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/);
  if (fs.existsSync(EXAMPLE_PATH)) {
    console.log("• No .env found — starting from .env.example");
    return fs.readFileSync(EXAMPLE_PATH, "utf8").split(/\r?\n/);
  }
  console.log("• No .env or .env.example found — creating a fresh .env");
  return [];
}

function getValue(lines, key) {
  const re = new RegExp(`^\\s*${key}\\s*=(.*)$`);
  for (const line of lines) {
    const m = line.match(re);
    if (m) return m[1].trim();
  }
  return undefined;
}

function setValue(lines, key, value) {
  const re = new RegExp(`^\\s*${key}\\s*=.*$`);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) { lines[i] = `${key}=${value}`; return lines; }
  }
  // Not present — append (keep file tidy with a trailing entry).
  if (lines.length && lines[lines.length - 1] !== "") lines.push("");
  lines.push(`${key}=${value}`);
  return lines;
}

function genHex32() { return crypto.randomBytes(32).toString("hex"); }

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, (a) => resolve(a.trim())));
}

// ─── Main ────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n=== College Counselor — backend secrets setup ===\n");
  const lines = readEnvLines();
  const rl = NON_INTERACTIVE ? null : readline.createInterface({ input: process.stdin, output: process.stdout });
  const summary = [];

  // 1) ENCRYPTION_KEY — generate only if missing/placeholder/invalid.
  const curEnc = getValue(lines, "ENCRYPTION_KEY");
  const encValid = curEnc && HEX64.test(curEnc);
  if (encValid && !FORCE_ENCRYPTION) {
    summary.push("ENCRYPTION_KEY: already set — kept (rotating it would orphan existing PII).");
  } else if (encValid && FORCE_ENCRYPTION) {
    let proceed = NON_INTERACTIVE;
    if (!proceed) {
      console.log("\n⚠️  ENCRYPTION_KEY already exists. Rotating it makes ALL previously");
      console.log("    stored PII (names, emails, encrypted BYOK keys) PERMANENTLY undecryptable.");
      const a = await ask(rl, '    Type "ROTATE" to confirm, anything else to keep: ');
      proceed = a === "ROTATE";
    }
    if (proceed) { setValue(lines, "ENCRYPTION_KEY", genHex32()); summary.push("ENCRYPTION_KEY: ROTATED (old PII now undecryptable)."); }
    else summary.push("ENCRYPTION_KEY: kept (rotation cancelled).");
  } else {
    setValue(lines, "ENCRYPTION_KEY", genHex32());
    summary.push("ENCRYPTION_KEY: generated (64 hex chars).");
  }

  // 2) JWT_SECRET — generate if missing/placeholder.
  const curJwt = getValue(lines, "JWT_SECRET");
  if (!curJwt || PLACEHOLDER.test(curJwt) || curJwt.length < 32) {
    setValue(lines, "JWT_SECRET", genHex32());
    summary.push("JWT_SECRET: generated.");
  } else {
    summary.push("JWT_SECRET: already set — kept.");
  }

  // 3) SCORECARD_API_KEY — the IPEDS / College Scorecard data API.
  let scorecard = opts.scorecard ?? process.env.SCORECARD_API_KEY;
  const curScore = getValue(lines, "SCORECARD_API_KEY");
  const curScoreValid = curScore && !PLACEHOLDER.test(curScore);
  if (!scorecard && !NON_INTERACTIVE) {
    console.log("\nCollege Scorecard / IPEDS data API key (free: https://api.data.gov/signup/).");
    console.log(curScoreValid ? "  A key is already configured." : "  Leave blank to run in OFFLINE baseline mode.");
    const a = await ask(rl, curScoreValid ? "  New key (blank = keep current): " : "  Paste key (blank = offline): ");
    if (a) scorecard = a;
  }
  if (scorecard) {
    setValue(lines, "SCORECARD_API_KEY", scorecard.trim());
    summary.push("SCORECARD_API_KEY: set — live college data enabled.");
  } else if (curScoreValid) {
    summary.push("SCORECARD_API_KEY: already set — kept.");
  } else {
    summary.push("SCORECARD_API_KEY: not set — backend runs in OFFLINE baseline mode.");
  }

  rl?.close();

  // Write atomically with 0600 perms (secrets file).
  let out = lines.join("\n");
  if (!out.endsWith("\n")) out += "\n";
  fs.writeFileSync(ENV_PATH, out, { mode: 0o600 });
  try { fs.chmodSync(ENV_PATH, 0o600); } catch { /* non-fatal on some FS */ }

  console.log(`\n✓ Wrote ${path.relative(process.cwd(), ENV_PATH)} (permissions 600)\n`);
  for (const s of summary) console.log("  • " + s);
  console.log("\nNext: start the backend with `npm start` and confirm the boot banner shows");
  console.log("      'Scorecard: LIVE' (or OFFLINE) and no ENCRYPTION_KEY fatal.\n");
}

main().catch((err) => { console.error("Setup failed:", err.message); process.exit(1); });

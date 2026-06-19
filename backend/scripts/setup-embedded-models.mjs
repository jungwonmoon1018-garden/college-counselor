#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
// SETUP-EMBEDDED-MODELS — download default GGUF + warm Xenova cache
// ═══════════════════════════════════════════════════════════════════════
// Runs as part of `npm install` (postinstall) and on demand. Idempotent.
// Skippable via SKIP_EMBEDDED_MODELS=1 for CI / offline installs.
//
// Default model: Qwen2.5-1.5B-Instruct-Q4_K_M.gguf (~1 GB) from the
// bartowski GGUF mirror on Hugging Face. Other GGUFs can be substituted
// by setting EMBEDDED_MODEL_URL + EMBEDDED_MODEL_FILE in env.
// ═══════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(MODULE_DIR, "..");
const MODELS_DIR = path.join(BACKEND_ROOT, "models");

const DEFAULT_MODEL_FILE = "qwen2.5-1.5b-instruct.q4_k_m.gguf";
const DEFAULT_MODEL_URL =
  "https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf";

const MODEL_FILE = (process.env.EMBEDDED_MODEL_FILE || DEFAULT_MODEL_FILE).toLowerCase();
const MODEL_URL = process.env.EMBEDDED_MODEL_URL || DEFAULT_MODEL_URL;

function log(...args) {
  console.log("[setup-embedded-models]", ...args);
}

function fmtMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

async function ensureDir(p) {
  await fs.promises.mkdir(p, { recursive: true });
}

async function downloadIfMissing() {
  const dest = path.join(MODELS_DIR, MODEL_FILE);
  if (fs.existsSync(dest)) {
    const stat = await fs.promises.stat(dest);
    if (stat.size > 100 * 1024 * 1024) {
      log(`✓ Model already present at ${dest} (${fmtMB(stat.size)})`);
      return { downloaded: false, path: dest };
    }
    log(`Existing model file at ${dest} looks truncated (${fmtMB(stat.size)}) — re-downloading.`);
    await fs.promises.unlink(dest);
  }

  await ensureDir(MODELS_DIR);
  log(`Downloading ${MODEL_URL}`);
  log(`→ ${dest}`);

  const res = await fetch(MODEL_URL, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }
  const total = Number(res.headers.get("content-length") || 0);
  if (total) log(`Total size: ${fmtMB(total)}`);

  const tmp = `${dest}.partial`;
  const fileStream = fs.createWriteStream(tmp);

  let pulled = 0;
  let lastReport = 0;
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    pulled += value.length;
    fileStream.write(Buffer.from(value));
    if (total && pulled - lastReport > 50 * 1024 * 1024) {
      lastReport = pulled;
      log(`… ${fmtMB(pulled)} / ${fmtMB(total)} (${((pulled / total) * 100).toFixed(0)}%)`);
    }
  }
  await new Promise((resolve, reject) => {
    fileStream.end((err) => (err ? reject(err) : resolve()));
  });

  await fs.promises.rename(tmp, dest);
  log(`✓ Downloaded ${fmtMB(pulled)} → ${dest}`);
  return { downloaded: true, path: dest };
}

async function warmXenovaCache() {
  if (process.env.SKIP_XENOVA_WARM === "1") {
    log("Skipping Xenova warm-cache (SKIP_XENOVA_WARM=1).");
    return;
  }
  try {
    // Dynamic import so the script still runs the GGUF download even if
    // @xenova/transformers is not yet installed.
    const { embed } = await import("../llm-adapters/embedded-embeddings.js");
    log("Warming Xenova bge-small-en-v1.5 cache (one-time, ~30 MB download)...");
    const vec = await embed("warm-up embedding sentence for the bge-small model");
    log(`✓ Embeddings ready (dim=${vec.length}).`);
  } catch (err) {
    log(`! Skipped Xenova warm: ${err.message}`);
    log("  Embeddings will lazy-load on first request.");
  }
}

async function main() {
  if (process.env.SKIP_EMBEDDED_MODELS === "1") {
    log("SKIP_EMBEDDED_MODELS=1 set — skipping all embedded model setup.");
    return;
  }
  await downloadIfMissing();
  await warmXenovaCache();
  log("Setup complete.");
}

main().catch((err) => {
  console.error("[setup-embedded-models] FAILED:", err.message);
  // Don't fail npm install if optional setup couldn't complete.
  // The backend already detects missing models at runtime and falls back.
  process.exit(0);
});

// ═══════════════════════════════════════════════════════════════════════
// EMBEDDED LLAMA ADAPTER — in-process GGUF inference via node-llama-cpp
// ═══════════════════════════════════════════════════════════════════════
// Provides a zero-cost tier=small dispatch target so per-student decisions
// (narrative-fit scoring, classification, embedded councilors) don't burn
// tokens on cloud providers. Conforms to the same return envelope every
// other adapter uses:
//   { content:[{type:"text",text}], usage:{input_tokens,output_tokens},
//     model, stop_reason, _raw }
//
// The node-llama-cpp dep is imported lazily so the backend still boots when
// it isn't installed (e.g. CI containers without build tools). When the dep
// is missing or the GGUF isn't downloaded, isAvailable() returns false and
// callers must dispatch elsewhere.
// ═══════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { llmLog, llmDebug, breadcrumb, since } from "./llm-log.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.resolve(MODULE_DIR, "..", "models");

// Highest Node major the native node-llama-cpp binary is known-good on here.
// The project's CI pins Node 22; newer majors (e.g. 25) have segfaulted during
// native inference (ABI/prebuilt-binary mismatch). Bump this as newer ABIs are
// verified. Override with EMBEDDED_LLAMA_FORCE=1.
const SUPPORTED_NODE_MAX = 22;

// Written immediately before a native prompt and deleted right after. If it
// survives to the next boot, the previous run crashed mid-inference and we
// disable embedded text for this run (crash-loop breaker).
const INFLIGHT_MARKER = path.join(MODELS_DIR, ".llama-inflight");

// Cached state — building the LlamaModel takes ~1s, so we keep one alive
// per process. Keyed by absolute model file path.
const MODEL_CACHE = new Map(); // path -> { llama, model, context }
let LLAMA_MODULE = null;       // lazy import handle
let LLAMA_LOAD_ERROR = null;   // cached failure message so we don't retry on every call
let RUNTIME_WARNED = false;    // log the "disabled" reason only once per process
let CRASH_MARKER_SEEN = null;  // memoized: did a marker exist at first check this run?

// ─── Runtime safety gate for native TEXT inference ──────────────────────
// True iff it is safe to run node-llama-cpp on this process. Sync + cheap so
// isEmbeddedAvailable() (used synchronously by the policy router) can call it.
// Unsafe → callers fall back to BYOK instead of risking an uncatchable
// native segfault. Embeddings (ONNX) are unaffected — they don't crash.
export function embeddedLlamaRuntimeSafe() {
  if (process.env.EMBEDDED_LLAMA_FORCE === "1") return true;

  const reasons = [];
  if (process.env.EMBEDDED_LLAMA_DISABLED === "1") reasons.push("EMBEDDED_LLAMA_DISABLED=1");

  const major = Number(process.versions.node.split(".")[0]);
  if (Number.isFinite(major) && major > SUPPORTED_NODE_MAX) {
    reasons.push(`Node v${process.versions.node} outside tested range (<=${SUPPORTED_NODE_MAX})`);
  }

  // Crash-loop breaker — check once per process and memoize.
  if (CRASH_MARKER_SEEN === null) {
    try { CRASH_MARKER_SEEN = fs.existsSync(INFLIGHT_MARKER); } catch { CRASH_MARKER_SEEN = false; }
  }
  if (CRASH_MARKER_SEEN) reasons.push("previous run crashed mid-inference (.llama-inflight present)");

  if (reasons.length === 0) return true;

  if (!RUNTIME_WARNED) {
    RUNTIME_WARNED = true;
    llmLog("LLAMA", `embedded text inference disabled — ${reasons.join("; ")}. tier=small/councilors will use BYOK. Run on Node <=${SUPPORTED_NODE_MAX} (or set EMBEDDED_LLAMA_FORCE=1) to enable.`);
  }
  return false;
}

function writeInflightMarker(modelId) {
  try { fs.writeFileSync(INFLIGHT_MARKER, `${modelId} ${new Date().toISOString()}\n`); }
  catch { /* best-effort */ }
}

function clearInflightMarker() {
  try { if (fs.existsSync(INFLIGHT_MARKER)) fs.unlinkSync(INFLIGHT_MARKER); }
  catch { /* best-effort */ }
}

async function loadLlamaModule() {
  if (LLAMA_MODULE) return LLAMA_MODULE;
  if (LLAMA_LOAD_ERROR) throw LLAMA_LOAD_ERROR;
  try {
    const t0 = Date.now();
    LLAMA_MODULE = await import("node-llama-cpp");
    llmLog("LLAMA", "node-llama-cpp imported", { node: process.versions.node, ms: since(t0) });
    return LLAMA_MODULE;
  } catch (err) {
    LLAMA_LOAD_ERROR = new Error(
      `node-llama-cpp is not installed or failed to load (${err.message}). ` +
      `Install with: npm install node-llama-cpp@latest`
    );
    LLAMA_LOAD_ERROR.code = "embedded_unavailable";
    LLAMA_LOAD_ERROR.cause = err;
    throw LLAMA_LOAD_ERROR;
  }
}

/**
 * Resolve a tier-defaults model id (e.g. "qwen2.5-1.5b-instruct.q4_k_m") to
 * an absolute file path. The convention is: tier id is the lowercased GGUF
 * filename without the extension; the file lives at backend/models/<id>.gguf.
 */
export function resolveModelPath(modelId) {
  if (typeof modelId !== "string" || !modelId.trim()) return null;
  const safe = modelId.trim().toLowerCase();
  // Reject anything trying to traverse the dir.
  if (safe.includes("/") || safe.includes("\\") || safe.includes("..")) return null;
  return path.join(MODELS_DIR, `${safe}.gguf`);
}

/**
 * True iff (a) node-llama-cpp can be imported and (b) the default model file
 * is on disk. Cheap probe used by the policy router to decide whether to
 * route tier=small to the embedded adapter vs. the student's BYOK provider.
 */
export async function isAvailable(modelId = "qwen2.5-1.5b-instruct.q4_k_m") {
  const modelPath = resolveModelPath(modelId);
  if (!modelPath) return false;
  if (!fs.existsSync(modelPath)) return false;
  try {
    await loadLlamaModule();
    return true;
  } catch {
    return false;
  }
}

/**
 * Cheap sync version for synchronous callers (e.g. the dispatcher's tier
 * decision). Only checks file presence — does NOT verify node-llama-cpp.
 * Async isAvailable() is the canonical check.
 */
export function isModelFileOnDisk(modelId = "qwen2.5-1.5b-instruct.q4_k_m") {
  const modelPath = resolveModelPath(modelId);
  if (!modelPath) return false;
  return fs.existsSync(modelPath);
}

async function getOrLoadModel(modelPath) {
  if (MODEL_CACHE.has(modelPath)) {
    llmDebug("LLAMA", "model cache hit", { modelPath });
    return MODEL_CACHE.get(modelPath);
  }
  llmLog("LLAMA", "loading model (cache miss)", { modelPath });
  const t0 = Date.now();
  const { getLlama } = await loadLlamaModule();
  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath });
  // One context per model; sessions are spawned per call.
  const context = await model.createContext({ contextSize: 4096 });
  const entry = { llama, model, context };
  MODEL_CACHE.set(modelPath, entry);
  llmLog("LLAMA", "model + context ready", { ms: since(t0) });
  return entry;
}

/**
 * Render the OpenAI-shaped messages array into a flat user/system prompt
 * pair for LlamaChatSession. We collapse the messages because the chat
 * session expects a single user turn; multi-turn flows pass earlier turns
 * as system/context prose.
 */
function flattenMessages(messages = [], system = "") {
  const lines = [];
  if (system) lines.push(`[SYSTEM]\n${system}\n`);
  for (const m of messages) {
    const role = m.role === "assistant" ? "ASSISTANT" : "USER";
    const text = typeof m.content === "string"
      ? m.content
      : Array.isArray(m.content)
        ? m.content.map((c) => (c.type === "text" ? c.text : "")).join("\n")
        : "";
    lines.push(`[${role}]\n${text}\n`);
  }
  return lines.join("\n");
}

/**
 * Rough token count — node-llama-cpp tokenizes lazily so we use the
 * model's tokenizer when we have it loaded, else fall back to ~4 chars/token.
 */
function approxTokens(text, model) {
  if (!text) return 0;
  if (model?.tokenize) {
    try { return model.tokenize(text).length; } catch { /* fallthrough */ }
  }
  return Math.ceil(text.length / 4);
}

/**
 * Inference entrypoint. Shape matches callOpenAI/callGoogle.
 */
export async function callEmbeddedLlama({
  model: modelId = "qwen2.5-1.5b-instruct.q4_k_m",
  messages = [],
  system = "",
  maxTokens = 512,
  temperature = 0.7,
  signal,
} = {}) {
  const modelPath = resolveModelPath(modelId);
  if (!modelPath) {
    const err = new Error(`Invalid embedded model id "${modelId}".`);
    err.code = "invalid_model";
    err.status = 400;
    throw err;
  }
  if (!fs.existsSync(modelPath)) {
    const err = new Error(
      `Embedded model file missing at ${modelPath}. ` +
      `Run: node backend/scripts/setup-embedded-models.mjs`
    );
    err.code = "embedded_model_missing";
    err.status = 503;
    throw err;
  }

  llmDebug("LLAMA", "callEmbeddedLlama", { model: modelId, maxTokens, temperature });
  const { model, context } = await getOrLoadModel(modelPath);
  const { LlamaChatSession } = await loadLlamaModule();
  const sequence = context.getSequence();
  const session = new LlamaChatSession({
    contextSequence: sequence,
    systemPrompt: system || undefined,
  });

  // Build the user turn — flatten any prior assistant/user pairs into prose
  // because LlamaChatSession.prompt() takes a single user message.
  const userTurn = flattenMessages(messages, "");
  const input = userTurn || "(no input)";

  const startTokens = approxTokens(input, model);

  // Crash breadcrumb + crash-loop marker: the synchronous stderr line and the
  // on-disk marker both land BEFORE entering native code. If the process
  // segfaults inside session.prompt(), the START line has no matching END and
  // the marker survives to the next boot (which disables embedded then).
  writeInflightMarker(modelId);
  breadcrumb("LLAMA", `>>> native session.prompt START model=${modelId} inputTokens=${startTokens} maxTokens=${maxTokens} (if no END line follows, this is the segfault site)`);
  const t0 = Date.now();

  let response;
  try {
    response = await session.prompt(input, {
      maxTokens,
      temperature,
      signal,
    });
  } finally {
    clearInflightMarker();
    // Free the sequence so subsequent calls can reuse the context.
    try { sequence.dispose(); } catch { /* ignore */ }
  }

  const outputTokens = approxTokens(response, model);
  breadcrumb("LLAMA", `<<< native session.prompt END model=${modelId} ms=${since(t0)} outTokens=${outputTokens}`);

  return {
    content: [{ type: "text", text: response || "" }],
    usage: {
      input_tokens: startTokens,
      output_tokens: outputTokens,
    },
    model: modelId,
    stop_reason: "end_turn",
    _raw: { provider: "embedded", model_path: modelPath },
  };
}

/**
 * Cheap validation — used by /api/llm/providers/embedded/status and the
 * generic validateKey() pathway. Returns { valid, status, code, message }.
 */
export async function validateEmbedded({ model: modelId = "qwen2.5-1.5b-instruct.q4_k_m" } = {}) {
  const modelPath = resolveModelPath(modelId);
  if (!modelPath) {
    return { valid: false, status: 400, code: "invalid_model", message: `Invalid model id "${modelId}".` };
  }
  if (!fs.existsSync(modelPath)) {
    return {
      valid: false,
      status: 503,
      code: "embedded_model_missing",
      message: `Embedded model not downloaded. Run: node backend/scripts/setup-embedded-models.mjs`,
    };
  }
  try {
    await loadLlamaModule();
  } catch (err) {
    return { valid: false, status: 503, code: err.code || "embedded_unavailable", message: err.message };
  }
  return { valid: true, status: 200, code: "ok", message: "Embedded provider is available." };
}

/**
 * Dispose every cached model — used by tests and graceful shutdown.
 */
export async function disposeEmbedded() {
  for (const [modelPath, entry] of MODEL_CACHE) {
    try { await entry.context?.dispose?.(); } catch { /* ignore */ }
    try { await entry.model?.dispose?.(); } catch { /* ignore */ }
    MODEL_CACHE.delete(modelPath);
  }
}

export const MODELS_DIRECTORY = MODELS_DIR;

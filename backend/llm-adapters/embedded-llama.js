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

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.resolve(MODULE_DIR, "..", "models");

// Cached state — building the LlamaModel takes ~1s, so we keep one alive
// per process. Keyed by absolute model file path.
const MODEL_CACHE = new Map(); // path -> { llama, model, context }
let LLAMA_MODULE = null;       // lazy import handle
let LLAMA_LOAD_ERROR = null;   // cached failure message so we don't retry on every call

async function loadLlamaModule() {
  if (LLAMA_MODULE) return LLAMA_MODULE;
  if (LLAMA_LOAD_ERROR) throw LLAMA_LOAD_ERROR;
  try {
    LLAMA_MODULE = await import("node-llama-cpp");
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
  if (MODEL_CACHE.has(modelPath)) return MODEL_CACHE.get(modelPath);
  const { getLlama } = await loadLlamaModule();
  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath });
  // One context per model; sessions are spawned per call.
  const context = await model.createContext({ contextSize: 4096 });
  const entry = { llama, model, context };
  MODEL_CACHE.set(modelPath, entry);
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

  let response;
  try {
    response = await session.prompt(input, {
      maxTokens,
      temperature,
      signal,
    });
  } finally {
    // Free the sequence so subsequent calls can reuse the context.
    try { sequence.dispose(); } catch { /* ignore */ }
  }

  const outputTokens = approxTokens(response, model);

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

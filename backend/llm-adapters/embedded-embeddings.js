// ═══════════════════════════════════════════════════════════════════════
// EMBEDDED EMBEDDINGS — local ONNX text embedding via @xenova/transformers
// ═══════════════════════════════════════════════════════════════════════
// Wraps the bge-small-en-v1.5 model so vector-store.js can compute query
// embeddings without a remote API call. Default dimensions: 384.
//
// Lazy-loaded: the first embed() call downloads the model into the Xenova
// cache (~30 MB) and pins the pipeline; subsequent calls are sub-200 ms on
// CPU. Falls back gracefully when @xenova/transformers is not installed —
// callers should treat that as "no semantic search available" rather than
// throwing.
// ═══════════════════════════════════════════════════════════════════════

import { llmLog, llmDebug, since } from "./llm-log.js";

const DEFAULT_MODEL_ID = "Xenova/bge-small-en-v1.5";
const DEFAULT_DIMENSIONS = 384;

let PIPELINE_PROMISE = null;
let MODULE_LOAD_ERROR = null;

async function loadTransformers() {
  if (MODULE_LOAD_ERROR) throw MODULE_LOAD_ERROR;
  try {
    const xenova = await import("@xenova/transformers");
    // Pin cache directory to a stable per-repo location so reinstalls don't
    // re-download. The Xenova package already caches under its own dir;
    // we only override when the env explicitly requests it.
    if (process.env.XENOVA_CACHE_DIR) {
      xenova.env.cacheDir = process.env.XENOVA_CACHE_DIR;
    }
    // Disallow remote model downloads in CI / offline environments.
    if (process.env.XENOVA_OFFLINE === "1") {
      xenova.env.allowRemoteModels = false;
    }
    return xenova;
  } catch (err) {
    MODULE_LOAD_ERROR = new Error(
      `@xenova/transformers is not installed (${err.message}). ` +
      `Install with: npm install @xenova/transformers`
    );
    MODULE_LOAD_ERROR.code = "embeddings_unavailable";
    MODULE_LOAD_ERROR.cause = err;
    throw MODULE_LOAD_ERROR;
  }
}

async function getPipeline(modelId = DEFAULT_MODEL_ID) {
  if (PIPELINE_PROMISE) return PIPELINE_PROMISE;
  PIPELINE_PROMISE = (async () => {
    llmLog("EMBED", "loading bge pipeline (first call may download model)", { modelId });
    const t0 = Date.now();
    const xenova = await loadTransformers();
    const extractor = await xenova.pipeline("feature-extraction", modelId, {
      quantized: true, // smaller download, near-identical quality at 384 dims
    });
    llmLog("EMBED", "bge pipeline ready", { modelId, ms: since(t0) });
    return { extractor, modelId };
  })();
  try {
    return await PIPELINE_PROMISE;
  } catch (err) {
    PIPELINE_PROMISE = null;
    throw err;
  }
}

/**
 * Embed a single text into a Float32Array. Mean-pooled, L2-normalized so
 * cosine == dot product downstream. Truncates to the model's max sequence
 * length (typically 512 tokens) silently — callers pre-chunk if needed.
 */
export async function embed(text, { modelId = DEFAULT_MODEL_ID } = {}) {
  if (typeof text !== "string" || !text.trim()) {
    return new Float32Array(DEFAULT_DIMENSIONS);
  }
  const { extractor } = await getPipeline(modelId);
  const t0 = Date.now();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  // Output is a Tensor — we want the raw Float32Array.
  const vec = new Float32Array(output.data);
  llmDebug("EMBED", "embed", { chars: text.length, dims: vec.length, ms: since(t0) });
  return vec;
}

/**
 * Batch embed — slightly more efficient than mapping embed() one-by-one
 * because the pipeline can batch tokenization.
 */
export async function embedBatch(texts, opts = {}) {
  const out = [];
  for (const t of texts) {
    out.push(await embed(t, opts));
  }
  return out;
}

/**
 * Cheap probe — used by /api/llm/providers/embedded/status. Does NOT trigger
 * a model download; only checks whether the npm dep loads.
 */
export async function isEmbeddingsAvailable() {
  try {
    await loadTransformers();
    return true;
  } catch {
    return false;
  }
}

export const EMBEDDING_DIMENSIONS = DEFAULT_DIMENSIONS;
export const EMBEDDING_MODEL_ID = DEFAULT_MODEL_ID;

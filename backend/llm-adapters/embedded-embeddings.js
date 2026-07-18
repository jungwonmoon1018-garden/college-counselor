import crypto from "node:crypto";

// Deterministic local feature hashing for retrieval. This is deliberately not
// an LLM or downloaded embedding model: it has no network access, native code,
// model cache, or executable schema parser.
const DEFAULT_DIMENSIONS = 384;
const MODEL_ID = "local-feature-hash-v1";

function features(text) {
  const normalized = String(text)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return [];
  const tokens = normalized.split(" ");
  const output = [...tokens];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    output.push(`${tokens[index]} ${tokens[index + 1]}`);
  }
  return output;
}

export async function embed(text) {
  const vector = new Float32Array(DEFAULT_DIMENSIONS);
  for (const feature of features(text)) {
    const digest = crypto.createHash("sha256").update(feature).digest();
    const bucket = digest.readUInt32BE(0) % DEFAULT_DIMENSIONS;
    vector[bucket] += (digest[4] & 1) === 0 ? 1 : -1;
  }
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let index = 0; index < vector.length; index += 1) vector[index] /= norm;
  }
  return vector;
}

export async function embedBatch(texts) {
  return Promise.all((texts || []).map((text) => embed(text)));
}

export async function isEmbeddingsAvailable() {
  return true;
}

export const EMBEDDING_DIMENSIONS = DEFAULT_DIMENSIONS;
export const EMBEDDING_MODEL_ID = MODEL_ID;

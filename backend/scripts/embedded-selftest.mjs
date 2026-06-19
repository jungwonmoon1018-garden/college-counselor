// ═══════════════════════════════════════════════════════════════════════
// EMBEDDED MODELS SELF-TEST
// ═══════════════════════════════════════════════════════════════════════
// Exercises BOTH embedded models for real inference and prints the full path
// log, so you can confirm what's running (or why it fell back):
//   1. bge-small-en-v1.5 (ONNX)        → one embedding
//   2. Qwen2.5-1.5B (node-llama-cpp)   → one text completion
//
// Run:  LLM_DEBUG=1 node scripts/embedded-selftest.mjs
//
// The llama step honors the runtime guard (Node version, env, crash marker):
// it is SKIPPED with an explanation when unsafe. Set EMBEDDED_LLAMA_FORCE=1 to
// attempt it anyway — useful to demonstrate the segfault the guard prevents.
// ═══════════════════════════════════════════════════════════════════════

import { embed, isEmbeddingsAvailable, EMBEDDING_MODEL_ID } from "../llm-adapters/embedded-embeddings.js";
import { callEmbeddedLlama, isModelFileOnDisk, embeddedLlamaRuntimeSafe } from "../llm-adapters/embedded-llama.js";
import { resolveTierDefault } from "../llm-adapters/index.js";

console.log(`\n=== embedded self-test (Node ${process.versions.node}, LLM_DEBUG=${process.env.LLM_DEBUG || "0"}) ===\n`);

// ─── 1. Embeddings (bge) ───
console.log("--- bge embeddings ---");
try {
  if (!(await isEmbeddingsAvailable())) {
    console.log(`SKIP: @xenova/transformers not loadable.`);
  } else {
    const vec = await embed("A first-generation student leading a robotics nonprofit.");
    const ok = vec.length > 0 && vec.some((x) => x !== 0);
    console.log(`OK: ${EMBEDDING_MODEL_ID} → ${vec.length} dims, nonzero=${ok}`);
  }
} catch (err) {
  console.log(`FAIL: ${err.message}`);
}

// ─── 2. Text (llama) ───
console.log("\n--- qwen llama ---");
const modelId = resolveTierDefault("embedded", "small");
if (!isModelFileOnDisk(modelId)) {
  console.log(`SKIP: model file not on disk (${modelId}). Run scripts/setup-embedded-models.mjs.`);
} else if (!embeddedLlamaRuntimeSafe()) {
  console.log(`SKIP: runtime guard disabled embedded text inference (see [LLM LLAMA] line above). Set EMBEDDED_LLAMA_FORCE=1 to attempt anyway.`);
} else {
  try {
    const res = await callEmbeddedLlama({
      model: modelId,
      messages: [{ role: "user", content: "In one sentence, what is a college application 'spike'?" }],
      maxTokens: 64,
      temperature: 0.2,
    });
    const text = res?.content?.[0]?.text?.trim() || "";
    console.log(`OK: ${modelId} → ${res?.usage?.output_tokens} out tokens`);
    console.log(`    "${text.slice(0, 160)}${text.length > 160 ? "…" : ""}"`);
  } catch (err) {
    console.log(`FAIL: ${err.message}`);
  }
}

console.log("\n=== done ===\n");
process.exit(0);

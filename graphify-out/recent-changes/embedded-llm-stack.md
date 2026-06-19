# Embedded LLM stack

## What it is

The backend reasons embedded-first: routine `tier=small` work and all embeddings
run in-process at zero marginal cost, and only synthesis (`tier=medium`) and the
genuinely hard calls (`tier=large`) escalate to a student's BYOK provider.

- **Text generation** — `Qwen2.5-1.5B-Instruct` (Q4_K_M GGUF) loaded through
  `node-llama-cpp`. The adapter imports the native module lazily so the backend
  still boots when it is absent, and `isAvailable()` probes both that the module
  imports and that the GGUF is on disk before the policy router will route to it.
  The model file convention is `backend/models/<tier-id>.gguf`, e.g.
  `qwen2.5-1.5b-instruct.q4_k_m.gguf`; `resolveModelPath()` rejects any id
  containing path-traversal characters.
- **Embeddings** — `Xenova/bge-small-en-v1.5` wrapped for `vector-store.js`, so
  query and document vectors are computed locally without a network call.

## Files touched

- `backend/llm-adapters/embedded-llama.js` — lazy `node-llama-cpp` load,
  `resolveModelPath()`, `isAvailable()` probe.
- `backend/llm-adapters/embedded-embeddings.js` — bge-small wrapper.
- `backend/llm-adapters/tier-defaults.js` — tier → default model mapping.
- `backend/llm-adapters/index.js` — availability check consumed by the policy
  router.

## Why it matters here

Two of the five Strategy Council seats and every `tier=small` chat scoring call
run on the embedded model, which is what makes the council (~5k tokens for five
voices) cheaper than a single large-tier call. The embedded path is also the
graceful default: when a student has no BYOK key, `tier=small` still answers.

## Validation

`GET /api/llm/providers/embedded/status` reports readiness. In the validation
environment the Qwen GGUF and the bge-small model were both present, so the
embedded path was live. Note that **graphify's** semantic extraction is a
separate concern — it needs a Gemini/Google key or the `/graphify` subagent
flow, not this in-process model (see [logseq-pii-vault](logseq-pii-vault.md)).

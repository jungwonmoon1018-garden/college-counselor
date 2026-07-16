import test from "node:test";
import assert from "node:assert/strict";
import {
  embed,
  embedBatch,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL_ID,
} from "../llm-adapters/embedded-embeddings.js";

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

test("local retrieval vectors are deterministic and require no model runtime", async () => {
  const first = await embed("financial aid FAFSA deadline");
  const second = await embed("financial aid FAFSA deadline");
  assert.equal(first.length, EMBEDDING_DIMENSIONS);
  assert.deepEqual(first, second);
  assert.equal(EMBEDDING_MODEL_ID, "local-feature-hash-v1");
});

test("feature hashing ranks shared college-advice terms above unrelated text", async () => {
  const [query, relevant, unrelated] = await embedBatch([
    "college application essay feedback",
    "feedback for a college application essay",
    "volcanic rock mineral classification",
  ]);
  assert.ok(dot(query, relevant) > dot(query, unrelated));
});

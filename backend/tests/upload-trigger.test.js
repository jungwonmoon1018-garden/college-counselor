// tests/upload-trigger.test.js — classifyUploadForCouncil decides whether an
// uploaded EC document is about extracurriculars or course selection and which
// council decision-type to use. Strong rule matches and the empty/unrelated
// cases are deterministic (no model); the single-signal path is forced down the
// no-embeddings branch so the test never loads a model.

import test from "node:test";
import assert from "node:assert/strict";
import { classifyUploadForCouncil } from "../council/upload-trigger.js";

test("EC-heavy text → relevant, ec-strategy, via rules", async () => {
  const v = await classifyUploadForCouncil(
    "I founded the robotics club and served as captain. We won a regional competition and ran a community service fundraiser.",
  );
  assert.equal(v.relevant, true);
  assert.equal(v.decisionType, "ec-strategy");
  assert.equal(v.via, "rules");
});

test("course-selection text → relevant, course-selection", async () => {
  const v = await classifyUploadForCouncil(
    "My course selection for senior year is AP Calculus and AP Biology. I'm weighing the prerequisites and overall course rigor on my transcript.",
  );
  assert.equal(v.relevant, true);
  assert.equal(v.decisionType, "course-selection");
});

test("unrelated text → not relevant", async () => {
  const v = await classifyUploadForCouncil("The weather today is sunny and I had a sandwich for lunch.");
  assert.equal(v.relevant, false);
});

test("empty text → not relevant", async () => {
  const v = await classifyUploadForCouncil("   ");
  assert.equal(v.relevant, false);
});

test("single weak signal with embeddings unavailable → conservative (not relevant)", async () => {
  const v = await classifyUploadForCouncil("I attend debate.", { embeddingsOk: false });
  assert.equal(v.relevant, false);
  assert.equal(v.via, "rules-only");
});

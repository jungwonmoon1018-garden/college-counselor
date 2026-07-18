import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "../../frontend/src");
const sources = [
  ["App.jsx", fs.readFileSync(path.join(frontendRoot, "App.jsx"), "utf8")],
  ["api.js", fs.readFileSync(path.join(frontendRoot, "api.js"), "utf8")],
];

test("frontend excludes retired parent-notification and Anthropic compatibility surfaces", () => {
  for (const [name, source] of sources) {
    assert.doesNotMatch(source, /\bparentalNotify\b/, name + " must not call the removed notification client");
    assert.doesNotMatch(source, /\/notify-parent\b/i, name + " must not call the removed parent endpoint");
    assert.doesNotMatch(source, /chat\s*\|\s*anthropic/i, name + " must not accept the legacy proxy suffix");
    assert.doesNotMatch(source, /\banthropic(?:_beta)?\b/i, name + " must not retain Anthropic compatibility tokens");
  }
});

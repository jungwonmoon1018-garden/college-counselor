import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const sourceDir = path.join(projectRoot, "frontend", "dist");
const targetDir = path.join(projectRoot, "backend", "public");
const expectedIndex = path.join(sourceDir, "index.html");

try {
  await fs.access(expectedIndex);
} catch {
  throw new Error("frontend/dist is missing. Run the frontend production build first.");
}

if (path.dirname(targetDir) !== path.join(projectRoot, "backend")) {
  throw new Error("Refusing to replace an unexpected web build directory.");
}

await fs.rm(targetDir, { recursive: true, force: true });
await fs.mkdir(targetDir, { recursive: true });
await fs.cp(sourceDir, targetDir, { recursive: true });

console.log(`Prepared production web assets in ${path.relative(projectRoot, targetDir)}.`);

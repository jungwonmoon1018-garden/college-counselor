#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
// sync-skill.mjs — install/update the active collegeapp-ai skill from the repo
// ═══════════════════════════════════════════════════════════════════════
// The repo copy (backend/skills/collegeapp-ai/) is the SOURCE OF TRUTH. The
// installed copy at ~/.claude/skills/collegeapp-ai/ drifts by hand otherwise
// (it was stranded at v1.0.0 while the repo moved to v1.2.0). This script
// copies SKILL.md + scripts/ from the repo to the active install.
//
//   node scripts/sync-skill.mjs              # copy (creates target if missing)
//   node scripts/sync-skill.mjs --dry-run    # show what would change, write nothing
//   node scripts/sync-skill.mjs --check      # exit 2 if versions differ (deploy guard)
//   node scripts/sync-skill.mjs --target /path/to/skills/collegeapp-ai
//
// Target precedence: --target > COLLEGEAPP_SKILL_TARGET > ~/.claude/skills/collegeapp-ai
// Only the known file set is overwritten (SKILL.md + scripts/*). Never rm -rf.
// ═══════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = path.dirname(SCRIPT_DIR);            // …/collegeapp-ai
const SOURCE_SCRIPTS = path.join(SOURCE_ROOT, "scripts");

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const getOpt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
};
const DRY_RUN = has("--dry-run");
const CHECK = has("--check");

const target =
  getOpt("--target") ||
  process.env.COLLEGEAPP_SKILL_TARGET ||
  path.join(os.homedir(), ".claude", "skills", "collegeapp-ai");
const targetScripts = path.join(target, "scripts");

function readVersion(skillMdPath) {
  try {
    const text = fs.readFileSync(skillMdPath, "utf8");
    const m = text.match(/^version:\s*(.+)$/m);
    return m ? m[1].trim() : "unknown";
  } catch {
    return null; // file missing
  }
}

const srcSkill = path.join(SOURCE_ROOT, "SKILL.md");
const dstSkill = path.join(target, "SKILL.md");
const srcVersion = readVersion(srcSkill);
const dstVersion = readVersion(dstSkill);

if (srcVersion == null) {
  console.error(`[skill:sync] FATAL: source SKILL.md not found at ${srcSkill}`);
  process.exit(1);
}

// --check: pass only when the installed version matches the repo version.
if (CHECK) {
  if (dstVersion === srcVersion) {
    console.log(`[skill:sync] OK — installed skill is v${srcVersion} (in sync).`);
    process.exit(0);
  }
  console.error(`[skill:sync] DRIFT — repo v${srcVersion} vs installed ${dstVersion == null ? "(not installed)" : "v" + dstVersion}. Run \`npm run skill:sync\`.`);
  process.exit(2);
}

// Build the file list: SKILL.md + every file directly under scripts/ (flat).
const scriptFiles = fs.existsSync(SOURCE_SCRIPTS)
  ? fs.readdirSync(SOURCE_SCRIPTS).filter((f) => fs.statSync(path.join(SOURCE_SCRIPTS, f)).isFile())
  : [];

console.log(`[skill:sync] source v${srcVersion}  →  target ${dstVersion == null ? "(new install)" : "v" + dstVersion}`);
console.log(`[skill:sync] target: ${target}`);
console.log(`[skill:sync] files: SKILL.md, ${scriptFiles.map((f) => "scripts/" + f).join(", ")}`);

if (DRY_RUN) {
  console.log("[skill:sync] --dry-run: no files written.");
  process.exit(0);
}

// Copy. Create target dirs if missing; overwrite only the known file set.
fs.mkdirSync(target, { recursive: true });
fs.mkdirSync(targetScripts, { recursive: true });
fs.copyFileSync(srcSkill, dstSkill);
for (const f of scriptFiles) {
  fs.copyFileSync(path.join(SOURCE_SCRIPTS, f), path.join(targetScripts, f));
}
console.log(`[skill:sync] Done — installed v${srcVersion} (${1 + scriptFiles.length} files).`);

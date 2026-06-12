// ═══════════════════════════════════════════════════════════════════════
// refresh-cds.mjs — refresh Common Data Set records to a target cycle by
// running the full pipeline (download → parse → validate → ingest) over the
// CDS repository index.
//
// The pipeline downloads from the source links registered in
// tools/cds-cache/index.json and prefers the newest cycle present. So the
// usual flow after an application season ends is:
//   1. node scripts/add-cds-cycle.mjs --in new-cds-links.json --cycle 2024-25
//   2. npm run refresh:cds -- --year 2024-25
//
// Only data from the registered authoritative source PDFs is ingested —
// nothing is invented. Schools without a link for the requested cycle fall
// back to their newest available cycle (or are reported as not-in-index).
//
// Usage:
//   npm run refresh:cds -- --year 2024-25
//   node scripts/refresh-cds.mjs --year 2024-25 --names "Stanford University,Brown University"
//   node scripts/refresh-cds.mjs --year 2024-25 --names-file schools.txt --concurrency 3 --force
// ═══════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import { prepareRAGStatements } from "../rag-engine.js";
import { ingestBulk, getRepositoryIndex } from "../cds-ingest-pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

function readArg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  if (next === undefined || next.startsWith("--")) return true;
  return next;
}

const YEAR = readArg("--year", "2024-25");
const CONCURRENCY = Number(readArg("--concurrency", "3")) || 3;
const FORCE = readArg("--force", false) === true;
const NAMES_ARG = readArg("--names", null);
const NAMES_FILE = readArg("--names-file", null);
const LIMIT = readArg("--limit", null) ? Number(readArg("--limit", null)) : Infinity;

async function resolveTargets() {
  if (NAMES_ARG) return String(NAMES_ARG).split(",").map((s) => s.trim()).filter(Boolean);
  if (NAMES_FILE) return fs.readFileSync(path.resolve(process.cwd(), NAMES_FILE), "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const index = await getRepositoryIndex();
  return index.map((e) => e.name).filter(Boolean);
}

async function main() {
  const dbPath = path.join(PROJECT_ROOT, "data", "counselor.db");
  if (!fs.existsSync(dbPath)) {
    console.error(`[refresh:cds] No DB at ${dbPath}. Start the server once to initialize it, then retry.`);
    process.exit(1);
  }
  const db = new Database(dbPath);
  const stmts = prepareRAGStatements(db);

  let targets = await resolveTargets();
  targets = targets.slice(0, LIMIT);
  if (targets.length === 0) {
    console.error("[refresh:cds] No target schools resolved.");
    process.exit(1);
  }

  console.log(`[refresh:cds] Refreshing ${targets.length} school(s) to cycle ${YEAR} (concurrency ${CONCURRENCY}${FORCE ? ", force" : ""}).`);
  const results = await ingestBulk(stmts, targets, { concurrency: CONCURRENCY, year: YEAR, force: FORCE });

  const byStatus = {};
  for (const r of results) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  console.log("[refresh:cds] Status breakdown:", JSON.stringify(byStatus));
  const okCount = results.filter((r) => r.status === "ok" || r.status === "ok_with_overrides").length;
  console.log(`[refresh:cds] Done: ${okCount}/${results.length} ingested cleanly. Review discrepancies above.`);
  db.close();
}

main().catch((err) => { console.error("[refresh:cds] Fatal:", err.message); process.exit(1); });

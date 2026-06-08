// Import official IPEDS completions data into admissions-intelligence tables.
// Accepts either:
//   1. precomputed growth JSON rows, or
//   2. raw long-form CSV/JSON rows with year/completions columns.
//
// Usage:
//   node scripts/import-ipeds-completions.mjs path/to/file.csv
//   node scripts/import-ipeds-completions.mjs path/to/file.json

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  initAdmissionsIntelligenceTables,
  prepareAdmissionsIntelStatements,
  seedOfficialCipMappings,
  upsertIpedsGrowth,
} from "../admissions-intelligence.js";
import { loadIpedsGrowthFile } from "../admissions-intelligence-loader.js";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node scripts/import-ipeds-completions.mjs <rows.csv|rows.json>");
  process.exit(1);
}

const resolved = path.resolve(inputPath);
if (!fs.existsSync(resolved)) {
  console.error(`File not found: ${resolved}`);
  process.exit(1);
}
const rows = loadIpedsGrowthFile(resolved, {
  sourceUrl: "https://nces.ed.gov/ipeds/datacenter/DataFiles.aspx",
  sourceTitle: `NCES IPEDS completions import (${path.basename(resolved)})`,
});
if (!Array.isArray(rows) || rows.length === 0) {
  console.error("No usable IPEDS growth rows were produced from the input.");
  process.exit(1);
}

const dbPath = path.resolve(process.cwd(), "data", "counselor.db");
const db = new Database(dbPath);
initAdmissionsIntelligenceTables(db);
seedOfficialCipMappings(db);
const stmts = prepareAdmissionsIntelStatements(db);

for (const row of rows) {
  upsertIpedsGrowth(stmts, row);
}

console.log(`Imported ${rows.length} IPEDS growth rows into ${dbPath}`);
db.close();

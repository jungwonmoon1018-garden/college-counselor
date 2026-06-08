// Manual (re)ingest of the on-disk parsed/validated CDS cache into the
// cds_records table. The server also does this automatically at boot when the
// table is empty; run this to force a refresh after updating the parsed files.
//
//   node scripts/ingest-cds-cache.mjs
//
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareRAGStatements } from "../rag-engine.js";
import { ingestParsedCdsCache } from "../cds-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "..", "data", "counselor.db");

const db = new Database(dbPath);
const ragStmts = prepareRAGStatements(db);

const result = await ingestParsedCdsCache(ragStmts);
const count = db.prepare("SELECT COUNT(*) AS c FROM cds_records").get().c;

console.log(`Ingested ${result.ingested} record(s), skipped ${result.skipped}.`);
if (result.errors.length) {
  console.log(`Errors (${result.errors.length}):`);
  for (const e of result.errors) console.log("  -", e);
}
console.log(`cds_records now holds ${count} row(s).`);
db.close();

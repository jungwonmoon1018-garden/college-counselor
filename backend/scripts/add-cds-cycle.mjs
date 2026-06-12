// ═══════════════════════════════════════════════════════════════════════
// add-cds-cycle.mjs — register a new Common Data Set cycle's source links into
// the CDS repository index (tools/cds-cache/index.json).
//
// The ingest pipeline (downloadCDS) already prefers the NEWEST cycle key in
// each school's `links` map, so once you add e.g. "2024-25" links here, a
// subsequent `npm run refresh:cds` will pull, parse, validate, and ingest the
// new cycle automatically.
//
// This script only registers links YOU supply from authoritative sources
// (each school's official CDS page / institutional research office). It never
// invents URLs or data.
//
// Input file (JSON): map of school slug OR name → URL (string), or → an object
// of { "<cycle>": url }. Examples:
//   {
//     "stanford-university": "https://ucomm.stanford.edu/cds/2024-2025.pdf",
//     "Massachusetts Institute of Technology": { "2024-25": "https://ir.mit.edu/cds-2024-2025" }
//   }
//
// Usage:
//   node scripts/add-cds-cycle.mjs --in new-cds-links.json --cycle 2024-25
//   node scripts/add-cds-cycle.mjs --in new-cds-links.json --cycle 2024-25 --dry-run
// ═══════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const INDEX_PATH = path.join(PROJECT_ROOT, "tools/cds-cache/index.json");

function readArg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  if (next === undefined || next.startsWith("--")) return true;
  return next;
}

const IN_PATH = readArg("--in", null);
const DEFAULT_CYCLE = readArg("--cycle", "2024-25");
const DRY_RUN = readArg("--dry-run", false) === true;

function slugify(name) {
  return String(name).toLowerCase().trim()
    .replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

if (!IN_PATH) {
  console.error("Usage: node scripts/add-cds-cycle.mjs --in <links.json> [--cycle 2024-25] [--dry-run]");
  process.exit(1);
}

const links = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), IN_PATH), "utf8"));
const indexRaw = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
const isArray = Array.isArray(indexRaw);
const entries = isArray ? indexRaw : Object.values(indexRaw);

// Index existing entries by slug for fast lookup/merge.
const bySlug = new Map(entries.map((e) => [e.slug || slugify(e.name || ""), e]));

let added = 0, updated = 0, created = 0;
for (const [keyRaw, value] of Object.entries(links)) {
  const slug = slugify(keyRaw);
  // Accept either a bare URL string (uses --cycle) or a { cycle: url } object.
  const cycleMap = typeof value === "string" ? { [DEFAULT_CYCLE]: value } : value;

  let entry = bySlug.get(slug);
  if (!entry) {
    entry = { name: keyRaw, slug, links: {} };
    bySlug.set(slug, entry);
    entries.push(entry);
    created++;
  }
  entry.links = entry.links || {};
  for (const [cycle, url] of Object.entries(cycleMap)) {
    if (entry.links[cycle] && entry.links[cycle] !== url) updated++;
    else if (!entry.links[cycle]) added++;
    entry.links[cycle] = url;
  }
}

console.log(`[add-cds-cycle] ${added} new cycle link(s), ${updated} updated, ${created} new school entr(ies). Total schools: ${entries.length}.`);

if (DRY_RUN) { console.log("[add-cds-cycle] --dry-run: not writing."); process.exit(0); }

const out = isArray ? entries : Object.fromEntries(entries.map((e) => [e.slug, e]));
fs.writeFileSync(INDEX_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
console.log(`[add-cds-cycle] Wrote ${INDEX_PATH}. Next: npm run refresh:cds -- --year ${DEFAULT_CYCLE}`);

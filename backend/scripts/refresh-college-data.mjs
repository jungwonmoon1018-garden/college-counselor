// ═══════════════════════════════════════════════════════════════════════
// refresh-college-data.mjs — refresh the fallback college profiles from the
// LIVE College Scorecard API (U.S. Dept. of Education) instead of the static
// IPEDS CSV snapshot.
//
// Why: after an application cycle ends, the quantitative facts (acceptance
// rate, SAT/ACT ranges, enrollment, cost, outcomes) shift. The app already
// shows LIVE Scorecard data at request time; this script refreshes the
// *offline fallback* (generated/college-profiles.generated.js) so the cached
// baseline is current too — using authoritative federal data, never invented
// numbers.
//
// What it does NOT touch: Common Data Set qualitative signals (avg admitted
// GPA, AP courses valued, top majors, EC emphasis). Scorecard does not carry
// those, so existing values are PRESERVED, not overwritten or guessed. Refresh
// those via the CDS pipeline (see scripts/add-cds-cycle.mjs + REFRESH-DATA.md).
//
// Usage:
//   node scripts/refresh-college-data.mjs                 # refresh every
//                                                         # school already in
//                                                         # the generated file
//                                                         # (by unitId)
//   node scripts/refresh-college-data.mjs --names "Stanford University,Massachusetts Institute of Technology"
//   node scripts/refresh-college-data.mjs --names-file my-schools.txt
//   node scripts/refresh-college-data.mjs --from-cds       # use the CDS cache
//                                                          # school list
//   node scripts/refresh-college-data.mjs --delay 400 --limit 50 --dry-run
//
// Requires SCORECARD_API_KEY in the environment (.env). DEMO_KEY works but is
// rate-limited (~30 req/hr) — fine for a handful of schools, not for hundreds.
// ═══════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

import { searchScorecard, getCollegeById } from "../college-scorecard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(PROJECT_ROOT, ".env"), override: true });

function readArg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  // boolean flags have no value
  const next = process.argv[i + 1];
  if (next === undefined || next.startsWith("--")) return true;
  return next;
}

const OUT_PATH = path.resolve(PROJECT_ROOT, readArg("--out", "generated/college-profiles.generated.js"));
const CDS_INDEX = path.resolve(PROJECT_ROOT, "tools/cds-cache/index.json");
const DELAY_MS = Number(readArg("--delay", "350")) || 350;
const LIMIT = readArg("--limit", null) ? Number(readArg("--limit", null)) : Infinity;
const DRY_RUN = readArg("--dry-run", false) === true;
const NAMES_ARG = readArg("--names", null);
const NAMES_FILE = readArg("--names-file", null);
const FROM_CDS = readArg("--from-cds", false) === true;

// The Scorecard "latest.*" fields lag the calendar year by 1-2 years; label
// the refreshed cohort conservatively and stamp the wall-clock refresh time so
// downstream code can show provenance honestly.
const REFRESHED_AT = new Date().toISOString();
const APPROX_DATA_YEAR = new Date().getUTCFullYear() - 1;

const SCORECARD_API_KEY = (() => {
  const k = (process.env.SCORECARD_API_KEY || "").trim();
  if (!k || /^REPLACE_WITH/i.test(k)) return "DEMO_KEY";
  return k;
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (x, p = 4) => (x == null ? null : Math.round(x * 10 ** p) / 10 ** p);

// Load the existing generated profiles (if any) so we can (a) know which
// schools to refresh by default and (b) preserve CDS-only qualitative fields.
async function loadExistingProfiles() {
  if (!fs.existsSync(OUT_PATH)) return [];
  try {
    const mod = await import(`file://${OUT_PATH}?t=${Date.now()}`);
    return Array.isArray(mod.GENERATED_COLLEGE_PROFILES) ? mod.GENERATED_COLLEGE_PROFILES : [];
  } catch (err) {
    console.warn(`[refresh] Could not import existing profiles (${err.message}) — continuing fresh.`);
    return [];
  }
}

function loadCdsNames() {
  try {
    const j = JSON.parse(fs.readFileSync(CDS_INDEX, "utf8"));
    const arr = Array.isArray(j) ? j : Object.values(j);
    return arr.map((e) => e?.name).filter(Boolean);
  } catch (err) {
    console.warn(`[refresh] Could not read CDS index: ${err.message}`);
    return [];
  }
}

// Map a normalized Scorecard record onto our generated-profile schema,
// merging with the existing profile so CDS-only fields survive.
function mergeProfile(norm, existing = {}) {
  return {
    unitId: norm.unitId || existing.unitId || null,
    name: norm.name || existing.name || null,
    state: norm.state || existing.state || null,
    sat25: norm.sat25 ?? existing.sat25 ?? null,
    sat75: norm.sat75 ?? existing.sat75 ?? null,
    act25: norm.act25 ?? existing.act25 ?? null,
    act75: norm.act75 ?? existing.act75 ?? null,
    // Scorecard normalizes acceptanceRate to a percent (e.g. 3.6); the profile
    // schema stores a 0-1 ratio.
    acceptance: norm.acceptanceRate != null ? round(norm.acceptanceRate / 100) : (existing.acceptance ?? null),
    enrollment: norm.enrollment ?? existing.enrollment ?? null,
    tuitionIn: norm.tuitionIn ?? existing.tuitionIn ?? null,
    tuitionOut: norm.tuitionOut ?? existing.tuitionOut ?? null,
    // CDS-only — Scorecard has none of these, so PRESERVE (never invent).
    avgGpaAdmitted: existing.avgGpaAdmitted ?? null,
    apCoursesValued: existing.apCoursesValued ?? [],
    topMajors: existing.topMajors ?? [],
    ecEmphasis: existing.ecEmphasis ?? [],
    yieldRate: existing.yieldRate ?? null, // not in normalized Scorecard output
    retentionRate: norm.retentionRate ?? existing.retentionRate ?? null,
    gradRate6yr: norm.gradRate ?? existing.gradRate6yr ?? null,
    medianEarnings10yr: norm.medianEarnings10yr ?? existing.medianEarnings10yr ?? null,
    dataYear: APPROX_DATA_YEAR,
    refreshedAt: REFRESHED_AT,
    source: "College Scorecard API (refreshed)",
  };
}

async function fetchByName(name) {
  const res = await searchScorecard(SCORECARD_API_KEY, { name, limit: 1 });
  if (res.error) throw new Error(res.error);
  return res.results?.[0] || null;
}

async function main() {
  if (SCORECARD_API_KEY === "DEMO_KEY") {
    console.warn("[refresh] Using DEMO_KEY (rate-limited ~30/hr). Set SCORECARD_API_KEY in .env for bulk refreshes.");
  }

  const existing = await loadExistingProfiles();
  const existingByUnitId = new Map(existing.filter((p) => p.unitId).map((p) => [String(p.unitId), p]));
  const existingByName = new Map(existing.filter((p) => p.name).map((p) => [p.name.toLowerCase(), p]));

  // Decide the work list + whether we look up by unitId or by name.
  let mode = "unitId";
  let work = []; // [{ key, existing }]
  if (NAMES_ARG || NAMES_FILE) {
    mode = "name";
    const names = NAMES_ARG
      ? String(NAMES_ARG).split(",").map((s) => s.trim()).filter(Boolean)
      : fs.readFileSync(path.resolve(process.cwd(), NAMES_FILE), "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    work = names.map((name) => ({ key: name, existing: existingByName.get(name.toLowerCase()) || {} }));
  } else if (FROM_CDS) {
    mode = "name";
    work = loadCdsNames().map((name) => ({ key: name, existing: existingByName.get(name.toLowerCase()) || {} }));
  } else {
    work = existing.filter((p) => p.unitId).map((p) => ({ key: String(p.unitId), existing: p }));
  }

  if (work.length === 0) {
    console.error("[refresh] Nothing to refresh. Provide --names/--names-file/--from-cds, or build the generated file first (npm run generate:colleges).");
    process.exit(1);
  }

  work = work.slice(0, LIMIT);
  console.log(`[refresh] Mode: ${mode}. Schools to refresh: ${work.length}. Delay: ${DELAY_MS}ms.${DRY_RUN ? " (dry-run)" : ""}`);

  const refreshed = [];
  let ok = 0, miss = 0, fail = 0;
  for (let i = 0; i < work.length; i++) {
    const { key, existing: prev } = work[i];
    try {
      const norm = mode === "name" ? await fetchByName(key) : await getCollegeById(SCORECARD_API_KEY, key);
      if (!norm) { miss++; console.warn(`  · [${i + 1}/${work.length}] no match: ${key}`); if (Object.keys(prev).length) refreshed.push(prev); continue; }
      const merged = mergeProfile(norm, prev);
      refreshed.push(merged);
      ok++;
      console.log(`  ✓ [${i + 1}/${work.length}] ${merged.name} — acc ${merged.acceptance != null ? (merged.acceptance * 100).toFixed(1) + "%" : "n/a"}, SAT ${merged.sat25 ?? "?"}–${merged.sat75 ?? "?"}`);
    } catch (err) {
      fail++;
      console.warn(`  ✗ [${i + 1}/${work.length}] ${key}: ${err.message}`);
      if (Object.keys(prev).length) refreshed.push(prev); // keep stale rather than drop
    }
    if (i < work.length - 1) await sleep(DELAY_MS);
  }

  // Merge refreshed rows back over the full existing set (so a partial refresh
  // doesn't drop schools we didn't touch this run).
  const out = new Map(existing.map((p) => [String(p.unitId || p.name), p]));
  for (const p of refreshed) out.set(String(p.unitId || p.name), p);
  const finalProfiles = [...out.values()].sort((a, b) => String(a.state).localeCompare(String(b.state)) || String(a.name).localeCompare(String(b.name)));

  console.log(`[refresh] Done: ${ok} refreshed, ${miss} no-match, ${fail} failed. Total profiles: ${finalProfiles.length}.`);

  if (DRY_RUN) { console.log("[refresh] --dry-run: not writing."); return; }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  const header = `// Auto-generated by scripts/refresh-college-data.mjs.\n// Source: U.S. Dept. of Education College Scorecard API (live, authoritative).\n// Refreshed: ${REFRESHED_AT}.\n// Quantitative fields (acceptance, SAT/ACT, enrollment, cost, outcomes) are\n// from Scorecard. CDS-only qualitative fields (avgGpaAdmitted, apCoursesValued,\n// topMajors, ecEmphasis) are PRESERVED from the prior build — refresh those via\n// the CDS pipeline, not here. No values are invented.\n`;
  fs.writeFileSync(OUT_PATH, `${header}export const GENERATED_COLLEGE_PROFILES = ${JSON.stringify(finalProfiles, null, 2)};\n`, "utf8");
  console.log(`[refresh] Wrote ${finalProfiles.length} profiles → ${OUT_PATH}`);
}

main().catch((err) => { console.error("[refresh] Fatal:", err.message); process.exit(1); });

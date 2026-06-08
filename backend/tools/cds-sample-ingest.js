// ═══════════════════════════════════════════════════════════════════════
// cds-sample-ingest.js — pulls and parses CDS for a curated sample of
// 25 schools spanning T20, sub-Ivy, and T100. Saves normalized records
// to tools/cds-cache/parsed/<slug>.json so the positioning engine can
// consume them without further LLM or web calls.
// ═══════════════════════════════════════════════════════════════════════

import { fetchIndex, downloadCDS } from "./cds-ingester.js";
import { parseCDSPositional } from "./cds-pdf-positional.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PARSED_DIR = path.join(__dirname, "cds-cache", "parsed");

// Curated sample mirrors the Jiyeon test matrix: each tier represented,
// with majors that show up in computational biology / CS searches.
const SAMPLE = [
  // ── T20 ──
  { name: "Princeton University", tier: "T20" },
  { name: "Stanford University", tier: "T20" },
  { name: "Harvard University", tier: "T20" },
  { name: "Yale University", tier: "T20" },
  { name: "California Institute of Technology", tier: "T20" },
  { name: "Johns Hopkins University", tier: "T20" },
  { name: "Duke University", tier: "T20" },
  { name: "University of Pennsylvania", tier: "T20" },
  { name: "Columbia University in the City of New York", tier: "T20" },
  // ── Sub-Ivy ──
  { name: "Cornell University", tier: "Sub-Ivy" },
  { name: "Northwestern University", tier: "Sub-Ivy" },
  { name: "Brown University", tier: "Sub-Ivy" },
  { name: "Rice University", tier: "Sub-Ivy" },
  { name: "Vanderbilt University", tier: "Sub-Ivy" },
  { name: "Washington University in St Louis", tier: "Sub-Ivy" },
  // ── T50 ──
  { name: "University of Michigan-Ann Arbor", tier: "T50" },
  { name: "Georgia Institute of Technology-Main Campus", tier: "T50" },
  { name: "Carnegie Mellon University", tier: "T50" },
  { name: "University of Virginia-Main Campus", tier: "T50" },
  { name: "New York University", tier: "T50" },
  // ── T100 / state flagships ──
  { name: "University of Wisconsin-Madison", tier: "T100" },
  { name: "Purdue University-Main Campus", tier: "T100" },
  { name: "Indiana University-Bloomington", tier: "T100" },
  { name: "Michigan State University", tier: "T100" },
  { name: "Pennsylvania State University-Main Campus", tier: "T100" },
];

async function main() {
  const rows = await fetchIndex();
  fs.mkdirSync(PARSED_DIR, { recursive: true });

  console.log(`Ingesting ${SAMPLE.length} schools…\n`);
  console.log("school".padEnd(48), "year".padEnd(8), "admit%".padEnd(8), "SAT".padEnd(11), "policy".padEnd(14), "C7-VI count");

  const results = [];
  for (const target of SAMPLE) {
    // Best-effort name match: exact, then prefix
    let school =
      rows.find((r) => r.name === target.name) ||
      rows.find((r) => r.name.startsWith(target.name)) ||
      rows.find((r) => target.name.startsWith(r.name));
    if (!school) {
      console.log(target.name.slice(0, 46).padEnd(48), "NOT IN INDEX");
      results.push({ ...target, status: "not_in_index" });
      continue;
    }
    const year = school.links["2023-24"] ? "2023-24" : Object.keys(school.links).sort().reverse()[0];
    try {
      const dl = await downloadCDS({ school, year });
      if (dl.kind !== "pdf") {
        console.log(school.name.slice(0, 46).padEnd(48), year.padEnd(8), "kind=" + dl.kind);
        results.push({ ...target, status: "non_pdf", kind: dl.kind });
        continue;
      }
      const parsed = await parseCDSPositional(dl.path);
      const record = {
        school: school.name,
        slug: school.slug,
        tier: target.tier,
        year,
        ...parsed,
      };
      fs.writeFileSync(path.join(PARSED_DIR, `${school.slug}.json`), JSON.stringify(record, null, 2));
      const c7VI = Object.values(parsed.c7 || {}).filter((v) => v === "very_important").length;
      console.log(
        school.name.slice(0, 46).padEnd(48),
        year.padEnd(8),
        ((parsed.overallAdmitRate ? (parsed.overallAdmitRate * 100).toFixed(1) + "%" : "n/a")).padEnd(8),
        ((parsed.enrolledSAT?.p25 ?? "?") + "-" + (parsed.enrolledSAT?.p75 ?? "?")).padEnd(11),
        String(parsed.testPolicy ?? "?").padEnd(14),
        String(c7VI),
      );
      results.push({ ...target, status: "ok", admitRate: parsed.overallAdmitRate, slug: school.slug });
    } catch (e) {
      console.log(school.name.slice(0, 46).padEnd(48), "ERROR:", String(e.message).slice(0, 60));
      results.push({ ...target, status: "error", message: String(e.message).slice(0, 100) });
    }
  }

  const ok = results.filter((r) => r.status === "ok").length;
  console.log(`\n${ok}/${SAMPLE.length} parsed successfully`);
  fs.writeFileSync(path.join(PARSED_DIR, "_run_summary.json"), JSON.stringify(results, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });

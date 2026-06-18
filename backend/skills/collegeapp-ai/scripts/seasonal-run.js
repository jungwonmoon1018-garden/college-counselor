#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
// seasonal-run.js — trigger the seasonal credible-source research (counselor)
// ═══════════════════════════════════════════════════════════════════════
// Kicks off POST /api/admin/seasonal-research/run, which refreshes last-season
// admissions stats + AP score distributions and proposes AP concept updates —
// from OFFICIAL sources only (Common Data Set, collegescorecard.ed.gov,
// collegeboard.org), every figure verified against its source before use.
//
// This is an OPERATOR/COUNSELOR action (Basic auth), not a student one — it
// needs COUNSELOR_USER / COUNSELOR_PASS, and the backend needs an OpenRouter
// operator key (OPENROUTER_API_KEY). Keep the college set small for a manual
// run (it's synchronous); full sweeps run on the scheduled job.
//
//   node scripts/seasonal-run.js --colleges "MIT,Rice University" --skip-ap
//   node scripts/seasonal-run.js --top-n 3
//
// Env: COLLEGEAPP_BACKEND_URL (default http://localhost:3001),
//      COUNSELOR_USER, COUNSELOR_PASS
// ═══════════════════════════════════════════════════════════════════════

const BACKEND = process.env.COLLEGEAPP_BACKEND_URL || "http://localhost:3001";
const USER = process.env.COUNSELOR_USER || "";
const PASS = process.env.COUNSELOR_PASS || "";

function parseArgs(argv) {
  const out = { colleges: [], skipAP: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--skip-ap") out.skipAP = true;
    else if (a === "--colleges") out.colleges = (argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--top-n") out.topN = parseInt(argv[++i], 10);
    else if (a === "--subjects") out.subjects = (argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean).map((name) => ({ subject_id: name.toUpperCase().replace(/[^A-Z0-9]+/g, "_"), name }));
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/seasonal-run.js [--colleges \"A,B\"] [--top-n N] [--subjects \"AP Biology,...\"] [--skip-ap]");
    process.exit(0);
  }
  if (!USER || !PASS) {
    console.error("Set COUNSELOR_USER and COUNSELOR_PASS to authenticate (this is a counselor/operator action).");
    process.exit(2);
  }
  const basic = Buffer.from(`${USER}:${PASS}`).toString("base64");
  const body = {};
  if (args.colleges.length) body.colleges = args.colleges;
  if (Number.isFinite(args.topN)) body.topN = args.topN;
  if (args.subjects) body.subjects = args.subjects;
  if (args.skipAP) body.skipAP = true;

  let res;
  try {
    res = await fetch(`${BACKEND}/api/admin/seasonal-research/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${basic}` },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error(`Backend unreachable at ${BACKEND}: ${err?.message}`);
    process.exit(5);
  }
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) { console.error("Auth failed — check COUNSELOR_USER / COUNSELOR_PASS."); process.exit(3); }
  if (res.status === 503) { console.error(json.error || "Seasonal research unavailable (no OpenRouter operator key)."); process.exit(4); }
  if (!res.ok) { console.error(`Run failed (${res.status}): ${json.error || "unknown"}`); process.exit(1); }
  console.log(JSON.stringify(json, null, 2));
}

main();

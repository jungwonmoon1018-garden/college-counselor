#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
// CONVENE-COUNCIL — CLI wrapper around POST /api/strategy-council/convene
// ═══════════════════════════════════════════════════════════════════════
// Used by the /collegeapp-ai skill (Pillar 5) when the model recognizes
// the student is asking a high-stakes strategic question and decides to
// convene the council. Returns the full envelope (recommendation,
// dissent, citations, breakdown) as pretty JSON on stdout.
//
// Usage:
//   node convene-council.js \
//     --backend http://localhost:3000 \
//     --student <studentId> \
//     --token <studentSessionToken> \
//     --decision-type major-pivot \
//     --question "Should I switch from CS to applied math?"
// ═══════════════════════════════════════════════════════════════════════

const args = parseArgs(process.argv.slice(2));

if (args.help || !args.question || !args.student) {
  console.log(`Usage:
  node convene-council.js \\
    --backend <url> \\
    --student <studentId> \\
    --token <sessionToken> \\
    --decision-type <college-list|major-pivot|narrative-arc|ec-strategy|ed-ea|late-cycle|other> \\
    --question "<your high-stakes strategic question>"

Defaults: --backend http://localhost:3000, --decision-type other.
`);
  process.exit(args.help ? 0 : 1);
}

const backend = args.backend || process.env.COUNCIL_BACKEND_URL || "http://localhost:3000";
const decisionType = args["decision-type"] || "other";

const payload = {
  question: args.question,
  decision_type: decisionType,
  urgency: args.urgency || "deliberate",
};

const headers = {
  "Content-Type": "application/json",
};
if (args.token) headers.Authorization = `Bearer ${args.token}`;

const url = `${backend.replace(/\/$/, "")}/api/strategy-council/convene`;

try {
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
  if (!res.ok) {
    const txt = await res.text();
    console.error(`Council request failed: ${res.status} ${res.statusText}\n${txt}`);
    process.exit(2);
  }
  const body = await res.json();
  console.log(JSON.stringify(body, null, 2));
} catch (err) {
  console.error("convene-council:", err.message);
  process.exit(3);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") { out.help = true; continue; }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) { out[key] = next; i++; }
      else { out[key] = true; }
    }
  }
  return out;
}

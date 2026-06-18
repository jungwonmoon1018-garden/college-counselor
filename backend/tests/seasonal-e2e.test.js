// End-to-end agentic test for the seasonal credible-source researcher.
// Drives runSeasonalResearch with a SCRIPTED fake operator LLM (no network) and
// asserts the full pipeline behaves safely for a minors' app:
//   • a clean college           → verified + persisted in cds_records
//   • a planted-wrong stat       → discrepancy → quarantined (removed from cds_records)
//   • a no-source result         → never persisted
//   • per-college official .edu  → appears in the search extraDomains (Part B)
//   • only credible domains      → every search is .edu/.gov/.org
//   • AP score distribution      → rows persisted
//   • AP concept proposal        → ap_concept_proposals (curated catalog untouched)
import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { initRAGTables, prepareRAGStatements } from "../rag-engine.js";
import { runSeasonalResearch, getLatestSeasonalRun } from "../seasonal-research.js";

// A fully-scripted operator LLM. Routes by prompt shape + the school/subject
// named in the user message, and records every call so the test can assert
// which domains each search was restricted to.
function scriptedLLM(calls) {
  const j = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj) }] });
  return async (args) => {
    const u = args.messages?.[0]?.content || "";
    calls.push({ content: u, extraDomains: args.extraDomains || [], wantsWeb: !!args.wantsWeb });

    // ── Verification lenses (check BEFORE the CDS-reader branch: lens A's
    //    prompt also contains "Common Data Set") ──
    if (/verify for/i.test(u)) {
      const contradict = j({ confirmed: true, matches: false, notes: "official source differs" });
      const confirm = j({ confirmed: true, matches: true, notes: "matches" });
      // Wrong U: the federal-data lens contradicts → quorum = discrepancy.
      if (/"Wrong U"/.test(u) && /federal College Scorecard/i.test(u)) return contradict;
      return confirm;
    }

    // ── CDS reader (cds-store.extractCdsViaWeb) ──
    if (/official Common Data Set \(CDS\) for/i.test(u)) {
      if (/"Clean U"/.test(u)) return j({ found: true, year: "2024-2025", admitRatePercent: 5, sat25: 1500, sat75: 1570, sourceUrl: "https://www.cleanu.edu/cds" });
      if (/"Wrong U"/.test(u)) return j({ found: true, year: "2024-2025", admitRatePercent: 4, sat25: 1510, sat75: 1580, sourceUrl: "https://www.wrongu.edu/cds" });
      if (/"NoSource U"/.test(u)) return j({ found: true, admitRatePercent: 50, sourceUrl: null }); // value but no source → dropped
      return j({ found: false });
    }
    // ── Admit-rate fallback (only if CDS returned null) ──
    if (/admission \(acceptance\) rate/i.test(u)) return j({ found: false });

    // ── AP score distribution ──
    if (/score distribution/i.test(u)) return j({ found: true, examYear: 2025, distribution: { 5: 18, 4: 22, 3: 30, 2: 20, 1: 10 }, sampleSize: 50000, sourceUrl: "https://collegeboard.org/ap-bio-scores" });
    // ── AP CED locate + analyze (propose-only) ──
    if (/Find the latest official Course and Exam Description/i.test(u)) return j({ found: true, examYear: 2025, pageUrl: "https://collegeboard.org/ap-bio-ced", pdfUrl: null });
    if (/list the main units/i.test(u)) return j({ concepts: [{ name: "Cell Structure", weight: 0.2, keywords: ["cell", "membrane"] }, { name: "Genetics", weight: 0.25, keywords: ["dna", "allele"] }] });

    return { content: [{ type: "text", text: "{}" }] };
  };
}

function setup() {
  const db = new Database(":memory:");
  initRAGTables(db);
  const ragStmts = prepareRAGStatements(db);
  return { db, ragStmts };
}

test("seasonal e2e: clean verifies, wrong-stat is quarantined, no-source is dropped", async () => {
  const { db, ragStmts } = setup();
  const calls = [];
  const callLLM = scriptedLLM(calls);

  const run = await runSeasonalResearch(db, ragStmts, callLLM, {
    trigger: "test",
    topN: 0, // use only the explicit set for determinism
    delayMs: 0,
    colleges: [
      { name: "Clean U", website: "https://www.cleanu.edu/" },
      { name: "Wrong U", website: "https://www.wrongu.edu/" },
      { name: "NoSource U" },
    ],
    subjects: [{ subject_id: "AP_BIOLOGY", name: "AP Biology" }],
  });

  assert.equal(run.ok, true);
  assert.equal(run.summary.admissionsOk, 2, "Clean + Wrong scraped with a source; NoSource dropped");
  assert.equal(run.summary.verified, 1, "only Clean U verifies");
  assert.equal(run.summary.flagged, 1, "Wrong U is flagged (discrepancy)");

  // ── cds_records: Clean present, Wrong quarantined (deleted), NoSource never written ──
  const cnt = (name) => db.prepare("SELECT COUNT(*) c FROM cds_records WHERE school_name = ?").get(name).c;
  assert.equal(cnt("Clean U"), 1, "clean record persisted");
  assert.equal(cnt("Wrong U"), 0, "contradicted record quarantined out of cds_records");
  assert.equal(cnt("NoSource U"), 0, "no-source record never persisted");

  // ── verification audit trail ──
  const wrongSummary = db.prepare("SELECT status, notes FROM seasonal_verifications WHERE school='Wrong U' AND field='admissions'").get();
  assert.equal(wrongSummary.status, "discrepancy");
  assert.match(wrongSummary.notes, /quarantined/);
  const cleanSummary = db.prepare("SELECT status FROM seasonal_verifications WHERE school='Clean U' AND field='admissions'").get();
  assert.equal(cleanSummary.status, "verified");

  // ── Part B: each college's own official .edu host scoped its search ──
  const cleanCdsCall = calls.find((c) => /"Clean U"/.test(c.content) && /Common Data Set \(CDS\)/i.test(c.content));
  assert.ok(cleanCdsCall, "clean CDS read happened");
  assert.ok(cleanCdsCall.extraDomains.includes("www.cleanu.edu"), "clean college's .edu host in search domains");
  for (const shared of ["commondataset.org", "collegescorecard.ed.gov", "nces.ed.gov"]) {
    assert.ok(cleanCdsCall.extraDomains.includes(shared), `shared credible host ${shared} present`);
  }

  // ── credible-source guarantee: every search restricted to .edu/.gov/.org ──
  for (const c of calls) {
    for (const d of c.extraDomains) {
      assert.match(d, /\.(edu|gov|org)$/, `non-credible domain leaked into search: ${d}`);
    }
  }

  // ── AP distributions persisted ──
  const apRows = db.prepare("SELECT COUNT(*) c FROM ap_score_distributions WHERE subject_id='AP_BIOLOGY'").get().c;
  assert.equal(apRows, 5, "one row per AP score 1-5");

  // ── AP concept PROPOSAL written, status 'proposed' (catalog not mutated) ──
  const prop = db.prepare("SELECT subject_id, status, proposed_json FROM ap_concept_proposals WHERE subject_id='AP_BIOLOGY'").get();
  assert.ok(prop, "an AP concept proposal was written");
  assert.equal(prop.status, "proposed");
  assert.ok(JSON.parse(prop.proposed_json).concepts.length >= 1);

  // ── run is logged + readable ──
  const latest = getLatestSeasonalRun(db);
  assert.equal(latest.run_id, run.runId);
  assert.equal(latest.verified, 1);
  assert.equal(latest.flagged, 1);
});

test("seasonal e2e: hydrateBaselineWebsites backfills .edu from the Scorecard cache", async () => {
  const { db, ragStmts } = setup();
  // A baseline college with NO static website, plus a Scorecard cache row that
  // carries its official site (school.school_url → .website in the payload).
  db.prepare("INSERT INTO baseline_colleges (unit_id, name, acceptance_rate) VALUES (?,?,?)").run("999001", "Cache College", 0.07);
  ragStmts.upsertScorecardCache.run("999001", "Cache College", JSON.stringify({ name: "Cache College", website: "https://www.cachecollege.edu/" }));

  const calls = [];
  const run = await runSeasonalResearch(db, ragStmts, scriptedLLM(calls), {
    trigger: "test", topN: 5, delayMs: 0, skipAP: true, colleges: [],
  });
  assert.equal(run.ok, true);

  // The website got backfilled onto the baseline row…
  const site = db.prepare("SELECT website FROM baseline_colleges WHERE unit_id='999001'").get().website;
  assert.match(site, /cachecollege\.edu/);
  // …and the CDS search for that college was scoped to its .edu host.
  const call = calls.find((c) => /"Cache College"/.test(c.content) && /Common Data Set \(CDS\)/i.test(c.content));
  assert.ok(call && call.extraDomains.includes("www.cachecollege.edu"), "backfilled .edu host scoped the search");
});

// Tests for the seasonal credible-source research orchestrator. Pure-logic +
// dependency-injected LLM, so no network: a fake callLLM returns canned JSON.
import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  ensureSeasonalTables,
  resolveSeasonalColleges,
  fetchSeasonalAdmissions,
  fetchAPScoreDistributions,
  refreshAPConceptsFromPDFs,
  verifySeasonalRecord,
  runSeasonalResearch,
  getLatestSeasonalRun,
} from "../seasonal-research.js";

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE baseline_colleges (unit_id TEXT PRIMARY KEY, name TEXT, acceptance_rate REAL);
    CREATE TABLE profile_snapshots (rowid_ INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT, profile_json TEXT, created_at TEXT);
  `);
  ensureSeasonalTables(db);
  return db;
}
const llmText = (obj) => async () => ({ content: [{ type: "text", text: JSON.stringify(obj) }] });

test("ensureSeasonalTables creates the seasonal tables (idempotent)", () => {
  const db = freshDb();
  ensureSeasonalTables(db); // second call must not throw
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const t of ["seasonal_research_runs", "seasonal_verifications", "ap_score_distributions", "ap_concept_proposals"]) {
    assert.ok(names.includes(t), `missing table ${t}`);
  }
});

test("resolveSeasonalColleges unions targets + top-N and dedups", () => {
  const db = freshDb();
  db.prepare("INSERT INTO baseline_colleges VALUES (?,?,?)").run("166683", "MIT", 0.04);
  db.prepare("INSERT INTO baseline_colleges VALUES (?,?,?)").run("190150", "Columbia University", 0.039);
  db.prepare("INSERT INTO baseline_colleges VALUES (?,?,?)").run("999999", "State College", 0.78);
  db.prepare("INSERT INTO profile_snapshots (student_id, profile_json, created_at) VALUES (?,?,?)")
    .run("stu1", JSON.stringify({ goals: ["Rice University", { name: "MIT" }] }), "2026-01-01");

  const colleges = resolveSeasonalColleges(db, { topN: 2 });
  const names = colleges.map((c) => c.name);
  assert.ok(names.includes("Rice University"), "target school included");
  assert.ok(names.includes("MIT"), "MIT included");
  // MIT appears as both a target and a top-N pick — must be deduped.
  assert.equal(names.filter((n) => n === "MIT").length, 1, "MIT must be deduped");
  // top-2 most selective are MIT + Columbia; State College (0.78) excluded.
  assert.ok(!names.includes("State College"), "less-selective school excluded by topN=2");
});

test("no operator key → every entrypoint no-ops gracefully (no fabrication)", async () => {
  const db = freshDb();
  assert.equal((await fetchSeasonalAdmissions({}, null, [{ name: "MIT" }])).reason, "no_operator_llm");
  assert.equal((await fetchAPScoreDistributions(db, null)).reason, "no_operator_llm");
  assert.equal((await refreshAPConceptsFromPDFs(db, null)).reason, "no_operator_llm");
  const run = await runSeasonalResearch(db, {}, null, {});
  assert.equal(run.ok, false);
  assert.equal(run.reason, "no_operator_openrouter_key");
});

test("fetchAPScoreDistributions persists verified % rows with a source url", async () => {
  const db = freshDb();
  const callLLM = llmText({ found: true, examYear: 2025, distribution: { 5: 20.1, 4: 25, 3: 30, 2: 15, 1: 9.9 }, sampleSize: 100000, sourceUrl: "https://collegeboard.org/x" });
  const r = await fetchAPScoreDistributions(db, callLLM, [{ subject_id: "AP_BIOLOGY", name: "AP Biology" }]);
  assert.equal(r.ok, true);
  const rows = db.prepare("SELECT * FROM ap_score_distributions WHERE subject_id='AP_BIOLOGY'").all();
  assert.equal(rows.length, 5, "one row per score 1-5");
  assert.ok(rows.every((x) => x.source_url && x.exam_year === 2025), "rows carry source + year");
});

test("verifySeasonalRecord multi-lens quorum: all-confirm → verified; any-contradict → discrepancy", async () => {
  const db = freshDb();
  const rec = { school: "MIT", slug: "mit", overallAdmitRate: 0.04, enrolledSAT: { p25: 1520, p75: 1580 }, sourceUrl: "https://commondataset.org/mit" };

  const ok = await verifySeasonalRecord(db, llmText({ confirmed: true, matches: true, notes: "matches CDS", sourceUrl: "https://commondataset.org/mit" }), "run1", rec);
  assert.equal(ok.status, "verified");
  assert.equal(ok.confirms, 3, "all three lenses confirmed");

  const bad = await verifySeasonalRecord(db, llmText({ confirmed: true, matches: false, notes: "CDS says 0.05" }), "run1", rec);
  assert.equal(bad.status, "discrepancy");
  assert.ok(bad.contradicts >= 1, "at least one lens contradicted");

  // One summary row ("admissions") per call, plus three per-lens rows each.
  const summary = db.prepare("SELECT status FROM seasonal_verifications WHERE slug='mit' AND field='admissions' ORDER BY id").all();
  assert.deepEqual(summary.map((r) => r.status), ["verified", "discrepancy"]);
  const lensCount = db.prepare("SELECT COUNT(*) c FROM seasonal_verifications WHERE slug='mit' AND field LIKE 'admissions:%'").get().c;
  assert.equal(lensCount, 6, "3 per-lens votes × 2 calls");
});

test("verifySeasonalRecord quorum: 2 confirm + 1 unconfirmed → verified (no contradiction)", async () => {
  const db = freshDb();
  const rec = { school: "Rice", slug: "rice", overallAdmitRate: 0.08, sourceUrl: "https://commondataset.org/rice" };
  // Lens-aware fake: Scorecard lens can't find it (unconfirmed); the other two confirm.
  const callLLM = async (args) => {
    const u = args.messages?.[0]?.content || "";
    if (/federal College Scorecard/i.test(u)) return { content: [{ type: "text", text: JSON.stringify({ confirmed: false, notes: "not found" }) }] };
    return { content: [{ type: "text", text: JSON.stringify({ confirmed: true, matches: true, notes: "ok" }) }] };
  };
  const v = await verifySeasonalRecord(db, callLLM, "run2", rec);
  assert.equal(v.status, "verified");
  assert.equal(v.confirms, 2);
  assert.equal(v.contradicts, 0);
});

test("runSeasonalResearch with a fake LLM logs a run and returns a summary", async () => {
  const db = freshDb();
  db.prepare("INSERT INTO baseline_colleges VALUES (?,?,?)").run("166683", "MIT", 0.04);
  // A fake callLLM that returns admit-rate JSON for admissions, distribution for AP,
  // and confirmation for verify — enough for the orchestrator to complete.
  const callLLM = async (args) => {
    const u = (args.messages?.[0]?.content || "");
    if (/admission \(acceptance\) rate/i.test(u)) return { content: [{ type: "text", text: JSON.stringify({ found: true, admitRatePercent: 4, season: "Fall 2025", sourceUrl: "https://commondataset.org/mit" }) }] };
    if (/Common Data Set/i.test(u)) return { content: [{ type: "text", text: JSON.stringify({}) }] }; // CDS miss → falls back to admit-rate
    if (/score distribution/i.test(u)) return { content: [{ type: "text", text: JSON.stringify({ found: true, examYear: 2025, distribution: { 5: 20, 4: 25, 3: 30, 2: 15, 1: 10 }, sampleSize: 1, sourceUrl: "https://collegeboard.org/x" }) }] };
    if (/Course and Exam Description/i.test(u)) return { content: [{ type: "text", text: JSON.stringify({ found: false }) }] };
    if (/independently verify/i.test(u)) return { content: [{ type: "text", text: JSON.stringify({ confirmed: true, matches: true, notes: "ok" }) }] };
    return { content: [{ type: "text", text: "{}" }] };
  };
  const run = await runSeasonalResearch(db, {}, callLLM, { trigger: "test", topN: 1, delayMs: 0, subjects: [{ subject_id: "AP_BIOLOGY", name: "AP Biology" }] });
  assert.equal(run.ok, true);
  assert.ok(run.runId, "returns a run id");
  const latest = getLatestSeasonalRun(db);
  assert.ok(latest && latest.run_id === run.runId, "run logged + readable");
});

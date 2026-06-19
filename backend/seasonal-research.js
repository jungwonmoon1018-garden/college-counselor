// ═══════════════════════════════════════════════════════════════════════
// SEASONAL RESEARCH — credible-source-only admissions + AP refresh
// ═══════════════════════════════════════════════════════════════════════
// Refreshes last-application-season admissions stats (and AP data — see the
// AP module functions) from OFFICIAL sources only, via OpenRouter's web
// plugin. Sources are restricted by credible-sources.js (collegeboard.org,
// official .edu admissions / Common Data Set pages, collegescorecard.ed.gov,
// nces.ed.gov) — never forums/blogs/Reddit.
//
// This module is pure orchestration over existing readers (cds-store.js) and
// is DEPENDENCY-INJECTED with an operator-keyed `callLLM` (see
// buildOperatorCallLLM in server.js). It never holds keys itself, and if no
// operator OpenRouter key is configured the caller passes callLLM=null and
// every function degrades to a no-op result (no fabrication).
//
// Each scraped record carries a sourceUrl; nothing is treated as verified
// until the Phase-4 verifier confirms it against that source.
// ═══════════════════════════════════════════════════════════════════════

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { slugifySchoolName, extractCdsViaWeb, extractAdmitRateViaWeb } from "./cds-store.js";
import { persistAndValidate } from "./cds-validator.js";
import { extractHost } from "./credible-sources.js";
import { hydrateBaselineWebsites } from "./rag-engine.js";
import { compareLensValues } from "./seasonal-verification-v2.js";
import { getCollegeById } from "./college-scorecard.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const CDS_PARSED_DIR = path.join(MODULE_DIR, "tools", "cds-cache", "parsed");

// Default AP subjects to refresh when the caller doesn't specify a set.
const DEFAULT_AP_SUBJECTS = Object.freeze([
  { subject_id: "AP_CALCULUS_BC", name: "AP Calculus BC" },
  { subject_id: "AP_BIOLOGY", name: "AP Biology" },
  { subject_id: "AP_CHEMISTRY", name: "AP Chemistry" },
  { subject_id: "AP_PHYSICS_C_MECH", name: "AP Physics C: Mechanics" },
  { subject_id: "AP_STATISTICS", name: "AP Statistics" },
  { subject_id: "AP_US_GOVERNMENT", name: "AP US Government and Politics" },
  { subject_id: "AP_MACROECONOMICS", name: "AP Macroeconomics" },
  { subject_id: "AP_MICROECONOMICS", name: "AP Microeconomics" },
]);

// Defensive JSON extraction from an LLM text block (tolerates ```json fences
// and surrounding prose).
function parseJsonLoose(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(cleaned); } catch { /* try to find a JSON object */ }
  const s = cleaned.indexOf("{");
  if (s < 0) return null;
  let depth = 0;
  for (let i = s; i < cleaned.length; i++) {
    if (cleaned[i] === "{") depth++;
    else if (cleaned[i] === "}") { depth--; if (depth === 0) { try { return JSON.parse(cleaned.slice(s, i + 1)); } catch { return null; } } }
  }
  return null;
}

function textOf(resp) {
  return (resp?.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
}

// Cross-college credible hosts that apply to every search (CDS + federal data).
// Each college ALSO gets its own official .edu host appended at search time,
// resolved from baseline_colleges.website (populated from Scorecard's
// school.school_url) — see fetchSeasonalAdmissions / resolveSeasonalColleges.
const SEASONAL_EXTRA_DOMAINS = Object.freeze([
  "commondataset.org",
  "collegescorecard.ed.gov",
  "nces.ed.gov",
]);

// Build the per-college search domain list: the shared credible hosts plus the
// college's own official site host (e.g. "www.stanford.edu") when known.
// buildAllowedDomains downstream still validates each host is institutional.
function domainsForCollege(college) {
  const host = extractHost(college?.website);
  return host ? [...SEASONAL_EXTRA_DOMAINS, host] : [...SEASONAL_EXTRA_DOMAINS];
}

// ─── College set: students' targets ∪ operator top-N (most selective) ───
// Deduped by slug. `explicitColleges` (from the manual trigger) wins first.
export function resolveSeasonalColleges(db, { topN = 25, explicitColleges = [] } = {}) {
  const set = new Map(); // slug -> { name, slug, unitId, website, source }
  const add = (name, unitId, source, website = null) => {
    const clean = typeof name === "string" ? name.trim() : "";
    if (!clean) return;
    const slug = slugifySchoolName(clean);
    if (!slug || set.has(slug)) return;
    set.set(slug, { name: clean, slug, unitId: unitId || null, website: website || null, source });
  };

  // 1. Explicit list (manual trigger). Honor a caller-supplied website.
  for (const c of explicitColleges || []) {
    if (typeof c === "string") add(c, null, "explicit");
    else if (c && typeof c === "object") add(c.name, c.unitId || c.unit_id, "explicit", c.website || c.url);
  }

  // 2. Students' target / goal schools — best-effort across the latest
  //    snapshot per student. Tolerant of goal shape (string or object).
  try {
    const rows = db.prepare(
      "SELECT student_id, profile_json FROM profile_snapshots ORDER BY datetime(created_at) DESC, rowid DESC",
    ).all();
    const seen = new Set();
    for (const r of rows) {
      if (seen.has(r.student_id)) continue;
      seen.add(r.student_id);
      let goals = [];
      try { goals = (JSON.parse(r.profile_json || "{}").goals) || []; } catch { /* skip */ }
      for (const g of goals) {
        if (typeof g === "string") add(g, null, "target");
        else if (g && typeof g === "object") add(g.name || g.school || g.college, g.unitId || g.unit_id, "target");
      }
    }
  } catch { /* table/shape tolerant — targets are optional */ }

  // 3. Operator top-N most-selective from the baseline set.
  if (topN > 0) {
    try {
      const rows = db.prepare(
        "SELECT name, unit_id, website FROM baseline_colleges WHERE acceptance_rate IS NOT NULL AND name IS NOT NULL ORDER BY acceptance_rate ASC LIMIT ?",
      ).all(topN);
      for (const r of rows) add(r.name, r.unit_id, "topN", r.website);
    } catch { /* baseline optional */ }
  }

  // 4. Backfill the official website for any college that still lacks one, by
  //    matching baseline_colleges on unit_id then name. Lets the searcher scope
  //    to each college's own .edu host. Tolerant of an un-migrated DB.
  try {
    const byUnit = db.prepare("SELECT website FROM baseline_colleges WHERE unit_id = ?");
    const byName = db.prepare("SELECT website FROM baseline_colleges WHERE name = ? COLLATE NOCASE");
    for (const c of set.values()) {
      if (c.website) continue;
      let row = c.unitId ? byUnit.get(c.unitId) : null;
      if (!row || !row.website) row = byName.get(c.name);
      if (row && row.website) c.website = row.website;
    }
  } catch { /* website is optional — fall back to shared credible hosts */ }

  return Array.from(set.values());
}

// Shape an admit-rate-only result into a persistAndValidate-compatible record
// (same shape parseWebCdsRecord produces, with only the overall rate filled).
function admitRateToRecord(college, ar) {
  return {
    school: college.name,
    slug: college.slug || slugifySchoolName(college.name),
    yearLabel: ar.season || null,
    overallAdmitRate: ar.admitRatePercent != null ? ar.admitRatePercent / 100 : null,
    enrolledSAT: {},
    enrolledACT: {},
    c7: {},
    testPolicy: null,
    sourceUrl: ar.sourceUrl || null,
    sourceKind: "web_llm",
    parserVersion: 0,
  };
}

// ─── Fetch + persist last-season admissions for a set of colleges ───
// Reuses the existing web readers with the operator callLLM (web plugin,
// credible-domain-restricted). Returns a per-college summary. Persistence is
// best-effort per college; one failure never aborts the run.
export async function fetchSeasonalAdmissions(ragStmts, callLLM, colleges, opts = {}) {
  if (!callLLM) return { ok: false, reason: "no_operator_llm", results: [] };
  // Synthetic provider info for the readers' model selection (operator is OR).
  const byok = { provider: "openrouter", models: { large: opts.largeModel, medium: opts.mediumModel } };
  const results = [];

  for (const college of colleges) {
    let rec = null;
    let source = null;
    // Shared credible hosts + this college's own official .edu (when known).
    const collegeDomains = domainsForCollege(college);
    // Prefer the full CDS read; fall back to the lightweight admit-rate read.
    try {
      const cds = await extractCdsViaWeb({ callLLM, byok, schoolName: college.name, extraDomains: collegeDomains });
      if (cds) { rec = cds; source = "cds_web"; }
    } catch (err) { /* fall through to admit-rate */ }
    if (!rec) {
      try {
        const ar = await extractAdmitRateViaWeb({ callLLM, byok, schoolName: college.name, extraDomains: collegeDomains });
        if (ar) { rec = admitRateToRecord(college, ar); source = "admit_rate_web"; }
      } catch (err) { /* no data */ }
    }

    if (!rec) {
      results.push({ college: college.name, slug: college.slug, ok: false, reason: "no_data" });
    } else if (rec.sourceUrl) {
      // Only persist when a source URL is present — no source ⇒ never trusted.
      try {
        await persistAndValidate(ragStmts, rec, { source: "seasonal_web" });
        results.push({ college: college.name, slug: college.slug, ok: true, source, sourceUrl: rec.sourceUrl, record: rec });
      } catch (err) {
        results.push({ college: college.name, slug: college.slug, ok: false, error: err?.message });
      }
    } else {
      results.push({ college: college.name, slug: college.slug, ok: false, reason: "no_source_url" });
    }

    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
  }

  return { ok: true, results };
}

// ─── Schema (idempotent) ────────────────────────────────────────────────
// Self-contained seasonal tables so we don't touch rag-engine's big init.
export function ensureSeasonalTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS seasonal_research_runs (
      run_id TEXT PRIMARY KEY,
      started_at TEXT, finished_at TEXT, trigger TEXT,
      colleges_count INTEGER, admissions_ok INTEGER, admissions_failed INTEGER,
      verified INTEGER, flagged INTEGER, ap_subjects INTEGER, ap_proposals INTEGER,
      summary_json TEXT
    );
    CREATE TABLE IF NOT EXISTS seasonal_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT, slug TEXT, school TEXT, field TEXT,
      scraped_value TEXT, source_url TEXT,
      status TEXT, notes TEXT,
      verified_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_seasonal_verif_slug ON seasonal_verifications(slug);
    CREATE TABLE IF NOT EXISTS ap_score_distributions (
      exam_year INTEGER, subject_id TEXT, score INTEGER,
      percent_scored REAL, sample_size INTEGER, source_url TEXT,
      fetched_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (exam_year, subject_id, score)
    );
    CREATE TABLE IF NOT EXISTS ap_concept_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id TEXT, exam_year INTEGER, source_url TEXT,
      proposed_json TEXT, status TEXT DEFAULT 'proposed',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

// ─── AP score distributions ─────────────────────────────────────────────
// Web-read collegeboard.org for the latest official % scoring 1-5 per exam.
export async function fetchAPScoreDistributions(db, callLLM, subjects = DEFAULT_AP_SUBJECTS, opts = {}) {
  if (!callLLM) return { ok: false, reason: "no_operator_llm", results: [] };
  const ins = db.prepare(
    `INSERT OR REPLACE INTO ap_score_distributions (exam_year, subject_id, score, percent_scored, sample_size, source_url, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
  );
  const results = [];
  for (const subj of subjects) {
    let saved = 0, examYear = null, sourceUrl = null;
    try {
      const resp = await callLLM({
        max_tokens: 1200, temperature: 0, wantsWeb: true, extraDomains: ["collegeboard.org"],
        system: "You report official College Board AP score distributions from collegeboard.org ONLY. Never fabricate; use null if you cannot verify. Output ONLY the requested JSON.",
        messages: [{ role: "user", content:
          `Most recent official score distribution for "${subj.name}" from collegeboard.org (the % of test-takers scoring each of 5/4/3/2/1). Return ONLY JSON:\n` +
          `{"found":true,"examYear":<year|null>,"distribution":{"5":<pct|null>,"4":<pct>,"3":<pct>,"2":<pct>,"1":<pct>},"sampleSize":<int|null>,"sourceUrl":"<collegeboard.org url|null>"}` }],
      });
      const j = parseJsonLoose(textOf(resp));
      if (j && j.found !== false && j.distribution && j.sourceUrl) {
        examYear = Number.isFinite(+j.examYear) ? +j.examYear : null;
        sourceUrl = String(j.sourceUrl).slice(0, 400);
        for (const score of [5, 4, 3, 2, 1]) {
          const pct = Number(j.distribution[score] ?? j.distribution[String(score)]);
          if (Number.isFinite(pct) && pct >= 0 && pct <= 100) {
            ins.run(examYear, subj.subject_id, score, Math.round(pct * 10) / 10, Number.isFinite(+j.sampleSize) ? +j.sampleSize : null, sourceUrl);
            saved++;
          }
        }
      }
    } catch (err) { results.push({ subject: subj.subject_id, ok: false, error: err?.message }); continue; }
    results.push({ subject: subj.subject_id, ok: saved > 0, savedScores: saved, examYear, sourceUrl });
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
  }
  return { ok: true, results };
}

// Fetch + extract text from an official College Board PDF (CED/FRQ). Only
// collegeboard.org hosts are fetched — anything else is refused.
async function fetchCollegeBoardPdfText(url, maxChars = 40000) {
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
  if (!(host === "collegeboard.org" || host.endsWith(".collegeboard.org"))) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const pdfParse = (await import("pdf-parse")).default;
    const parsed = await pdfParse(buf);
    return (parsed.text || "").slice(0, maxChars);
  } catch { return null; }
}

// ─── AP concept refresh from the latest official exam PDFs (propose-only) ──
// Locates the latest CED PDF on collegeboard.org, fetches + parses it, and
// LLM-analyzes the units/concepts. Writes a PROPOSAL only (never mutates the
// curated ap-concept-catalog) for human review.
export async function refreshAPConceptsFromPDFs(db, callLLM, subjects = DEFAULT_AP_SUBJECTS, opts = {}) {
  if (!callLLM) return { ok: false, reason: "no_operator_llm", results: [] };
  const ins = db.prepare(
    `INSERT INTO ap_concept_proposals (subject_id, exam_year, source_url, proposed_json, status, created_at)
     VALUES (?, ?, ?, ?, 'proposed', datetime('now'))`,
  );
  const results = [];
  for (const subj of subjects) {
    try {
      // 1. Locate the latest official CED on collegeboard.org (web plugin).
      const find = await callLLM({
        max_tokens: 900, temperature: 0, wantsWeb: true, extraDomains: ["collegeboard.org"],
        system: "You locate official College Board AP Course and Exam Description (CED) materials on collegeboard.org ONLY. Output ONLY JSON.",
        messages: [{ role: "user", content:
          `Find the latest official Course and Exam Description (CED) for "${subj.name}" on collegeboard.org. Return ONLY JSON:\n` +
          `{"found":true,"examYear":<year|null>,"pdfUrl":"<direct .pdf url on collegeboard.org|null>","pageUrl":"<collegeboard.org page url|null>"}` }],
      });
      const loc = parseJsonLoose(textOf(find));
      if (!loc || loc.found === false) { results.push({ subject: subj.subject_id, ok: false, reason: "not_found" }); continue; }
      const sourceUrl = (loc.pdfUrl || loc.pageUrl || null);
      const examYear = Number.isFinite(+loc.examYear) ? +loc.examYear : null;

      // 2. Fetch + parse the PDF when available (best-effort enrichment).
      let pdfText = null;
      if (loc.pdfUrl) pdfText = await fetchCollegeBoardPdfText(loc.pdfUrl);

      // 3. Analyze concepts — from the PDF text if we got it, else have the
      //    web plugin read the CED page.
      let concepts = null;
      if (pdfText) {
        const an = await callLLM({
          max_tokens: 1500, temperature: 0,
          system: "You extract the official units/concepts of an AP course from its CED text. Output ONLY JSON.",
          messages: [{ role: "user", content:
            `From this AP "${subj.name}" CED text, list the main units/concepts with an approximate exam weight (0-1, summing ~1) and 2-4 keywords each. Return ONLY JSON:\n` +
            `{"concepts":[{"name":"...","weight":<0-1>,"keywords":["..."]}]}\n\nCED TEXT:\n${pdfText}` }],
        });
        concepts = parseJsonLoose(textOf(an))?.concepts || null;
      } else if (loc.pageUrl) {
        const an = await callLLM({
          max_tokens: 1500, temperature: 0, wantsWeb: true, extraDomains: ["collegeboard.org"],
          system: "You read the official AP CED page on collegeboard.org and list its units/concepts. Output ONLY JSON.",
          messages: [{ role: "user", content:
            `Read the official CED for "${subj.name}" at ${loc.pageUrl} and list the main units/concepts with an approximate exam weight (0-1) and 2-4 keywords. Return ONLY JSON:\n` +
            `{"concepts":[{"name":"...","weight":<0-1>,"keywords":["..."]}]}` }],
        });
        concepts = parseJsonLoose(textOf(an))?.concepts || null;
      }

      if (Array.isArray(concepts) && concepts.length > 0 && sourceUrl) {
        ins.run(subj.subject_id, examYear, String(sourceUrl).slice(0, 400), JSON.stringify({ concepts, parsedPdf: !!pdfText }));
        results.push({ subject: subj.subject_id, ok: true, concepts: concepts.length, examYear, parsedPdf: !!pdfText, sourceUrl });
      } else {
        results.push({ subject: subj.subject_id, ok: false, reason: "no_concepts" });
      }
    } catch (err) { results.push({ subject: subj.subject_id, ok: false, error: err?.message }); }
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
  }
  return { ok: true, results };
}

// ─── Adversarial verification (multi-lens quorum) ────────────────────────
// A single re-check can be fooled the same way the original scrape was. So we
// cross-examine each scraped admissions claim through THREE independent lenses,
// each restricted to a DIFFERENT credible source family:
//   A. the institution's Common Data Set (commondataset.org + its own .edu)
//   B. the federal College Scorecard / NCES IPEDS data
//   C. the originally cited source page itself (re-read)
// Each lens votes confirm / contradict / unconfirmed. Quorum:
//   • verified     — ≥2 lenses confirm-and-match AND none contradict
//   • discrepancy  — ANY credible lens contradicts (a value differs)
//   • unverified   — otherwise (not enough independent confirmation)
// Per-lens votes are logged to seasonal_verifications. A "discrepancy" verdict
// QUARANTINES the freshly-scraped value: the web-sourced cds_records row is
// removed so contradicted data can never reach a student's context.
function buildVerificationLenses(record) {
  const sourceHost = extractHost(record.sourceUrl);
  const eduFromSource = sourceHost && sourceHost.endsWith(".edu") ? [sourceHost] : [];
  return [
    { key: "common_data_set", label: "the institution's Common Data Set", domains: ["commondataset.org", ...eduFromSource] },
    { key: "college_scorecard", label: "the federal College Scorecard and NCES IPEDS data", domains: ["collegescorecard.ed.gov", "nces.ed.gov"] },
    { key: "cited_source", label: "the originally cited source page", domains: sourceHost ? [sourceHost] : ["commondataset.org"] },
  ];
}

// Read the locally-cached, validated CDS sidecar for a slug (overrides already
// applied during parsing). Same field names as a scraped `record`, so values
// compare directly. Returns null when no sidecar exists for this slug.
function readParsedCDS(slug) {
  try {
    const p = path.join(CDS_PARSED_DIR, `${slug}.json`);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch { return null; }
}

// Retrieval-first verification: compare the scraped record against two
// deterministic, zero-token lenses — the institution's cached Common Data Set
// (Lens A) and the federal College Scorecard (Lens B) — using the numeric
// comparator in seasonal-verification-v2.js. Returns a conclusive tally only
// when the lenses clearly agree (≥2 confirm) or any lens contradicts; returns
// null when the local evidence is inconclusive so the caller can fall back to
// the LLM web lenses. Costs no LLM tokens.
async function tryDeterministicVerification(record, { scorecardApiKey, unitId } = {}) {
  const slug = record.slug || slugifySchoolName(record.school || "");
  const sat = record.enrolledSAT || {};
  const scraped = {
    admit_rate: Number.isFinite(record.overallAdmitRate) ? record.overallAdmitRate : null,
    sat_25: Number.isFinite(sat.p25) ? sat.p25 : null,
    sat_75: Number.isFinite(sat.p75) ? sat.p75 : null,
  };

  // Lens A — local parsed CDS sidecar (fractions + composite SAT, same units).
  const cds = readParsedCDS(slug);
  const lensA = cds ? {
    admit_rate: Number.isFinite(cds.overallAdmitRate) ? cds.overallAdmitRate : null,
    sat_25: Number.isFinite(cds.enrolledSAT?.p25) ? cds.enrolledSAT.p25 : null,
    sat_75: Number.isFinite(cds.enrolledSAT?.p75) ? cds.enrolledSAT.p75 : null,
  } : null;

  // Lens B — federal College Scorecard. acceptanceRate is a percentage (e.g.
  // 3.65); divide by 100 so it shares the scraped record's fraction units.
  let lensB = null;
  if (scorecardApiKey && unitId) {
    const row = await getCollegeById(scorecardApiKey, unitId);
    if (row) {
      lensB = {
        admit_rate: Number.isFinite(row.acceptanceRate) ? row.acceptanceRate / 100 : null,
        sat_25: Number.isFinite(row.sat25) ? row.sat25 : null,
        sat_75: Number.isFinite(row.sat75) ? row.sat75 : null,
      };
    }
  }

  if (!lensA && !lensB) return null;

  const fields = ["admit_rate", "sat_25", "sat_75"];
  const votes = [];
  for (const [lensKey, vals] of [["common_data_set", lensA], ["college_scorecard", lensB]]) {
    if (!vals) continue;
    let confirm = 0, contradict = 0, compared = 0;
    for (const field of fields) {
      const s = scraped[field], lv = vals[field];
      if (!Number.isFinite(s) || !Number.isFinite(lv)) continue;
      compared++;
      const r = compareLensValues(s, lv, field);
      if (r === "confirm") confirm++;
      else if (r === "contradict") contradict++;
    }
    if (compared === 0) continue;
    const vote = contradict >= 1 ? "contradict" : confirm >= 1 ? "confirm" : "unconfirmed";
    votes.push({ lens: lensKey, vote, compared, confirm, contradict });
  }
  if (votes.length === 0) return null;

  const confirms = votes.filter((v) => v.vote === "confirm").length;
  const contradicts = votes.filter((v) => v.vote === "contradict").length;
  // Conclusive only when authoritative sources clearly agree or any disagrees.
  if (contradicts >= 1 || confirms >= 2) return { slug, votes, confirms, contradicts };
  return null;
}

export async function verifySeasonalRecord(db, callLLM, runId, record, opts = {}) {
  if (!record) return { status: "unverified", reason: "no_record" };
  const slug = record.slug || slugifySchoolName(record.school || "");
  const admitPct = record.overallAdmitRate != null ? Math.round(record.overallAdmitRate * 1000) / 10 : null;
  const sat = record.enrolledSAT || {};
  const claim = [
    admitPct != null ? `overall admit rate ≈ ${admitPct}%` : null,
    (sat.p25 && sat.p75) ? `enrolled SAT 25/75 ≈ ${sat.p25}/${sat.p75}` : null,
  ].filter(Boolean).join("; ");
  if (!claim) return { status: "unverified", reason: "nothing_to_verify" };

  const logVote = (field, status, notes, sourceUrl) => {
    try {
      db.prepare(
        `INSERT INTO seasonal_verifications (run_id, slug, school, field, scraped_value, source_url, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(runId, slug, record.school || "", field, claim.slice(0, 300), sourceUrl || null, status, (notes || "").slice(0, 300));
    } catch { /* non-fatal */ }
  };

  const quarantine = () => {
    try {
      const res = db.prepare(
        `DELETE FROM cds_records WHERE slug = ? AND source_kind LIKE '%web%'`,
      ).run(slug);
      return res.changes > 0;
    } catch { return false; }
  };

  // ─── Retrieval-first pre-check (zero LLM tokens) ───────────────────────
  // Compare against the cached CDS + federal Scorecard before spending any
  // web-search tokens. Only short-circuits on a conclusive local verdict;
  // otherwise falls through to the LLM web lenses below.
  try {
    const det = await tryDeterministicVerification(record, {
      scorecardApiKey: opts.scorecardApiKey,
      unitId: opts.unitId,
    });
    if (det) {
      for (const v of det.votes) {
        logVote(
          `admissions:${v.lens}`,
          v.vote,
          `deterministic compared=${v.compared} confirm=${v.confirm} contradict=${v.contradict}`,
          v.lens === "college_scorecard" ? "collegescorecard.ed.gov" : "commondataset.org",
        );
      }
      const status = det.contradicts >= 1 ? "discrepancy" : "verified";
      let quarantined = false;
      if (status === "discrepancy") quarantined = quarantine();
      logVote(
        "admissions",
        status,
        `deterministic confirms=${det.confirms} contradicts=${det.contradicts}${quarantined ? " quarantined" : ""}`,
        record.sourceUrl,
      );
      return { status, confirms: det.confirms, contradicts: det.contradicts, votes: det.votes, quarantined, deterministic: true };
    }
  } catch { /* fall through to LLM lenses */ }

  // ─── LLM web lenses (fallback when local evidence is inconclusive) ─────
  if (!callLLM) return { status: "unverified", reason: "inconclusive_no_llm" };

  const lenses = buildVerificationLenses(record);
  const votes = [];
  for (const lens of lenses) {
    let vote = "unconfirmed", notes = "", lensSource = lens.domains[0] || null;
    try {
      const resp = await callLLM({
        max_tokens: 600, temperature: 0, wantsWeb: true, extraDomains: lens.domains,
        system: `You independently verify admissions statistics using ${lens.label} ONLY. Be skeptical; confirm a number only if that source actually states it, and report a mismatch honestly. Output ONLY JSON.`,
        messages: [{ role: "user", content:
          `Using ${lens.label}, verify for "${record.school}" (originally cited: ${record.sourceUrl || "none"}): ${claim}. ` +
          `Return ONLY JSON: {"confirmed":<true|false>,"matches":<true|false>,"notes":"<short>","sourceUrl":"<url|null>"}` }],
      });
      const j = parseJsonLoose(textOf(resp));
      if (j) {
        notes = String(j.notes || "");
        lensSource = j.sourceUrl || lensSource;
        if (j.confirmed === true && j.matches === false) vote = "contradict";
        else if (j.confirmed === true && j.matches !== false) vote = "confirm";
        else vote = "unconfirmed";
      }
    } catch (err) {
      notes = `lens error: ${err?.message || "unknown"}`;
      vote = "unconfirmed";
    }
    votes.push({ lens: lens.key, vote });
    logVote(`admissions:${lens.key}`, vote, notes, lensSource);
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
  }

  const confirms = votes.filter((v) => v.vote === "confirm").length;
  const contradicts = votes.filter((v) => v.vote === "contradict").length;
  let status;
  if (contradicts >= 1) status = "discrepancy";
  else if (confirms >= 2) status = "verified";
  else status = "unverified";

  // Quarantine on contradiction: drop the freshly web-scraped row so a
  // contradicted stat can never surface to a student. Scoped to web-sourced
  // rows so curated/PDF records are never touched.
  let quarantined = false;
  if (status === "discrepancy") {
    try {
      const res = db.prepare(
        `DELETE FROM cds_records WHERE slug = ? AND source_kind LIKE '%web%'`,
      ).run(slug);
      quarantined = res.changes > 0;
    } catch { /* non-fatal */ }
  }

  logVote(
    "admissions",
    status,
    `confirms=${confirms} contradicts=${contradicts}${quarantined ? " quarantined" : ""}`,
    record.sourceUrl,
  );
  return { status, confirms, contradicts, votes, quarantined };
}

// ─── Orchestrator entrypoint ────────────────────────────────────────────
// Ties it together: resolve colleges → fetch admissions → verify each →
// AP distributions → AP concept proposals. Logs the run. Safe no-op (and a
// clear reason) when there's no operator OpenRouter key.
export async function runSeasonalResearch(db, ragStmts, callLLM, opts = {}) {
  ensureSeasonalTables(db);
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const trigger = opts.trigger || "manual";
  if (!callLLM) {
    return { ok: false, runId, reason: "no_operator_openrouter_key", startedAt };
  }

  // Backfill official .edu sites from the Scorecard cache so each college's
  // own host can scope its web search (best-effort; never fatal).
  try { hydrateBaselineWebsites(db); } catch { /* optional */ }

  const colleges = resolveSeasonalColleges(db, { topN: opts.topN ?? 25, explicitColleges: opts.colleges || [] });
  // slug → unitId, so the deterministic Scorecard lens can be looked up per record.
  const unitBySlug = new Map(colleges.map((c) => [c.slug, c.unitId]).filter(([, u]) => u));
  const adm = await fetchSeasonalAdmissions(ragStmts, callLLM, colleges, { delayMs: opts.delayMs ?? 750 });

  // Adversarially verify each persisted admissions record.
  let verified = 0, flagged = 0;
  for (const r of (adm.results || [])) {
    if (r.ok && r.record) {
      const recSlug = r.record.slug || r.slug;
      const v = await verifySeasonalRecord(db, callLLM, runId, r.record, {
        delayMs: opts.delayMs ?? 750,
        scorecardApiKey: opts.scorecardApiKey || null,
        unitId: unitBySlug.get(recSlug) || null,
      });
      if (v.status === "verified") verified++; else flagged++;
      r.verification = v.status;
      if (v.quarantined) r.quarantined = true;
      if (opts.delayMs) await new Promise((x) => setTimeout(x, opts.delayMs));
    }
  }

  // AP (when requested — default on).
  const subjects = opts.subjects || DEFAULT_AP_SUBJECTS;
  const apDist = opts.skipAP ? { results: [] } : await fetchAPScoreDistributions(db, callLLM, subjects, { delayMs: opts.delayMs ?? 750 });
  const apConcepts = opts.skipAP ? { results: [] } : await refreshAPConceptsFromPDFs(db, callLLM, subjects, { delayMs: opts.delayMs ?? 750 });

  const admissionsOk = (adm.results || []).filter((r) => r.ok).length;
  const admissionsFailed = (adm.results || []).length - admissionsOk;
  const apProposals = (apConcepts.results || []).filter((r) => r.ok).length;
  const finishedAt = new Date().toISOString();
  const summary = {
    colleges: colleges.length, admissionsOk, admissionsFailed, verified, flagged,
    apSubjects: subjects.length, apDistributions: (apDist.results || []).filter((r) => r.ok).length, apProposals,
    admissions: adm.results, apDist: apDist.results, apConcepts: apConcepts.results,
  };
  try {
    db.prepare(
      `INSERT INTO seasonal_research_runs (run_id, started_at, finished_at, trigger, colleges_count, admissions_ok, admissions_failed, verified, flagged, ap_subjects, ap_proposals, summary_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(runId, startedAt, finishedAt, trigger, colleges.length, admissionsOk, admissionsFailed, verified, flagged, subjects.length, apProposals, JSON.stringify(summary));
  } catch { /* non-fatal */ }

  return { ok: true, runId, startedAt, finishedAt, trigger, summary };
}

// Read the latest run for status surfaces (/api/methodology, /api/baselines).
export function getLatestSeasonalRun(db) {
  try {
    ensureSeasonalTables(db);
    const row = db.prepare("SELECT run_id, started_at, finished_at, trigger, colleges_count, verified, flagged, ap_proposals FROM seasonal_research_runs ORDER BY datetime(started_at) DESC LIMIT 1").get();
    return row || null;
  } catch { return null; }
}

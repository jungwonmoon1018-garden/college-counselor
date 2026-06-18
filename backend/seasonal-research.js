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

import { slugifySchoolName, extractCdsViaWeb, extractAdmitRateViaWeb } from "./cds-store.js";
import { persistAndValidate } from "./cds-validator.js";

// Per-college search restriction. We don't reliably know each college's own
// .edu host (baseline_colleges has no domain column), but the credible-sources
// allowlist already covers the major selective schools' .edu domains, and CDS
// + Scorecard hosts work for any school. (A future refinement can pass a
// resolved .edu host per college.)
const SEASONAL_EXTRA_DOMAINS = Object.freeze([
  "commondataset.org",
  "collegescorecard.ed.gov",
  "nces.ed.gov",
]);

// ─── College set: students' targets ∪ operator top-N (most selective) ───
// Deduped by slug. `explicitColleges` (from the manual trigger) wins first.
export function resolveSeasonalColleges(db, { topN = 25, explicitColleges = [] } = {}) {
  const set = new Map(); // slug -> { name, slug, unitId, source }
  const add = (name, unitId, source) => {
    const clean = typeof name === "string" ? name.trim() : "";
    if (!clean) return;
    const slug = slugifySchoolName(clean);
    if (!slug || set.has(slug)) return;
    set.set(slug, { name: clean, slug, unitId: unitId || null, source });
  };

  // 1. Explicit list (manual trigger).
  for (const c of explicitColleges || []) {
    if (typeof c === "string") add(c, null, "explicit");
    else if (c && typeof c === "object") add(c.name, c.unitId || c.unit_id, "explicit");
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
        "SELECT name, unit_id FROM baseline_colleges WHERE acceptance_rate IS NOT NULL AND name IS NOT NULL ORDER BY acceptance_rate ASC LIMIT ?",
      ).all(topN);
      for (const r of rows) add(r.name, r.unit_id, "topN");
    } catch { /* baseline optional */ }
  }

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
    // Prefer the full CDS read; fall back to the lightweight admit-rate read.
    try {
      const cds = await extractCdsViaWeb({ callLLM, byok, schoolName: college.name, extraDomains: SEASONAL_EXTRA_DOMAINS });
      if (cds) { rec = cds; source = "cds_web"; }
    } catch (err) { /* fall through to admit-rate */ }
    if (!rec) {
      try {
        const ar = await extractAdmitRateViaWeb({ callLLM, byok, schoolName: college.name, extraDomains: SEASONAL_EXTRA_DOMAINS });
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

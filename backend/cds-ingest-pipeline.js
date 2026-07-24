// ═══════════════════════════════════════════════════════════════════════
// cds-ingest-pipeline.js — orchestrates the full CDS ingestion lifecycle.
// ═══════════════════════════════════════════════════════════════════════
//   1. Resolve school name → CDS PDF URL via cds-search.js
//   2. Download the PDF (Google Drive direct-download)
//   3. Parse via cds-pdf-parser.js (positional + form-field merge)
//   4. Validate + persist via cds-validator.js (writes RAG-engine tables)
//
// This module is the single import point for ingestion code (server.js
// admin endpoints, cron jobs, CLI scripts). It assumes a prepared-RAG
// `stmts` object from rag-engine.js::prepareRAGStatements().
// ═══════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchRepositoryIndex, findBestRepositoryEntry, selectPreferredCdsLink, parseCdsRepositoryIndex } from "./cds-search.js";
import { parseCDSPositional } from "./cds-pdf-parser.js";
import { persistAndValidate } from "./cds-validator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "data", "cds-cache");
const PDF_DIR = path.join(CACHE_DIR, "pdfs");
// Operator-registered CDS source links (written by scripts/add-cds-cycle.mjs).
// These are authoritative — an operator curated them from each school's
// official institutional-research page — so they MERGE INTO and OVERRIDE the
// scraped collegetransitions index below. Without this merge the registered
// links were dead: getRepositoryIndex only read the scraped HTML, so a fresh
// cycle added via add-cds-cycle never reached downloadCDS.
const OPERATOR_INDEX_PATH = path.join(__dirname, "tools", "cds-cache", "index.json");

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

function ensureDirs() {
  for (const d of [CACHE_DIR, PDF_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);
}

// ─── Operator-registered index merge ─────────────────────────────────────
// Read tools/cds-cache/index.json (array or slug-keyed object of
// { name, slug, links:{cycle:url} }). Returns [] when absent/unreadable.
function loadOperatorIndex() {
  try {
    if (!fs.existsSync(OPERATOR_INDEX_PATH)) return [];
    const raw = JSON.parse(fs.readFileSync(OPERATOR_INDEX_PATH, "utf8"));
    const entries = Array.isArray(raw) ? raw : Object.values(raw);
    return entries.filter((e) => e && (e.name || e.slug) && e.links && typeof e.links === "object");
  } catch {
    return [];
  }
}

// Merge operator links onto the scraped index. Match by normalized slug
// (recomputed with this module's slugify so it lines up with enrichIndex,
// regardless of how add-cds-cycle stored the slug). Operator links WIN on a
// cycle-key conflict; schools absent from the scrape are appended. downloadCDS
// then picks the newest cycle key, so a freshly-registered 2025-26 link is used.
function mergeOperatorIndex(scraped) {
  const op = loadOperatorIndex();
  if (op.length === 0) return scraped;
  const bySlug = new Map(scraped.map((e) => [e.slug, e]));
  let merged = 0, appended = 0;
  for (const oe of op) {
    const slug = slugify(oe.name || oe.slug);
    const target = bySlug.get(slug);
    if (target) {
      target.links = { ...(target.links || {}), ...oe.links };
      merged++;
    } else {
      const entry = { name: oe.name || oe.slug, slug, links: { ...oe.links } };
      scraped.push(entry);
      bySlug.set(slug, entry);
      appended++;
    }
  }
  if (merged || appended) {
    console.log(`[cds-index] merged operator links: ${merged} matched, ${appended} appended (${op.length} registered).`);
  }
  return scraped;
}

// ─── Drive URL resolver ──────────────────────────────────────────────
// The College Transitions repository wraps every CDS link in a Google
// redirect: https://www.google.com/url?q=<ENCODED_TARGET>&sa=D&... — unwrap
// it to the real destination before resolving a download URL. Without this,
// the Drive file-id regex captures trailing "&sa=D&source=..." junk and the
// download 404s.
export function unwrapGoogleRedirect(url) {
  if (!url) return url;
  const s = String(url);
  if (!/google\.com\/url\?/.test(s)) return s;
  const m = s.match(/[?&]q=([^&]+)/);
  if (!m) return s;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

export function resolveDownloadURL(url) {
  if (!url) return null;
  url = unwrapGoogleRedirect(url);
  if (/\.pdf(\?|$)/i.test(url)) return url;
  // Stop the id capture at /, ?, & so trailing query params don't pollute it.
  const driveFile = url.match(/drive\.google\.com\/file\/d\/([^/?&]+)/);
  if (driveFile) return `https://drive.google.com/uc?export=download&id=${driveFile[1]}`;
  const driveOpen = url.match(/drive\.google\.com\/(?:open|uc)\?(?:export=download&)?id=([^&]+)/);
  if (driveOpen) return `https://drive.google.com/uc?export=download&id=${driveOpen[1]}`;
  const sheetsExport = url.match(/docs\.google\.com\/spreadsheets\/d\/([^/?&]+)/);
  if (sheetsExport) return `https://docs.google.com/spreadsheets/d/${sheetsExport[1]}/export?format=xlsx`;
  return url;
}

// Try one cycle's link: cache hit, else fetch + magic-byte sniff. Returns a
// result object or throws (so the caller can fall back to an older cycle).
async function tryDownloadCycle({ slug, name, yearKey, link, force }) {
  const downloadURL = resolveDownloadURL(link);
  const targetPDF = path.join(PDF_DIR, `${slug}.${yearKey}.pdf`);
  const targetXLSX = path.join(PDF_DIR, `${slug}.${yearKey}.xlsx`);

  for (const p of [targetPDF, targetXLSX]) {
    if (!force && fs.existsSync(p) && fs.statSync(p).size > 1024) {
      return {
        path: p, sizeBytes: fs.statSync(p).size, fromCache: true,
        kind: p.endsWith(".pdf") ? "pdf" : "xlsx",
        url: downloadURL, year: yearKey,
      };
    }
  }

  const res = await fetch(downloadURL, { headers: BROWSER_HEADERS, redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${name} ${yearKey}`);
  const buf = Buffer.from(await res.arrayBuffer());

  const head = buf.slice(0, 4).toString("hex");
  let kind = "unknown";
  let target = targetPDF;
  if (head.startsWith("25504446")) { kind = "pdf"; target = targetPDF; }
  else if (head.startsWith("504b0304")) { kind = "xlsx"; target = targetXLSX; }
  else {
    const sniff = buf.slice(0, 256).toString("utf8");
    if (/<html/i.test(sniff)) {
      throw new Error(`HTML interstitial (not a PDF) for ${name} ${yearKey}`);
    }
    target = path.join(PDF_DIR, `${slug}.${yearKey}.bin`);
  }
  fs.writeFileSync(target, buf);
  return { path: target, sizeBytes: buf.length, fromCache: false, kind, url: downloadURL, year: yearKey };
}

export async function downloadCDS({ school, year, force = false }) {
  ensureDirs();
  const slug = school.slug || slugify(school.name);
  const links = school.links || {};
  // Build the cycle attempt order: the explicitly requested year first (if
  // present), then every cycle newest→oldest. We try each in turn and return
  // the first that actually downloads — so a registered-but-dead 2025-26 link
  // (a school that hasn't published yet) gracefully falls back to the newest
  // cycle that IS live (e.g. collegetransitions' 2024-25) instead of failing.
  const ordered = Object.keys(links).sort().reverse();
  const attemptKeys = year && links[year] ? [year, ...ordered.filter((k) => k !== year)] : ordered;
  if (attemptKeys.length === 0) throw new Error(`No CDS link for ${school.name}`);

  let lastErr = null;
  for (const yearKey of attemptKeys) {
    try {
      return await tryDownloadCycle({ slug, name: school.name, yearKey, link: links[yearKey], force });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error(`No downloadable CDS link for ${school.name}`);
}

// ─── Repository index loader (cached for 24h) ────────────────────────
const INDEX_TTL_MS = 24 * 60 * 60 * 1000;
let indexCache = null;
let indexFetchedAt = 0;

export async function getRepositoryIndex({ force = false, fetchImpl = fetch } = {}) {
  const now = Date.now();
  if (!force && indexCache && now - indexFetchedAt < INDEX_TTL_MS) return indexCache;
  const indexHTMLPath = path.join(CACHE_DIR, "index.html");
  ensureDirs();

  // Disk-cache fallback
  if (!force && fs.existsSync(indexHTMLPath) &&
      Date.now() - fs.statSync(indexHTMLPath).mtimeMs < INDEX_TTL_MS) {
    const html = fs.readFileSync(indexHTMLPath, "utf8");
    indexCache = mergeOperatorIndex(enrichIndex(parseIndex(html)));
    indexFetchedAt = now;
    return indexCache;
  }

  // cds-search.js's fetchRepositoryIndex returns the raw repository HTML
  // (NOT parsed entries) — it must be run through parseIndex before use.
  // Treating its return as entries was a latent bug that crashed every
  // happy-path ingest (enrichIndex/findBestRepositoryEntry call .map on a
  // string), which is why the admin ingest never populated cds_records.
  let html;
  try {
    html = await fetchRepositoryIndex({ fetchImpl });
  } catch (e) {
    // Fall back to direct fetch with browser headers (Cloudflare-friendly).
    const res = await fetchImpl("https://www.collegetransitions.com/dataverse/common-data-set-repository/", { headers: BROWSER_HEADERS });
    if (!res.ok) throw new Error(`Index fetch failed: ${res.status}`);
    html = await res.text();
  }
  try { fs.writeFileSync(indexHTMLPath, html); } catch { /* cache write is best-effort */ }

  // Decorate with a `links` map keyed by year label (back-compat with
  // the older ingester contract used by sample CLIs).
  indexCache = mergeOperatorIndex(enrichIndex(parseIndex(html)));
  indexFetchedAt = now;
  return indexCache;
}

function parseIndex(html) {
  // Use the same parser cds-search.js exposes — kept here as a thin
  // wrapper so callers can pass raw HTML when needed.
  return parseCdsRepositoryIndex(html);
}

function enrichIndex(entries) {
  return entries.map((e) => {
    // parseCdsRepositoryIndex emits { schoolName, normalizedSchoolName, years }
    // where each year is { year, available, links: [{ label, url }] }. The old
    // code read e.name / e.links (which don't exist), producing slug
    // "undefined" and empty link maps.
    const name = e.schoolName || e.name || "";
    const slug = slugify(name);
    const links = {};
    const yearList = Array.isArray(e.years) ? e.years : (Array.isArray(e.links) ? e.links : []);
    for (const y of yearList) {
      const url = y.url || (Array.isArray(y.links) ? y.links.find((l) => l.url)?.url : null);
      if (y.year && url) links[y.year] = url;
    }
    return { ...e, name, slug, links };
  });
}

// ─── Single-school ingest ─────────────────────────────────────────────
// Fetches, parses, validates, and persists ONE school's CDS. Returns a
// summary the server can render or log.
export async function ingestOne(stmts, schoolName, options = {}) {
  const { year, force = false, tier = null } = options;
  const index = await getRepositoryIndex();
  const entry = findBestRepositoryEntry(index, schoolName) ||
                index.find((e) => e.name.toLowerCase() === String(schoolName).toLowerCase());
  if (!entry) {
    return { school: schoolName, status: "not_in_index" };
  }

  let dl;
  try {
    dl = await downloadCDS({ school: entry, year, force });
  } catch (e) {
    return { school: entry.name, slug: entry.slug, status: "download_failed", error: String(e.message).slice(0, 200) };
  }
  if (dl.kind !== "pdf") {
    return { school: entry.name, slug: entry.slug, status: "non_pdf", kind: dl.kind, year: dl.year };
  }

  let parsed;
  try {
    parsed = await parseCDSPositional(dl.path);
  } catch (e) {
    return { school: entry.name, slug: entry.slug, status: "parse_failed", error: String(e.message).slice(0, 200) };
  }

  const recordForValidator = {
    ...parsed,
    school: entry.name,
    slug: entry.slug,
    yearLabel: dl.year,
    tier,
    sourcePdfPath: dl.path,
    sourceUrl: dl.url,
    sourceKind: parsed.parserNotes?.includes?.("merged_form_fields") ? "pdf_merged" : "pdf_text",
  };

  const result = await persistAndValidate(stmts, recordForValidator, { tier, sourceUrl: dl.url });

  return {
    school: entry.name,
    slug: entry.slug,
    status: result.validation.status,
    year: dl.year,
    discrepancies: result.validation.discrepancies.length,
    overrides: Object.keys(result.validation.overrides),
    admitRate: result.cdsRow.overall_admit_rate,
    sat: result.cdsRow.enrolled_sat_p25 != null
      ? { p25: result.cdsRow.enrolled_sat_p25, p75: result.cdsRow.enrolled_sat_p75 }
      : null,
  };
}

// ─── Bulk ingest ──────────────────────────────────────────────────────
export async function ingestBulk(stmts, targets, { concurrency = 3, year = "2023-24", force = false } = {}) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < targets.length) {
      const idx = i++;
      const t = targets[idx];
      const schoolName = typeof t === "string" ? t : t.name;
      const tier = typeof t === "object" ? t.tier : null;
      try {
        const r = await ingestOne(stmts, schoolName, { year, force, tier });
        results.push(r);
      } catch (e) {
        results.push({ school: schoolName, status: "error", error: String(e.message).slice(0, 200) });
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// ─── Full refresh over the whole repository index ─────────────────────
// Re-scrapes the collegetransitions index (force) — which also re-merges the
// operator-registered links — then ingests every school, preferring the newest
// cycle (downloadCDS handles that + the older-cycle fallback). Used by the
// scheduled daily June-onward refresh so the freshest CDS reaches College Fit.
// True on/after June 1 (month index >= 5). New CDS cycles publish across the
// summer, so the scheduled daily refresh stays idle Jan–May and runs Jun–Dec.
export function shouldRunCdsRefresh(nowMs) {
  return new Date(nowMs ?? Date.now()).getMonth() >= 5;
}

export async function refreshAllCds(stmts, { concurrency = 3, year = null } = {}) {
  const index = await getRepositoryIndex({ force: true });
  const targets = index.map((e) => e.name).filter(Boolean);
  const results = await ingestBulk(stmts, targets, { concurrency, year });
  const byStatus = {};
  for (const r of results) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  return { total: results.length, byStatus };
}

// ─── Re-validate without re-fetching ──────────────────────────────────
// When CORRECTIONS changes (operator added new ground truth), re-run
// validation against existing cds_records rows without re-downloading.
export async function revalidateAll(stmts) {
  const rows = stmts.cds.listAll.all();
  const results = [];
  for (const row of rows) {
    const record = {
      slug: row.slug,
      school: row.school_name,
      yearLabel: row.year_label,
      year: row.year,
      tier: row.tier,
      overallAdmitRate: row.overall_admit_rate,
      yieldRate: row.yield_rate,
      enrolledSAT: row.enrolled_sat_p25 != null
        ? { p25: row.enrolled_sat_p25, p75: row.enrolled_sat_p75 } : null,
      enrolledACT: row.enrolled_act_p25 != null
        ? { p25: row.enrolled_act_p25, p75: row.enrolled_act_p75 } : null,
      enrolledGPA: row.enrolled_gpa_p25 != null
        ? { p25: row.enrolled_gpa_p25, p75: row.enrolled_gpa_p75 } : null,
      testPolicy: row.test_policy,
      c7: row.c7_json ? safeJSON(row.c7_json, {}) : {},
      b1: row.b1_json ? safeJSON(row.b1_json, null) : null,
      sourceUrl: row.source_url,
      sourceKind: row.source_kind,
      parserVersion: row.parser_version,
      parserNotes: row.parser_notes_json ? safeJSON(row.parser_notes_json, []) : [],
    };
    const r = await persistAndValidate(stmts, record);
    results.push({
      slug: record.slug,
      status: r.validation.status,
      discrepancies: r.validation.discrepancies.length,
    });
  }
  return results;
}

function safeJSON(raw, fallback) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

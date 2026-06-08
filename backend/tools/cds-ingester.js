// ═══════════════════════════════════════════════════════════════════════
// cds-ingester.js — pulls Common Data Set PDFs from College Transitions'
// public repository and turns them into structured records the
// positioning engine can consume.
// ═══════════════════════════════════════════════════════════════════════
//
// The College Transitions repo (https://www.collegetransitions.com/
// dataverse/common-data-set-repository/) is a curated index of links to
// each school's official CDS, hosted on Google Drive. The page is the
// most complete public mirror because schools individually scatter CDS
// PDFs across various office-of-institutional-research microsites.
//
// Pipeline:
//   1. fetchIndex()       — fetch + parse the index page → {school, links}
//   2. resolveDownloadURL — convert Drive view URLs to direct downloads
//   3. downloadCDS()      — cache the PDF to disk with year-stamped name
//   4. parseCDS()         — extract B1, C7, C9 (admit, ratings, bands)
//
// Cache layout:
//   tools/cds-cache/
//     index.html              raw index page
//     index.json              parsed school→links map
//     pdfs/<slug>.<year>.pdf  cached PDF
//     parsed/<slug>.json      structured CDS record
// ═══════════════════════════════════════════════════════════════════════

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
// Re-route to the root-level parser, which has OCR-as-primary support and
// the strengthened C9/C12 extractors. The legacy tools/cds-pdf-positional.js
// stays in place for now but is no longer the canonical implementation.
import { parseCDSPositional } from "../cds-pdf-parser.js";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "cds-cache");
const PDF_DIR = path.join(CACHE_DIR, "pdfs");
const PARSED_DIR = path.join(CACHE_DIR, "parsed");

const INDEX_URL = "https://www.collegetransitions.com/dataverse/common-data-set-repository/";

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

function ensureDirs() {
  for (const d of [CACHE_DIR, PDF_DIR, PARSED_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);
}

// ─── 1. Index ─────────────────────────────────────────────────────────
// Fetch the index page once a day; rely on the disk cache otherwise.
export async function fetchIndex({ force = false } = {}) {
  ensureDirs();
  const cachedHTML = path.join(CACHE_DIR, "index.html");
  const ageMs = fs.existsSync(cachedHTML) ? Date.now() - fs.statSync(cachedHTML).mtimeMs : Infinity;
  const oneDay = 24 * 60 * 60 * 1000;
  if (!force && ageMs < oneDay) {
    return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, "index.json"), "utf8"));
  }
  const res = await fetch(INDEX_URL, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`Index fetch failed: ${res.status}`);
  const html = await res.text();
  fs.writeFileSync(cachedHTML, html);
  const rows = parseIndexHTML(html);
  fs.writeFileSync(path.join(CACHE_DIR, "index.json"), JSON.stringify(rows, null, 2));
  return rows;
}

export function parseIndexHTML(html) {
  // Build header → year map
  const headerRe = /<th[^>]*ninja_column_(\d+)[^>]*>([^<]+)<\/th>/g;
  const cols = {};
  let h;
  while ((h = headerRe.exec(html))) cols[h[1]] = h[2].trim();

  const rowRe = /<tr data-row_id="\d+"[^>]*>([\s\S]*?)<\/tr>/g;
  const rows = [];
  let r;
  while ((r = rowRe.exec(html))) {
    const inner = r[1];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    const cells = [];
    let t;
    while ((t = tdRe.exec(inner))) cells.push(t[1]);
    if (cells.length === 0) continue;

    const name = cells[0]
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&#8217;/g, "’")
      .replace(/&#8216;/g, "‘")
      .replace(/&nbsp;/g, " ")
      .trim();
    if (!name) continue;

    const links = {};
    for (let i = 1; i < cells.length; i++) {
      const cell = cells[i];
      const a = cell.match(/href="([^"]+)"/);
      if (!a) continue;
      let url = a[1].replace(/&amp;/g, "&");
      // Unwrap google redirect: /url?q=<inner>&...
      const inner = url.match(/\/url\?q=([^&]+)/);
      if (inner) url = decodeURIComponent(inner[1]);
      const year = cols[String(i + 1)] || `col${i + 1}`;
      links[year] = url;
    }
    if (Object.keys(links).length) rows.push({ name, slug: slugify(name), links });
  }
  return rows;
}

// ─── 2. Drive download URL resolver ───────────────────────────────────
// Convert https://drive.google.com/file/d/<ID>/view → uc?export=download&id=<ID>
// Spreadsheets get the export=xlsx URL. Plain .pdf URLs are returned as-is.
export function resolveDownloadURL(url) {
  if (!url) return null;
  if (/\.pdf(\?|$)/i.test(url)) return url;
  const driveFile = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (driveFile) return `https://drive.google.com/uc?export=download&id=${driveFile[1]}`;
  const driveOpen = url.match(/drive\.google\.com\/open\?id=([^&]+)/);
  if (driveOpen) return `https://drive.google.com/uc?export=download&id=${driveOpen[1]}`;
  const sheetsExport = url.match(/docs\.google\.com\/spreadsheets\/d\/([^/]+)/);
  if (sheetsExport) return `https://docs.google.com/spreadsheets/d/${sheetsExport[1]}/export?format=xlsx`;
  return url;
}

// ─── 3. Download a single CDS PDF ─────────────────────────────────────
// Returns { path, contentType, sizeBytes, fromCache, kind: "pdf"|"xlsx"|"unknown" }
// `kind` is detected from response Content-Type and the magic bytes.
export async function downloadCDS({ school, year, force = false }) {
  ensureDirs();
  const links = (school.links || {})[year];
  if (!links) throw new Error(`No CDS link for ${school.name} ${year}`);
  const downloadURL = resolveDownloadURL(links);
  const slug = school.slug || slugify(school.name);
  const targetPDF = path.join(PDF_DIR, `${slug}.${year}.pdf`);
  const targetXLSX = path.join(PDF_DIR, `${slug}.${year}.xlsx`);
  for (const p of [targetPDF, targetXLSX]) {
    if (!force && fs.existsSync(p) && fs.statSync(p).size > 1024) {
      return { path: p, sizeBytes: fs.statSync(p).size, fromCache: true, kind: p.endsWith(".pdf") ? "pdf" : "xlsx" };
    }
  }
  const res = await fetch(downloadURL, { headers: BROWSER_HEADERS, redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${school.name} ${year}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // Detect kind from magic bytes
  const head = buf.slice(0, 4).toString("hex");
  let kind = "unknown";
  let target = targetPDF;
  if (head.startsWith("25504446")) { kind = "pdf"; target = targetPDF; }
  else if (head.startsWith("504b0304")) { kind = "xlsx"; target = targetXLSX; }
  else {
    // Drive sometimes returns an HTML virus-warning page for big files; skip.
    const sniff = buf.slice(0, 256).toString("utf8");
    if (/<html/i.test(sniff)) {
      throw new Error(`Drive returned HTML (virus-warning interstitial) for ${school.name} ${year}`);
    }
    target = path.join(PDF_DIR, `${slug}.${year}.bin`);
  }
  fs.writeFileSync(target, buf);
  return { path: target, sizeBytes: buf.length, fromCache: false, kind };
}

// ─── 4. PDF parser → structured CDS fields ────────────────────────────
// Extracts the fields the positioning engine needs:
//   - cds.year                 from the document header
//   - cds.overallAdmitRate     from B1 (apps admitted / apps received)
//   - cds.enrolledGPA.{p25,p75}   approx from C12 (HS GPA dist)
//   - cds.enrolledSAT.{p25,p75}   from C9 (composite SAT 25th/75th)
//   - cds.enrolledACT.{p25,p75}   from C9 (composite ACT 25th/75th)
//   - cds.testPolicy           from C9 testing policy section
//   - cds.c7                   from C7 (each factor → very_important/important/considered/not_considered)
//   - cds.yieldRate            from B1 (enrolled / admitted)
//
// CDS PDFs are mostly plain text after pdf-parse extraction; format is
// reasonably consistent because the CDS template is published. Numbers
// land near specific labels — we anchor regexes to those labels.
export async function parseCDS(filePath) {
  const buf = fs.readFileSync(filePath);
  const data = await pdfParse(buf);
  const text = data.text;
  return extractCDSFields(text);
}

export function extractCDSFields(text) {
  const out = { source: "cds", parserVersion: 1 };

  // Year from "Common Data Set 2023-2024" or similar
  const yearM = text.match(/Common\s+Data\s+Set\s+(\d{4})\s*[-–]\s*(\d{2,4})/i);
  if (yearM) out.year = Number(yearM[1]);

  // ─ B1 / B2: total applicants & admitted ─
  // CDS B1 has a table with "Total first-time, first-year (freshman) men/women"
  // counts for applied / admitted / enrolled. We look for the totals row.
  // Patterns vary so we accept any of a few common formats.
  const apps = pickNumberAfterLabel(text, [
    /total\s+first-time,\s+first-year\s*\(freshman\)\s*men\s+who\s+applied[^\d]*([\d,]+)/i,
    /men[^\n]*women[^\n]*total[^\n]*\n[^\n]*applied[^\d]*([\d,]+)/i,
  ]);
  // Better: extract "Applicants — Total", "Admits — Total", "Enrolled — Total" via labelled triple.
  const totals = extractB1Totals(text);
  if (totals) {
    if (totals.applied && totals.admitted) {
      out.overallAdmitRate = round4(totals.admitted / totals.applied);
    }
    if (totals.admitted && totals.enrolled) {
      out.yieldRate = round4(totals.enrolled / totals.admitted);
    }
    out.b1 = totals;
  }

  // ─ C9: SAT / ACT 25th–75th bands ─
  // The line that matters is "SAT Composite" or "SAT EBRW + Math" with the
  // 25th–75th columns. Composite is sum (1600 scale); we use it directly.
  const satComp = matchBand(text, [
    /SAT\s+Composite[^\n]*?\b(\d{3,4})[^\d]+(\d{3,4})\b/i,
    /Composite\s+\(SAT\s+Total\)[^\n]*?\b(\d{3,4})[^\d]+(\d{3,4})\b/i,
  ]);
  if (satComp) out.enrolledSAT = { p25: satComp[0], p75: satComp[1] };
  else {
    const ebrw = matchBand(text, [/SAT\s+Evidence[- ]Based\s+Reading\s+and\s+Writing[^\n]*?\b(\d{3,4})[^\d]+(\d{3,4})\b/i]);
    const math = matchBand(text, [/SAT\s+Math[^\n]*?\b(\d{3,4})[^\d]+(\d{3,4})\b/i]);
    if (ebrw && math) out.enrolledSAT = { p25: ebrw[0] + math[0], p75: ebrw[1] + math[1] };
  }
  const actComp = matchBand(text, [
    /ACT\s+Composite[^\n]*?\b(\d{2})[^\d]+(\d{2})\b/i,
  ]);
  if (actComp) out.enrolledACT = { p25: actComp[0], p75: actComp[1] };

  // ─ Test policy ─
  if (/test[\s-]?blind/i.test(text)) out.testPolicy = "test_blind";
  else if (/test[\s-]?optional/i.test(text)) out.testPolicy = "test_optional";
  else out.testPolicy = "test_required";

  // ─ C12: HS GPA distribution → derive p25/p75 unweighted GPA bands ─
  const gpa = extractGPABands(text);
  if (gpa) out.enrolledGPA = gpa;

  // ─ C7: factor importance ratings ─
  out.c7 = extractC7Ratings(text);

  return out;
}

function extractB1Totals(text) {
  // Strategy: find a section starting with "B1" or "Applicants — Total" and
  // grab the first three numbers in the totals column. Many CDS PDFs use a
  // 4-column layout: men / women / men+women / [optional blank]. The "Total
  // (men+women)" column is what we want.
  // We try a layered approach:
  //  - Look for "Applicants" line, capture all numbers; the largest is total.
  //  - Same for "Admitted" and "Enrolled".
  const result = {};
  const block = section(text, /B1\b|Freshman\s+Admission/i, /B2\b|First-Time\s+Wait[- ]?listed|Wait\s+List/i);
  const target = block || text;

  function grab(label) {
    const re = new RegExp(`\\b${label}[^\\n]*\\n?[^\\n]*?([\\d,]{2,})(?:[^\\d\\n]+([\\d,]{2,}))?(?:[^\\d\\n]+([\\d,]{2,}))?(?:[^\\d\\n]+([\\d,]{2,}))?`, "i");
    const m = target.match(re);
    if (!m) return null;
    const nums = m.slice(1).filter(Boolean).map((s) => Number(s.replace(/,/g, ""))).filter((n) => !isNaN(n));
    if (nums.length === 0) return null;
    // Heuristic: biggest is the total; small noise like "0" or "1" is filtered.
    return Math.max(...nums);
  }

  const applied = grab("Total\\s+first-time,\\s+first-year") || grab("Applicants") || grab("Total\\s+applicants");
  const admitted = grab("Admitted\\s+applicants") || grab("Admits") || grab("Total\\s+admitted");
  const enrolled = grab("Total\\s+enrolled") || grab("Enrolled\\s+full-?time");
  if (applied) result.applied = applied;
  if (admitted) result.admitted = admitted;
  if (enrolled) result.enrolled = enrolled;
  return Object.keys(result).length ? result : null;
}

function extractGPABands(text) {
  // CDS C12: percentages of enrolled freshmen with GPAs in named bands.
  // We map the published cumulative thresholds to a synthetic p25 / p75.
  const bands = {
    "4.00": null, "3.75-3.99": null, "3.50-3.74": null, "3.25-3.49": null,
    "3.00-3.24": null, "2.50-2.99": null, "2.00-2.49": null, "1.00-1.99": null, "below_1": null,
  };
  const labelMap = [
    [/3\.75\s*[-–]\s*3\.99[^\n]*?([\d.]+)\s*%/i, "3.75-3.99"],
    [/3\.50\s*[-–]\s*3\.74[^\n]*?([\d.]+)\s*%/i, "3.50-3.74"],
    [/3\.25\s*[-–]\s*3\.49[^\n]*?([\d.]+)\s*%/i, "3.25-3.49"],
    [/3\.00\s*[-–]\s*3\.24[^\n]*?([\d.]+)\s*%/i, "3.00-3.24"],
    [/2\.50\s*[-–]\s*2\.99[^\n]*?([\d.]+)\s*%/i, "2.50-2.99"],
  ];
  let any = false;
  for (const [re, key] of labelMap) {
    const m = text.match(re);
    if (m) { bands[key] = Number(m[1]); any = true; }
  }
  // Capture 4.00 row separately: "4.0 [tab/spaces] N%"
  const m400 = text.match(/4\.00?\s+([\d.]+)\s*%/);
  if (m400) { bands["4.00"] = Number(m400[1]); any = true; }
  if (!any) return null;

  // Build cumulative from top down to estimate p75 (75% of enrolled have >= p75)
  // and p25 (25% have >= p25, i.e. the bottom of the upper quartile).
  const order = ["4.00","3.75-3.99","3.50-3.74","3.25-3.49","3.00-3.24","2.50-2.99","2.00-2.49","1.00-1.99","below_1"];
  const lowerOf = { "4.00":4.00, "3.75-3.99":3.75, "3.50-3.74":3.50, "3.25-3.49":3.25, "3.00-3.24":3.00, "2.50-2.99":2.50, "2.00-2.49":2.00, "1.00-1.99":1.00, "below_1":0 };
  let cum = 0;
  let p75 = null, p25 = null;
  for (const k of order) {
    const v = bands[k];
    if (v == null) continue;
    cum += v;
    if (p75 == null && cum >= 25) p75 = lowerOf[k];   // top quartile of enrolled
    if (p25 == null && cum >= 75) p25 = lowerOf[k];
  }
  if (p25 == null && p75 != null) p25 = Math.max(0, p75 - 0.4);
  if (p75 == null) return null;
  return { p25: round2(p25), p75: round2(p75), source: "C12_cumulative" };
}

const C7_FACTORS = [
  ["academic_gpa", /Academic\s+GPA/i, "gpa"],
  ["rigor_of_secondary_school_record", /Rigor\s+of\s+secondary\s+school\s+record/i, "rigor"],
  ["class_rank", /Class\s+rank/i, "class_rank"],
  ["standardized_test_scores", /Standardized\s+test\s+scores/i, "test_scores"],
  ["application_essay", /Application\s+essay/i, "application_essay"],
  ["recommendations", /Recommendation\(?s\)?/i, "recommendations"],
  ["interview", /Interview/i, "interview"],
  ["extracurricular_activities", /Extracurricular\s+activities/i, "ec"],
  ["talent_ability", /Talent\/?ability/i, "talent_ability"],
  ["character_personal_qualities", /Character\/?personal\s+qualities/i, "character"],
  ["first_generation", /First\s+generation/i, "first_generation"],
  ["alumni_relation", /Alumni\/?ae\s+relation/i, "alumni_relation"],
  ["geographical_residence", /Geographical\s+residence/i, "geographical_residence"],
  ["state_residency", /State\s+residency/i, "state_residency"],
  ["religious_affiliation", /Religious\s+affiliation/i, "religious_affiliation"],
  ["racial_ethnic_status", /Racial\/?ethnic\s+status/i, "racial_ethnic_status"],
  ["volunteer_work", /Volunteer\s+work/i, "volunteer_work"],
  ["work_experience", /Work\s+experience/i, "work_experience"],
  ["level_of_applicants_interest", /Level\s+of\s+applicant'?s?\s+interest/i, "level_of_interest"],
];

function extractC7Ratings(text) {
  // CDS C7 is typically a 4-column table: factor name + X-mark in
  // "Very Important" / "Important" / "Considered" / "Not Considered".
  // After pdf-parse, the X is usually a literal "X" or "•" or "✓". We
  // detect by scanning the line that contains the factor label and look
  // for the column position of the marker.
  //
  // Two-pass strategy:
  //  1. Locate the C7 section.
  //  2. For each factor, pull the line; check which of the four importance
  //     keywords precedes/contains the X-mark.

  const block = section(text, /C7\.\s|Relative\s+importance\s+of\s+each/i, /C8\.|C9\.|Standardized\s+Testing/i) || text;
  const ratings = {};

  for (const [_, re, key] of C7_FACTORS) {
    const m = block.match(new RegExp(re.source + "[^\\n]*\\n?[^\\n]*", "i"));
    if (!m) { ratings[key] = "not_considered"; continue; }
    const line = m[0];
    // The column ordering in CDS is typically:
    // [Factor]  [Very Important]  [Important]  [Considered]  [Not Considered]
    // After pdf-parse, the X marker often sits at a predictable column or
    // right after one of the labels. We look for the marker.
    let rating = null;
    if (/Very\s+Important[^\n]*?[Xx•✓]/.test(line) || /[Xx•✓]\s*Very\s+Important/.test(line)) rating = "very_important";
    else if (/(?<!Very\s)Important[^\n]*?[Xx•✓]/.test(line) || /[Xx•✓]\s*Important/.test(line)) rating = "important";
    else if (/Considered[^\n]*?[Xx•✓]/.test(line) || /[Xx•✓]\s*Considered(?!\s*Not)/.test(line)) rating = "considered";
    else if (/Not\s+Considered[^\n]*?[Xx•✓]/.test(line) || /[Xx•✓]\s*Not\s+Considered/.test(line)) rating = "not_considered";

    // Fallback heuristic: count X positions in the line and pick by index.
    if (!rating) {
      const xIdx = line.search(/[Xx•✓]/);
      if (xIdx > -1) {
        const seg = line.slice(xIdx);
        if (/Very/i.test(seg)) rating = "very_important";
        else if (/Important/i.test(seg)) rating = "important";
        else if (/Not\s*Considered/i.test(seg)) rating = "not_considered";
        else if (/Considered/i.test(seg)) rating = "considered";
      }
    }
    ratings[key] = rating || "not_considered";
  }
  return ratings;
}

// ─── helpers ─────────────────────────────────────────────────────────
function pickNumberAfterLabel(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return Number(m[1].replace(/,/g, ""));
  }
  return null;
}

function matchBand(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const lo = Number(m[1]);
      const hi = Number(m[2]);
      if (!isNaN(lo) && !isNaN(hi) && lo <= hi) return [lo, hi];
    }
  }
  return null;
}

function section(text, startRe, endRe) {
  const s = text.search(startRe);
  if (s < 0) return null;
  const tail = text.slice(s);
  const e = tail.slice(50).search(endRe); // skip the start match itself
  return e < 0 ? tail.slice(0, 8000) : tail.slice(0, 50 + e);
}

function round2(v) { return Math.round(v * 100) / 100; }
function round4(v) { return Math.round(v * 10000) / 10000; }

// ─── 5. Bulk orchestrator ─────────────────────────────────────────────
// Downloads + parses N schools at the most-recent available year. Yields
// progress so a CLI can render it.
export async function ingestAll({ schools, year = "2023-24", limit = null, concurrency = 3 }) {
  ensureDirs();
  const target = limit ? schools.slice(0, limit) : schools;
  const results = [];
  let i = 0;
  async function worker() {
    while (i < target.length) {
      const idx = i++;
      const school = target[idx];
      try {
        // Pick the requested year if available; otherwise fall back to the
        // most recent year present in the index.
        const availableYears = Object.keys(school.links).sort().reverse();
        const useYear = school.links[year] ? year : availableYears[0];
        const dl = await downloadCDS({ school, year: useYear });
        if (dl.kind !== "pdf") {
          results.push({ school: school.name, year: useYear, status: "skipped", reason: dl.kind });
          continue;
        }
        const parsed = await parseCDSPositional(dl.path);
        const record = { school: school.name, slug: school.slug, year: useYear, ...parsed };
        fs.writeFileSync(path.join(PARSED_DIR, `${school.slug}.json`), JSON.stringify(record, null, 2));
        results.push({ school: school.name, year: useYear, status: "ok", admitRate: parsed.overallAdmitRate, satP25: parsed.enrolledSAT?.p25, satP75: parsed.enrolledSAT?.p75 });
      } catch (e) {
        results.push({ school: school.name, status: "error", message: String(e.message || e).slice(0, 140) });
      }
    }
  }
  const workers = Array.from({ length: concurrency }, worker);
  await Promise.all(workers);
  return results;
}

// ─── 6. Loader for the positioning engine ─────────────────────────────
// Reads cached parsed records and returns them keyed by slug. The
// positioning engine consumes `school.cds` directly; this normalizes
// the parsed form into that shape.
export function loadParsed() {
  ensureDirs();
  const files = fs.readdirSync(PARSED_DIR).filter((f) => f.endsWith(".json"));
  const records = {};
  for (const f of files) {
    const r = JSON.parse(fs.readFileSync(path.join(PARSED_DIR, f), "utf8"));
    records[r.slug] = r;
  }
  return records;
}

// ─── CLI dispatch ────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const cmd = process.argv[2];
  const arg = process.argv[3];
  (async () => {
    if (cmd === "index") {
      const rows = await fetchIndex({ force: arg === "--force" });
      console.log(`Index has ${rows.length} schools across years:`,
        Object.fromEntries(Object.entries(rows.reduce((acc, r) => {
          for (const y of Object.keys(r.links)) acc[y] = (acc[y] || 0) + 1;
          return acc;
        }, {})).sort()));
    } else if (cmd === "parse-one") {
      // Usage: node cds-ingester.js parse-one <slug> [year] [--ocr|--pdfjs|--auto]
      const rows = await fetchIndex();
      const school = rows.find((r) => r.slug === arg || r.name.toLowerCase() === String(arg).toLowerCase());
      if (!school) { console.error("Not found:", arg); process.exit(1); }
      const args = process.argv.slice(4);
      const year = args.find((a) => /^\d{4}-\d{2}$/.test(a)) || "2023-24";
      // Method flag: drives OCR vs pdfjs primary path. OCR is the slower
      // route (5-10s/page) but gives uniform extraction across native and
      // scanned PDFs. Default "auto" uses pdfjs and only OCR-falls-back.
      const methodFlag = args.find((a) => a.startsWith("--"));
      const method = methodFlag === "--ocr" ? "ocr"
                    : methodFlag === "--pdfjs" ? "pdfjs"
                    : "auto";
      const useYear = school.links[year] ? year : Object.keys(school.links).sort().reverse()[0];
      const dl = await downloadCDS({ school, year: useYear });
      console.log("Downloaded:", dl);
      if (dl.kind !== "pdf") return;
      // The tools/cds-ingester.js still uses tools/cds-pdf-positional.js for
      // its parser; the root parser at cds-pdf-parser.js takes the same
      // method param for OCR primary mode.
      const parsed = await parseCDSPositional(dl.path, { method });
      console.log("Method:", method, "(actual extraction:", parsed.extractionMethod || "pdfjs", ")");
      console.log(JSON.stringify({ school: school.name, year: useYear, ...parsed }, null, 2));
    } else if (cmd === "ingest") {
      // Usage: node cds-ingester.js ingest [limit] [year]
      const limit = arg ? Number(arg) : 20;
      const year = process.argv[4] || "2023-24";
      const rows = await fetchIndex();
      console.log(`Ingesting ${limit} schools at ${year}…`);
      const results = await ingestAll({ schools: rows, year, limit, concurrency: 3 });
      const ok = results.filter((r) => r.status === "ok").length;
      const err = results.filter((r) => r.status === "error").length;
      const skip = results.filter((r) => r.status === "skipped").length;
      console.log(`\n${ok} ok · ${err} error · ${skip} skipped`);
      console.log("Errors:", results.filter((r) => r.status === "error").slice(0, 8));
    } else {
      console.log(`Usage:
  node tools/cds-ingester.js index
  node tools/cds-ingester.js parse-one <slug-or-name> [year]
  node tools/cds-ingester.js ingest [limit=20] [year=2023-24]`);
    }
  })().catch((e) => { console.error(e); process.exit(1); });
}

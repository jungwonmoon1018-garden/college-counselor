// ═══════════════════════════════════════════════════════════════════════
// cds-pdf-positional.js — column-aware CDS extractor.
// ═══════════════════════════════════════════════════════════════════════
// Uses pdfjs-dist to get every text item with its (x, y) coordinates,
// which lets us reconstruct the column layout that pdf-parse loses.
// Critical for C7 (factor importance ratings) where the meaning is
// purely positional: an X under "Very Important" vs "Considered" is the
// only thing that distinguishes them, and after a flat text dump those
// Xs end up unmoored from their column headers.
//
// Pipeline:
//   1. extractItems(pdfPath) → [{page, x, y, str, width}]
//   2. groupByLine(items)    → rows of items with similar y
//   3. extractC7Positional(items) → factor → rating
//   4. extractC1Counts(items)     → applied / admitted / enrolled
//   5. extractC9Bands(items)      → SAT / ACT 25/75
//   6. extractC12GPA(items)       → GPA distribution → p25/p75
// ═══════════════════════════════════════════════════════════════════════

import fs from "fs";
// pdfjs-dist v4 ships ESM only. Import the legacy build which is more
// compatible with Node (no DOM dependencies).
const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

export async function extractItems(pdfPath) {
  const buf = new Uint8Array(fs.readFileSync(pdfPath));
  const loadingTask = pdfjsLib.getDocument({ data: buf, useSystemFonts: false, isEvalSupported: false, disableFontFace: true });
  const pdf = await loadingTask.promise;
  const items = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    for (const it of tc.items) {
      // transform = [a, b, c, d, e, f] where (e, f) is the position
      const x = it.transform[4];
      const y = it.transform[5];
      const str = it.str;
      if (!str || !str.trim()) continue;
      items.push({ page: p, x: round1(x), y: round1(y), str, width: it.width || 0 });
    }
  }
  await pdf.destroy();
  return items;
}

// Group items into lines by (page, y) within tolerance.
export function groupByLine(items, yTolerance = 2.0) {
  const lines = [];
  const sorted = [...items].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  let cur = null;
  for (const it of sorted) {
    if (!cur || it.page !== cur.page || Math.abs(cur.y - it.y) > yTolerance) {
      cur = { page: it.page, y: it.y, items: [] };
      lines.push(cur);
    }
    cur.items.push(it);
  }
  // sort items in each line left-to-right
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines;
}

// ─── C7: Factor importance ratings (positional) ──────────────────────
// CDS C7 is a 4-column table:
//   [factor name] [Very Important] [Important] [Considered] [Not Considered]
// We:
//   1. Find the C7 page(s).
//   2. Locate the 4 column headers ("Very Important", "Important",
//      "Considered", "Not Considered") and record their X centers.
//   3. For each factor row, find the X mark in that row and assign it
//      to the nearest column.
const C7_FACTOR_PATTERNS = [
  ["rigor",            /rigor\s+of\s+secondary\s+school\s+record/i],
  ["class_rank",       /class\s+rank/i],
  ["gpa",              /academic\s+gpa/i],
  ["test_scores",      /standardized\s+test\s+scores/i],
  ["application_essay", /application\s+essay/i],
  ["recommendations",  /recommendation/i],
  ["interview",        /interview/i],
  ["ec",               /extracurricular\s+activities/i],
  ["talent_ability",   /talent.{0,3}ability/i],
  ["character",        /character.{0,3}personal\s+qualities/i],
  ["first_generation", /first\s+generation/i],
  ["alumni_relation",  /alumni.{0,4}relation/i],
  ["geographical_residence", /geographical\s+residence/i],
  ["state_residency",  /state\s+residency/i],
  ["religious_affiliation", /religious\s+affiliation/i],
  ["racial_ethnic_status", /racial.{0,3}ethnic\s+status/i],
  ["volunteer_work",   /volunteer\s+work/i],
  ["work_experience",  /work\s+experience/i],
  ["level_of_interest", /level\s+of\s+applicant.{0,3}\s*interest/i],
];

const C7_COLUMNS = [
  ["very_important", /very\s*important/i],
  ["important",      /^important$/i],   // anchored to avoid catching "Very Important"
  ["considered",     /^considered$/i],
  ["not_considered", /not\s*considered/i],
];

export function extractC7Positional(items) {
  // Concatenate same-line items into "blob" tokens because pdfjs-dist
  // can split words across multiple items. We rebuild each line as an
  // ordered list of (x, text) tokens.
  const lines = groupByLine(items, 2.5);

  // 1. Find the line containing all 4 column headers.
  let headerLine = null;
  for (const line of lines) {
    const text = line.items.map((i) => i.str).join(" ");
    if (/very\s*important/i.test(text) && /not\s*considered/i.test(text)) {
      headerLine = line;
      break;
    }
  }
  if (!headerLine) {
    // Header sometimes split across two lines (each column on its own line);
    // fall back: scan a window of lines for 4 headers near each other in y.
    for (let k = 0; k < lines.length; k++) {
      const window = lines.slice(k, k + 3);
      const flat = window.flatMap((l) => l.items);
      const hasAll =
        flat.some((i) => /very\s*important/i.test(i.str)) &&
        flat.some((i) => /^important$/i.test(i.str.trim())) &&
        flat.some((i) => /^considered$/i.test(i.str.trim())) &&
        flat.some((i) => /not\s*considered/i.test(i.str));
      if (hasAll) { headerLine = { page: window[0].page, y: window[0].y, items: flat }; break; }
    }
  }
  if (!headerLine) return null;

  // 2. Extract column X centers
  const cols = {};
  for (const [key, re] of C7_COLUMNS) {
    const item = headerLine.items.find((i) => re.test(i.str.trim()));
    if (item) cols[key] = item.x + (item.width || 30) / 2;
  }
  if (Object.keys(cols).length < 3) return null; // insufficient anchor points

  // 3. Walk lines after the header and pick out factor rows. For each
  //    factor we find its label and then locate the nearest "X" marker
  //    on the same horizontal line (or the immediately following line —
  //    pdf-parse sometimes splits the X onto its own item with a
  //    fractionally lower y).
  const headerPage = headerLine.page;
  const headerY = headerLine.y;
  const candidateLines = lines.filter((l) => l.page === headerPage && l.y < headerY ||
                                              l.page > headerPage);

  const ratings = {};
  for (const [factor, re] of C7_FACTOR_PATTERNS) {
    let labelLine = null;
    let labelXEnd = null;
    for (const line of candidateLines) {
      const lineText = line.items.map((i) => i.str).join(" ");
      if (re.test(lineText)) {
        // find the first item whose text matches part of the label, then
        // the X-mark is to its right
        labelLine = line;
        const lastLabelItem = line.items
          .filter((i) => /[A-Za-z]/.test(i.str))
          .reduce((a, b) => (a && a.x > b.x ? a : b), null);
        labelXEnd = (lastLabelItem?.x || 0) + (lastLabelItem?.width || 0);
        break;
      }
    }
    if (!labelLine) { ratings[factor] = "not_considered"; continue; }

    // Recompute labelXEnd ignoring single-character X marks (so we don't
    // mistake the X marker itself for the end of the label text).
    const labelTextItems = labelLine.items.filter((i) => {
      const s = i.str.trim();
      return /[A-Za-z]/.test(s) && s.length > 2 && !/^[Xx]+$/.test(s);
    });
    const lastTextItem = labelTextItems.reduce((a, b) => (a && a.x > b.x ? a : b), null);
    labelXEnd = (lastTextItem?.x || 0) + (lastTextItem?.width || 0);

    // Find X-mark candidates: short string ("X", "x", "•", "✓") to the
    // right of the label end, within ±2pt vertically.
    const xCandidates = [];
    for (const it of labelLine.items) {
      if (it.x < labelXEnd + 5) continue;
      const s = it.str.trim();
      if (/^[Xx•✓✔]$/.test(s)) xCandidates.push(it);
    }
    // Also scan immediate neighbour lines (CDS sometimes splits X to its
    // own y-line a fractional point above/below the label).
    for (const line of candidateLines) {
      if (line === labelLine) continue;
      if (line.page !== labelLine.page) continue;
      if (Math.abs(line.y - labelLine.y) > 2) continue;
      for (const it of line.items) {
        if (it.x < labelXEnd + 5) continue;
        const s = it.str.trim();
        if (/^[Xx•✓✔]$/.test(s)) xCandidates.push(it);
      }
    }

    if (xCandidates.length === 0) { ratings[factor] = "not_considered"; continue; }

    // Use the leftmost X (in case there's noise) and assign to nearest col.
    xCandidates.sort((a, b) => a.x - b.x);
    const x = xCandidates[0].x;
    let nearest = null, nearestDist = Infinity;
    for (const [key, cx] of Object.entries(cols)) {
      const d = Math.abs(x - cx);
      if (d < nearestDist) { nearestDist = d; nearest = key; }
    }
    ratings[factor] = nearest || "not_considered";
  }
  return ratings;
}

// ─── C1: First-year admission counts (applied / admitted / enrolled) ─
// CDS C1 has separate per-gender rows under three category headers:
//   "First-Time, First-Year Student Applicants"      — men/women/another/unknown
//   "First-Time, First-Year Student Admits"          — men/women/another/unknown
//   "First-Time, First-Year Student Enrollees..."    — men/women × FT/PT × another...
// Each row ends with a single number in the "Total" column. We sum the
// per-gender numbers within each category to get applied/admitted/enrolled.
export function extractC1Counts(items) {
  const lines = groupByLine(items, 2.5);
  const result = {};

  function sumCategory(rowRe, opts = {}) {
    let sum = 0;
    let hits = 0;
    for (const line of lines) {
      const t = line.items.map((i) => i.str).join(" ");
      if (!rowRe.test(t)) continue;
      // Last numeric token in the line is the Total-column value.
      const nums = line.items
        .map((i) => i.str.trim())
        .filter((s) => /^[\d,]+$/.test(s) && s.length > 0)
        .map((s) => Number(s.replace(/,/g, "")))
        .filter((n) => !isNaN(n) && n > 0);
      if (nums.length === 0) continue;
      sum += nums[nums.length - 1];
      hits++;
      if (opts.maxHits && hits >= opts.maxHits) break;
    }
    return hits > 0 ? sum : null;
  }

  const applied = sumCategory(/^Total\s+first-time,?\s+first-year\s+(men|women|another\s+gender|unknown\s+gender)\s+who\s+applied/i);
  const admitted = sumCategory(/^Total\s+first-time,?\s+first-year\s+(men|women|another\s+gender|unknown\s+gender)\s+who\s+were\s+admitted/i);
  // Enrollees row uses "Total full-time/part-time, first-time, first-year <gender> who enrolled"
  const enrolled = sumCategory(/^Total\s+(full-time|part-time),\s+first-time,?\s+first-year\s+(men|women|another\s+gender|unknown\s+gender)\s+who\s+enrolled/i);

  if (applied) result.applied = applied;
  if (admitted) result.admitted = admitted;
  if (enrolled) result.enrolled = enrolled;

  // Sanity: applied >= admitted >= enrolled (drop any failures)
  if (result.applied && result.admitted && result.admitted > result.applied) delete result.admitted;
  if (result.admitted && result.enrolled && result.enrolled > result.admitted) delete result.enrolled;

  return Object.keys(result).length ? result : null;
}

// ─── C9: SAT / ACT 25th–75th ─────────────────────────────────────────
// CDS C9 has rows like:
//   SAT Composite           1500   1580
//   SAT EBRW               750     780
//   SAT Math               770     800
//   ACT Composite           34     35
// pdfjs-dist preserves these numbers along with their column positions,
// so we anchor on the row labels and grab the two numbers immediately
// following.
export function extractC9Bands(items) {
  const lines = groupByLine(items, 2.5);
  const out = {};

  function findBand(labelRe, numRange) {
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i].items.map((it) => it.str).join(" ");
      if (!labelRe.test(text)) continue;
      // Collect numbers from this line and the next 2 lines (CDS sometimes
      // wraps the number into the next y-line).
      const window = lines.slice(i, i + 3);
      const candidates = [];
      for (const line of window) {
        for (const it of line.items) {
          const m = it.str.trim().match(/^([\d,]+)$/);
          if (m) {
            const n = Number(m[1].replace(/,/g, ""));
            if (n >= numRange[0] && n <= numRange[1]) candidates.push({ x: it.x, n });
          }
        }
      }
      if (candidates.length >= 2) {
        // Sort left→right. CDS C9 columns are 25th, 50th, 75th, often 3
        // numbers; take first and last to get p25 / p75.
        candidates.sort((a, b) => a.x - b.x);
        const p25 = candidates[0].n;
        const p75 = candidates[candidates.length - 1].n;
        if (p25 <= p75) return { p25, p75 };
      }
    }
    return null;
  }

  const satComp = findBand(/SAT\s+Composite|Composite\s*\(SAT\s+Total\)|SAT\s+Total/i, [400, 1600]);
  if (satComp) out.enrolledSAT = satComp;
  else {
    const ebrw = findBand(/SAT\s+Evidence|SAT\s+EBRW|Critical\s+Reading|Evidence-?Based\s+Reading/i, [200, 800]);
    const math = findBand(/SAT\s+Math|^Math\s+\(SAT\)/i, [200, 800]);
    if (ebrw && math) out.enrolledSAT = { p25: ebrw.p25 + math.p25, p75: ebrw.p75 + math.p75 };
  }

  const actComp = findBand(/ACT\s+Composite/i, [10, 36]);
  if (actComp) out.enrolledACT = actComp;

  return out;
}

// ─── C12: GPA distribution → derive p25/p75 unweighted GPA ───────────
export function extractC12GPA(allText) {
  const labelMap = [
    ["4.00", /4\.0+\s+([\d.]+)\s*%/, 4.00],
    ["3.75-3.99", /3\.75\s*[-–]\s*3\.99[^\n]*?([\d.]+)\s*%/i, 3.75],
    ["3.50-3.74", /3\.50\s*[-–]\s*3\.74[^\n]*?([\d.]+)\s*%/i, 3.50],
    ["3.25-3.49", /3\.25\s*[-–]\s*3\.49[^\n]*?([\d.]+)\s*%/i, 3.25],
    ["3.00-3.24", /3\.00\s*[-–]\s*3\.24[^\n]*?([\d.]+)\s*%/i, 3.00],
    ["2.50-2.99", /2\.50\s*[-–]\s*2\.99[^\n]*?([\d.]+)\s*%/i, 2.50],
    ["2.00-2.49", /2\.00\s*[-–]\s*2\.49[^\n]*?([\d.]+)\s*%/i, 2.00],
  ];
  const pcts = [];
  for (const [label, re, lower] of labelMap) {
    const m = allText.match(re);
    if (m) pcts.push({ label, lower, pct: Number(m[1]) });
  }
  if (pcts.length < 3) return null;
  // Sort top→bottom
  pcts.sort((a, b) => b.lower - a.lower);
  let cum = 0, p75 = null, p25 = null;
  for (const r of pcts) {
    cum += r.pct;
    if (p75 == null && cum >= 25) p75 = r.lower;
    if (p25 == null && cum >= 75) p25 = r.lower;
  }
  if (p25 == null && p75 != null) p25 = Math.max(0, p75 - 0.4);
  if (p75 == null) return null;
  return { p25, p75, source: "C12_cumulative" };
}

// ─── Test policy ─────────────────────────────────────────────────────
// CDS C8A is a 5-column table whose row "SAT or ACT" gets a single X in
// one of: Required / Required-for-some / Recommended / Not-required-but-
// considered (test-optional) / Not-considered-even-if-submitted (test-
// blind). Column header text wraps across multiple y-lines, so we
// approximate column boundaries from the words "Required", "considered"
// and "submitted" markers when they appear within a header band.
export function extractTestPolicyPositional(items) {
  const lines = groupByLine(items, 2.5);
  // Find C8A row(s). The row is "SAT or ACT" followed by an X mark.
  const satRow = lines.find((l) => l.items.some((i) => /^SAT\s+or\s+ACT$/i.test(i.str.trim())));
  if (!satRow) return "test_required"; // default
  const xItem = satRow.items.find((i) => /^[Xx•✓✔]$/.test(i.str.trim()));
  if (!xItem) return "test_required";
  const xPos = xItem.x;

  // Locate the C8A header band (within ~80pt above the row, same page)
  const header = lines.filter(
    (l) =>
      l.page === satRow.page &&
      l.y > satRow.y &&
      l.y < satRow.y + 80
  );
  // Build {keyword → x} map by scanning header tokens
  const headerTokens = [];
  for (const line of header) {
    for (const it of line.items) {
      const s = it.str.trim();
      if (/^Admission$/.test(s)) headerTokens.push({ key: "admission", x: it.x });
      if (/^Required$/.test(s) || /^Required\s+to/.test(s)) headerTokens.push({ key: "required", x: it.x });
      if (/^Required\s+for$/i.test(s) || /^some$/i.test(s)) headerTokens.push({ key: "some", x: it.x });
      if (/^Recommended$/i.test(s)) headerTokens.push({ key: "recommended", x: it.x });
      if (/^Not\s+required\s+for$/i.test(s) || /^submitted$/i.test(s)) headerTokens.push({ key: "test_optional", x: it.x });
      if (/^Not$/i.test(s) && header.some((l2) => l2.items.some((it2) => /^considered\s+for/i.test(it2.str.trim())))) headerTokens.push({ key: "test_blind", x: it.x });
    }
  }
  // Heuristic boundaries: 5 columns roughly evenly spaced. We look at the
  // x-distribution of identifiers and pick the closest one to xPos.
  // Simpler & robust: define x-bins by the column anchors we recorded.
  // For each candidate key we may have multiple x's; collapse to the min.
  const cols = {};
  for (const t of headerTokens) {
    if (cols[t.key] == null || t.x < cols[t.key]) cols[t.key] = t.x;
  }
  // Collapse: ensure the 5 buckets we care about
  const buckets = [
    { key: "test_required", x: cols.admission ?? cols.required },
    { key: "test_required_some", x: cols.some },
    { key: "test_recommended", x: cols.recommended },
    { key: "test_optional", x: cols.test_optional },
    { key: "test_blind", x: cols.test_blind },
  ].filter((b) => b.x != null);
  if (buckets.length < 2) {
    // Fall back to simple text matching if positional fails
    const t = items.map((i) => i.str).join(" ");
    if (/test[\s-]?blind/i.test(t)) return "test_blind";
    if (/test[\s-]?optional/i.test(t)) return "test_optional";
    return "test_required";
  }
  // Snap xPos to the nearest bucket center
  let nearest = buckets[0];
  let dist = Math.abs(xPos - buckets[0].x);
  for (const b of buckets.slice(1)) {
    const d = Math.abs(xPos - b.x);
    if (d < dist) { dist = d; nearest = b; }
  }
  // Reduce intermediate buckets to either required / optional / blind
  if (nearest.key === "test_blind") return "test_blind";
  if (nearest.key === "test_optional" || nearest.key === "test_recommended") return "test_optional";
  return "test_required";
}

// Plain-text fallback (kept for callers that already have the text).
export function extractTestPolicy(text) {
  if (/test[\s-]?blind/i.test(text)) return "test_blind";
  if (/test[\s-]?optional/i.test(text)) return "test_optional";
  return "test_required";
}

// ─── Year ────────────────────────────────────────────────────────────
export function extractYear(text) {
  const m = text.match(/Common\s+Data\s+Set\s+(\d{4})\s*[-–]\s*(\d{2,4})/i);
  if (m) return Number(m[1]);
  return null;
}

// ─── Top-level: parse one PDF into a CDS record ──────────────────────
// Strategy: positional pass first (works for text-rendered CDSes like
// Princeton/MIT). Fall back to form-fields for any field positional
// missed (works for AcroForm CDSes like Cornell/UW). The two paths
// produce the same record shape so the merge is straightforward.
export async function parseCDSPositional(pdfPath) {
  const items = await extractItems(pdfPath);
  const allText = items.map((i) => i.str).join(" ");
  const positional = { source: "cds", parserVersion: 2 };
  positional.year = extractYear(allText);
  positional.testPolicy = extractTestPolicyPositional(items);
  const counts = extractC1Counts(items);
  if (counts) {
    positional.b1 = counts;
    if (counts.applied && counts.admitted) positional.overallAdmitRate = round4(counts.admitted / counts.applied);
    if (counts.admitted && counts.enrolled) positional.yieldRate = round4(counts.enrolled / counts.admitted);
  }
  Object.assign(positional, extractC9Bands(items));
  const gpa = extractC12GPA(allText);
  if (gpa) positional.enrolledGPA = gpa;
  const c7 = extractC7Positional(items);
  if (c7 && Object.values(c7).some((v) => v !== "not_considered")) positional.c7 = c7;

  // Form-fields pass: only run if positional left key fields empty.
  const needsFormFields =
    !positional.b1 ||
    !positional.enrolledSAT ||
    !positional.c7;
  if (needsFormFields) {
    const { extractFormFields, buildCDSFromFormFields } = await import("./cds-form-fields.js");
    try {
      const fields = await extractFormFields(pdfPath);
      const fromForm = buildCDSFromFormFields(fields);
      if (fromForm) {
        // Merge: positional wins where present; form fills in the rest.
        if (!positional.b1 && fromForm.b1) {
          positional.b1 = fromForm.b1;
          positional.overallAdmitRate = fromForm.overallAdmitRate;
          positional.yieldRate = fromForm.yieldRate;
        }
        if (!positional.enrolledSAT && fromForm.enrolledSAT) positional.enrolledSAT = fromForm.enrolledSAT;
        if (!positional.enrolledACT && fromForm.enrolledACT) positional.enrolledACT = fromForm.enrolledACT;
        if (!positional.enrolledGPA && fromForm.enrolledGPA) positional.enrolledGPA = fromForm.enrolledGPA;
        if (!positional.c7 && fromForm.c7) positional.c7 = fromForm.c7;
        if (positional.testPolicy === "test_required" && fromForm.testPolicy && fromForm.testPolicy !== "test_required") {
          positional.testPolicy = fromForm.testPolicy;
        }
        positional.parserNotes = (positional.parserNotes || []).concat("merged_form_fields");
      }
    } catch (e) {
      positional.parserNotes = (positional.parserNotes || []).concat("form_fields_failed: " + String(e.message).slice(0, 60));
    }
  }
  if (!positional.c7) positional.c7 = {};
  return positional;
}

function round1(v) { return Math.round(v * 10) / 10; }
function round4(v) { return Math.round(v * 10000) / 10000; }

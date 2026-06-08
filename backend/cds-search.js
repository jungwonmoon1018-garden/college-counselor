import crypto from "node:crypto";
import { extractImage, extractPDF, extractPdfOCR, extractText, isSupportedMime } from "./file-extractors.js";

export const CDS_REPOSITORY_URL = "https://www.collegetransitions.com/dataverse/common-data-set-repository/";
export const CDS_REPOSITORY_HOST = "www.collegetransitions.com";
export const CDS_YEAR_LABELS = Object.freeze([
  "2024-25",
  "2023-24",
  "2022-23",
  "2021-22",
  "2020-21",
  "2019-20",
  "2018-19",
  "2017-18",
]);

export function normalizeSchoolName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\b(university|college|campus|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function stripHtml(html) {
  return decodeEntities(String(html || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function absolutizeUrl(rawHref, baseUrl = CDS_REPOSITORY_URL) {
  try {
    return new URL(rawHref, baseUrl).toString();
  } catch {
    return null;
  }
}

export function parseCdsRepositoryIndex(html) {
  const src = String(html || "");
  const entries = [];
  const rowRegex = /<tr\b[\s\S]*?<\/tr>/gi;
  const cellRegex = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
  const anchorRegex = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  for (const rowMatch of src.matchAll(rowRegex)) {
    const rowHtml = rowMatch[0];
    const cells = [...rowHtml.matchAll(cellRegex)].map((m) => m[1]);
    if (cells.length < 2) continue;
    const schoolName = stripHtml(cells[0]);
    if (!schoolName || /institution/i.test(schoolName)) continue;

    const years = [];
    for (let i = 1; i < Math.min(cells.length, CDS_YEAR_LABELS.length + 1); i += 1) {
      const cellHtml = cells[i];
      const label = CDS_YEAR_LABELS[i - 1];
      const links = [...cellHtml.matchAll(anchorRegex)].map((m) => ({
        label: stripHtml(m[2]) || "CDS",
        url: absolutizeUrl(decodeEntities(m[1])),
      })).filter((link) => link.url);
      const available = /\bCDS\b/i.test(stripHtml(cellHtml)) || links.length > 0;
      years.push({ year: label, available, links });
    }
    entries.push({
      schoolName,
      normalizedSchoolName: normalizeSchoolName(schoolName),
      years,
    });
  }

  return entries;
}

export function findBestRepositoryEntry(entries, schoolName) {
  const normalized = normalizeSchoolName(schoolName);
  if (!normalized) return null;
  const exact = entries.find((entry) => entry.normalizedSchoolName === normalized);
  if (exact) return exact;

  const normalizedParts = new Set(normalized.split(" ").filter(Boolean));
  let best = null;
  let bestScore = 0;
  for (const entry of entries) {
    const parts = entry.normalizedSchoolName.split(" ").filter(Boolean);
    let overlap = 0;
    for (const part of parts) {
      if (normalizedParts.has(part)) overlap += 1;
    }
    const score = overlap / Math.max(parts.length, normalizedParts.size, 1);
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return bestScore >= 0.5 ? best : null;
}

function looksLikeGoogleRelay(url) {
  try {
    const parsed = new URL(url);
    return /(^|\.)google\./i.test(parsed.hostname);
  } catch {
    return false;
  }
}

export function selectPreferredCdsLink(entry) {
  if (!entry?.years) return null;
  for (const year of entry.years) {
    for (const link of year.links || []) {
      if (!link.url) continue;
      if (!looksLikeGoogleRelay(link.url)) {
        return { year: year.year, ...link };
      }
    }
    if (year.available && (!year.links || year.links.length === 0)) {
      return { year: year.year, label: "CDS", url: null };
    }
  }
  return null;
}

export const C7_RATING_NUMERIC = Object.freeze({
  very_important: 1,
  important: 0.7,
  considered: 0.35,
  not_considered: 0,
});

const C7_RATING_ALIASES = Object.freeze({
  very_important: ["very important", "veryimportant", "vi"],
  important: ["important", "imp", "i"],
  considered: ["considered", "consider", "c"],
  not_considered: ["not considered", "notconsidered", "not-considered", "nc"],
});

const C7_FACTORS = Object.freeze([
  { key: "rigor", section: "Academic", labels: ["rigor of secondary school record", "rigor"] },
  { key: "classRank", section: "Academic", labels: ["class rank"] },
  { key: "academicGpa", section: "Academic", labels: ["academic gpa", "gpa"] },
  { key: "standardizedTests", section: "Academic", labels: ["standardized test scores", "standardized tests", "test scores"] },
  { key: "essay", section: "Academic", labels: ["application essay", "essay"] },
  { key: "recommendation", section: "Academic", labels: ["recommendation(s)", "recommendations", "recommendation"] },
  { key: "interview", section: "Nonacademic", labels: ["interview"] },
  { key: "extracurriculars", section: "Nonacademic", labels: ["extracurricular activities", "extracurriculars", "ec"] },
  { key: "talentAbility", section: "Nonacademic", labels: ["talent/ability", "talent ability"] },
  { key: "character", section: "Nonacademic", labels: ["character/personal qualities", "character personal qualities", "personal qualities", "character"] },
  { key: "firstGeneration", section: "Nonacademic", labels: ["first generation", "first-generation"] },
  { key: "alumniRelation", section: "Nonacademic", labels: ["alumni/ae relation", "alumni relation", "alumnae relation"] },
  { key: "geographicalResidence", section: "Nonacademic", labels: ["geographical residence", "geographic residence"] },
  { key: "stateResidency", section: "Nonacademic", labels: ["state residency"] },
  { key: "religiousAffiliation", section: "Nonacademic", labels: ["religious affiliation/commitment", "religious affiliation", "religious commitment"] },
  { key: "racialEthnicStatus", section: "Nonacademic", labels: ["racial/ethnic status", "racial ethnic status"] },
  { key: "volunteerWork", section: "Nonacademic", labels: ["volunteer work"] },
  { key: "workExperience", section: "Nonacademic", labels: ["work experience"] },
  { key: "levelOfInterest", section: "Nonacademic", labels: ["level of applicant's interest", "level of applicant’s interest", "applicant interest", "level of interest"] },
]);

const C7_LEGACY_KEY_MAP = Object.freeze({
  class_rank: "classRank",
  gpa: "academicGpa",
  academic_gpa: "academicGpa",
  test_scores: "standardizedTests",
  standardized_tests: "standardizedTests",
  application_essay: "essay",
  recommendations: "recommendation",
  recommendation: "recommendation",
  ec: "extracurriculars",
  extracurriculars: "extracurriculars",
  talent_ability: "talentAbility",
  first_generation: "firstGeneration",
  alumni_relation: "alumniRelation",
  geographical_residence: "geographicalResidence",
  state_residency: "stateResidency",
  religious_affiliation: "religiousAffiliation",
  racial_ethnic_status: "racialEthnicStatus",
  volunteer_work: "volunteerWork",
  work_experience: "workExperience",
  level_of_interest: "levelOfInterest",
});

function normalizeC7Text(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ratingToNumeric(label) {
  const normalized = String(label || "").toLowerCase();
  if (normalized.includes("not considered")) return 0;
  if (normalized.includes("very important")) return 1;
  if (normalized.includes("important")) return 0.7;
  if (normalized.includes("considered")) return 0.35;
  return null;
}

function ratingKeyToNumeric(rating) {
  if (typeof rating === "number" && Number.isFinite(rating)) return rating;
  const normalized = normalizeC7Text(rating).replace(/\s/g, "_");
  if (C7_RATING_NUMERIC[normalized] != null) return C7_RATING_NUMERIC[normalized];
  for (const [key, aliases] of Object.entries(C7_RATING_ALIASES)) {
    if (aliases.some((alias) => normalizeC7Text(alias).replace(/\s/g, "_") === normalized)) {
      return C7_RATING_NUMERIC[key];
    }
  }
  return ratingToNumeric(rating);
}

function ratingLabelFromNumeric(value) {
  const numeric = Number(value);
  if (numeric === 1) return "very_important";
  if (numeric === 0.7) return "important";
  if (numeric === 0.35) return "considered";
  if (numeric === 0) return "not_considered";
  return null;
}

function canonicalC7Key(rawKeyOrLabel) {
  const direct = C7_LEGACY_KEY_MAP[rawKeyOrLabel] || rawKeyOrLabel;
  if (C7_FACTORS.some((factor) => factor.key === direct)) return direct;
  const normalized = normalizeC7Text(rawKeyOrLabel);
  if (!normalized) return null;
  for (const factor of C7_FACTORS) {
    if (factor.labels.some((label) => {
      const alias = normalizeC7Text(label);
      return normalized === alias || normalized.includes(alias) || alias.includes(normalized);
    })) {
      return factor.key;
    }
  }
  return null;
}

function c7FactorByKey(key) {
  return C7_FACTORS.find((factor) => factor.key === key) || null;
}

function c7CellMarked(value) {
  if (value === true) return true;
  if (typeof value === "number") return value > 0;
  return /^(x|✓|✔|check|checked|yes|true|1)$/i.test(String(value || "").trim());
}

function selectedRatingFromRow(row) {
  if (!row || typeof row !== "object") return null;
  if (row.selectedRating != null) return row.selectedRating;
  if (row.rating != null) return row.rating;
  const ratingColumns = [
    ["very_important", row.veryImportant ?? row.very_important ?? row["Very Important"]],
    ["important", row.important ?? row["Important"]],
    ["considered", row.considered ?? row["Considered"]],
    ["not_considered", row.notConsidered ?? row.not_considered ?? row["Not Considered"]],
  ];
  const marked = ratingColumns.filter(([, value]) => c7CellMarked(value)).map(([rating]) => rating);
  return marked.length === 1 ? marked[0] : null;
}

export function normalizeC7Object(rawC7 = {}) {
  const c7 = {};
  for (const [rawKey, rawValue] of Object.entries(rawC7 || {})) {
    const key = canonicalC7Key(rawKey);
    if (!key) continue;
    const numeric = ratingKeyToNumeric(rawValue);
    if (numeric == null) continue;
    c7[key] = numeric;
  }
  return c7;
}

export function normalizeC7TableRows(rows = []) {
  const c7 = {};
  const normalizedRows = [];
  const warnings = [];

  for (const row of rows || []) {
    const factorLabel = Array.isArray(row) ? row[0] : row?.factorLabel ?? row?.factor ?? row?.label ?? row?.name;
    const canonicalKey = canonicalC7Key(factorLabel);
    if (!canonicalKey) continue;
    const selectedRating = Array.isArray(row) ? row[1] : selectedRatingFromRow(row);
    const numericWeight = ratingKeyToNumeric(selectedRating);
    if (numericWeight == null) {
      warnings.push(`c7_unreadable_rating:${factorLabel}`);
      continue;
    }
    const factor = c7FactorByKey(canonicalKey);
    const selectedKey = ratingLabelFromNumeric(numericWeight);
    c7[canonicalKey] = numericWeight;
    normalizedRows.push({
      section: row?.section || factor?.section || null,
      factorLabel: String(factorLabel || ""),
      veryImportant: selectedKey === "very_important",
      important: selectedKey === "important",
      considered: selectedKey === "considered",
      notConsidered: selectedKey === "not_considered",
      selectedRating: selectedKey,
      canonicalKey,
      numericWeight,
    });
  }

  return { c7, rows: normalizedRows, warnings };
}

function extractC7HeaderPositions(lines) {
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (!/very\s+important/i.test(line) || !/not\s+considered/i.test(line)) continue;
    const positions = {
      very_important: lower.search(/very\s+important/i),
      important: lower.search(/(?<!very\s)important/i),
      considered: lower.search(/(?<!not\s)considered/i),
      not_considered: lower.search(/not\s+considered/i),
    };
    if (Object.values(positions).filter((v) => v >= 0).length >= 3) return positions;
  }
  return null;
}

function nearestRatingByX(line, headerPositions) {
  if (!headerPositions) return null;
  const xMarks = [...String(line || "").matchAll(/\b[xX]\b|[✓✔]/g)].map((match) => match.index).filter((idx) => idx != null);
  if (xMarks.length !== 1) return null;
  const x = xMarks[0];
  let best = null;
  let bestDistance = Infinity;
  for (const [rating, pos] of Object.entries(headerPositions)) {
    if (pos < 0) continue;
    const distance = Math.abs(x - pos);
    if (distance < bestDistance) {
      best = rating;
      bestDistance = distance;
    }
  }
  return best;
}

export function extractC7TableRowsFromText(rawText) {
  const lines = String(rawText || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\t/g, "    ").trimEnd())
    .filter((line) => line.trim());
  const headerPositions = extractC7HeaderPositions(lines);
  const rows = [];
  let currentSection = null;

  for (const line of lines) {
    if (/^\s*academic\b/i.test(line)) currentSection = "Academic";
    if (/^\s*nonacademic\b/i.test(line)) currentSection = "Nonacademic";
    if (/very\s+important/i.test(line) && /not\s+considered/i.test(line)) continue;

    const factor = C7_FACTORS.find((candidate) =>
      candidate.labels.some((label) => normalizeC7Text(line).includes(normalizeC7Text(label)))
    );
    if (!factor) continue;

    let selectedRating = nearestRatingByX(line, headerPositions);
    if (!selectedRating) {
      const explicit = line.match(/(not\s+considered|very\s+important|important|considered)\s*$/i);
      selectedRating = explicit?.[1] || null;
    }
    if (!selectedRating) continue;
    rows.push({
      section: currentSection || factor.section,
      factorLabel: factor.labels[0],
      selectedRating,
    });
  }

  return normalizeC7TableRows(rows);
}

function extractPercent(label, text) {
  const regex = new RegExp(`${escapeRegExp(label)}[^\\d]{0,30}(\\d{1,2}(?:\\.\\d)?)\\s*%`, "i");
  const match = text.match(regex);
  return match ? Number(match[1]) : null;
}

function extractRange(text, leftLabel, rightLabel) {
  const regex = new RegExp(`${escapeRegExp(leftLabel)}[^\\d]{0,20}(\\d{1,4})[^\\d]{1,20}${escapeRegExp(rightLabel)}[^\\d]{0,20}(\\d{1,4})`, "i");
  const match = text.match(regex);
  if (!match) return null;
  return { low: Number(match[1]), high: Number(match[2]) };
}

function extractSingleNumber(text, label, maxGap = 30) {
  const regex = new RegExp(`${escapeRegExp(label)}[^\\d]{0,${maxGap}}(\\d{1,4}(?:\\.\\d+)?)`, "i");
  const match = text.match(regex);
  return match ? Number(match[1]) : null;
}

function hasUsefulCdsText(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length < 200) return false;
  const signals = [
    /common\s+data\s+set/i,
    /\bC7\b/i,
    /basis\s+for\s+selection/i,
    /overall\s+admission\s+rate/i,
    /first[-\s]?time,\s*first[-\s]?year/i,
    /SAT\s+Evidence[-\s]?Based\s+Reading/i,
    /ACT\s+Composite/i,
  ];
  return signals.some((re) => re.test(normalized));
}

function mergeWarnings(...warnings) {
  return warnings.filter(Boolean).join(";") || null;
}

function isImageContentType(contentType) {
  return /^image\/(png|jpe?g|webp)/i.test(String(contentType || ""));
}

function isPdfContentType(contentType, url = "") {
  const ct = String(contentType || "").toLowerCase();
  return ct.includes("application/pdf") || String(url || "").toLowerCase().endsWith(".pdf");
}

function isHtmlContentType(contentType) {
  return String(contentType || "").toLowerCase().includes("html");
}

/**
 * Extract raw CDS text before parsing admissions fields.
 *
 * The production path always attempts embedded PDF text first because that is
 * fast and deterministic. If the result looks like a scanned/empty CDS, callers
 * may provide `ocrPdfExtractor(buffer, context)` to render/OCR pages in their
 * own environment. Image sources are OCR'd directly with tesseract.js.
 */
export async function extractCdsDocumentText(buffer, {
  contentType = "",
  url = "",
  ocrPdfExtractor = extractPdfOCR,
  pdfTextExtractor = extractPDF,
  imageOcrOptions = {},
} = {}) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || "");

  if (isPdfContentType(contentType, url)) {
    const pdf = await pdfTextExtractor(buf);
    const pdfText = String(pdf.text || "");
    if (hasUsefulCdsText(pdfText) || typeof ocrPdfExtractor !== "function") {
      return {
        text: pdfText,
        extractionMethod: "pdf_text",
        warning: hasUsefulCdsText(pdfText)
          ? pdf.warning || null
          : mergeWarnings(pdf.warning, "pdf_text_low_signal"),
        pageCount: pdf.pageCount ?? null,
      };
    }

    const ocr = await ocrPdfExtractor(buf, { contentType, url, pageCount: pdf.pageCount ?? null });
    return {
      text: String(ocr?.text || ""),
      extractionMethod: "pdf_ocr",
      warning: mergeWarnings(pdf.warning, "pdf_text_low_signal", ocr?.warning),
      pageCount: ocr?.pageCount ?? pdf.pageCount ?? null,
    };
  }

  if (isImageContentType(contentType)) {
    const ocr = await extractImage(buf, imageOcrOptions);
    return {
      text: String(ocr.text || ""),
      extractionMethod: "image_ocr",
      warning: ocr.warning || null,
      pageCount: null,
    };
  }

  if (isSupportedMime(contentType)) {
    const extracted = await extractText(buf, contentType);
    return {
      text: String(extracted.text || ""),
      extractionMethod: extracted.kind === "text" ? "plain_text" : `${extracted.kind}_text`,
      warning: extracted.warning || null,
      pageCount: extracted.pageCount ?? null,
    };
  }

  const text = buf.toString("utf8");
  return {
    text: isHtmlContentType(contentType) ? stripHtml(text) : text,
    extractionMethod: isHtmlContentType(contentType) ? "html_text" : "plain_text",
    warning: null,
    pageCount: null,
  };
}

export async function parseCdsDocument(buffer, options = {}) {
  const extracted = await extractCdsDocumentText(buffer, options);
  return {
    parsed: parseCdsText(extracted.text),
    text: extracted.text,
    extraction: {
      method: extracted.extractionMethod,
      warning: extracted.warning,
      pageCount: extracted.pageCount ?? null,
      charCount: String(extracted.text || "").length,
    },
  };
}

export function parseCdsText(rawText) {
  const text = String(rawText || "").replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();

  const regexC7 = normalizeC7Object({
    rigor: ratingToNumeric((text.match(/rigor of secondary school record[^.]{0,120}?(very important|important|considered|not considered)/i) || [])[1]),
    classRank: ratingToNumeric((text.match(/class rank[^.]{0,120}?(very important|important|considered|not considered)/i) || [])[1]),
    academicGpa: ratingToNumeric((text.match(/academic gpa[^.]{0,120}?(very important|important|considered|not considered)/i) || [])[1]),
    standardizedTests: ratingToNumeric((text.match(/standardized test scores[^.]{0,140}?(very important|important|considered|not considered)/i) || [])[1]),
    essay: ratingToNumeric((text.match(/application essay[^.]{0,120}?(very important|important|considered|not considered)/i) || [])[1]),
    recommendation: ratingToNumeric((text.match(/recommendation[^.]{0,120}?(very important|important|considered|not considered)/i) || [])[1]),
    extracurriculars: ratingToNumeric((text.match(/extracurricular activities[^.]{0,120}?(very important|important|considered|not considered)/i) || [])[1]),
    talentAbility: ratingToNumeric((text.match(/talent\/ability[^.]{0,120}?(very important|important|considered|not considered)/i) || [])[1]),
    character: ratingToNumeric((text.match(/character\/personal qualities[^.]{0,140}?(very important|important|considered|not considered)/i) || [])[1]),
    firstGeneration: ratingToNumeric((text.match(/first generation[^.]{0,140}?(very important|important|considered|not considered)/i) || [])[1]),
  });
  const tableC7 = extractC7TableRowsFromText(rawText);
  const c7 = { ...regexC7, ...tableC7.c7 };

  const hasTestOptional = /test[\s-]?optional|sat\/act optional|standardized test scores.+not considered/i.test(lower);

  return {
    admitRatePercent: extractPercent("overall admission rate", text) || extractPercent("admission rate", text),
    yieldRatePercent: extractPercent("percent who actually enrolled", text) || extractPercent("yield", text),
    gpaAverage: extractSingleNumber(text, "average high school GPA of all degree-seeking, first-time, first-year"),
    satComposite: extractRange(text, "SAT Evidence-Based Reading and Writing", "SAT Math"),
    actComposite: extractRange(text, "ACT Composite", "ACT Composite") || {
      low: extractSingleNumber(text, "ACT Composite 25th"),
      high: extractSingleNumber(text, "ACT Composite 75th"),
    },
    classRankTop10Percent: extractPercent("percent who had high school class rank in top tenth", text),
    classRankTop25Percent: extractPercent("top quarter", text),
    testPolicy: hasTestOptional ? "test_optional_or_deemphasized" : "test_considered_or_required",
    c7,
    c7TableRows: tableC7.rows,
    c7ExtractionWarnings: tableC7.warnings,
  };
}

export function computeCdsQueryCacheKey(targets) {
  const sig = JSON.stringify((targets || []).map((target) => ({
    unitId: target.unitId || null,
    name: normalizeSchoolName(target.schoolName || target.name || target.label || ""),
  })).sort((a, b) => `${a.unitId || ""}:${a.name}`.localeCompare(`${b.unitId || ""}:${b.name}`)));
  return crypto.createHash("sha256").update(sig).digest("hex");
}

async function fetchText(url, fetchImpl, extractionOptions = {}) {
  const resp = await fetchImpl(url, {
    headers: {
      "user-agent": "college-counselor-backend/1.0 CDS fetcher",
      "accept": "text/html,application/pdf,image/png,image/jpeg,image/webp,application/xhtml+xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const contentType = String(resp.headers.get("content-type") || "").toLowerCase();
  if (isPdfContentType(contentType, url) || isImageContentType(contentType)) {
    const buf = Buffer.from(await resp.arrayBuffer());
    const extracted = await extractCdsDocumentText(buf, {
      ...extractionOptions,
      contentType,
      url,
    });
    return {
      text: extracted.text || "",
      contentType: isPdfContentType(contentType, url) ? "application/pdf" : contentType,
      extraction: {
        method: extracted.extractionMethod,
        warning: extracted.warning,
        pageCount: extracted.pageCount ?? null,
        charCount: String(extracted.text || "").length,
      },
    };
  }
  const text = await resp.text();
  return {
    text: isHtmlContentType(contentType) ? stripHtml(text) : text,
    contentType,
    extraction: {
      method: isHtmlContentType(contentType) ? "html_text" : "plain_text",
      warning: null,
      pageCount: null,
      charCount: text.length,
    },
  };
}

export async function fetchRepositoryIndex({ fetchImpl = fetch } = {}) {
  const resp = await fetchImpl(CDS_REPOSITORY_URL, {
    headers: {
      "user-agent": "college-counselor-backend/1.0 CDS index fetcher",
      "accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
  });
  if (!resp.ok) throw new Error(`CDS repository fetch failed: HTTP ${resp.status}`);
  return await resp.text();
}

export async function resolveAndParseCdsTargets(targets, {
  fetchImpl = fetch,
  repositoryHtml = null,
  ocrPdfExtractor = null,
  pdfTextExtractor = extractPDF,
  imageOcrOptions = {},
} = {}) {
  const html = repositoryHtml ?? await fetchRepositoryIndex({ fetchImpl });
  const entries = parseCdsRepositoryIndex(html);
  const results = [];

  for (const target of targets || []) {
    const schoolName = target.schoolName || target.name || target.label || "";
    const entry = findBestRepositoryEntry(entries, schoolName);
    const preferred = selectPreferredCdsLink(entry);
    let parsed = null;
    let fetchStatus = "not_fetched";
    let sourceUrl = preferred?.url || null;
    let sourceContentType = null;
    let sourceExtraction = null;

    if (preferred?.url) {
      try {
        const doc = await fetchText(preferred.url, fetchImpl, { ocrPdfExtractor, pdfTextExtractor, imageOcrOptions });
        parsed = parseCdsText(doc.text);
        sourceContentType = doc.contentType;
        sourceExtraction = doc.extraction || null;
        fetchStatus = "ok";
      } catch (err) {
        fetchStatus = `error:${err.message}`;
      }
    } else if (preferred?.year) {
      fetchStatus = "listed_without_direct_link";
    } else {
      fetchStatus = "not_found";
    }

    results.push({
      unitId: target.unitId || null,
      schoolName,
      repositoryMatch: entry ? {
        schoolName: entry.schoolName,
        latestAvailableYear: entry.years.find((year) => year.available)?.year || null,
      } : null,
      source: "College Transitions CDS repository",
      sourceUrl,
      sourceContentType,
      sourceExtraction,
      fetchStatus,
      parsed,
    });
  }

  return results;
}

export function extractTargetSchoolNames(goals, fallbackRows = []) {
  const names = [];
  const fallbackByUnitId = new Map(
    (fallbackRows || []).map((row) => [String(row.unit_id || row.unitId || ""), row.name]).filter(([id, name]) => id && name)
  );
  for (const goal of goals || []) {
    if (typeof goal === "string" && goal.trim()) {
      names.push({ unitId: null, schoolName: goal.trim() });
      continue;
    }
    if (!goal || typeof goal !== "object") continue;
    const rawUnitId = goal.unitId ?? goal.unit_id ?? goal.id ?? null;
    const unitId = rawUnitId ? String(rawUnitId) : null;
    const schoolName = goal.schoolName || goal.name || goal.label || (unitId ? fallbackByUnitId.get(unitId) : null);
    if (schoolName) names.push({ unitId, schoolName });
  }
  const seen = new Set();
  return names.filter((item) => {
    const key = `${item.unitId || ""}|${normalizeSchoolName(item.schoolName)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

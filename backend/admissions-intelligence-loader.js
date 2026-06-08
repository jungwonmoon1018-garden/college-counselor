import fs from "node:fs";
import path from "node:path";

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeValue(value) {
  const raw = String(value ?? "").trim();
  if (raw === "") return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseCsv(text) {
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]).map(normalizeHeader);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = normalizeValue(cells[idx]);
    });
    return row;
  });
}

function pick(row, keys) {
  for (const key of keys) {
    if (row[key] != null && row[key] !== "") return row[key];
  }
  return null;
}

function normalizeAwardLevel(value) {
  const text = String(value || "").toLowerCase();
  if (!text) return "bachelor";
  if (text.includes("bachelor") || text === "5") return "bachelor";
  if (text.includes("master") || text === "7") return "master";
  if (text.includes("doctor") || text === "9") return "doctorate";
  if (text.includes("associate") || text === "3") return "associate";
  return text.replace(/\s+/g, "_");
}

function asYear(value) {
  const n = Number(value);
  if (Number.isFinite(n) && n >= 1900 && n <= 2100) return Math.trunc(n);
  const match = String(value || "").match(/(20\d{2}|19\d{2})/);
  return match ? Number(match[1]) : null;
}

function asUnitId(value) {
  const s = String(value || "").trim();
  return /^\d{4,8}$/.test(s) ? s : null;
}

function asCipCode(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{2})(?:\.?(\d{2})(?:\.?(\d{2}))?)?$/);
  if (!match) return raw;
  const [, a, b, c] = match;
  if (c) return `${a}.${b}${c}`;
  if (b) return `${a}.${b}`;
  return a;
}

function asCompletions(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : null;
}

export function normalizeIpedsLongRows(rows, {
  sourceUrl = "https://nces.ed.gov/ipeds/",
  sourceTitle = "NCES IPEDS completions",
} = {}) {
  const normalized = [];
  for (const row of rows || []) {
    const unitId = asUnitId(pick(row, ["unitid", "unit_id", "opeid", "institution_id"]));
    const cipCode = asCipCode(pick(row, ["cipcode", "cip_code", "cip_4", "cip_6", "cip"]));
    const year = asYear(pick(row, ["year", "data_year", "survey_year", "academic_year"]));
    const completions = asCompletions(pick(row, ["completions", "awards", "ctotal", "completions_total", "total_completions"]));
    if (!cipCode || !year || completions == null) continue;
    normalized.push({
      unitId,
      cipCode,
      awardLevel: normalizeAwardLevel(pick(row, ["award_level", "awardlevel", "awlevel", "award"])),
      year,
      completions,
      sourceUrl,
      sourceTitle,
    });
  }
  return normalized;
}

export function computeGrowthRows(longRows, {
  yearStart = null,
  yearEnd = null,
} = {}) {
  const groups = new Map();
  for (const row of longRows || []) {
    const key = [row.unitId || "", row.cipCode, row.awardLevel || "bachelor"].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const out = [];
  for (const values of groups.values()) {
    values.sort((a, b) => a.year - b.year);
    const first = yearStart != null ? values.find((r) => r.year === yearStart) : values[0];
    const last = yearEnd != null ? [...values].reverse().find((r) => r.year === yearEnd) : values[values.length - 1];
    if (!first || !last || first.year >= last.year) continue;
    const start = Number(first.completions);
    const end = Number(last.completions);
    const growthRate = start > 0 ? (end - start) / start : (end > 0 ? 1 : 0);
    out.push({
      unitId: first.unitId,
      cipCode: first.cipCode,
      awardLevel: first.awardLevel,
      yearStart: first.year,
      yearEnd: last.year,
      completionsStart: start,
      completionsEnd: end,
      growthRate,
      sourceUrl: last.sourceUrl,
      sourceTitle: last.sourceTitle,
      sourceType: "official",
    });
  }
  return out;
}

export function loadIpedsGrowthFile(filePath, options = {}) {
  const resolved = path.resolve(filePath);
  const raw = fs.readFileSync(resolved, "utf8");
  const ext = path.extname(resolved).toLowerCase();
  let longRows = [];

  if (ext === ".json") {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.yearStart != null && parsed[0]?.growthRate != null) {
      return parsed;
    }
    longRows = normalizeIpedsLongRows(Array.isArray(parsed) ? parsed : parsed.rows || [], options);
  } else {
    longRows = normalizeIpedsLongRows(parseCsv(raw), options);
  }

  return computeGrowthRows(longRows, options);
}

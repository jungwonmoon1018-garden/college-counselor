import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC"
]);

function readArg(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

const hdPath = path.resolve(PROJECT_ROOT, readArg("--hd", "data/ipeds/hd2023_unzipped/hd2023.csv"));
const admPath = path.resolve(PROJECT_ROOT, readArg("--adm", "data/ipeds/adm2023_unzipped/adm2023.csv"));
const outPath = path.resolve(PROJECT_ROOT, readArg("--out", "generated/college-profiles.generated.js"));

function parseCsvLine(line) {
  const out = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === "\"") {
        if (line[i + 1] === "\"") {
          current += "\"";
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === "\"") {
      inQuotes = true;
    } else if (char === ",") {
      out.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  out.push(current);
  return out;
}

function parseCsvFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0]);
  const rows = [];

  for (const line of lines.slice(1)) {
    const values = parseCsvLine(line);
    const row = {};
    for (let i = 0; i < headers.length; i += 1) {
      row[headers[i]] = values[i] ?? "";
    }
    rows.push(row);
  }

  return rows;
}

function parseNumber(value) {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function ratio(numerator, denominator) {
  if (numerator == null || denominator == null || denominator <= 0) return null;
  return numerator / denominator;
}

function average(values) {
  const valid = values.filter(value => value != null);
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function estimateEnrollment(instSizeCode) {
  const estimates = new Map([
    [1, 500],
    [2, 2500],
    [3, 7500],
    [4, 15000],
    [5, 30000]
  ]);
  return estimates.get(instSizeCode) ?? null;
}

function isEligibleInstitution(hdRow) {
  const control = parseNumber(hdRow.CONTROL);
  const level = parseNumber(hdRow.ICLEVEL);
  const carnegie = parseNumber(hdRow.C21BASIC);
  const degreeGranting = parseNumber(hdRow.DEGGRANT);
  const active = parseNumber(hdRow.CYACTIVE);
  const state = hdRow.STABBR;

  if (!US_STATE_CODES.has(state)) return false;
  if (![1, 2].includes(control)) return false;
  if (level !== 1) return false;
  if (degreeGranting !== 1) return false;
  if (active !== 1) return false;
  if (carnegie == null || carnegie < 1 || carnegie > 24) return false;

  return true;
}

function buildCollegeProfile(hdRow, admRow) {
  const sat25Component = average([parseNumber(admRow.SATVR25), parseNumber(admRow.SATMT25)]);
  const sat75Component = average([parseNumber(admRow.SATVR75), parseNumber(admRow.SATMT75)]);

  return {
    unitId: hdRow.UNITID,
    name: hdRow.INSTNM,
    state: hdRow.STABBR,
    sat25: sat25Component != null ? Math.round(sat25Component * 2) : null,
    sat75: sat75Component != null ? Math.round(sat75Component * 2) : null,
    act25: parseNumber(admRow.ACTCM25),
    act75: parseNumber(admRow.ACTCM75),
    acceptance: ratio(parseNumber(admRow.ADMSSN), parseNumber(admRow.APPLCN)),
    enrollment: estimateEnrollment(parseNumber(hdRow.INSTSIZE)),
    tuitionIn: null,
    tuitionOut: null,
    avgGpaAdmitted: null,
    apCoursesValued: [],
    topMajors: [],
    ecEmphasis: [],
    yieldRate: ratio(parseNumber(admRow.ENRLT), parseNumber(admRow.ADMSSN)),
    retentionRate: null,
    gradRate6yr: null,
    medianEarnings10yr: null,
    dataYear: 2023,
    _selectionState: hdRow.STABBR,
    _selectionCategory: parseNumber(hdRow.C21BASIC)
  };
}

function compareSelectionProfiles(a, b) {
  if (a.acceptance == null && b.acceptance != null) return 1;
  if (a.acceptance != null && b.acceptance == null) return -1;
  if (a.acceptance != null && b.acceptance != null && a.acceptance !== b.acceptance) {
    return a.acceptance - b.acceptance;
  }

  if (a.sat75 == null && b.sat75 != null) return 1;
  if (a.sat75 != null && b.sat75 == null) return -1;
  if (a.sat75 != null && b.sat75 != null && a.sat75 !== b.sat75) return b.sat75 - a.sat75;

  if (a.act75 == null && b.act75 != null) return 1;
  if (a.act75 != null && b.act75 == null) return -1;
  if (a.act75 != null && b.act75 != null && a.act75 !== b.act75) return b.act75 - a.act75;

  if (a.yieldRate == null && b.yieldRate != null) return 1;
  if (a.yieldRate != null && b.yieldRate == null) return -1;
  if (a.yieldRate != null && b.yieldRate != null && a.yieldRate !== b.yieldRate) return b.yieldRate - a.yieldRate;

  if (a.enrollment == null && b.enrollment != null) return 1;
  if (a.enrollment != null && b.enrollment == null) return -1;
  if (a.enrollment != null && b.enrollment != null && a.enrollment !== b.enrollment) return b.enrollment - a.enrollment;

  return a.name.localeCompare(b.name);
}

function isPreferredStatePick(profile) {
  return (profile.enrollment ?? 0) >= 2500 || profile._selectionCategory === 15 || profile._selectionCategory === 21;
}

function uniqueByUnitId(profiles) {
  const byUnitId = new Map();
  for (const profile of profiles) {
    if (!byUnitId.has(profile.unitId)) byUnitId.set(profile.unitId, profile);
  }
  return [...byUnitId.values()];
}

function stripSelectionFields(profile) {
  const { _selectionState, _selectionCategory, ...clean } = profile;
  return clean;
}

function main() {
  if (!fs.existsSync(hdPath)) throw new Error(`Missing HD CSV: ${hdPath}`);
  if (!fs.existsSync(admPath)) throw new Error(`Missing ADM CSV: ${admPath}`);

  const hdRows = parseCsvFile(hdPath);
  const admRows = parseCsvFile(admPath);
  const admByUnitId = new Map(admRows.map(row => [row.UNITID, row]));

  const profiles = hdRows
    .filter(isEligibleInstitution)
    .map(hdRow => buildCollegeProfile(hdRow, admByUnitId.get(hdRow.UNITID) || {}));

  const rankedProfiles = [...profiles].sort(compareSelectionProfiles);
  const nationalUniversities = rankedProfiles.filter(profile => profile._selectionCategory === 15).slice(0, 100);
  const liberalArtsColleges = rankedProfiles.filter(profile => profile._selectionCategory === 21).slice(0, 50);

  const stateTopPicks = [];
  for (const state of [...US_STATE_CODES].sort()) {
    const candidates = rankedProfiles.filter(profile => profile._selectionState === state);
    const preferred = candidates.filter(isPreferredStatePick);
    const secondary = candidates.filter(profile => !isPreferredStatePick(profile));
    stateTopPicks.push(...preferred.slice(0, 10));
    if (preferred.length < 10) {
      stateTopPicks.push(...secondary.slice(0, 10 - preferred.length));
    }
  }

  const selectedProfiles = uniqueByUnitId([
    ...nationalUniversities,
    ...liberalArtsColleges,
    ...stateTopPicks
  ])
    .map(stripSelectionFields)
    .sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const fileContents = `// Auto-generated by scripts/generate-college-profiles.mjs.\n// Source: NCES IPEDS HD2023 + ADM2023.\n// Selection: top 100 national universities, top 50 liberal arts colleges,\n// and the top 10 four-year public/private nonprofit institutions per state.\n// Manual Common Data Set overrides remain in baseline-data.js for richer GPA/AP/EC metadata.\nexport const GENERATED_COLLEGE_PROFILES = ${JSON.stringify(selectedProfiles, null, 2)};\n`;
  fs.writeFileSync(outPath, fileContents, "utf8");

  console.log(`Generated ${selectedProfiles.length} fallback college profiles at ${outPath}`);
}

main();

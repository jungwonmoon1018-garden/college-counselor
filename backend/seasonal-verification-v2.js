// Retrieval-first seasonal verification. Official CDS and College Scorecard
// values are compared deterministically; disagreements are quarantined and
// never delegated to a generative model.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const CDS_CACHE_DIR = path.join(MODULE_DIR, 'tools', 'cds-cache');
const PDFS_DIR = path.join(CDS_CACHE_DIR, 'pdfs');
const PARSED_DIR = path.join(CDS_CACHE_DIR, 'parsed');
const CACHED_SCRAPE_STALE_DAYS = 90;

const TOLERANCES = Object.freeze({
  admit_rate: Object.freeze({ confirm: 0.05, contradict: 0.15 }),
  sat_25: Object.freeze({ confirm: 50, contradict: 150 }),
  sat_75: Object.freeze({ confirm: 50, contradict: 150 }),
});

async function readLensA(slug, field) {
  const parsedPath = path.join(PARSED_DIR, `${slug}.json`);
  if (fs.existsSync(parsedPath)) {
    try {
      const data = JSON.parse(await fs.promises.readFile(parsedPath, 'utf-8'));
      return extractFieldFromParsedCDS(data, field);
    } catch (error) {
      console.warn(`[seasonal-v2] parsed CDS for ${slug} unreadable:`, error.message);
    }
  }

  const pdfPath = await findCdsPdf(slug);
  if (!pdfPath) return null;
  try {
    const parser = await import('./cds-pdf-parser.js');
    if (typeof parser.parseCdsPdfFile !== 'function') return null;
    const data = await parser.parseCdsPdfFile(pdfPath);
    return extractFieldFromParsedCDS(data, field);
  } catch (error) {
    console.warn(`[seasonal-v2] CDS parse for ${slug} failed:`, error.message);
    return null;
  }
}

async function findCdsPdf(slug) {
  if (!fs.existsSync(PDFS_DIR)) return null;
  const entries = await fs.promises.readdir(PDFS_DIR);
  const match = entries.find((entry) => entry.startsWith(`${slug}.`) && entry.endsWith('.pdf'));
  return match ? path.join(PDFS_DIR, match) : null;
}

function extractFieldFromParsedCDS(parsed, field) {
  if (!parsed) return null;
  if (field === 'admit_rate') {
    const section = parsed.sections?.C || {};
    if (Number.isFinite(section.admit_rate)) return section.admit_rate;
    if (Number.isFinite(section.C1?.admit_rate)) return section.C1.admit_rate;
    return null;
  }
  if (field === 'sat_25' || field === 'sat_75') {
    const band = parsed.sections?.C?.C9?.SAT_composite
      || parsed.sections?.C?.C9?.SAT
      || parsed.sections?.C9?.SAT_composite
      || parsed.sections?.C9?.SAT;
    return Number.isFinite(band?.[field]) ? band[field] : null;
  }
  return null;
}

async function readLensB(slug, field, scorecardAPI) {
  if (typeof scorecardAPI?.getCollegeById !== 'function') return null;
  try {
    const row = await scorecardAPI.getCollegeById(slug);
    return Number.isFinite(row?.[field]) ? row[field] : null;
  } catch (error) {
    console.warn(`[seasonal-v2] Scorecard for ${slug}.${field} failed:`, error.message);
    return null;
  }
}

function readLensC(citedRow, field) {
  if (!citedRow) return { value: null, stale: false };
  const scrapedAt = citedRow.scraped_at ? new Date(citedRow.scraped_at).getTime() : 0;
  const ageDays = (Date.now() - scrapedAt) / (1000 * 60 * 60 * 24);
  if (!Number.isFinite(ageDays) || ageDays > CACHED_SCRAPE_STALE_DAYS) {
    return { value: null, stale: true };
  }
  return {
    value: Number.isFinite(citedRow[field]) ? citedRow[field] : null,
    stale: false,
  };
}

export function compareLensValues(scraped, lensValue, field) {
  if (!Number.isFinite(scraped) || !Number.isFinite(lensValue)) return 'unconfirmed';
  const tolerance = TOLERANCES[field];
  if (!tolerance) return 'unconfirmed';
  const difference = Math.abs(scraped - lensValue);
  if (field === 'admit_rate') {
    const relative = difference / Math.max(Math.abs(scraped), Math.abs(lensValue), Number.EPSILON);
    if (relative <= tolerance.confirm) return 'confirm';
    if (relative >= tolerance.contradict) return 'contradict';
    return 'unconfirmed';
  }
  if (difference <= tolerance.confirm) return 'confirm';
  if (difference >= tolerance.contradict) return 'contradict';
  return 'unconfirmed';
}

function resolveStatus(votes) {
  const confirms = votes.filter((vote) => vote.vote === 'confirm');
  const contradictions = votes.filter((vote) => vote.vote === 'contradict');
  const officialConfirm = confirms.some((vote) => vote.lens === 'A' || vote.lens === 'B');
  if (confirms.length >= 2 && contradictions.length === 0 && officialConfirm) return 'verified';
  if (contradictions.length > 0) return 'discrepancy';
  return 'unverified';
}

function quarantineReason(votes) {
  const confirmed = votes.filter((vote) => vote.vote === 'confirm').map((vote) => vote.lens);
  const contradicted = votes.filter((vote) => vote.vote === 'contradict').map((vote) => vote.lens);
  if (confirmed.length && contradicted.length) {
    return `Lens disagreement: confirmed by ${confirmed.join(', ')}, contradicted by ${contradicted.join(', ')}.`;
  }
  return `Contradicted by lens ${contradicted.join(', ')}.`;
}

export async function verifySeasonalRecordV2({ slug, field, scraped, citedRow, scorecardAPI }) {
  const lensA = await readLensA(slug, field);
  const lensB = await readLensB(slug, field, scorecardAPI);
  const lensC = readLensC(citedRow, field);
  const lenses = [
    { lens: 'A', value: lensA, vote: compareLensValues(scraped, lensA, field) },
    { lens: 'B', value: lensB, vote: compareLensValues(scraped, lensB, field) },
    { lens: 'C', value: lensC.value, vote: compareLensValues(scraped, lensC.value, field) },
  ];
  const status = resolveStatus(lenses);
  return {
    status,
    lenses,
    cited_source_stale: lensC.stale,
    adjudication: status === 'discrepancy'
      ? { method: 'deterministic_quarantine', reason: quarantineReason(lenses) }
      : null,
    total_tokens: { input: 0, output: 0 },
  };
}

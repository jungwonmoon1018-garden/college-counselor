// ═══════════════════════════════════════════════════════════════════════
// SEASONAL VERIFICATION v2 — retrieval-first 3-lens council (Pillar 3)
// ═══════════════════════════════════════════════════════════════════════
// Drop-in replacement for verifySeasonalRecord in seasonal-research.js.
// The original called the OpenRouter web plugin once per lens per record
// (~3 calls × 25 colleges ≈ 75k+ tokens per quarterly run). This version
// fetches each lens deterministically:
//
//   Lens A (CDS):       parse the locally cached PDF via cds-pdf-parser.
//   Lens B (Scorecard): hit the College Scorecard JSON API directly.
//   Lens C (cited):     reuse the existing cached scrape. If the cached
//                       scrape is older than 90 days, mark unconfirmed
//                       instead of re-fetching.
//
// compareLensValues() is a deterministic comparator — no LLM call. Each
// lens votes confirm / contradict / unconfirmed against the scraped
// value using numeric tolerances (admit rate ±5% confirm, ±15% contradict;
// SAT ±50 / ±150 points).
//
// LLM only fires on disagreement: when ≥1 lens confirms AND ≥1 contradicts,
// the embedded Qwen2.5-1.5B reads the structured tuple {scraped, lensA,
// lensB, lensC} and emits a one-paragraph adjudication (~200 in, ~100 out).
//
// Expected token usage: ~5k/run (vs ~120k baseline).
//
// To wire in seasonal-research.js, replace:
//   const verification = await verifySeasonalRecord({...});
// with:
//   const verification = await verifySeasonalRecordV2({...});
// (Same return shape: { status, lenses, adjudication?, total_tokens }.)
// ═══════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callLLM, isEmbeddedAvailable, resolveTierDefault } from "./llm-adapters/index.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const CDS_CACHE_DIR = path.join(MODULE_DIR, "tools", "cds-cache");
const PDFS_DIR = path.join(CDS_CACHE_DIR, "pdfs");
const PARSED_DIR = path.join(CDS_CACHE_DIR, "parsed");

// Numeric tolerances for compareLensValues.
const TOLERANCES = {
  admit_rate: { confirm: 0.05, contradict: 0.15 }, // relative
  sat_25:     { confirm: 50,   contradict: 150 },  // absolute
  sat_75:     { confirm: 50,   contradict: 150 },
};

const CACHED_SCRAPE_STALE_DAYS = 90;

/**
 * Lens A — local CDS PDF. Reads the parsed cache (preferred) or falls
 * back to a fresh parse of the PDF on disk. Returns the structured
 * value tuple or null if no CDS is available for this slug.
 */
async function readLensA(slug, field) {
  // Prefer the already-parsed JSON sidecar produced by `npm run refresh:cds`.
  const parsedPath = path.join(PARSED_DIR, `${slug}.json`);
  if (fs.existsSync(parsedPath)) {
    try {
      const data = JSON.parse(await fs.promises.readFile(parsedPath, "utf-8"));
      return extractFieldFromParsedCDS(data, field);
    } catch (err) {
      console.warn(`[seasonal-v2] parsed CDS for ${slug} unreadable:`, err.message);
    }
  }

  // Fallback: parse the PDF directly via cds-pdf-parser.
  const pdfMatch = await findCdsPdf(slug);
  if (!pdfMatch) return null;
  try {
    const parser = await import("./cds-pdf-parser.js");
    if (typeof parser.parseCdsPdfFile === "function") {
      const data = await parser.parseCdsPdfFile(pdfMatch);
      return extractFieldFromParsedCDS(data, field);
    }
  } catch (err) {
    console.warn(`[seasonal-v2] fallback PDF parse for ${slug} failed:`, err.message);
  }
  return null;
}

async function findCdsPdf(slug) {
  if (!fs.existsSync(PDFS_DIR)) return null;
  const entries = await fs.promises.readdir(PDFS_DIR);
  const match = entries.find((f) => f.startsWith(`${slug}.`) && f.endsWith(".pdf"));
  return match ? path.join(PDFS_DIR, match) : null;
}

function extractFieldFromParsedCDS(parsed, field) {
  if (!parsed) return null;
  if (field === "admit_rate") {
    const c = parsed.sections?.C || {};
    if (Number.isFinite(c.admit_rate)) return c.admit_rate;
    if (Number.isFinite(c.C1?.admit_rate)) return c.C1.admit_rate;
    return null;
  }
  if (field === "sat_25" || field === "sat_75") {
    const c9 = parsed.sections?.C?.C9 || parsed.sections?.C9;
    if (!c9) return null;
    const band = c9.SAT_composite || c9.SAT || {};
    return Number.isFinite(band[field]) ? band[field] : null;
  }
  return null;
}

/**
 * Lens B — College Scorecard JSON. Uses the existing
 * backend/college-scorecard.js integration so the API key + caching
 * machinery are reused. Returns null when the API call fails or the
 * field isn't in the canonical Scorecard shape.
 */
async function readLensB(slug, field, scorecardAPI) {
  if (!scorecardAPI || typeof scorecardAPI.getCollegeById !== "function") return null;
  try {
    const row = await scorecardAPI.getCollegeById(slug);
    if (!row) return null;
    if (field === "admit_rate") return Number.isFinite(row.admit_rate) ? row.admit_rate : null;
    if (field === "sat_25") return Number.isFinite(row.sat_25) ? row.sat_25 : null;
    if (field === "sat_75") return Number.isFinite(row.sat_75) ? row.sat_75 : null;
    return null;
  } catch (err) {
    console.warn(`[seasonal-v2] Lens B for ${slug}.${field} failed:`, err.message);
    return null;
  }
}

/**
 * Lens C — previously cited source scrape. Reads from the cached
 * cited-source row. If the cached value is older than the staleness
 * threshold, returns unconfirmed instead of re-fetching.
 */
function readLensC(citedRow, field) {
  if (!citedRow) return { value: null, stale: false };
  const scrapedAt = citedRow.scraped_at ? new Date(citedRow.scraped_at).getTime() : 0;
  const ageDays = (Date.now() - scrapedAt) / (1000 * 60 * 60 * 24);
  if (ageDays > CACHED_SCRAPE_STALE_DAYS) return { value: null, stale: true };
  return { value: Number.isFinite(citedRow[field]) ? citedRow[field] : null, stale: false };
}

/**
 * Deterministic comparator. No LLM call.
 */
export function compareLensValues(scraped, lensValue, field) {
  if (!Number.isFinite(scraped) || !Number.isFinite(lensValue)) return "unconfirmed";
  const tol = TOLERANCES[field];
  if (!tol) return "unconfirmed";
  const diff = Math.abs(scraped - lensValue);
  if (field === "admit_rate") {
    const rel = diff / Math.max(scraped, lensValue);
    if (rel <= tol.confirm) return "confirm";
    if (rel >= tol.contradict) return "contradict";
    return "unconfirmed";
  }
  if (diff <= tol.confirm) return "confirm";
  if (diff >= tol.contradict) return "contradict";
  return "unconfirmed";
}

function tallyVotes(votes) {
  const confirms = votes.filter((v) => v === "confirm").length;
  const contradicts = votes.filter((v) => v === "contradict").length;
  if (confirms >= 2 && contradicts === 0) return "verified";
  if (contradicts >= 1 && confirms >= 1) return "disagreement"; // LLM adjudication next
  if (contradicts >= 1) return "discrepancy";                    // quarantine
  return "unverified";
}

/**
 * Embedded-LLM adjudication. Only fires when lenses disagree. Produces
 * a one-paragraph natural-language tie-break and a final status.
 */
async function llmAdjudicate({ scraped, lensA, lensB, lensC, field, slug }) {
  if (!isEmbeddedAvailable()) {
    // No embedded model — stay deterministic: when lenses disagree, lean
    // toward quarantine to protect the student from bad data.
    return { status: "discrepancy", text: "(embedded model unavailable — defaulted to quarantine on lens disagreement)", tokens: { input: 0, output: 0 } };
  }
  const modelId = resolveTierDefault("embedded", "small");
  const system =
    "You are a verification adjudicator for college admissions statistics. " +
    "Given a scraped value and three lens values, decide whether to mark the scraped value as " +
    "'verified' (lenses corroborate within tolerance), 'discrepancy' (scraped value is wrong, " +
    "quarantine it), or 'unverified' (insufficient evidence either way). " +
    "Respond with JSON ONLY: {\"status\": \"verified\"|\"discrepancy\"|\"unverified\", \"reason\": \"<25 words\"}.";
  const user = JSON.stringify({ slug, field, scraped, lensA, lensB, lensC });
  try {
    const resp = await callLLM({
      provider: "embedded",
      baseUrl: "embedded://local",
      model: modelId,
      system,
      messages: [{ role: "user", content: user }],
      maxTokens: 100,
      temperature: 0,
    });
    const raw = Array.isArray(resp?.content) ? resp.content.map((c) => c.text || "").join("").trim() : "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { status: "unverified", text: "(adjudicator returned unparseable output)", tokens: resp?.usage || { input: 0, output: 0 } };
    const parsed = JSON.parse(match[0]);
    const status = ["verified", "discrepancy", "unverified"].includes(parsed.status) ? parsed.status : "unverified";
    return {
      status,
      text: String(parsed.reason || "").slice(0, 200),
      tokens: resp?.usage || { input: 0, output: 0 },
    };
  } catch (err) {
    console.warn(`[seasonal-v2] adjudicator failed for ${slug}.${field}:`, err.message);
    return { status: "discrepancy", text: "(adjudicator error — quarantined defensively)", tokens: { input: 0, output: 0 } };
  }
}

/**
 * Drop-in replacement for seasonal-research.verifySeasonalRecord.
 *
 * @param {object} args
 * @param {string} args.slug
 * @param {"admit_rate"|"sat_25"|"sat_75"} args.field
 * @param {number} args.scraped         — value to verify
 * @param {object} [args.citedRow]      — cached cited-source row from prior runs
 * @param {object} [args.scorecardAPI]  — module ref to backend/college-scorecard.js
 *                                        (caller injects so this module stays decoupled)
 */
export async function verifySeasonalRecordV2({ slug, field, scraped, citedRow, scorecardAPI }) {
  const lensA = await readLensA(slug, field);
  const lensB = await readLensB(slug, field, scorecardAPI);
  const lensC = readLensC(citedRow, field);

  const votes = [
    { lens: "A", value: lensA,        vote: compareLensValues(scraped, lensA, field) },
    { lens: "B", value: lensB,        vote: compareLensValues(scraped, lensB, field) },
    { lens: "C", value: lensC.value,  vote: compareLensValues(scraped, lensC.value, field) },
  ];
  const tally = tallyVotes(votes.map((v) => v.vote));

  let adjudication = null;
  let totalTokens = { input: 0, output: 0 };
  let finalStatus = tally;

  if (tally === "disagreement") {
    adjudication = await llmAdjudicate({
      scraped,
      lensA, lensB, lensC: lensC.value,
      field, slug,
    });
    finalStatus = adjudication.status;
    totalTokens = adjudication.tokens || totalTokens;
  }

  return {
    status: finalStatus,
    lenses: votes,
    cited_source_stale: lensC.stale,
    adjudication,
    total_tokens: totalTokens,
  };
}

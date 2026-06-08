// ═══════════════════════════════════════════════════════════════════════
// COLLEGE SCORECARD — Live College Data Integration (Tier 1)
// ═══════════════════════════════════════════════════════════════════════
// Wraps the U.S. Department of Education College Scorecard API
// https://collegescorecard.ed.gov/data/documentation/
//
// Provides:
//   1. Search 4,000+ institutions (not just hardcoded 20)
//   2. Live admission stats, costs, outcomes
//   3. College comparison matrices
//   4. Financial aid data
//
// Requires: SCORECARD_API_KEY in .env (free from https://api.data.gov/signup/)

const SCORECARD_BASE = "https://api.data.gov/ed/collegescorecard/v1";

// Field mapping: Scorecard API → our schema
const FIELD_MAP = {
  "id":                                       "unitId",
  "school.name":                              "name",
  "school.state":                             "state",
  "school.city":                              "city",
  "school.school_url":                        "website",
  "school.ownership":                         "ownership",       // 1=public, 2=private nonprofit, 3=private for-profit
  "school.locale":                            "locale",          // 11=city-large, 12=city-mid, etc.
  "school.carnegie_size_setting":             "sizeSetting",
  "latest.admissions.sat_scores.25th_percentile.critical_reading":  "satCR25",
  "latest.admissions.sat_scores.75th_percentile.critical_reading":  "satCR75",
  "latest.admissions.sat_scores.25th_percentile.math":             "satMath25",
  "latest.admissions.sat_scores.75th_percentile.math":             "satMath75",
  "latest.admissions.sat_scores.midpoint.critical_reading":        "satCRMid",
  "latest.admissions.sat_scores.midpoint.math":                    "satMathMid",
  "latest.admissions.act_scores.25th_percentile.cumulative":       "act25",
  "latest.admissions.act_scores.75th_percentile.cumulative":       "act75",
  "latest.admissions.act_scores.midpoint.cumulative":              "actMid",
  "latest.admissions.admission_rate.overall":                      "acceptanceRate",
  "latest.student.size":                                           "enrollment",
  "latest.cost.tuition.in_state":                                  "tuitionIn",
  "latest.cost.tuition.out_of_state":                              "tuitionOut",
  "latest.cost.avg_net_price.overall":                             "avgNetPrice",
  "latest.aid.pell_grant_rate":                                    "pellRate",
  "latest.aid.federal_loan_rate":                                  "federalLoanRate",
  "latest.aid.median_debt.completers.overall":                     "medianDebt",
  "latest.completion.rate_suppressed.overall":                     "gradRate",
  "latest.earnings.10_yrs_after_entry.median":                     "medianEarnings10yr",
  "latest.student.retention_rate.four_year.full_time":             "retentionRate",
  "latest.student.demographics.race_ethnicity.white":              "pctWhite",
  "latest.student.demographics.race_ethnicity.black":              "pctBlack",
  "latest.student.demographics.race_ethnicity.hispanic":           "pctHispanic",
  "latest.student.demographics.race_ethnicity.asian":              "pctAsian",
  "latest.programs.cip_4_digit":                                   "programs",
};

const ALL_FIELDS = Object.keys(FIELD_MAP).join(",");

// ─── Fetch from Scorecard API ───
export async function searchScorecard(apiKey, filters = {}) {
  if (!apiKey) return { error: "SCORECARD_API_KEY not configured", results: [], source: "offline" };

  const params = new URLSearchParams();
  params.set("api_key", apiKey);
  params.set("fields", ALL_FIELDS);
  params.set("per_page", String(filters.limit || 20));
  params.set("page", String(filters.page || 0));

  // Apply filters
  if (filters.name)        params.set("school.name", filters.name);
  if (filters.state)       params.set("school.state", filters.state);
  if (filters.states)      params.set("school.state", filters.states.join(","));
  if (filters.minSAT)      params.set("latest.admissions.sat_scores.midpoint.critical_reading__range", `${Math.round(filters.minSAT/2)}..`);
  if (filters.maxTuition)  params.set("latest.cost.tuition.in_state__range", `..${filters.maxTuition}`);
  if (filters.maxAcceptanceRate) params.set("latest.admissions.admission_rate.overall__range", `..${filters.maxAcceptanceRate/100}`);
  if (filters.sizePreference === "small")  params.set("latest.student.size__range", "..5000");
  if (filters.sizePreference === "medium") params.set("latest.student.size__range", "5000..20000");
  if (filters.sizePreference === "large")  params.set("latest.student.size__range", "20000..");

  // Always filter to degree-granting, primarily 4-year institutions
  params.set("school.degrees_awarded.predominant", "3"); // 3 = Bachelor's
  params.set("school.operating", "1"); // Currently operating

  try {
    const url = `${SCORECARD_BASE}/schools?${params}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Scorecard API ${res.status}: ${res.statusText}`);
    const json = await res.json();

    const results = (json.results || []).map(r => normalizeResult(r));
    return {
      results,
      total: json.metadata?.total || results.length,
      page: json.metadata?.page || 0,
      source: "U.S. Department of Education College Scorecard API",
      sourceUrl: "https://collegescorecard.ed.gov/"
    };
  } catch (err) {
    console.warn("[SCORECARD] API error:", err.message);
    return { error: err.message, results: [], source: "offline" };
  }
}

export async function getCollegeById(apiKey, unitId) {
  if (!apiKey) return null;
  try {
    const params = new URLSearchParams({ api_key: apiKey, id: unitId, fields: ALL_FIELDS });
    const res = await fetch(`${SCORECARD_BASE}/schools?${params}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const json = await res.json();
    return json.results?.[0] ? normalizeResult(json.results[0]) : null;
  } catch { return null; }
}

// ─── Compare N colleges head-to-head (Tier 4: College Comparison Matrix) ───
export async function compareColleges(apiKey, unitIds) {
  if (!apiKey || !unitIds?.length) return { error: "No colleges to compare", comparison: [] };

  const colleges = await Promise.all(unitIds.map(id => getCollegeById(apiKey, id)));
  const valid = colleges.filter(Boolean);
  if (valid.length < 2) return { error: "Need at least 2 valid colleges for comparison", comparison: valid };

  // Build comparison matrix
  const dimensions = [
    { key: "acceptanceRate", label: "Acceptance Rate", format: "pct", lowerBetter: true },
    { key: "sat25", label: "SAT 25th", format: "num" },
    { key: "sat75", label: "SAT 75th", format: "num" },
    { key: "tuitionIn", label: "In-State Tuition", format: "usd", lowerBetter: true },
    { key: "tuitionOut", label: "Out-of-State Tuition", format: "usd", lowerBetter: true },
    { key: "avgNetPrice", label: "Avg Net Price (after aid)", format: "usd", lowerBetter: true },
    { key: "enrollment", label: "Enrollment", format: "num" },
    { key: "gradRate", label: "Graduation Rate", format: "pct" },
    { key: "retentionRate", label: "Freshman Retention", format: "pct" },
    { key: "medianEarnings10yr", label: "Median Earnings (10yr)", format: "usd" },
    { key: "medianDebt", label: "Median Debt at Graduation", format: "usd", lowerBetter: true },
    { key: "pellRate", label: "Pell Grant Recipients", format: "pct" },
  ];

  const matrix = dimensions.map(dim => {
    const values = valid.map(c => ({
      school: c.name,
      value: c[dim.key],
      formatted: formatValue(c[dim.key], dim.format)
    }));
    // Rank: best to worst
    const sorted = [...values].filter(v => v.value != null).sort((a, b) =>
      dim.lowerBetter ? a.value - b.value : b.value - a.value
    );
    const ranked = values.map(v => ({
      ...v,
      rank: sorted.findIndex(s => s.school === v.school) + 1 || null
    }));
    return { dimension: dim.label, values: ranked };
  });

  return {
    colleges: valid.map(c => ({ unitId: c.unitId, name: c.name, state: c.state, city: c.city })),
    matrix,
    source: "U.S. Department of Education College Scorecard API"
  };
}

// ─── Financial Aid Lookup (Tier 3: Financial Planning) ───
export async function getFinancialAidProfile(apiKey, unitId) {
  const college = await getCollegeById(apiKey, unitId);
  if (!college) return { error: "College not found" };

  return {
    name: college.name,
    tuitionInState: college.tuitionIn,
    tuitionOutState: college.tuitionOut,
    avgNetPrice: college.avgNetPrice,
    pellRate: college.pellRate,
    federalLoanRate: college.federalLoanRate,
    medianDebt: college.medianDebt,
    needBlind: null, // Not in Scorecard — would need CDS
    meritAid: null,  // Not in Scorecard — would need CDS
    interpretation: buildFinancialInterpretation(college),
    source: "U.S. Department of Education College Scorecard API"
  };
}

function buildFinancialInterpretation(c) {
  const lines = [];
  if (c.avgNetPrice && c.tuitionOut) {
    const savings = c.tuitionOut - c.avgNetPrice;
    if (savings > 10000) lines.push(`Average student pays $${c.avgNetPrice?.toLocaleString()} after aid — $${savings.toLocaleString()} less than sticker price.`);
  }
  if (c.pellRate > 0.3) lines.push(`${Math.round(c.pellRate * 100)}% of students receive Pell Grants — this school serves a significant low-income population.`);
  if (c.medianDebt) lines.push(`Median debt at graduation: $${c.medianDebt?.toLocaleString()}.`);
  if (c.medianEarnings10yr) lines.push(`Median earnings 10 years after enrollment: $${c.medianEarnings10yr?.toLocaleString()}.`);
  if (c.medianDebt && c.medianEarnings10yr) {
    const ratio = c.medianDebt / c.medianEarnings10yr;
    if (ratio < 0.5) lines.push("Debt-to-earnings ratio is favorable.");
    else if (ratio > 1.0) lines.push("Debt-to-earnings ratio is concerning — consult with your family and financial aid office.");
  }
  return lines.join(" ");
}

// ─── Normalize Scorecard API result to our schema ───
function normalizeResult(raw) {
  const sat25 = (raw["latest.admissions.sat_scores.25th_percentile.critical_reading"] || 0) +
                (raw["latest.admissions.sat_scores.25th_percentile.math"] || 0);
  const sat75 = (raw["latest.admissions.sat_scores.75th_percentile.critical_reading"] || 0) +
                (raw["latest.admissions.sat_scores.75th_percentile.math"] || 0);
  const acceptRate = raw["latest.admissions.admission_rate.overall"];

  return {
    unitId:            String(raw.id || ""),
    name:              raw["school.name"] || "",
    state:             raw["school.state"] || "",
    city:              raw["school.city"] || "",
    website:           raw["school.school_url"] || "",
    ownership:         raw["school.ownership"] === 1 ? "public" : raw["school.ownership"] === 2 ? "private_nonprofit" : "private_forprofit",
    sat25:             sat25 || null,
    sat75:             sat75 || null,
    act25:             raw["latest.admissions.act_scores.25th_percentile.cumulative"] || null,
    act75:             raw["latest.admissions.act_scores.75th_percentile.cumulative"] || null,
    acceptanceRate:    acceptRate != null ? Math.round(acceptRate * 1000) / 10 : null,
    enrollment:        raw["latest.student.size"] || null,
    tuitionIn:         raw["latest.cost.tuition.in_state"] || null,
    tuitionOut:        raw["latest.cost.tuition.out_of_state"] || null,
    avgNetPrice:       raw["latest.cost.avg_net_price.overall"] || null,
    pellRate:          raw["latest.aid.pell_grant_rate"] || null,
    federalLoanRate:   raw["latest.aid.federal_loan_rate"] || null,
    medianDebt:        raw["latest.aid.median_debt.completers.overall"] || null,
    gradRate:          raw["latest.completion.rate_suppressed.overall"] || null,
    retentionRate:     raw["latest.student.retention_rate.four_year.full_time"] || null,
    medianEarnings10yr:raw["latest.earnings.10_yrs_after_entry.median"] || null,
    source: "College Scorecard API"
  };
}

function formatValue(v, fmt) {
  if (v == null) return "N/A";
  if (fmt === "pct") return `${Math.round(v * 100)}%`;
  if (fmt === "usd") return `$${v.toLocaleString()}`;
  return v.toLocaleString();
}

// ─── Historical trend fields (year-keyed prefix, e.g. "2018.admissions...") ───
const HIST_YEAR_FIELDS = [
  "admissions.admission_rate.overall",
  "admissions.sat_scores.25th_percentile.critical_reading",
  "admissions.sat_scores.75th_percentile.critical_reading",
  "admissions.sat_scores.25th_percentile.math",
  "admissions.sat_scores.75th_percentile.math",
  "admissions.act_scores.25th_percentile.cumulative",
  "admissions.act_scores.75th_percentile.cumulative",
  "cost.tuition.in_state",
  "cost.tuition.out_of_state",
  "cost.avg_net_price.overall",
  "student.size",
  "completion.rate_suppressed.overall",
  "earnings.10_yrs_after_entry.median",
];

/**
 * Fetch ~10 years of historical admission + cost + outcome data for one school.
 *
 * Uses year-specific Scorecard field syntax, e.g.:
 *   "2019.admissions.admission_rate.overall"
 *
 * The Scorecard year label represents the *start* of the academic year
 * (2019 → AY 2019-2020). Data is typically 1-2 years behind the current
 * calendar year; empty years are silently filtered out of the result.
 *
 * @param {string} apiKey   - SCORECARD_API_KEY
 * @param {string} unitId   - Scorecard school unit_id (numeric string)
 * @param {number} yearsBack - How many years of history to request (default 10)
 * @returns {{ unitId, name, history: YearSnapshot[], yearsRequested, source } | { error, unitId, history: [] }}
 */
export async function getCollegeHistory(apiKey, unitId, yearsBack = 10) {
  if (!apiKey) return { error: "SCORECARD_API_KEY not configured", unitId, history: [] };

  const currentYear = new Date().getFullYear();
  // Scorecard data lags 1-2 calendar years; request one year ahead of safe
  // boundary so we always capture the very latest cohort when it publishes.
  const latestDataYear = currentYear - 1;
  const startYear      = Math.max(latestDataYear - yearsBack + 1, 2012);

  const years      = [];
  for (let y = startYear; y <= latestDataYear; y++) years.push(y);

  const yearFields = years.flatMap(yr => HIST_YEAR_FIELDS.map(f => `${yr}.${f}`));
  const fields     = ["id", "school.name", ...yearFields].join(",");

  try {
    // The Scorecard REST API uses filter params, not path segments.
    // `/schools/${unitId}` returns 404 — use `?id=${unitId}` instead.
    const params = new URLSearchParams({ api_key: apiKey, id: unitId, fields });
    const res = await fetch(`${SCORECARD_BASE}/schools?${params}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Scorecard ${res.status}: ${res.statusText}`);

    const json = await res.json();
    const raw  = json.results?.[0];
    if (!raw) return { error: "College not found", unitId, history: [] };

    const history = years.map(yr => {
      const ar      = raw[`${yr}.admissions.admission_rate.overall`];
      const satCR25 = raw[`${yr}.admissions.sat_scores.25th_percentile.critical_reading`];
      const satCR75 = raw[`${yr}.admissions.sat_scores.75th_percentile.critical_reading`];
      const satM25  = raw[`${yr}.admissions.sat_scores.25th_percentile.math`];
      const satM75  = raw[`${yr}.admissions.sat_scores.75th_percentile.math`];
      const act25   = raw[`${yr}.admissions.act_scores.25th_percentile.cumulative`];
      const act75   = raw[`${yr}.admissions.act_scores.75th_percentile.cumulative`];
      const tuIn    = raw[`${yr}.cost.tuition.in_state`];
      const tuOut   = raw[`${yr}.cost.tuition.out_of_state`];
      const netPx   = raw[`${yr}.cost.avg_net_price.overall`];
      const enroll  = raw[`${yr}.student.size`];
      const grad    = raw[`${yr}.completion.rate_suppressed.overall`];
      const earn    = raw[`${yr}.earnings.10_yrs_after_entry.median`];

      // Skip completely empty years — the API returns null for unreported cohorts.
      if (ar == null && satCR25 == null && satM25 == null && tuIn == null) return null;

      return {
        year:          yr,
        admissionRate: ar    != null ? Math.round(ar   * 1000) / 10 : null,
        sat25:         (satCR25 || 0) + (satM25 || 0)  || null,
        sat75:         (satCR75 || 0) + (satM75 || 0)  || null,
        act25:         act25  || null,
        act75:         act75  || null,
        tuitionIn:     tuIn   || null,
        tuitionOut:    tuOut  || null,
        avgNetPrice:   netPx  || null,
        enrollment:    enroll || null,
        gradRate:      grad   != null ? Math.round(grad * 1000) / 10 : null,
        medianEarnings: earn  || null,
      };
    }).filter(Boolean);

    return {
      unitId:        String(raw.id),
      name:          raw["school.name"] || "",
      history,
      yearsRequested: years,
      source: "U.S. Department of Education College Scorecard API",
    };
  } catch (err) {
    console.warn(`[SCORECARD] History fetch error (unitId=${unitId}):`, err.message);
    return { error: err.message, unitId, history: [] };
  }
}

/**
 * Build a compact LLM-ready trend summary for a set of historical snapshots.
 * Returns a human-readable string covering selectivity trend + cost trajectory.
 * Called by the RAG engine when composing the college context block.
 */
export function summarizeCollegeHistory(name, history) {
  if (!history?.length) return null;

  const sorted = [...history].sort((a, b) => a.year - b.year);
  const first  = sorted[0];
  const last   = sorted[sorted.length - 1];

  const parts = [`${name || "This school"} — ${sorted.length}-year trend (${first.year}–${last.year}):`];

  if (first.admissionRate != null && last.admissionRate != null) {
    const delta = (last.admissionRate - first.admissionRate).toFixed(1);
    const dir   = delta < 0 ? "dropped" : "rose";
    parts.push(`Admit rate ${dir} from ${first.admissionRate}% → ${last.admissionRate}% (${delta > 0 ? "+" : ""}${delta}pp)`);
  }
  if (first.sat25 != null && last.sat25 != null) {
    parts.push(`SAT 25th: ${first.sat25} → ${last.sat25}`);
  }
  if (first.tuitionOut != null && last.tuitionOut != null) {
    const pct = Math.round(((last.tuitionOut - first.tuitionOut) / first.tuitionOut) * 100);
    parts.push(`Out-of-state tuition: $${first.tuitionOut?.toLocaleString()} → $${last.tuitionOut?.toLocaleString()} (+${pct}% over ${sorted.length} yrs)`);
  }
  if (last.gradRate != null) {
    parts.push(`Latest grad rate: ${last.gradRate}%`);
  }
  if (last.medianEarnings != null) {
    parts.push(`Latest median earnings (10yr): $${last.medianEarnings?.toLocaleString()}`);
  }

  return parts.join(" | ");
}

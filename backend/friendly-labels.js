// ═══════════════════════════════════════════════════════════════════════
// friendly-labels.js — turn engineer strings into student-facing copy
// ═══════════════════════════════════════════════════════════════════════
// The raw backend strings (`tier_1_distinctive`, `prestige_source:"research"`,
// factor keys like `narrative_fit`) leak internal taxonomy into the UI. This
// module centralises the mapping from those stable machine strings to
// human-readable English (and eventually Korean via the i18n layer).
//
// Keep these pure functions — no DB access, no async. The goal is that any
// API response or skill prompt that wants to show prose to the student can
// call `renderFriendlyEC(vector)` and get back a shape the frontend can
// dump straight into JSX without any local formatting logic.
//
// F11 from the Jiyeon UX audit ("engineer language → friendly labels").
// ═══════════════════════════════════════════════════════════════════════

/** Human copy for the 4 tier labels the vectorizer emits. */
export const TIER_FRIENDLY = Object.freeze({
  tier_1_distinctive: {
    short: "Distinctive",
    summary: "Reads as a top-tier application piece — national-level depth.",
    color: "#4ade80",
  },
  tier_2_strong: {
    short: "Strong",
    summary: "Clear value beyond participation — you've committed real time and delivered.",
    color: "#60a5fa",
  },
  tier_3_developing: {
    short: "Developing",
    summary: "Visible commitment with room to deepen before application season.",
    color: "#fbbf24",
  },
  tier_4_foundational: {
    short: "Foundational",
    summary: "You've started — small, steady steps count here. No shame in the early chapter.",
    color: "#94a3b8",
  },
});

/** Human copy for the `prestige_source` enum. */
export const PRESTIGE_SOURCE_FRIENDLY = Object.freeze({
  research: {
    short: "Researched",
    summary: "Scored from reputable admissions + competition sources. See rationale.",
  },
  benchmark: {
    short: "Matched",
    summary: "Recognised as a well-known competition in our catalogue.",
  },
  legacy: {
    short: "Not yet scored",
    summary: "We haven't looked this one up yet — ask to refresh and we'll research it.",
  },
  override: {
    short: "Counselor set",
    summary: "Your counselor set this score manually based on personal knowledge.",
  },
  unavailable: {
    short: "Research unavailable",
    summary: "Prestige lookup needs an Anthropic key — ask your counselor to enable it.",
  },
  research_failed: {
    short: "Needs your context",
    summary: "We couldn't find public sources for this one yet — a counselor can add detail.",
  },
});

/** Human labels for each of the 5 (+1 optional) EC factors. */
export const FACTOR_FRIENDLY = Object.freeze({
  dedication:    { short: "Dedication",    summary: "Total hours × years × how recently you were active." },
  achievement:   { short: "Achievement",   summary: "Verified awards or outcomes compared to what this activity typically produces." },
  leadership:    { short: "Leadership",    summary: "Scope of responsibility — people you lead, budget, or outputs you own." },
  prestige:      { short: "Prestige",      summary: "How elite this activity reads to a US admissions officer." },
  narrative_fit: { short: "Narrative fit", summary: "How tightly this activity connects to your written story and intended major." },
  major_spike:   { short: "Major spike",   summary: "How directly this activity signals your intended major." },
});

/** Human copy for the 5 directionality factors. */
export const DIRECTIONALITY_FACTOR_FRIENDLY = Object.freeze({
  academic_momentum:         { short: "Momentum",       summary: "GPA trajectory across semesters — are you rising or flat?" },
  test_score_strength:       { short: "Test scores",    summary: "SAT/ACT/AP scores vs. your target schools' 25th/75th." },
  major_academic_fit:        { short: "Major fit",      summary: "Coursework + grades in your intended major's feeder subjects." },
  rigor_and_challenge:       { short: "Rigor",          summary: "Courseload difficulty relative to what your school offers." },
  overall_academic_standing: { short: "Overall standing", summary: "Composite signal across all factors." },
});

/** Human copy for the directionality label. */
export const DIRECTIONALITY_LABEL_FRIENDLY = Object.freeze({
  rising_strong:     { short: "Rising strong",     summary: "You're trending upward and already at a competitive level." },
  rising_developing: { short: "Rising developing", summary: "Trajectory is positive but the baseline still needs lift." },
  stable_strong:     { short: "Stable strong",     summary: "Consistently competitive — reach schools are realistic." },
  stable_developing: { short: "Stable developing", summary: "Flat but serviceable — target/safety schools will notice." },
  declining:         { short: "Declining",         summary: "Recent semesters are weaker. This is fixable — many students write a short note explaining what changed." },
});

export function renderFriendlyTier(tierLabel) {
  return TIER_FRIENDLY[tierLabel] || { short: tierLabel || "Unknown", summary: "" };
}

export function renderFriendlyPrestigeSource(src) {
  return PRESTIGE_SOURCE_FRIENDLY[src] || { short: src || "Unknown", summary: "" };
}

export function renderFriendlyFactor(factorKey) {
  return FACTOR_FRIENDLY[factorKey] || { short: factorKey, summary: "" };
}

export function renderFriendlyDirectionalityFactor(key) {
  return DIRECTIONALITY_FACTOR_FRIENDLY[key] || { short: key, summary: "" };
}

export function renderFriendlyDirectionalityLabel(label) {
  return DIRECTIONALITY_LABEL_FRIENDLY[label] || { short: label || "Unknown", summary: "" };
}

/**
 * Decorate a toPublicShape EC vector with friendly labels + optionally the
 * prestige cache explanation (rationale + sourcesCited). Non-mutating.
 */
export function enrichECVectorWithFriendly(vector, prestigeExplanation) {
  if (!vector) return vector;
  const friendly = {
    tier: renderFriendlyTier(vector.tierLabel),
    prestigeSource: renderFriendlyPrestigeSource(vector.prestigeSource),
    factors: {},
  };
  for (const key of Object.keys(vector.factors || {})) {
    friendly.factors[key] = renderFriendlyFactor(key);
  }
  const out = { ...vector, friendly };
  if (prestigeExplanation) out.prestigeExplanation = prestigeExplanation;
  return out;
}

/**
 * Look up the cached prestige row for an EC and return the student-visible
 * subset. Returns null if nothing is cached yet.
 *
 * @param {object} stmts - ragStmts (needs getPrestigeCacheByName).
 * @param {string} ecName - raw EC name as stored on the vector row.
 */
export function getPrestigeExplanation(stmts, ecName) {
  if (!stmts?.getPrestigeCacheByName || !ecName) return null;
  const row = stmts.getPrestigeCacheByName.get(ecName);
  if (!row) return null;
  let sourcesCited = [];
  try { sourcesCited = JSON.parse(row.sources_json || "[]"); } catch { sourcesCited = []; }
  return {
    score: row.score,
    source: row.source,
    rationale: row.rationale || null,
    sourcesCited,
    provider: row.provider || null,
    model: row.model || null,
    fetchedAt: row.created_at || null,
  };
}

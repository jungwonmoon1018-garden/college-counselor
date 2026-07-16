// College value fit scoring.
//
// Deterministically compares already sourced college value themes with a
// student's courses and activities. The scorer performs no retrieval or model
// calls; callers supply values with their own trusted provenance.

// ─── Fit scoring (rule-based, deterministic) ───────────────────────────
// We compute a fit score for each (item, value) pair using:
//   1. Token-overlap signal (cheap baseline, surfaces obvious matches)
//   2. Type signal (e.g. AP/Honors courses align with "intellectual rigor")
//   3. Category signal (e.g. research ECs align with "inquiry")
// The output is a structured matrix the frontend can render directly.

const TYPE_VALUE_HINTS = {
  ap:               ["intellectual rigor", "academic depth", "challenge", "intellectual curiosity"],
  ib:               ["interdisciplinary", "global perspective", "international", "intellectual rigor"],
  honors:           ["intellectual rigor", "academic depth", "challenge"],
  dual_enrollment:  ["college readiness", "academic ambition", "intellectual curiosity"],
};

// Per-category value-theme hints. Used by the rule-based fit-scorer to
// boost (theme × category) pairs that have an obvious alignment. The
// LLM strategist sees the raw category + description and reasons more
// holistically; these hints are a cheap baseline for the deterministic
// pre-score the UI renders next to each value.
// Keys are the Common App's 30 activity types (in slug form — see
// frontend's EC_CATEGORIES). Legacy slugs ("club"/"varsity"/"arts"/
// "work") are aliased to their new equivalents for backward compat.
const CATEGORY_VALUE_HINTS = {
  // Common App taxonomy (30 categories)
  academic:                  ["intellectual rigor", "academic ambition", "scholarship", "intellectual curiosity"],
  art:                       ["creativity", "expression", "originality", "aesthetics"],
  athletics_club:            ["teamwork", "discipline", "perseverance", "character"],
  athletics_varsity:         ["leadership", "discipline", "teamwork", "character", "perseverance"],
  career_oriented:           ["real-world", "professionalism", "career readiness", "ambition"],
  community_service:         ["service", "civic engagement", "community", "public good", "impact"],
  computer_tech:             ["innovation", "problem solving", "technical depth", "creativity"],
  cultural:                  ["global perspective", "identity", "community", "inclusion", "heritage"],
  dance:                     ["expression", "discipline", "creativity", "performance"],
  debate_speech:             ["critical thinking", "communication", "rigor", "argumentation"],
  environmental:             ["sustainability", "stewardship", "civic engagement", "impact"],
  family_responsibilities:   ["responsibility", "perseverance", "character", "maturity"],
  foreign_exchange:          ["global perspective", "cross-cultural", "adaptability", "open-mindedness"],
  foreign_language:          ["global perspective", "cross-cultural", "scholarship", "open-mindedness"],
  internship:                ["real-world", "professionalism", "career readiness", "ambition"],
  journalism:                ["communication", "civic engagement", "rigor", "truth-seeking"],
  jrotc:                     ["leadership", "discipline", "service", "character"],
  lgbt:                      ["inclusion", "identity", "advocacy", "community", "courage"],
  music_instrumental:        ["expression", "discipline", "creativity", "performance"],
  music_vocal:               ["expression", "discipline", "creativity", "performance"],
  religious:                 ["service", "community", "values", "character"],
  research:                  ["inquiry", "intellectual curiosity", "discovery", "scholarship", "rigor"],
  robotics:                  ["problem solving", "innovation", "technical depth", "teamwork", "creativity"],
  school_spirit:             ["community", "leadership", "school engagement"],
  science_math:              ["intellectual curiosity", "scholarship", "rigor", "problem solving"],
  social_justice:            ["civic engagement", "advocacy", "inclusion", "impact", "courage"],
  student_govt:              ["leadership", "civic engagement", "community", "service"],
  theater_drama:             ["expression", "creativity", "collaboration", "performance"],
  work_paid:                 ["responsibility", "perseverance", "character", "real-world", "maturity"],
  other:                     ["initiative"],

  // Legacy aliases (pre-Common-App-expansion slugs) — keep so old
  // profiles still get a non-empty hint set.
  club:    ["initiative", "community", "leadership"],
  varsity: ["leadership", "discipline", "teamwork", "character"],
  arts:    ["creativity", "expression", "originality"],
  work:    ["responsibility", "perseverance", "character", "real-world"],
};

function tokenize(s) {
  return String(s || "").toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 3);
}
function tokenOverlap(a, b) {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  let n = 0;
  for (const t of A) if (B.has(t)) n++;
  return n;
}

function scoreItemAgainstValue(itemText, hintList, value) {
  const valueText = `${value.theme} ${value.summary}`;
  let score = 0;
  // Token-overlap baseline
  score += tokenOverlap(itemText, valueText) * 0.3;
  // Hint-based boost
  const valueLower = `${value.theme} ${value.summary}`.toLowerCase();
  for (const hint of hintList || []) {
    if (valueLower.includes(hint)) { score += 1.0; break; }
  }
  return score;
}

// Returns: { values:[...], courses:[{name,type, perValueScores:[..]}], ecs:[...], summary }
export function computeFit(values, profile) {
  const courses = (profile?.courses || []).map(c => {
    const itemText = `${c.name || ""} ${c.type || ""}`;
    const hints = TYPE_VALUE_HINTS[c.type] || [];
    const perValue = values.map(v => ({
      theme: v.theme,
      score: Math.round(scoreItemAgainstValue(itemText, hints, v) * 100) / 100,
    }));
    return { name: c.name, type: c.type, perValue };
  });

  const ecs = (profile?.activities || profile?.ecs || []).map(e => {
    const itemText = `${e.name || ""} ${e.role || ""} ${e.description || ""}`;
    const hints = CATEGORY_VALUE_HINTS[e.category] || [];
    const perValue = values.map(v => ({
      theme: v.theme,
      score: Math.round(scoreItemAgainstValue(itemText, hints, v) * 100) / 100,
    }));
    return { name: e.name, category: e.category, role: e.role, perValue };
  });

  // Aggregate per-value coverage: how many items hit each value at all
  const perValueCoverage = values.map(v => {
    const hits = courses.filter(c => c.perValue.find(p => p.theme === v.theme && p.score > 0.5)).length
              + ecs.filter(e => e.perValue.find(p => p.theme === v.theme && p.score > 0.5)).length;
    return { theme: v.theme, hits };
  });

  // Overall fit = average max-per-value-hit, normalized 0–100
  const maxPossible = values.length;
  const covered = perValueCoverage.filter(p => p.hits > 0).length;
  const overall = maxPossible > 0 ? Math.round((covered / maxPossible) * 100) : 0;

  return { values, courses, ecs, perValueCoverage, overall };
}

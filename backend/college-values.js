// ═══════════════════════════════════════════════════════════════════════
// COLLEGE CORE VALUES — extract & compare student fit.
// ═══════════════════════════════════════════════════════════════════════
// 1) Extract: given a college name + optional URL, ask the student's LLM
//    to fetch the official admissions/about page (via web_search +
//    web_fetch, restricted to credible-sources.js's allowlist) and pull
//    out 4–8 explicit value themes — what the university says it cares
//    about. Cached in college_values for 90 days.
//
// 2) Compare: given a student profile (courses, ECs, goals) and a set of
//    extracted values, score how each EC and each course aligns. Output
//    is rule-based + LLM-explained, so it's auditable.
//
// This module is provider-neutral — it takes a `callLLM` function from
// the caller so the same code runs over the student's BYOK key (Anthropic
// / OpenAI / Google / etc.).

import { makeWebSearchTool, makeWebFetchTool } from "./credible-sources.js";

const VALUES_TTL_DAYS = 90;

// Slugify a college name for cache key purposes. We DO strip common
// suffixes like "university" / "college" so "Stanford" and "Stanford
// University" cache hit each other (same school, same values). But we
// DO NOT strip campus / branch tokens (Berkeley, UCLA, Galveston,
// Behrend, Austin, etc.) — those are how different campuses get
// distinct cache entries. Two-letter campus abbreviations like "UC",
// "UT", "CSU", "SUNY" are preserved so "UC Berkeley" ≠ "Berkeley
// College".
function slugify(name) {
  const raw = String(name || "").toLowerCase().trim();
  if (!raw) return "";
  // Normalize separators & punctuation, but keep word boundaries.
  let s = raw
    .replace(/^the\s+/, "")
    // Strip the institution-type word ONLY when it's followed by another
    // word — protects "MIT" / "Caltech" from being mangled, and keeps
    // a trailing campus tag like ", Berkeley".
    .replace(/\b(university|college|institute|polytechnic)\b\s+of\s+/g, " ")
    .replace(/\bschool\s+of\b/g, " ")
    .replace(/\b(university|college|institute|polytechnic|academy)\b/g, " ")
    .replace(/\bof\b/g, " ")
    .replace(/[,.()&/'"’‘]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Now collapse whitespace into hyphens. We DELIBERATELY keep every
  // remaining token — including short campus names like "berkeley",
  // "ucla", "galveston" — so multi-campus systems get distinct slugs.
  return s.replace(/\s+/g, "-").replace(/^-+|-+$/g, "");
}

function isFresh(extractedAt) {
  if (!extractedAt) return false;
  const age = Date.now() - new Date(extractedAt).getTime();
  return age >= 0 && age < VALUES_TTL_DAYS * 24 * 60 * 60 * 1000;
}

const EXTRACT_PROMPT = (collegeName, hint) => `
You are extracting the explicitly stated core values of ${collegeName} from its own admissions / about / mission pages.

CAMPUS DISAMBIGUATION — DO THIS FIRST:
Many US universities are SYSTEMS with multiple campuses. Each campus has its own admissions office and often its own stated values. If "${collegeName}" is ambiguous, treat the most specific reading the student gave:
  • "${collegeName}" → use the FLAGSHIP campus unless the name itself specifies a branch.
    - "University of California" → UC Berkeley (system flagship)
    - "University of Texas" → UT Austin
    - "Penn State" → Penn State University Park (main campus)
    - "Texas A&M" → Texas A&M College Station
  • Branch-suffixed names → use that exact campus, never the parent:
    - "UCLA" / "UC Los Angeles" → Los Angeles campus only
    - "Texas A&M Galveston" → Galveston campus only
    - "Penn State Behrend" → Behrend campus only
  • Common-name schools that map to ONE campus → use that campus:
    - "Stanford" / "Princeton" / "Harvard" / "MIT" → unambiguous, single campus
    - "Cal" alone → UC Berkeley
  • If you find content from the WRONG branch in your search results, DISCARD IT and re-search with a more specific query (e.g. "UC Berkeley admissions" not "University of California admissions"). NEVER mix values from different campuses.

Step 1: Use web_search restricted to .edu / .gov / common-application platforms. Build a query that pins the specific campus:
  - "${collegeName} admissions mission values"
  - "${collegeName} about institutional values"
  - "${collegeName} dean of admissions what we look for"

Step 2: Use web_fetch on the most authoritative page for THAT SPECIFIC CAMPUS (prefer admissions.<exactcampus>.edu, about.<exactcampus>.edu, or the campus's own site — not the system-wide site if the user named a branch).

Step 3: Extract 4–8 distinct VALUE THEMES the school explicitly names or strongly implies in its OWN words. Each theme must:
  - be supported by a direct quote (≤ 25 words)
  - be a value, not a feature (so "intellectual curiosity" — yes; "small class size" — no, that's a feature)
  - be distinct from the others
  - come from the SAME campus as "displayName" — do not blend values from sibling branches

Return ONLY a JSON object with this exact shape — no markdown, no preamble:
{
  "displayName": "<the canonical name of the specific campus you used, e.g. 'UC Berkeley' or 'Princeton University'>",
  "sourceUrl": "<the page you actually fetched>",
  "values": [
    { "theme": "Intellectual curiosity", "summary": "Restless questioning across disciplines.", "evidence": "<exact quote>" }
  ]
}

${hint ? `Additional hint from caller: ${hint}` : ""}
`.trim();

// callLLM: async ({ model, max_tokens, system, messages, tools, wantsWeb, extraDomains }) => { content, usage }
//   — caller is responsible for routing this through the student's BYOK and
//   translating `wantsWeb` into whichever web-access mechanism the
//   provider supports (Anthropic native tools, OpenRouter `plugins:web`).
export async function extractCollegeValues(ragStmts, callLLM, { studentId, collegeName, hintUrl, model }) {
  const slug = slugify(collegeName);
  if (!slug) throw new Error("collegeName required");

  // Cache lookup
  const cached = ragStmts.getCollegeValues.get(slug);
  if (cached && isFresh(cached.extracted_at)) {
    return {
      slug,
      displayName: cached.display_name,
      sourceUrl: cached.source_url,
      values: JSON.parse(cached.values_json),
      cached: true,
      extractedAt: cached.extracted_at,
    };
  }

  // Live extraction. Tools are Anthropic-native (web_search_*, web_fetch_*)
  // — the dispatcher in server.js filters them for non-Anthropic providers
  // and substitutes OpenRouter's `plugins:[{id:"web"}]` when wantsWeb is
  // set, so the LLM gets internet access either way.
  const extraDomains = [];
  if (hintUrl) extraDomains.push(hintUrl);
  const tools = [makeWebSearchTool(extraDomains), makeWebFetchTool(extraDomains)];

  const llmResp = await callLLM({
    model,
    max_tokens: 2000,
    tools,
    wantsWeb: true,
    extraDomains,
    messages: [{ role: "user", content: EXTRACT_PROMPT(collegeName, hintUrl) }],
  });

  // The response.content is an array of blocks. We want the final text block.
  const text = (llmResp?.content || [])
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("")
    .trim();
  if (!text) throw new Error("Empty response from LLM");

  // Pull the JSON block — model may wrap it in fences despite instructions.
  const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch (parseErr) {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("Could not parse JSON from LLM response");
    parsed = JSON.parse(m[0]);
  }

  if (!Array.isArray(parsed.values) || parsed.values.length === 0) {
    throw new Error("LLM returned no values");
  }
  // Light validation
  const cleanValues = parsed.values
    .filter(v => v && typeof v.theme === "string" && typeof v.evidence === "string")
    .map(v => ({
      theme: v.theme.slice(0, 80),
      summary: String(v.summary || "").slice(0, 240),
      evidence: v.evidence.slice(0, 280),
    }))
    .slice(0, 8);

  ragStmts.upsertCollegeValues.run(
    slug,
    String(parsed.displayName || collegeName).slice(0, 120),
    String(parsed.sourceUrl || "").slice(0, 500),
    JSON.stringify(cleanValues),
    studentId,
  );

  return {
    slug,
    displayName: parsed.displayName || collegeName,
    sourceUrl: parsed.sourceUrl,
    values: cleanValues,
    cached: false,
    extractedAt: new Date().toISOString(),
  };
}

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

// ═══════════════════════════════════════════════════════════════════════
// COMPETITION RESEARCH — prestige scoring for extracurricular activities
// ═══════════════════════════════════════════════════════════════════════
// The 5th factor of the EC strength vector ("prestige") asks: independent
// of what the student *achieved*, how well-known/selective is the program
// itself in the eyes of a college admissions reader?
//
// Scoring sources in priority order:
//   1. Cache hit in ec_prestige_cache (30-day TTL).
//   2. Seeded qualifier_level row in baseline_ec_competitive — if the EC's
//      activity_id + level match a benchmarked row, we short-circuit with
//      the seeded prestige_score; no web search fires.
//   3. Official competition catalog (organizer / primary-source pages).
//   4. Anthropic web_search_20250305 tool bounded to official organizer,
//      .edu host, and government pages only.
//
// Non-Anthropic providers can't run web_search; prestige silently defaults
// to 0 with source:"unavailable" so tier labels still compute.
// ═══════════════════════════════════════════════════════════════════════

import crypto from "node:crypto";
import { callLLM } from "./llm-adapters/index.js";

export const PRESTIGE_TTL_DAYS = 30;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TOKENS = 800;

// Official organizer / primary-source catalog. This is the zero-API-cost
// path for known competitions and the source of truth for the web_search
// allowlist below. Scores are intentionally conservative and represent the
// prestige of the competition/level, not the student's personal execution.
export const OFFICIAL_COMPETITION_SOURCES = Object.freeze([
  {
    id: "math_olympiad",
    name: "MAA American Mathematics Competitions",
    category: "competitive_math",
    aliases: ["amc", "amc 8", "amc 10", "amc 12", "aime", "usamo", "usajmo", "imo", "math olympiad", "mathcounts"],
    keywords: ["mathematics", "competition math", "olympiad"],
    officialSources: [
      { title: "MAA American Mathematics Competitions", url: "https://maa.org/student-programs/amc/", organization: "Mathematical Association of America" },
      { title: "MAA AMC Policies", url: "https://maa.org/student-programs/amc/maa-american-mathematics-competitions-policies/", organization: "Mathematical Association of America" },
    ],
    levels: [
      { level: "AMC participant", match: ["amc", "amc 8", "amc 10", "amc 12", "participant"], prestigeScore: 0.25, rationale: "Official MAA AMC participation is broad but recognized as a math pipeline signal." },
      { level: "AIME qualifier", match: ["aime", "aime qualifier"], prestigeScore: 0.72, rationale: "AIME qualification is a selective national math achievement in the MAA pathway." },
      { level: "USAJMO/USAMO qualifier", match: ["usajmo", "usamo", "usamo qualifier", "usajmo qualifier"], prestigeScore: 0.92, rationale: "USAMO/USAJMO qualification is an elite national proof-based math signal." },
      { level: "IMO team member", match: ["imo", "international mathematical olympiad", "team member"], prestigeScore: 1.0, rationale: "IMO team membership is among the highest pre-college math distinctions." },
    ],
    defaultPrestigeScore: 0.25,
  },
  {
    id: "usaco",
    name: "USA Computing Olympiad",
    category: "competitive_computing",
    aliases: ["usaco", "usa computing olympiad", "computing olympiad", "ioi", "egoi"],
    keywords: ["algorithm", "programming contest", "competitive programming", "platinum", "gold", "silver", "bronze"],
    officialSources: [
      { title: "USACO Contest Details", url: "https://usaco.org/current/current/index.php?page=details", organization: "USA Computing Olympiad" },
    ],
    levels: [
      { level: "USACO Bronze", match: ["bronze"], prestigeScore: 0.25, rationale: "Bronze is the official entry division in USACO." },
      { level: "USACO Silver", match: ["silver"], prestigeScore: 0.45, rationale: "Silver indicates promotion beyond the entry USACO division." },
      { level: "USACO Gold", match: ["gold"], prestigeScore: 0.65, rationale: "Gold reflects advanced algorithmic competition standing in USACO." },
      { level: "USACO Platinum", match: ["platinum"], prestigeScore: 0.82, rationale: "Platinum is USACO's advanced division for strong algorithmic problem solvers." },
      { level: "USACO finalist / camp", match: ["finalist", "training camp", "camp", "ioi finalist", "egoi finalist"], prestigeScore: 0.95, rationale: "USACO finalists are considered for IOI/EGOI training camp and teams." },
      { level: "IOI/EGOI team member", match: ["ioi team", "egoi team", "international olympiad in informatics"], prestigeScore: 1.0, rationale: "IOI/EGOI team membership is a top international computing distinction." },
    ],
    defaultPrestigeScore: 0.25,
  },
  {
    id: "regeneron_isef",
    name: "Regeneron International Science and Engineering Fair",
    category: "competitive_research",
    aliases: ["isef", "regeneron isef", "international science and engineering fair", "science fair"],
    keywords: ["research", "science fair", "grand award", "young scientist"],
    officialSources: [
      { title: "Regeneron ISEF Awards", url: "https://www.societyforscience.org/isef/awards/", organization: "Society for Science" },
    ],
    levels: [
      { level: "Affiliated fair participant", match: ["local", "regional", "state", "affiliated"], prestigeScore: 0.45, rationale: "Affiliated fairs are the official qualifying pathway to ISEF." },
      { level: "ISEF finalist", match: ["isef finalist", "finalist", "qualified", "qualifier"], prestigeScore: 0.84, rationale: "ISEF finalist status means earning a place at the international fair." },
      { level: "ISEF Grand Award", match: ["grand award", "first award", "second award", "third award", "fourth award"], prestigeScore: 0.92, rationale: "ISEF Grand Awards are official category-level awards at the international fair." },
      { level: "ISEF Top Award", match: ["top award", "yancopoulos", "young scientist"], prestigeScore: 0.98, rationale: "ISEF Top Awards are selected from top category winners." },
    ],
    defaultPrestigeScore: 0.45,
  },
  {
    id: "regeneron_sts",
    name: "Regeneron Science Talent Search",
    category: "competitive_research",
    aliases: ["regeneron sts", "science talent search", "sts scholar", "sts finalist"],
    keywords: ["research", "science", "math", "scholar", "finalist"],
    officialSources: [
      { title: "Regeneron Science Talent Search", url: "https://www.regeneron.com/responsibility/fueling-stem-innovators/sts", organization: "Regeneron" },
      { title: "Society for Science STS Finalists", url: "https://www.societyforscience.org/press-release/regeneron-sts-2026-top-40-finalists", organization: "Society for Science" },
    ],
    levels: [
      { level: "STS entrant", match: ["entrant", "applicant"], prestigeScore: 0.35, rationale: "STS entry is research-oriented but not itself highly selective." },
      { level: "STS scholar", match: ["scholar", "top 300"], prestigeScore: 0.86, rationale: "STS scholars are a nationally selected research cohort." },
      { level: "STS finalist", match: ["finalist", "top 40"], prestigeScore: 0.96, rationale: "STS finalists are selected from the top scholars for national judging." },
      { level: "STS top winner", match: ["winner", "top award", "first place", "250000"], prestigeScore: 1.0, rationale: "STS top winners represent one of the highest pre-college research distinctions." },
    ],
    defaultPrestigeScore: 0.35,
  },
  {
    id: "science_olympiad",
    name: "Science Olympiad",
    category: "competitive_science",
    aliases: ["science olympiad", "scioly", "soinc", "science olympiad national tournament"],
    keywords: ["state tournament", "regional tournament", "national tournament", "stem"],
    officialSources: [
      { title: "Science Olympiad 2026 National Tournament", url: "https://www.soinc.org/2026-national-tournament", organization: "Science Olympiad" },
      { title: "Science Olympiad Tournaments", url: "https://www.soinc.org/play/tournaments", organization: "Science Olympiad" },
    ],
    levels: [
      { level: "Invitational / regional", match: ["invitational", "regional"], prestigeScore: 0.35, rationale: "Regional-level Science Olympiad is structured but less selective than state/national rounds." },
      { level: "State qualifier", match: ["state", "state qualifier"], prestigeScore: 0.60, rationale: "State qualification indicates advancement in the official Science Olympiad pathway." },
      { level: "National tournament qualifier", match: ["national", "nationals", "national tournament"], prestigeScore: 0.85, rationale: "The national tournament is the pinnacle for the best Science Olympiad teams." },
    ],
    defaultPrestigeScore: 0.35,
  },
  {
    id: "first_robotics",
    name: "FIRST Robotics Competition",
    category: "competitive_robotics",
    aliases: ["first robotics", "frc", "first tech challenge", "ftc", "first lego league", "fll", "first impact award", "chairmans award"],
    keywords: ["robotics", "championship", "regional", "district", "impact award"],
    officialSources: [
      { title: "FIRST Robotics Competition Awards", url: "https://www.firstinspires.org/resources/library/frc/awards", organization: "FIRST" },
      { title: "FIRST Hall of Fame / Impact Award", url: "https://www.firstinspires.org/resource-library/frc/past-winners-of-the-chairmans-award", organization: "FIRST" },
    ],
    levels: [
      { level: "Regional / district event", match: ["regional", "district"], prestigeScore: 0.45, rationale: "Regional and district events are official FIRST competition levels." },
      { level: "Championship qualifier", match: ["championship", "world championship", "worlds", "champs"], prestigeScore: 0.72, rationale: "FIRST Championship qualification is an official high-level robotics signal." },
      { level: "FIRST Impact Award", match: ["impact award", "chairman", "chairman's", "hall of fame"], prestigeScore: 0.90, rationale: "FIRST describes the Impact Award as its most prestigious FRC award." },
    ],
    defaultPrestigeScore: 0.35,
  },
  {
    id: "deca",
    name: "DECA Competitive Events",
    category: "competitive_business",
    aliases: ["deca", "deca icdc", "deca state", "deca district", "deca international"],
    keywords: ["business", "marketing", "finance", "entrepreneurship", "icdc"],
    officialSources: [
      { title: "DECA High School Competitive Events", url: "https://www.deca.org/compete", organization: "DECA Inc." },
    ],
    levels: [
      { level: "District competitor", match: ["district"], prestigeScore: 0.30, rationale: "District DECA competition is an official early competition level." },
      { level: "State qualifier", match: ["state"], prestigeScore: 0.55, rationale: "State qualification indicates advancement beyond local DECA competition." },
      { level: "ICDC / international", match: ["icdc", "international", "national"], prestigeScore: 0.82, rationale: "ICDC is DECA's high-level international competitive conference." },
    ],
    defaultPrestigeScore: 0.20,
  },
  {
    id: "fbla",
    name: "FBLA Competitive Events",
    category: "competitive_business",
    aliases: ["fbla", "future business leaders of america", "fbla nlc", "national leadership conference"],
    keywords: ["business", "leadership", "competitive events", "national top ten"],
    officialSources: [
      { title: "FBLA High School Competitive Events", url: "https://www.fbla.org/divisions/fbla/fbla-competitive-events/", organization: "Future Business Leaders of America" },
      { title: "FBLA National Leadership Conference", url: "https://www.fbla.org/fbla-national-leadership-conference/", organization: "Future Business Leaders of America" },
    ],
    levels: [
      { level: "District competitor", match: ["district"], prestigeScore: 0.30, rationale: "District FBLA competition is an official early competition level." },
      { level: "State qualifier", match: ["state"], prestigeScore: 0.55, rationale: "State qualification indicates advancement in FBLA competitive events." },
      { level: "NLC / national top ten", match: ["nlc", "national", "top ten", "top 10"], prestigeScore: 0.80, rationale: "FBLA NLC gathers top competitors and publishes national top-ten results." },
    ],
    defaultPrestigeScore: 0.20,
  },
  {
    id: "debate_toc_nsda",
    name: "High School Speech and Debate Championships",
    category: "competitive_speech_debate",
    aliases: ["nsda", "national speech and debate", "speech and debate", "tournament of champions", "toc", "j w patterson toc"],
    keywords: ["debate", "public forum", "policy debate", "lincoln douglas", "congressional debate", "speech"],
    officialSources: [
      { title: "JW Patterson Tournament of Champions", url: "https://ci.uky.edu/debate/toc", organization: "University of Kentucky Debate" },
      { title: "NSDA Livestream / National Tournament", url: "https://live.speechanddebate.org/", organization: "National Speech & Debate Association" },
    ],
    levels: [
      { level: "Circuit tournament", match: ["circuit", "bid tournament"], prestigeScore: 0.45, rationale: "Circuit tournaments provide the bid pathway to national-level debate championships." },
      { level: "TOC qualifier", match: ["toc qualifier", "bid", "gold bid", "silver bid"], prestigeScore: 0.75, rationale: "TOC qualification is earned through competitive bids at qualifying tournaments." },
      { level: "NSDA Nationals qualifier", match: ["nsda nationals", "national qualifier", "nationals qualifier"], prestigeScore: 0.82, rationale: "NSDA Nationals qualification marks advancement to a national speech and debate tournament." },
      { level: "TOC / NSDA finalist", match: ["finalist", "champion", "winner", "octofinalist", "semifinalist"], prestigeScore: 0.92, rationale: "Final rounds at TOC/NSDA represent elite national speech and debate achievement." },
    ],
    defaultPrestigeScore: 0.35,
  },
  {
    id: "hosa",
    name: "HOSA Competitive Events",
    category: "competitive_health",
    aliases: ["hosa", "hosa ilc", "hosa international leadership conference", "future health professionals"],
    keywords: ["health", "biomedical", "competitive events", "medallion"],
    officialSources: [
      { title: "HOSA Competitive Events", url: "https://hosa.org/compete/", organization: "HOSA-Future Health Professionals" },
      { title: "HOSA International Leadership Conference", url: "https://hosa.org/ilc/", organization: "HOSA-Future Health Professionals" },
    ],
    levels: [
      { level: "Regional / state competitor", match: ["regional", "state"], prestigeScore: 0.50, rationale: "State competition identifies members eligible for HOSA ILC." },
      { level: "ILC competitor", match: ["ilc", "international leadership conference"], prestigeScore: 0.72, rationale: "HOSA ILC includes official competitive events for top eligible members." },
      { level: "ILC medallion winner", match: ["medallion", "winner", "first", "second", "third"], prestigeScore: 0.86, rationale: "HOSA recognizes top ILC competitors with medallion placements." },
    ],
    defaultPrestigeScore: 0.30,
  },
  {
    id: "national_history_day",
    name: "National History Day",
    category: "competitive_humanities",
    aliases: ["national history day", "nhd", "history day"],
    keywords: ["history", "documentary", "exhibit", "paper", "performance"],
    officialSources: [
      { title: "National History Day Contest", url: "https://nhd.org/en/contest/", organization: "National History Day" },
    ],
    levels: [
      { level: "Regional / affiliate", match: ["regional", "affiliate", "state"], prestigeScore: 0.52, rationale: "NHD regional/affiliate advancement is part of the official contest pathway." },
      { level: "National Contest qualifier", match: ["national contest", "national qualifier", "top two"], prestigeScore: 0.82, rationale: "Top affiliate entries are invited to the NHD National Contest." },
      { level: "National award", match: ["national award", "winner", "medal", "finalist"], prestigeScore: 0.90, rationale: "National recognition at NHD is a high-level humanities research signal." },
    ],
    defaultPrestigeScore: 0.30,
  },
  {
    id: "congressional_app_challenge",
    name: "Congressional App Challenge",
    category: "competitive_computing",
    aliases: ["congressional app challenge", "cac", "houseofcode", "house of code"],
    keywords: ["app", "coding", "computer science", "district winner", "capitol"],
    officialSources: [
      { title: "Congressional App Challenge Students", url: "https://www.congressionalappchallenge.us/students/", organization: "Congressional App Challenge" },
      { title: "Congressional App Challenge About", url: "https://www.congressionalappchallenge.us/about/", organization: "Congressional App Challenge" },
    ],
    levels: [
      { level: "Participant", match: ["participant", "submitted", "submission"], prestigeScore: 0.25, rationale: "CAC participation is open by congressional district and is less selective than winning." },
      { level: "District winner", match: ["winner", "district winner", "won", "houseofcode"], prestigeScore: 0.72, rationale: "CAC winners are publicly recognized by participating congressional districts." },
    ],
    defaultPrestigeScore: 0.25,
  },
  {
    id: "scholastic_art_writing",
    name: "Scholastic Art & Writing Awards",
    category: "competitive_arts_writing",
    aliases: ["scholastic art and writing", "scholastic awards", "art and writing awards", "gold key", "national medal"],
    keywords: ["art", "writing", "portfolio", "gold medal", "silver medal"],
    officialSources: [
      { title: "Scholastic 2026 National Teen Medalists", url: "https://www.scholastic.com/newsroom/all-news/press-release/the-scholastic-art---writing-awards-announce-2026-class-of-natio.html", organization: "Scholastic / Alliance for Young Artists & Writers" },
      { title: "Art & Writing Awards", url: "https://www.artandwriting.org/", organization: "Alliance for Young Artists & Writers" },
    ],
    levels: [
      { level: "Regional award / Gold Key", match: ["regional", "gold key", "silver key", "honorable mention"], prestigeScore: 0.55, rationale: "Regional Scholastic awards are adjudicated recognition in a long-running arts program." },
      { level: "National Medal", match: ["national medal", "gold medal", "silver medal", "national"], prestigeScore: 0.84, rationale: "National medals are selected from national adjudication of regional winners." },
      { level: "Gold Medal Portfolio", match: ["gold medal portfolio", "portfolio award", "portfolio"], prestigeScore: 0.95, rationale: "Gold Medal Portfolio is the program's highest portfolio honor." },
    ],
    defaultPrestigeScore: 0.35,
  },
]);

const EXTRA_OFFICIAL_DOMAINS = [
  "maa.org",
  "usaco.org",
  "societyforscience.org",
  "regeneron.com",
  "soinc.org",
  "firstinspires.org",
  "deca.org",
  "fbla.org",
  "ci.uky.edu",
  "live.speechanddebate.org",
  "speechanddebate.org",
  "tabroom.com",
  "hosa.org",
  "nhd.org",
  "congressionalappchallenge.us",
  "house.gov",
  "copyright.gov",
  "scholastic.com",
  "artandwriting.org",
];

// Reputable-source allowlist enforced at the Anthropic web_search tool
// boundary. Only official organizers, official competition infrastructure,
// government pages, and official school-hosted competition pages belong here.
export const REPUTABLE_DOMAINS = Object.freeze(
  [...new Set([
    ...EXTRA_OFFICIAL_DOMAINS,
    ...EXTRA_OFFICIAL_DOMAINS.map((d) => d.startsWith("www.") ? d : `www.${d}`),
    ...OFFICIAL_COMPETITION_SOURCES.flatMap((entry) =>
      entry.officialSources.flatMap((s) => hostVariants(s.url)),
    ),
  ])].sort(),
);

const PRESTIGE_SYSTEM_PROMPT = [
  "You research the competitive prestige of named extracurricular activities for college admissions.",
  "Output exactly one JSON object {score, rationale, sourcesCited}. No prose outside the JSON.",
  "score is a number in [0.0, 1.0] per this scale:",
  "  0.95-1.00: single-digit-percent acceptance at top national finals (IMO/USAMO medal, ISEF Best-in-Category, STS Finalist, Davidson Fellow, Concord Review publication, Breakthrough Junior winner).",
  "  0.80-0.94: national finalist / top-100 nationally (USAJMO, ISEF category award, NMSF, Presidential Scholar semifinalist, first-team All-National in a major sport/art).",
  "  0.60-0.79: well-known regional or mid-national (AIME qualifier, state science fair 1st, national debate octofinal, all-state orchestra concertmaster).",
  "  0.40-0.59: top local or competitive state participation (state science fair participant, regional debate quarterfinal, district champion).",
  "  0.20-0.39: local participation with some selectivity.",
  "  0.00-0.19: unverifiable / no national reputation / participation-only.",
  "Use only official organizer, government, or official school-hosted competition pages. Do not use forums, Wikipedia, admissions consultants, blogs, or prep companies.",
  "Cite at least one official source for any score, and at least two official sources when available for any score >= 0.60. When uncertain, choose the lower bucket.",
  "rationale must be <= 40 words. sourcesCited is an array of URL strings actually used.",
  "Never invent contests or statistics.",
].join("\n");

export function normalizeActivityName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function computePrestigeCacheKey(activityName, levelHint) {
  const normalized = normalizeActivityName(activityName);
  const level = String(levelHint || "").toLowerCase().trim();
  return crypto.createHash("sha256").update(`${normalized}|${level}`).digest("hex");
}

export function searchCompetitionCatalog(query, options = {}) {
  const q = normalizeActivityName(query);
  if (!q) return [];

  const levelHint = normalizeActivityName(options.levelHint || "");
  const searchText = normalizeActivityName(`${q} ${levelHint}`.trim());
  const limit = Math.max(1, Math.min(25, Number(options.limit || 8)));

  const results = OFFICIAL_COMPETITION_SOURCES
    .map((entry) => {
      const confidence = scoreCatalogEntry(entry, q);
      if (confidence <= 0) return null;
      const level = chooseCatalogLevel(entry, searchText);
      return {
        activityId: entry.id,
        activityName: entry.name,
        category: entry.category,
        confidence: round2(confidence),
        level: level.level,
        score: round2(level.prestigeScore),
        rationale: level.rationale,
        source: "catalog",
        sourcesCited: entry.officialSources.map((s) => s.url),
        officialSources: entry.officialSources,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.confidence - a.confidence || b.score - a.score)
    .slice(0, limit);

  return results;
}

export function findBestCompetitionCatalogPrestige(activityName, levelHint = null) {
  const [best] = searchCompetitionCatalog(activityName, { levelHint, limit: 1 });
  if (!best || best.confidence < 0.55) return null;
  return best;
}

export function isReputableSourceUrl(url) {
  const host = extractHost(url);
  if (!host) return false;
  return REPUTABLE_DOMAINS.includes(host);
}

function scoreCatalogEntry(entry, normalizedQuery) {
  const qTerms = tokenSet(normalizedQuery);
  if (qTerms.size === 0) return 0;

  const aliases = [
    entry.name,
    ...(entry.aliases || []),
  ].map(normalizeActivityName).filter(Boolean);
  const keywords = (entry.keywords || []).map(normalizeActivityName).filter(Boolean);

  let best = 0;
  for (const alias of aliases) {
    if (normalizedQuery === alias) {
      best = Math.max(best, 1);
      continue;
    }
    if (normalizedQuery.includes(alias) || alias.includes(normalizedQuery)) {
      const lengthRatio = Math.min(normalizedQuery.length, alias.length) / Math.max(normalizedQuery.length, alias.length);
      best = Math.max(best, 0.75 + 0.2 * lengthRatio);
      continue;
    }
    const aliasTerms = tokenSet(alias);
    const overlap = [...qTerms].filter((t) => aliasTerms.has(t)).length;
    if (overlap > 0) {
      best = Math.max(best, overlap / Math.max(qTerms.size, aliasTerms.size));
    }
  }

  // Keywords help rank search results, but they should not by themselves
  // create a high-confidence catalog hit for generic phrases like "finalist"
  // or "research".
  for (const keyword of keywords) {
    const keywordTerms = tokenSet(keyword);
    const overlap = [...qTerms].filter((t) => keywordTerms.has(t)).length;
    if (overlap > 0) {
      const keywordScore = Math.min(0.45, 0.15 + 0.35 * (overlap / Math.max(qTerms.size, keywordTerms.size)));
      best = Math.max(best, keywordScore);
    }
  }

  return clamp01(best);
}

function chooseCatalogLevel(entry, normalizedSearchText) {
  const levels = [...(entry.levels || [])].sort((a, b) =>
    Number(b.prestigeScore || 0) - Number(a.prestigeScore || 0),
  );
  for (const level of levels) {
    const matches = Array.isArray(level.match) ? level.match : [];
    if (matches.some((m) => normalizedSearchText.includes(normalizeActivityName(m)))) {
      return level;
    }
  }
  return {
    level: "default",
    prestigeScore: entry.defaultPrestigeScore || 0,
    rationale: "Matched the official competition catalog; no specific level was detected.",
  };
}

function tokenSet(text) {
  return new Set(
    normalizeActivityName(text)
      .split(" ")
      .filter((t) => t.length > 1 && !["and", "the", "for", "with"].includes(t)),
  );
}

function extractHost(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function hostVariants(url) {
  const host = extractHost(url);
  if (!host) return [];
  return [host, `www.${host}`];
}

function isExpired(createdAt, ttlDays = PRESTIGE_TTL_DAYS) {
  if (!createdAt) return true;
  const when = Date.parse(createdAt);
  if (!Number.isFinite(when)) return true;
  const ageMs = Date.now() - when;
  return ageMs > ttlDays * 24 * 60 * 60 * 1000;
}

/**
 * Extract a tool-use / text response into the expected {score, rationale,
 * sourcesCited} JSON payload. Walks the Anthropic content array (which may
 * contain server_tool_use / web_search_tool_result / text blocks).
 */
function extractJsonFromResponse(resp) {
  if (!resp || !Array.isArray(resp.content)) return null;
  const textParts = resp.content
    .filter((c) => c && c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
  if (!textParts) return null;
  return parseJsonLoose(textParts);
}

function parseJsonLoose(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    if (start < 0) return null;
    let depth = 0;
    for (let i = start; i < raw.length; i++) {
      if (raw[i] === "{") depth += 1;
      else if (raw[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          const candidate = raw.slice(start, i + 1);
          try {
            return JSON.parse(candidate);
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }
}

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function round2(n) {
  return Math.round(clamp01(n) * 100) / 100;
}

/**
 * Research or fetch the prestige score for a named extracurricular.
 *
 * @param {object} params
 * @param {string} params.activityName — raw EC name as the student wrote it.
 * @param {string} [params.levelHint]   — e.g. "national", "regional", "state", "district".
 * @param {object} [params.benchmarkHit] — optional prior match against
 *   baseline_ec_competitive. Pass the qualifier_level object (with
 *   prestige_score) or null. Takes precedence over web research.
 * @param {object} params.stmts          — RAG stmts (needs getPrestigeCache
 *   + upsertPrestigeCache).
 * @param {object} [params.adapter]      — {provider, apiKey, baseUrl, model}
 *   resolved by caller (typically buildDefaultLLMClient). If provider is not
 *   "anthropic", the research path short-circuits to "unavailable".
 * @param {object} [params.options]      — { fetchImpl, timeoutMs, now }
 * @returns {Promise<{score:number, source:string, rationale?:string,
 *   sourcesCited?:string[], provider?:string, model?:string, cached:boolean}>}
 */
export async function researchCompetitionPrestige({
  activityName,
  levelHint = null,
  benchmarkHit = null,
  stmts,
  adapter = null,
  options = {},
}) {
  if (!activityName || !stmts) {
    return { score: 0, source: "invalid_input", cached: false };
  }

  const cacheKey = computePrestigeCacheKey(activityName, levelHint);

  // 1. Cache lookup with TTL.
  try {
    const cached = stmts.getPrestigeCache?.get(cacheKey);
    if (cached && !isExpired(cached.created_at)) {
      return {
        score: Number(cached.score) || 0,
        source: cached.source || "research",
        rationale: cached.rationale || null,
        sourcesCited: safeJSON(cached.sources_json) || [],
        provider: cached.provider || null,
        model: cached.model || null,
        cached: true,
      };
    }
  } catch {
    // Non-fatal — fall through.
  }

  // 2. Benchmark-hit short-circuit — no web search needed.
  if (benchmarkHit && typeof benchmarkHit.prestige_score === "number") {
    const score = clamp01(benchmarkHit.prestige_score);
    const rationale = `Seeded from baseline_ec_competitive qualifier "${benchmarkHit.level || ""}".`;
    const result = {
      score,
      source: "benchmark",
      rationale,
      sourcesCited: [],
      provider: null,
      model: null,
      cached: false,
    };
    try {
      stmts.upsertPrestigeCache?.run(
        cacheKey,
        activityName,
        levelHint || null,
        score,
        rationale,
        JSON.stringify([]),
        "benchmark",
        null,
        null,
        JSON.stringify({ score, rationale }),
      );
    } catch {
      // Non-fatal.
    }
    return result;
  }

  // 3. Official catalog short-circuit. This covers known competitions that
  // are not in the seeded baseline table yet and still writes a shared RAG
  // cache row for future all-at-once reuse.
  const catalogHit = findBestCompetitionCatalogPrestige(activityName, levelHint);
  if (catalogHit) {
    const score = clamp01(catalogHit.score);
    const rationale = catalogHit.rationale || "Matched official competition catalog.";
    const result = {
      score,
      source: "catalog",
      rationale,
      sourcesCited: catalogHit.sourcesCited || [],
      provider: null,
      model: null,
      cached: false,
      catalogMatch: {
        activityId: catalogHit.activityId,
        activityName: catalogHit.activityName,
        level: catalogHit.level,
        confidence: catalogHit.confidence,
      },
    };
    try {
      stmts.upsertPrestigeCache?.run(
        cacheKey,
        activityName,
        levelHint || catalogHit.level || null,
        score,
        rationale,
        JSON.stringify(result.sourcesCited),
        "catalog",
        null,
        null,
        JSON.stringify(result),
      );
    } catch {
      // Non-fatal.
    }
    return result;
  }

  // 4. Web research via Anthropic web_search. Non-Anthropic providers skip.
  if (!adapter || adapter.provider !== "anthropic" || !adapter.apiKey) {
    return {
      score: 0,
      source: "unavailable",
      rationale: "Prestige research requires an Anthropic key (web_search tool).",
      sourcesCited: [],
      cached: false,
    };
  }

  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const userText = [
    `Research the competitive prestige of "${activityName}"${levelHint ? ` at the ${levelHint} level` : ""} for U.S. college admissions.`,
    "Use web_search to consult official organizer, government, or official school-hosted sources only. Then output only:",
    '{ "score": 0.0-1.0, "rationale": "...", "sourcesCited": ["https://...", "..."] }',
  ].join("\n");

  let response;
  try {
    response = await callLLM({
      provider: adapter.provider,
      apiKey: adapter.apiKey,
      baseUrl: adapter.baseUrl || null,
      model: adapter.model,
      system: PRESTIGE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userText }],
      maxTokens: MAX_TOKENS,
      temperature: 0,
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 3,
          allowed_domains: REPUTABLE_DOMAINS,
        },
      ],
      signal: controller.signal,
      fetchImpl: options.fetchImpl,
    });
  } catch (err) {
    clearTimeout(timer);
    const failScore = 0;
    const failResult = {
      score: failScore,
      source: "research_failed",
      rationale: `web_search failed: ${err?.code || err?.message || "unknown"}`,
      sourcesCited: [],
      provider: adapter.provider,
      model: adapter.model,
      cached: false,
    };
    try {
      stmts.upsertPrestigeCache?.run(
        cacheKey,
        activityName,
        levelHint || null,
        failScore,
        failResult.rationale,
        JSON.stringify([]),
        "research_failed",
        adapter.provider,
        adapter.model,
        JSON.stringify(failResult),
      );
    } catch {
      // Non-fatal.
    }
    return failResult;
  } finally {
    clearTimeout(timer);
  }

  const parsed = extractJsonFromResponse(response);
  if (!parsed || typeof parsed !== "object") {
    const failResult = {
      score: 0,
      source: "research_failed",
      rationale: "Malformed research response",
      sourcesCited: [],
      provider: adapter.provider,
      model: adapter.model,
      cached: false,
    };
    try {
      stmts.upsertPrestigeCache?.run(
        cacheKey,
        activityName,
        levelHint || null,
        0,
        failResult.rationale,
        JSON.stringify([]),
        "research_failed",
        adapter.provider,
        adapter.model,
        JSON.stringify(failResult),
      );
    } catch {
      // Non-fatal.
    }
    return failResult;
  }

  const score = clamp01(parsed.score);
  const rationale = String(parsed.rationale || "").slice(0, 400);
  const sourcesCited = Array.isArray(parsed.sourcesCited)
    ? parsed.sourcesCited.filter((s) => typeof s === "string").slice(0, 10)
    : [];
  const reputableSources = sourcesCited.filter(isReputableSourceUrl);
  if (score > 0 && reputableSources.length === 0) {
    const failResult = {
      score: 0,
      source: "research_failed",
      rationale: "Research response cited no allowed official sources.",
      sourcesCited: [],
      provider: adapter.provider,
      model: adapter.model,
      cached: false,
    };
    try {
      stmts.upsertPrestigeCache?.run(
        cacheKey,
        activityName,
        levelHint || null,
        0,
        failResult.rationale,
        JSON.stringify([]),
        "research_failed",
        adapter.provider,
        adapter.model,
        JSON.stringify(failResult),
      );
    } catch {
      // Non-fatal.
    }
    return failResult;
  }

  const result = {
    score,
    source: "research",
    rationale,
    sourcesCited: reputableSources,
    provider: adapter.provider,
    model: adapter.model,
    cached: false,
  };

  try {
    stmts.upsertPrestigeCache?.run(
      cacheKey,
      activityName,
      levelHint || null,
      score,
      rationale,
      JSON.stringify(reputableSources),
      "research",
      adapter.provider,
      adapter.model,
      JSON.stringify({ score, rationale, sourcesCited: reputableSources }),
    );
  } catch {
    // Non-fatal.
  }

  return result;
}

function safeJSON(s) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

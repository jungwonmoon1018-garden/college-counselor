// ═══════════════════════════════════════════════════════════════════════
// CREDIBLE WEB SOURCES — allowlist for the web_search / web_fetch tool.
// ═══════════════════════════════════════════════════════════════════════
// Goal: when the counselor uses web search, restrict it to authoritative
// sources only. Cuts out user-generated forums, college-ranking SEO spam,
// essay-mill sites, and the rest of the high-noise stuff a student would
// otherwise hit.
//
// Anthropic's web_search_20260209 takes `allowed_domains: [...]` — every
// returned page must be on one of these domains. Subdomains are matched
// (e.g. "harvard.edu" matches "college.harvard.edu").
//
// When the user asks about a specific college that isn't on this list,
// the counselor can append its top-level domain to the allowlist for
// that single request via `extendAllowedDomains(["bowdoin.edu"])`.

export const FEDERAL_AID_SOURCES = [
  // Federal financial-aid + statistics
  "studentaid.gov",
  "fafsa.ed.gov",
  "ed.gov",
  "nces.ed.gov",
  "collegescorecard.ed.gov",
  "bls.gov",
  "data.gov",
];

export const TEST_AND_APPLICATION_SOURCES = [
  // Application platforms + standardized testing
  "commonapp.org",
  "coalitionforcollegeaccess.org",
  "ucop.edu",
  "applytexas.org",
  "questbridge.org",
  "matchlists.questbridge.org",
  "collegeboard.org",
  "bigfuture.collegeboard.org",
  "act.org",
  "ets.org",
  "ielts.org",
  "duolingo.com",
];

// Top US institutions whose admissions pages we want directly queryable.
// .edu is broad; we still list specific schools so the model can call
// admissions pages by hostname without guessing. Extend at runtime via
// extendAllowedDomains() for any school the student is researching.
export const ADMISSIONS_SOURCES = [
  // Ivy League + close peers
  "harvard.edu", "yale.edu", "princeton.edu", "columbia.edu",
  "cornell.edu", "brown.edu", "dartmouth.edu", "upenn.edu",
  // Top private research
  "mit.edu", "stanford.edu", "caltech.edu", "uchicago.edu",
  "duke.edu", "northwestern.edu", "jhu.edu", "rice.edu",
  "vanderbilt.edu", "wustl.edu", "nd.edu", "georgetown.edu",
  "tufts.edu", "emory.edu", "usc.edu", "nyu.edu", "bu.edu",
  "cmu.edu", "rochester.edu", "brandeis.edu", "case.edu",
  "bc.edu", "northeastern.edu", "tulane.edu", "wakeforest.edu",
  "villanova.edu", "scu.edu", "lmu.edu", "pepperdine.edu",
  "slu.edu", "marquette.edu", "fordham.edu", "gwu.edu",
  "american.edu", "syracuse.edu", "miami.edu", "smu.edu", "tcu.edu",
  // Top liberal arts
  "williams.edu", "amherst.edu", "swarthmore.edu", "pomona.edu",
  "bowdoin.edu", "wellesley.edu", "claremontmckenna.edu",
  "carleton.edu", "middlebury.edu", "haverford.edu", "vassar.edu",
  "wesleyan.edu", "smith.edu", "davidson.edu", "grinnell.edu",
  "hamilton.edu", "colby.edu", "bates.edu", "colgate.edu",
  "barnard.edu", "scrippscollege.edu", "kenyon.edu", "oberlin.edu",
  "trinitycollege.edu", "macalester.edu", "reed.edu",
  "mtholyoke.edu", "brynmawr.edu", "lafayette.edu", "bucknell.edu",
  "holycross.edu", "whitman.edu", "occidental.edu", "pitzer.edu",
  "dickinson.edu", "fandm.edu", "conncoll.edu", "skidmore.edu",
  "gettysburg.edu", "stlawu.edu", "denison.edu", "depauw.edu",
  "stolaf.edu", "centre.edu", "rhodes.edu", "sewanee.edu",
  // Top publics — UC, big-state flagships
  "berkeley.edu", "ucla.edu", "uci.edu", "ucsd.edu", "ucsb.edu",
  "ucdavis.edu", "ucsc.edu", "ucr.edu", "ucmerced.edu",
  "umich.edu", "virginia.edu", "unc.edu", "ncsu.edu",
  "gatech.edu", "uw.edu", "wisc.edu", "illinois.edu",
  "utexas.edu", "tamu.edu", "wm.edu", "umd.edu", "umbc.edu",
  "rutgers.edu", "ufl.edu", "fsu.edu", "usf.edu", "ucf.edu",
  "osu.edu", "psu.edu", "purdue.edu", "asu.edu", "arizona.edu",
  "colorado.edu", "umn.edu", "iu.edu", "iastate.edu",
  "msu.edu", "pitt.edu", "umass.edu", "uconn.edu", "udel.edu",
  "uga.edu", "auburn.edu", "clemson.edu", "vt.edu",
  "lsu.edu", "ou.edu", "okstate.edu", "ku.edu", "missouri.edu",
  "utk.edu", "uky.edu", "wvu.edu", "uoregon.edu", "oregonstate.edu",
  "binghamton.edu", "stonybrook.edu", "buffalo.edu", "albany.edu",
  // SUNY / CUNY / state systems
  "suny.edu", "cuny.edu", "calstate.edu",
  // Specialist / arts / engineering / business
  "olin.edu", "harveymudd.edu", "wpi.edu", "rpi.edu", "rit.edu",
  "stevens.edu", "drexel.edu", "njit.edu", "iit.edu",
  "berklee.edu", "juilliard.edu", "risd.edu", "calarts.edu",
  "cooper.edu", "babson.edu", "bentley.edu", "lehigh.edu",
  "pratt.edu", "parsons.edu", "newschool.edu", "sva.edu",
  "savannahcollege.edu", "scad.edu", "aii.edu",
  // HBCUs and MSIs
  "howard.edu", "morehouse.edu", "spelman.edu", "xula.edu",
  "hamptonu.edu", "famu.edu", "nccu.edu", "ncat.edu",
  "tuskegee.edu", "morgan.edu", "claflin.edu", "fisk.edu",
];

// Independent admissions data + journalism. Critical for the model to
// find dean-of-admissions interviews, CDS data, and recent shifts in
// what schools say they value. Restricted to outlets with editorial
// standards — no SEO essay mills, no user-generated review aggregators
// (Niche/Unigo intentionally excluded — they're crowdsourced opinion,
// not authoritative signal).
export const ADMISSIONS_JOURNALISM_SOURCES = [
  // Higher-ed trade press — primary outlet for dean interviews + policy
  "chronicle.com",            // Chronicle of Higher Education
  "insidehighered.com",       // Inside Higher Ed
  "nacacnet.org",             // National Assoc for College Admission Counseling
  "nais.org",                 // National Assoc of Independent Schools
  "councilforaid.org",        // Council for Aid to Education
  // Major newspapers — admissions coverage is consistently strong
  "nytimes.com",
  "washingtonpost.com",
  "wsj.com",
  "bostonglobe.com",
  "latimes.com",
  // Magazines / longform with admissions desks
  "theatlantic.com",
  "newyorker.com",
  // Official data publications + aggregators
  "commondataset.org",        // CDS canonical reference
  "petersons.com",            // long-standing admissions reference
  "collegetransitions.com",   // admissions strategy data
  "prepscholar.com",          // standardized-test + admissions data
  // Forbes/USNews rankings — flawed but cited in admissions decisions
  "usnews.com",
  "forbes.com",
];

// Top international research universities — for students considering
// non-US options or US-international dual applications.
export const INTERNATIONAL_SOURCES = [
  // UK
  "ox.ac.uk", "cam.ac.uk", "imperial.ac.uk", "ucl.ac.uk",
  "lse.ac.uk", "ed.ac.uk", "manchester.ac.uk", "kcl.ac.uk",
  "warwick.ac.uk", "bristol.ac.uk", "ucas.com",
  // Canada
  "utoronto.ca", "mcgill.ca", "ubc.ca", "uwaterloo.ca",
  "queensu.ca", "mcmaster.ca", "uottawa.ca",
  // Europe (selected)
  "ethz.ch", "epfl.ch", "tum.de", "lmu.de", "uni-heidelberg.de",
  "sciencespo.fr", "ens.psl.eu", "sorbonne-universite.fr",
  "ku.dk", "uva.nl", "leidenuniv.nl", "tudelft.nl",
  // Asia-Pacific
  "u-tokyo.ac.jp", "kyoto-u.ac.jp", "snu.ac.kr", "kaist.ac.kr",
  "nus.edu.sg", "ntu.edu.sg", "hku.hk", "cuhk.edu.hk",
  "tsinghua.edu.cn", "pku.edu.cn", "anu.edu.au", "unimelb.edu.au",
  "sydney.edu.au",
];

export const DEFAULT_ALLOWED_DOMAINS = Object.freeze([
  ...FEDERAL_AID_SOURCES,
  ...TEST_AND_APPLICATION_SOURCES,
  ...ADMISSIONS_SOURCES,
  ...ADMISSIONS_JOURNALISM_SOURCES,
  ...INTERNATIONAL_SOURCES,
]);

// Extract a host token from a URL or domain string. "https://x.harvard.edu/foo"
// → "x.harvard.edu". "harvard.edu" → "harvard.edu". Returns null on garbage.
function extractHost(raw) {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  try {
    if (/^https?:\/\//.test(s)) return new URL(s).hostname;
  } catch { /* fall through */ }
  // Bare domain — strip path / query if any
  return s.split("/")[0].split(":")[0] || null;
}

// Build the actual allowed_domains array for a single request. Pass any
// extra domains the conversation mentioned (e.g. the student asked about
// a regional college not on our default list) and we'll merge them.
export function buildAllowedDomains(extra = []) {
  const set = new Set(DEFAULT_ALLOWED_DOMAINS);
  for (const item of extra || []) {
    const host = extractHost(item);
    if (!host) continue;
    // Accepted runtime additions:
    //   • .edu / .gov / .org / .mil  — US institutional + non-profit
    //   • .ac.<cc> / .edu.<cc>       — international academic
    //   • Known consumer + journalism hosts explicitly allow-listed
    //     above (so a student hinting "nytimes.com/article/..." is
    //     accepted even though .com is otherwise filtered out)
    const ALLOW_LISTED = new Set([
      ...TEST_AND_APPLICATION_SOURCES,
      ...ADMISSIONS_JOURNALISM_SOURCES,
    ]);
    const isInstitutional =
      /\.(edu|gov|org|mil)$/.test(host) ||
      /\.ac\.[a-z]{2,3}$/.test(host) ||
      /\.edu\.[a-z]{2,3}$/.test(host);
    if (isInstitutional || ALLOW_LISTED.has(host)) {
      set.add(host);
    }
  }
  return Array.from(set);
}

// Build the Anthropic web-search tool definition with our allowlist
// applied. Returns null if web search isn't appropriate for this request
// (currently always returns the tool; callers can skip it as needed).
export function makeWebSearchTool(extraDomains = []) {
  return {
    type: "web_search_20260209",
    name: "web_search",
    allowed_domains: buildAllowedDomains(extraDomains),
    max_uses: 5,
  };
}

// Companion web-fetch tool — restricted to the same allowlist so the
// model can pull a specific admissions page after locating it via search.
export function makeWebFetchTool(extraDomains = []) {
  return {
    type: "web_fetch_20260209",
    name: "web_fetch",
    allowed_domains: buildAllowedDomains(extraDomains),
    max_uses: 3,
  };
}

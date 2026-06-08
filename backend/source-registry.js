// ═══════════════════════════════════════════════════════════════════════
// SOURCE REGISTRY — Trusted domain enforcement for regulated topics
// ═══════════════════════════════════════════════════════════════════════
// Only sources from trusted domains may populate the verified_facts lane
// for regulated and high-stakes topics. This registry is the single
// source of truth for which domains are trusted per topic.
// ═══════════════════════════════════════════════════════════════════════

const TRUSTED_DOMAINS = {
  fafsa: [
    "studentaid.gov",
    "fafsa.ed.gov",
    "ed.gov",
    "federalstudentaid.ed.gov",
  ],
  ferpa: [
    "ed.gov",
    "studentprivacy.ed.gov",
  ],
  financial_aid: [
    "studentaid.gov",
    "collegescorecard.ed.gov",
    "ed.gov",
    // Per-university financial aid offices are added dynamically
  ],
  deadlines: [
    "collegescorecard.ed.gov",
    // Per-university admissions pages are registered in the evidence graph
  ],
  scholarships: [
    "studentaid.gov",
    "fastweb.com",
    "scholarships.com",
    // Individual scholarship program official pages only
  ],
  test_scores: [
    "collegeboard.org",
    "act.org",
    "sat.collegeboard.org",
  ],
  statistics: [
    "nces.ed.gov",
    "collegescorecard.ed.gov",
    "commonapp.org",
    // Common Data Sets are per-university
  ],
};

// University domains that are always trusted for their own institution's data
const UNIVERSITY_DOMAIN_PATTERNS = [
  /\.edu$/i,
  /\.ac\.\w{2}$/i,     // UK/international academic domains
  /\.edu\.\w{2}$/i,    // Country-specific .edu domains
];

/**
 * Check if a URL/domain is trusted for a given topic type.
 */
export function isSourceTrusted(urlOrDomain, topicType) {
  if (!urlOrDomain || !topicType) return false;

  const domain = extractDomain(urlOrDomain);
  if (!domain) return false;

  // Check against topic-specific trusted domains
  const trustedForTopic = TRUSTED_DOMAINS[topicType] || [];
  for (const trusted of trustedForTopic) {
    if (domain === trusted || domain.endsWith(`.${trusted}`)) return true;
  }

  // University .edu domains are trusted for their own institutional data
  if (UNIVERSITY_DOMAIN_PATTERNS.some((p) => p.test(domain))) {
    // Only trusted for institutional-specific topics, not federal policy
    if (["deadlines", "financial_aid", "scholarships", "statistics"].includes(topicType)) {
      return true;
    }
  }

  return false;
}

/**
 * Get all trusted source domains for a topic.
 */
export function getSourcesForTopic(topicType) {
  return (TRUSTED_DOMAINS[topicType] || []).map((domain) => ({
    domain,
    type: "trusted",
    topicType,
  }));
}

/**
 * Register a university domain as trusted for specific categories.
 * Used when setting up monitoring for a specific institution.
 */
export function registerUniversityDomain(domain, unitId, categories = []) {
  // Validate it's actually a .edu domain
  if (!UNIVERSITY_DOMAIN_PATTERNS.some((p) => p.test(domain))) {
    return { registered: false, reason: "Domain does not match academic domain patterns." };
  }

  // Add to relevant topic registries
  for (const cat of categories) {
    if (TRUSTED_DOMAINS[cat] && !TRUSTED_DOMAINS[cat].includes(domain)) {
      TRUSTED_DOMAINS[cat].push(domain);
    }
  }

  return {
    registered: true,
    domain,
    unitId,
    categories,
  };
}

/**
 * Validate that all evidence objects for a regulated response come from trusted sources.
 */
export function validateEvidenceSources(evidenceObjects, topicType) {
  const results = evidenceObjects.map((evidence) => {
    const domain = evidence.source_domain || extractDomain(evidence.source_url);
    const trusted = isSourceTrusted(domain, topicType);
    return {
      evidenceId: evidence.id,
      domain,
      trusted,
      reason: trusted
        ? `Domain ${domain} is trusted for ${topicType}`
        : `Domain ${domain} is NOT trusted for ${topicType}. Evidence cannot be used in verified_facts lane.`,
    };
  });

  return {
    allTrusted: results.every((r) => r.trusted),
    trustedCount: results.filter((r) => r.trusted).length,
    untrustedCount: results.filter((r) => !r.trusted).length,
    details: results,
  };
}

/**
 * Extract domain from a URL or return the input if it's already a domain.
 */
function extractDomain(urlOrDomain) {
  if (!urlOrDomain) return null;
  try {
    if (urlOrDomain.includes("://")) {
      return new URL(urlOrDomain).hostname.toLowerCase();
    }
    // Already a domain
    return urlOrDomain.toLowerCase().replace(/^www\./, "");
  } catch {
    return urlOrDomain.toLowerCase().replace(/^www\./, "");
  }
}

/**
 * Get the full registry for diagnostic/admin purposes.
 */
export function getRegistry() {
  return {
    trustedDomains: { ...TRUSTED_DOMAINS },
    universityPatterns: UNIVERSITY_DOMAIN_PATTERNS.map((p) => p.source),
  };
}

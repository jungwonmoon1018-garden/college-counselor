// ═══════════════════════════════════════════════════════════════════════
// METHODOLOGY — single source of truth for "how the scores work", surfaced
// verbatim to students via /api/methodology and to the public site via
// docs/METHODOLOGY.md. The goal is explainability: every weight, threshold,
// and data source is shown, so a score is never an opaque verdict.
// ═══════════════════════════════════════════════════════════════════════

import { EC_FACTORS, EC_FACTOR_WEIGHTS_DEFAULT } from "./ec-vectorizer.js";

// Plain-language description of each EC factor + what raises it. Kept here (not
// in the vectorizer) so the explanation and the math live in lockstep but the
// vectorizer stays dependency-free.
export const EC_FACTOR_EXPLANATIONS = Object.freeze({
  impact_and_scope: {
    label: "Impact & scope",
    what: "How far the work reaches beyond the student — people served, dollars raised, audiences reached.",
    raises: "Reach beyond school (community, regional, national), concrete numbers (people, $), published/launched output.",
  },
  leadership_and_initiative: {
    label: "Leadership & initiative",
    what: "Whether the student started or drove something, not just held a title.",
    raises: "Founding/creating, top or mid rank roles, initiative verbs (organized, led, built), rank progression.",
  },
  passion_and_consistency: {
    label: "Passion & consistency",
    what: "Sustained, multi-year commitment and a visible body of work.",
    raises: "Years active, lifetime hours, portfolios/artifacts (repos, reels, pieces).",
  },
  talents_and_awards: {
    label: "Talents & awards",
    what: "External validation and competitive achievement.",
    raises: "Recognized awards by level (regional → international) and competition placement.",
  },
  relevance_to_intended_major: {
    label: "Relevance to intended major",
    what: "How clearly the activity connects to the student's declared field (their 'spike').",
    raises: "Keyword/competition overlap with the intended major; a coherent through-line.",
  },
  community_and_character: {
    label: "Community & character",
    what: "Intangible service, empathy, mentorship, and integrity signals.",
    raises: "Service, mentorship, inclusivity, and character signals — plus a floor derived from sustained impact/leadership/passion. Never inferred from nothing.",
  },
});

// Coarse composite → label thresholds (mirror compositeLabel in ec-vectorizer).
export const COMPOSITE_THRESHOLDS = Object.freeze([
  { atLeast: 0.80, label: "exceptional" },
  { atLeast: 0.65, label: "strong" },
  { atLeast: 0.45, label: "developing" },
  { atLeast: 0.25, label: "emerging" },
  { atLeast: 0.00, label: "early_stage" },
]);

/**
 * Assemble the full methodology object. Runtime status (model targets, data
 * freshness) is injected so the doc reflects the live deployment, not a
 * hardcoded snapshot.
 */
export function buildMethodology(status = {}) {
  const {
    claudeTargets = null,        // { haiku, sonnet, opus }
    claudeLastRefresh = null,    // ISO string | null
    providerMigration = null,    // { openrouter: {...}, ... }
    scorecardConfigured = false,
    cdsCycleLatest = null,       // e.g. "2024-25"
    baselineYear = 2024,
    domainMonitorDaily = true,
  } = status;

  const weights = EC_FACTORS.map((f) => ({
    factor: f,
    weight: EC_FACTOR_WEIGHTS_DEFAULT[f],
    ...EC_FACTOR_EXPLANATIONS[f],
  }));
  const weightSum = Math.round(Object.values(EC_FACTOR_WEIGHTS_DEFAULT).reduce((a, b) => a + b, 0) * 100) / 100;

  return {
    version: "1.0",
    summary:
      "These scores are an automated, evidence-based read of what you tell us — a starting point for conversation, never a verdict. Every weight and data source is shown below. You can override any factor, and a human counselor (and your own judgment) should always have the final say.",
    ecScoring: {
      explanation:
        "Each activity is scored 0–1 on six independent factors. The composite is a weighted sum of those factors using the published weights below. Factors are kept independent (not collapsed into one ranking) on purpose.",
      factors: weights,
      weightsSumTo: weightSum,
      composite: {
        formula: "composite = Σ (factor_score × factor_weight)",
        thresholds: COMPOSITE_THRESHOLDS,
        note: "The label is a coarse band for orientation only; the underlying factor scores are what you should act on.",
      },
    },
    narrativeQuality: {
      explanation:
        "Narrative drafts are grounded ONLY in your real profile — we never invent awards, titles, or experiences. The draft is editable scaffolding in your own voice, not a finished essay and not words handed to you. Narrative quality influences EC 'relevance/fit' signals (how well an activity supports your stated story), but it never manufactures accomplishments.",
      noGhostwriting: true,
      humanOversight:
        "This tool does not replace a human counselor. Unusual transcripts, non-US curricula, special-needs accommodations, and complex family contexts can be misread by an automated system — bring those to a real counselor. Use this output as preparation, not a decision.",
    },
    dataSources: {
      admissionsStats: {
        source: "U.S. Dept. of Education College Scorecard API",
        freshness: scorecardConfigured ? "live (fetched at request time)" : "offline fallback (API key not configured)",
      },
      commonDataSet: {
        source: "Institutional Common Data Set publications",
        latestCycleIngested: cdsCycleLatest || "see tools/cds-cache",
        refresh: "Operator-registered official CDS links, parsed + validated before ingest. Never scraped blindly or fabricated.",
      },
      officialPages: {
        source: "University admissions / aid / deadline pages",
        refresh: domainMonitorDaily ? "Daily diff-based monitoring (domain-monitor), respects robots.txt" : "manual",
      },
      apConcepts: {
        source: "Curated from released AP FRQ content (2023–2025)",
        refresh: "Curated catalog; updated when the College Board releases new exam content.",
      },
      baselineDistributions: {
        source: "NCES / NACAC / CollegeBoard aggregate reports",
        year: baselineYear,
      },
      internationalCaveat:
        "Coverage is strongest for US institutions and US-style transcripts. Non-US curricula, grading scales, and visa/eligibility nuances are not fully modeled — verify with an advisor familiar with your system.",
    },
    modelTransparency: {
      whyItMatters:
        "Free-text guidance quality depends on the LLM behind your BYOK key. A weak or outdated model can produce generic or hallucinated suggestions. We keep recommended models current and tell you when yours is behind.",
      anthropic: {
        policy: "Retired Anthropic model IDs are auto-migrated to the current recommended target (no action needed).",
        currentTargets: claudeTargets,
        lastRefresh: claudeLastRefresh,
      },
      otherProviders: {
        policy: "For OpenRouter and other BYOK providers, newer recommended models are detected and PROPOSED — migration happens only with your explicit approval, never silently.",
        status: providerMigration,
      },
    },
    yourControls: {
      overrides: "Override any factor score; your override is preserved on every recompute.",
      correction: "Every plan is marked open for correction — the numbers are an automated read, not ground truth.",
      export_delete: "Your data is encrypted, exportable, and deletable at any time.",
    },
  };
}

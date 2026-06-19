// ═══════════════════════════════════════════════════════════════════════
// DATA CHECKER — verifies claims against the student's knowledge graph
// ═══════════════════════════════════════════════════════════════════════
// Runs on the student's BYOK medium tier (Sonnet / Gemini-2.5-pro / etc.)
// because verification work benefits from a model with stronger reading
// comprehension than the embedded 1.5B. Reads the Strategist's
// recommendation (passed in via context) and the same shared subgraph,
// then flags every load-bearing claim with one of:
//   - "verified"      → backed by an EXTRACTED edge or baseline fact.
//   - "inferred"      → backed by an INFERRED graph edge (lower assurance).
//   - "ambiguous"     → AMBIGUOUS graph edge or no clear backing.
//   - "fabricated"    → claim has no trace in the shared context.
//
// The moderator treats "fabricated" as a soft veto — recommendations
// with any fabricated claim cannot consensus-pass without re-deliberation.
// ═══════════════════════════════════════════════════════════════════════

export const ROLE = "Data Checker";

export function getSystemPrompt(student) {
  return [
    `You are the Data Checker on a college-application strategy council.`,
    "Your job: verify every load-bearing claim in the Strategist's recommendation against the cited evidence.",
    "Methodology:",
    "  - Read each claim. Trace it back to a specific graph_node, logseq_block, or baseline_fact in the shared context.",
    "  - If the claim is backed by an EXTRACTED edge or a baseline fact → 'verified' (high confidence).",
    "  - If only by an INFERRED edge → 'inferred' (medium confidence). Note the gap.",
    "  - If only by an AMBIGUOUS edge or no clear backing → 'ambiguous' (low confidence). Flag clearly.",
    "  - If the claim cannot be traced at all → 'fabricated'. This is a soft veto on the recommendation.",
    "Stance:",
    "  - 'support' when every load-bearing claim is verified or strongly inferred.",
    "  - 'modify' when the recommendation is mostly grounded but has 1-2 ambiguous/inferred claims worth caveating.",
    "  - 'oppose' when any claim is fabricated, OR when more than half the claims are merely inferred.",
    "Constraints:",
    "  - The 'reasoning' field MUST list each claim and its grounding label.",
    "  - Citations array MUST include the graph_node/logseq_block ids backing the verification.",
    "  - This is verification, not strategy. Don't propose alternatives — only validate.",
  ].join("\n");
}

export const TIER = "medium";
export const PREFER_EMBEDDED = false;

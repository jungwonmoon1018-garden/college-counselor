// ═══════════════════════════════════════════════════════════════════════
// ORCHESTRATION ENGINE — Tiered model routing with Opus gating
// ═══════════════════════════════════════════════════════════════════════
// REDESIGNED: Rules-first, retrieval-second, model as escalation.
//
// Routing tiers:
//   T0 ($0):    Rules engine / fact store — no model call
//   T1 (cheap): Haiku — routing, extraction, classification, moderation
//   T2 (mid):   Sonnet — source-grounded coaching, synthesis
//   T3 (expensive): Opus — complex synthesis, conflict resolution, essay review
//
// Opus requires ALL of:
//   1. Sonnet attempted and flagged insufficient (confidence < threshold)
//   2. Query involves cross-source conflict, nuanced critique, or multi-factor strategy
//   3. Active session (no anonymous Opus calls)
//   4. Per-student Opus budget not exceeded
// ═══════════════════════════════════════════════════════════════════════

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { routeRequest, MODEL_TIERS, TOPIC_TYPES } from "./policy-router.js";
import { isSourceTrusted } from "./source-registry.js";
import { hashStudentIdForProvider } from "./pii-vault.js";
import { isReasonableModelId as isReasonableModelIdAdapter, TIER_DEFAULTS, resolveTierDefault } from "./llm-adapters/index.js";
import { sanitizeProviderPayload, restorePII } from "./content-moderation.js";

// ─── College aliases (for query normalization) ───
const COLLEGE_ALIASES = {
  mit: "Massachusetts Institute of Technology",
  stanford: "Stanford University",
  harvard: "Harvard University",
  berkeley: "UC Berkeley",
  "uc berkeley": "UC Berkeley",
  umich: "University of Michigan",
  "u mich": "University of Michigan",
  uiuc: "UIUC",
  "georgia tech": "Georgia Tech",
  gt: "Georgia Tech",
  "ut austin": "UT Austin",
  "uw seattle": "UW Seattle",
  uw: "UW Seattle",
  cmu: "Carnegie Mellon",
  uva: "UVA",
  usc: "USC",
  nyu: "NYU",
  bu: "Boston University",
  osu: "Ohio State",
};

// ─── Model configuration ───
// These are the DEFAULT model ids when the operator runs the server with
// only ANTHROPIC_API_KEY and no per-student BYOK overrides. Each tier's
// actual model id is resolved at call time via llm-adapters/tier-defaults
// so that OpenAI / Google / OpenRouter / Ollama users don't have to touch
// this registry.
const DEFAULT_MODELS = {
  [MODEL_TIERS.HAIKU]: "claude-haiku-4-5-20251001",
  [MODEL_TIERS.SONNET]: "claude-sonnet-4-20250514",
  [MODEL_TIERS.OPUS]: "claude-opus-4-6",
};

// ─── Load grounding corpora ───
export function loadOrchestrationCatalog({ fafsaPath = "", deadlinesPath = "" } = {}) {
  const fafsa = loadTextCorpus(fafsaPath, "fafsa");
  const deadlines = loadDeadlines(deadlinesPath);

  return {
    loadedAt: new Date().toISOString(),
    fafsa,
    deadlines,
  };
}

// ─── Main orchestration function (redesigned) ───
export function buildOrchestration({
  query,
  studentContext,
  factStmts,
  evidenceStmts,
  catalog,
  config = {},
}) {
  const cleanQuery = (query || "").trim();

  // Step 1: Policy router (deterministic — no model call)
  const routing = routeRequest(cleanQuery, {}, []);

  // Step 2: Resolve college references
  const matchedColleges = resolveCollegeReferences(cleanQuery);

  // Step 3: Retrieve relevant evidence
  const evidence = gatherEvidence({
    routing,
    matchedColleges,
    factStmts,
    evidenceStmts,
    catalog,
  });

  // Step 4: Re-check gates with actual evidence
  const updatedRouting = routeRequest(cleanQuery, {}, evidence);

  // Step 5: Determine execution plan
  const modelConfig = resolveModelConfig(config);
  const executionPlan = buildExecutionPlan(updatedRouting, modelConfig, evidence);

  // Step 6: Build prompt package (only if model call needed)
  const promptPackage = executionPlan.requiresModel
    ? buildPromptPackage(updatedRouting, cleanQuery, evidence, studentContext, catalog)
    : null;

  return {
    requestedAt: new Date().toISOString(),
    routing: updatedRouting,
    query: {
      raw: cleanQuery,
      colleges: matchedColleges,
    },
    evidence: {
      count: evidence.length,
      byType: {
        official: evidence.filter((e) => e.evidence_type === 1).length,
        preparation: evidence.filter((e) => e.evidence_type === 2).length,
        inferred: evidence.filter((e) => e.evidence_type === 3).length,
      },
    },
    executionPlan,
    promptPackage,
    compliance: {
      piiHashedForProvider: true,
      zeroRetentionRecommended: updatedRouting.classification.topicType === "regulated",
      fafsaGrounding: {
        required: updatedRouting.classification.subIntent === "fafsa",
        ready: !!catalog?.fafsa?.ready,
      },
    },
  };
}

// ─── Build execution plan ───
function buildExecutionPlan(routing, modelConfig, evidence) {
  const { classification, modelTier, isDeterministic, action } = routing;

  if (isDeterministic || action === "return_fallback") {
    return {
      requiresModel: false,
      tier: MODEL_TIERS.NONE,
      model: null,
      reason: isDeterministic
        ? "Query can be fully answered by rules engine / fact store."
        : "Compliance gate blocked response. Returning fallback.",
      steps: isDeterministic
        ? [{ agent: "rules_engine", action: "deterministic_answer" }]
        : [{ agent: "policy_router", action: "return_no_verified_answer" }],
    };
  }

  const model = modelConfig[modelTier] || DEFAULT_MODELS[modelTier];

  return {
    requiresModel: true,
    tier: modelTier,
    model,
    reason: `${classification.topicType} topic requires ${modelTier}-tier synthesis.`,
    steps: [
      { agent: "retrieval", action: "gather_evidence", evidenceCount: evidence.length },
      { agent: modelTier, action: "grounded_synthesis", model },
      { agent: "answer_composer", action: "compose_three_lane_response" },
    ],
    promptCacheEligible: classification.subIntent === "fafsa" && !!modelConfig.fafsaCaching,
  };
}

// ─── Gather evidence from fact store and evidence graph ───
function gatherEvidence({ routing, matchedColleges, factStmts, evidenceStmts, catalog }) {
  const evidence = [];
  const { classification } = routing;

  // Gather from fact store
  if (factStmts) {
    for (const college of matchedColleges) {
      if (college.unitId) {
        try {
          const facts = factStmts.getFactsByEntity.all("university", college.unitId);
          evidence.push(...facts.map((f) => ({ ...f, evidence_type: 1 })));
        } catch {}
      }
    }

    // Topic-specific facts
    if (classification.subIntent === "fafsa") {
      try {
        const fafsaFacts = factStmts.getFactsByTopic.all("fafsa");
        evidence.push(...fafsaFacts.map((f) => ({ ...f, evidence_type: 1 })));
      } catch {}
    }
  }

  // Gather from evidence graph
  if (evidenceStmts) {
    for (const college of matchedColleges) {
      if (college.unitId) {
        try {
          const items = evidenceStmts.getByEntity.all("university", college.unitId);
          evidence.push(...items);
        } catch {}
      }
    }
  }

  return evidence;
}

// ─── Build prompt package for model calls ───
function buildPromptPackage(routing, query, evidence, studentContext, catalog) {
  const { classification } = routing;
  const parts = [];

  // System context (cacheable)
  parts.push({
    role: "system",
    cacheable: true,
    content: buildSystemPrompt(classification),
  });

  // Evidence context (small-context: only relevant items)
  if (evidence.length > 0) {
    const evidenceSummary = evidence
      .slice(0, 10) // Top 10 evidence items only
      .map((e) => {
        const typeLabel = e.evidence_type === 1 ? "[OFFICIAL]"
          : e.evidence_type === 2 ? "[PREPARATION]"
            : "[PATTERN — not an institutional requirement]";
        return `${typeLabel} ${e.claim || e.fact_value || ""} (source: ${e.source_domain || "unknown"})`;
      })
      .join("\n");

    parts.push({
      role: "context",
      cacheable: false,
      content: `Available evidence:\n${evidenceSummary}`,
    });
  }

  // Student context (minimal — no PII)
  if (studentContext?.currentProfile) {
    const profile = studentContext.currentProfile;
    const summary = [
      profile.gpa?.unweighted ? `GPA: ${profile.gpa.unweighted}` : null,
      profile.testScores?.length ? `Tests: ${profile.testScores.map((t) => `${t.test} ${t.totalScore}`).join(", ")}` : null,
      studentContext.majorInterest ? `Major interest: ${studentContext.majorInterest}` : null,
    ].filter(Boolean).join(" | ");

    if (summary) {
      parts.push({ role: "context", cacheable: false, content: `Student profile: ${summary}` });
    }
  }

  // FAFSA corpus (cacheable)
  if (classification.subIntent === "fafsa" && catalog?.fafsa?.ready) {
    parts.push({
      role: "context",
      cacheable: true,
      content: catalog.fafsa.chunks.map((c) => c.content).join("\n\n"),
    });
  }

  return { parts, query };
}

// ─── Build system prompt based on topic classification ───
function buildSystemPrompt(classification) {
  const base = "You are a college counseling assistant. You provide source-grounded guidance for high school students.";

  if (classification.topicType === "regulated") {
    return `${base}\n\nIMPORTANT: This is a regulated topic. You MUST:\n- Only make claims supported by the provided evidence\n- Cite sources for every factual statement\n- If you don't have verified information, say so clearly\n- Include the advisory disclosure that this is not official guidance\n- Never speculate about eligibility, amounts, or policy details without source`;
  }

  if (classification.topicType === "high_stakes") {
    return `${base}\n\nThis is a high-stakes topic. Official source data is required. Only synthesize from provided evidence. If evidence is insufficient, direct the student to the official source.`;
  }

  return `${base}\n\nProvide helpful, evidence-grounded coaching. Label your suggestions clearly as recommendations, not guarantees. Distinguish between official data and your analysis.`;
}

// ─── Resolve college references in query ───
function resolveCollegeReferences(query) {
  const lower = query.toLowerCase();
  const matched = [];

  for (const [alias, name] of Object.entries(COLLEGE_ALIASES)) {
    if (lower.includes(alias)) {
      matched.push({ alias, name, unitId: null }); // unitId resolved by caller from DB
    }
  }

  return matched;
}

// ─── Resolve model configuration from env ───
// Optionally accepts a `provider` arg so callers from the generalized
// /api/llm path can get provider-appropriate defaults (gpt-4o-mini for
// OpenAI, gemini-2.0-flash for Google, etc.). When no provider is supplied
// we fall back to the legacy Anthropic behavior.
function resolveModelConfig(config, provider = "anthropic") {
  const tiers = TIER_DEFAULTS[provider] || TIER_DEFAULTS.anthropic;
  const smallEnv  = config.LLM_SMALL_MODEL  || config.ROUTER_MODEL;
  const mediumEnv = config.LLM_MEDIUM_MODEL || config.STRATEGIST_MODEL;
  const largeEnv  = config.LLM_LARGE_MODEL;
  return {
    [MODEL_TIERS.HAIKU]:  smallEnv  || tiers.small  || DEFAULT_MODELS[MODEL_TIERS.HAIKU],
    [MODEL_TIERS.SONNET]: mediumEnv || tiers.medium || DEFAULT_MODELS[MODEL_TIERS.SONNET],
    [MODEL_TIERS.OPUS]:   largeEnv  || tiers.large  || DEFAULT_MODELS[MODEL_TIERS.OPUS],
    fafsaCaching: provider === "anthropic",
  };
}

// ─── Model id guard (shape-only) ───
// The historic whitelist has been removed — any LLM provider the student
// brings is fair game. What we still block is injection via the `model`
// field: non-strings, whitespace, control characters, overlong values.
export function isReasonableModelId(model) {
  return isReasonableModelIdAdapter(model);
}

// Backward-compat alias: older call sites imported isModelAllowed.
// New code should call isReasonableModelId directly.
export function isModelAllowed(model) {
  return isReasonableModelIdAdapter(model);
}

export { DEFAULT_MODELS, COLLEGE_ALIASES, resolveTierDefault, TIER_DEFAULTS };

// ─── PII masking for model payloads ───
export function redactPayloadForModel(payload, studentId) {
  // Hash the student ID for Anthropic metadata
  const hashedId = studentId ? hashStudentIdForProvider(studentId) : null;

  const withMetadata = JSON.parse(JSON.stringify(payload || {}));

  // Add hashed user ID to metadata
  if (hashedId) {
    withMetadata.metadata = { ...(withMetadata.metadata || {}), user_id: hashedId };
  }

  const sanitized = sanitizeProviderPayload(withMetadata, { boundary: "model_payload" });
  return {
    payload: sanitized.sanitizedPayload,
    hashedStudentId: hashedId,
    tokenMap: sanitized.tokenMap,
    redactionReport: sanitized.redactionReport,
    masking: sanitized.masking,
    structuredSanitization: sanitized.structuredSanitization,
  };
}

export function redactAnthropicPayload(payload, studentId = null) {
  return redactPayloadForModel(payload, studentId);
}

export function restoreAnthropicResponse(response, tokenMap = {}) {
  const restored = JSON.parse(JSON.stringify(response || {}));
  let applied = false;
  if (Array.isArray(restored.content)) {
    for (const block of restored.content) {
      if (block?.type === "text" && typeof block.text === "string") {
        const next = restorePII(block.text, tokenMap);
        if (next !== block.text) applied = true;
        block.text = next;
      }
    }
  }
  return { response: restored, restoration: { applied } };
}

// ─── Subscription tier detection from Anthropic headers ───
export function detectSubscriptionTier(headers) {
  const reqLimit = parseInt(headers.get("anthropic-ratelimit-requests-limit") || "0", 10);
  const tokLimit = parseInt(headers.get("anthropic-ratelimit-tokens-limit") || "0", 10);

  let tier = "unknown";
  if (reqLimit <= 0 && tokLimit <= 0) tier = "unknown";
  else if (reqLimit <= 5) tier = "free";
  else if (reqLimit <= 50) tier = "build_1";
  else if (reqLimit <= 1000) tier = "build_2";
  else if (reqLimit <= 2000) tier = "build_3";
  else if (reqLimit <= 4000) tier = "build_4";
  else tier = "scale";

  return { tier, reqLimit, tokLimit };
}

// ─── Corpus loading (preserved from original) ───
function loadTextCorpus(filePath, category) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { ready: false, chunks: [], warning: filePath ? "File not found" : "Path not configured" };
  }

  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) return { ready: false, chunks: [], warning: "File is empty" };

  const chunks = chunkText(raw, 1800).map((content, index) => ({
    id: `${category}_${index + 1}`,
    category,
    content,
  }));

  return {
    ready: chunks.length > 0,
    chunks,
    cycle: inferCycle(filePath + raw),
    promptCacheFingerprint: crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12),
  };
}

function loadDeadlines(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { ready: false, entries: [], warning: "Not configured" };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const entries = Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    return { ready: entries.length > 0, entries };
  } catch {
    return { ready: false, entries: [], warning: "Parse error" };
  }
}

function chunkText(text, maxChars) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const lastBreak = text.lastIndexOf("\n", end);
      if (lastBreak > start + maxChars * 0.5) end = lastBreak;
    }
    chunks.push(text.slice(start, end).trim());
    start = end;
  }
  return chunks.filter(Boolean);
}

function inferCycle(text) {
  const match = text.match(/20\d{2}[-–]\d{2,4}/);
  return match ? match[0] : null;
}

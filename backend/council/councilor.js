// ═══════════════════════════════════════════════════════════════════════
// COUNCILOR — base class for a single seat in the Strategy Council
// ═══════════════════════════════════════════════════════════════════════
// Each role module (strategist, skeptic, devils-advocate, data-checker,
// compliance) exports a config object consumed here. The Councilor
// instance wraps an LLM call with structured-output parsing and
// confidence extraction.
//
// Output envelope (every seat returns this):
//   {
//     stance: "support" | "oppose" | "modify",
//     recommendation: string,   // 1–3 sentences
//     confidence: 0..1,         // self-reported
//     citations: [{type, id}],  // graph_node, logseq_block, baseline_fact
//     reasoning: string,        // 1 paragraph max — used by audit trail
//     model: string,            // which model produced this
//   }
// ═══════════════════════════════════════════════════════════════════════

import { callLLM, resolveTierDefault, isEmbeddedAvailable } from "../llm-adapters/index.js";
import { llmLog, llmDebug } from "../llm-adapters/llm-log.js";

const PARSE_TRIES = 2; // re-prompt on parse failure
const MAX_OUTPUT_TOKENS = 600;

export class Councilor {
  constructor({ role, getSystemPrompt, tier = "small", preferEmbedded = true }) {
    if (!role) throw new Error("Councilor requires a role label.");
    if (typeof getSystemPrompt !== "function") {
      throw new Error("Councilor requires a getSystemPrompt(student) function.");
    }
    this.role = role;
    this.getSystemPrompt = getSystemPrompt;
    this.tier = tier;
    this.preferEmbedded = preferEmbedded;
  }

  /**
   * Resolve which provider/model to call. Default policy:
   *   - tier=small with preferEmbedded=true → embedded if GGUF ready,
   *     else fall back to student BYOK small tier.
   *   - tier=medium → always student BYOK (Data Checker, Compliance).
   *
   * The orchestration layer can override by passing `byok` (consent + key).
   */
  resolveAdapter({ byok }) {
    if (this.tier === "small" && this.preferEmbedded && isEmbeddedAvailable()) {
      return {
        provider: "embedded",
        apiKey: null,
        baseUrl: "embedded://local",
        model: resolveTierDefault("embedded", "small"),
        fallbackUsed: false,
      };
    }
    if (!byok || !byok.provider) {
      // Last-resort fall-back to embedded even at medium tier when no BYOK
      // is configured. The audit trail flags this so the moderator
      // downgrades confidence appropriately.
      if (isEmbeddedAvailable()) {
        return {
          provider: "embedded",
          apiKey: null,
          baseUrl: "embedded://local",
          model: resolveTierDefault("embedded", "small"),
          fallbackUsed: true,
        };
      }
      throw new Error(`Councilor "${this.role}" requires a BYOK adapter but none is configured.`);
    }
    return {
      provider: byok.provider,
      apiKey: byok.apiKey,
      baseUrl: byok.baseUrl || null,
      model: byok.model || resolveTierDefault(byok.provider, this.tier),
      fallbackUsed: false,
    };
  }

  /** Deliberate on a question against a shared context envelope. */
  async deliberate({ question, decisionType, student, context, byok, signal }) {
    const adapter = this.resolveAdapter({ byok });
    llmLog("COUNCIL", "seat resolved", { role: this.role, tier: this.tier, provider: adapter.provider, model: adapter.model, fallbackUsed: adapter.fallbackUsed });
    const system = this.getSystemPrompt(student);
    const userPrompt = buildUserPrompt({
      role: this.role,
      question,
      decisionType,
      context,
    });

    let lastErr = null;
    for (let attempt = 0; attempt < PARSE_TRIES; attempt++) {
      try {
        const response = await callLLM({
          provider: adapter.provider,
          apiKey: adapter.apiKey,
          baseUrl: adapter.baseUrl,
          model: adapter.model,
          system,
          messages: [{ role: "user", content: userPrompt }],
          maxTokens: MAX_OUTPUT_TOKENS,
          temperature: 0.2,
          signal,
        });
        const raw = Array.isArray(response?.content)
          ? response.content.map((c) => c.text || "").join("").trim()
          : "";
        const parsed = parseEnvelope(raw);
        if (parsed) {
          return {
            ...parsed,
            role: this.role,
            model: adapter.model,
            provider: adapter.provider,
            fallback_used: adapter.fallbackUsed,
            usage: response?.usage || null,
          };
        }
        lastErr = new Error("Failed to parse council envelope JSON.");
      } catch (err) {
        llmDebug("COUNCIL", "deliberate attempt failed", { role: this.role, attempt, error: err?.message });
        lastErr = err;
      }
    }

    // Hard fail — return an abstention so the moderator can still tally.
    return {
      role: this.role,
      stance: "modify",
      recommendation: `(${this.role} could not produce a usable response: ${lastErr?.message || "unknown error"}.)`,
      confidence: 0,
      citations: [],
      reasoning: "Councilor abstained due to provider error or unparseable output.",
      model: adapter.model,
      provider: adapter.provider,
      fallback_used: adapter.fallbackUsed,
      abstained: true,
    };
  }
}

function buildUserPrompt({ role, question, decisionType, context }) {
  return [
    `You are the ${role} seat on a college-application strategy council.`,
    `Decision type: ${decisionType}`,
    `Student question: ${question}`,
    "",
    "Shared context follows (graph subgraph, vault excerpts). Use only what's here — do not invent facts:",
    "──────────",
    context || "(no context retrieved)",
    "──────────",
    "",
    'Respond with JSON only in this exact shape:',
    '{"stance": "support" | "oppose" | "modify",',
    ' "recommendation": "1-3 sentences",',
    ' "confidence": 0.0-1.0,',
    ' "citations": [{"type": "graph_node"|"logseq_block"|"baseline_fact", "id": "..."}],',
    ' "reasoning": "one paragraph, your role-specific lens"}',
    "",
    "No prose outside the JSON. No markdown fences.",
  ].join("\n");
}

function parseEnvelope(raw) {
  if (!raw) return null;
  // Try direct, then extract the first balanced { ... } block.
  try {
    return validate(JSON.parse(raw));
  } catch { /* fall through */ }
  const start = raw.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === "{") depth++;
    else if (raw[i] === "}") {
      depth--;
      if (depth === 0) {
        try {
          return validate(JSON.parse(raw.slice(start, i + 1)));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function validate(obj) {
  if (!obj || typeof obj !== "object") return null;
  const stance = obj.stance === "oppose" || obj.stance === "modify" ? obj.stance : "support";
  const confidence = clamp01(Number(obj.confidence));
  const recommendation = String(obj.recommendation || "").slice(0, 1000);
  const reasoning = String(obj.reasoning || "").slice(0, 2000);
  const citations = Array.isArray(obj.citations) ? obj.citations.filter(isValidCitation).slice(0, 8) : [];
  return { stance, recommendation, confidence, reasoning, citations };
}

function isValidCitation(c) {
  if (!c || typeof c !== "object") return false;
  return ["graph_node", "logseq_block", "baseline_fact"].includes(c.type) && typeof c.id === "string";
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

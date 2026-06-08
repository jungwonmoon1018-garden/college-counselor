// ═══════════════════════════════════════════════════════════════════════
// CONTENT MODERATION — Input/output moderation middleware
// ═══════════════════════════════════════════════════════════════════════
// Required by Anthropic Usage Policy. Provides:
//   - Input screening (before model calls)
//   - Output screening (before returning to user)
//   - Age-appropriate content filtering for minors
//   - PII detection and redaction before model context
//   - Credential detection (blocks FSA IDs, SSNs, etc.)
// ═══════════════════════════════════════════════════════════════════════

// ─── Content categories ───
const CATEGORIES = {
  SAFE: "safe",
  CRISIS: "crisis",
  INAPPROPRIATE: "inappropriate",
  CREDENTIAL: "credential_detected",
  PII_DETECTED: "pii_detected",
  OFF_TOPIC: "off_topic",
};

// ─── Patterns ───
const CREDENTIAL_PATTERNS = [
  { pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/, type: "ssn", message: "Do not share your Social Security Number with this system." },
  { pattern: /\bfsa\s*id\b.*[:=]\s*\S+/i, type: "fsa_id", message: "Do not share your FSA ID with this system. Manage your FSA ID at StudentAid.gov." },
  { pattern: /\bpassword\b.*[:=]\s*\S+/i, type: "password", message: "Do not share passwords with this system." },
  { pattern: /\bsk-ant-api\d{2}-[a-zA-Z0-9_-]{20,}/i, type: "api_key", message: "API key detected in message. Use the secure API Key settings instead." },
  { pattern: /\bsk-(?:proj-)?[a-zA-Z0-9_-]{20,}/i, type: "api_key", message: "API key detected in message. Use the secure API Key settings instead." },
  { pattern: /\b[A-Z0-9]{2}\d{9}[A-Z]?\b/, type: "bank_account", message: "Possible bank account or routing number detected." },
];

const PII_PATTERNS = [
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, type: "email", replacement: "[EMAIL_REDACTED]", restorable: true },
  { pattern: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, type: "phone", replacement: "[PHONE_REDACTED]", restorable: false },
  { pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g, type: "ssn", replacement: "[SSN_REDACTED]", restorable: false },
  { pattern: /\$\s*[\d,]+\.?\d{0,2}/g, type: "financial", replacement: "[FINANCIAL_REDACTED]", restorable: true },
];

const PROVIDER_REDACTION_PATTERNS = [
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, type: "email", label: "STUDENT_EMAIL", restorable: true },
  { pattern: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, type: "phone", label: "PHONE", restorable: false },
  { pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g, type: "ssn", label: "SSN", restorable: false },
  { pattern: /\$\s*[\d,]+\.?\d{0,2}/g, type: "financial", label: "ANNUAL_INCOME", restorable: false },
  { pattern: /\b\d{1,6}\s+[A-Z][A-Za-z0-9.'-]*(?:\s+[A-Z][A-Za-z0-9.'-]*){0,4}\s+(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Lane|Ln\.?|Drive|Dr\.?|Court|Ct\.?)\b/g, type: "street_address", label: "STREET_ADDRESS", restorable: false },
  { pattern: /\b(?:student\s*id|id)\s*(?:is|:|=)?\s*[A-Z]-?\d{3,}\b/gi, type: "student_id", label: "STUDENT_ID", restorable: false },
  { pattern: /\b[A-Z][a-z]+ [A-Z][a-z]+\s+from\b/g, type: "student_name_context", label: "STUDENT_NAME", restorable: true, trimSuffix: /\s+from$/i },
  { pattern: /\bfrom\s+[A-Z][A-Za-z0-9.'-]*(?:\s+[A-Z][A-Za-z0-9.'-]*){0,3}\s+(?:High|School|Academy|Preparatory|Prep)\b/g, type: "school_context", label: "CURRENT_SCHOOL", restorable: true, trimPrefix: /^from\s+/i },
];

const INAPPROPRIATE_PATTERNS = [
  /\b(hack|cheat|plagiari[sz]e|fake|forge|fabricat)\b.*\b(essay|application|transcript|grade|score|letter)/i,
  /\b(buy|purchase|pay\s+for)\b.*\b(essay|admission|acceptance|grade)/i,
  /\b(impersonat|pretend\s+to\s+be|pose\s+as)\b/i,
];

const OFF_TOPIC_PATTERNS = [
  /\b(tell\s+me\s+a\s+joke|sing\s+a\s+song|write\s+a\s+poem)\b/i,
  /\b(what\s+is\s+the\s+meaning\s+of\s+life)\b/i,
  /\b(play\s+a\s+game|let'?s\s+play)\b/i,
];

// ─── Screen input before processing ───
export function screenInput(text, options = {}) {
  const results = [];

  if (!text || typeof text !== "string") {
    return { category: CATEGORIES.SAFE, results: [], redactedText: text || "", text: text || "", redacted: false, blocked: false };
  }

  // 1. Credential detection (highest priority, blocks immediately)
  for (const { pattern, type, message } of CREDENTIAL_PATTERNS) {
    if (pattern.test(text)) {
      results.push({
        category: CATEGORIES.CREDENTIAL,
        type,
        message,
        blocked: true,
      });
    }
  }

  if (results.some((r) => r.blocked)) {
    const message = results.find((r) => r.blocked).message;
    return {
      category: CATEGORIES.CREDENTIAL,
      results,
      blocked: true,
      message,
      reason: message,
      redactedText: text,
      text,
      redacted: false,
    };
  }

  // 2. Inappropriate content
  for (const pattern of INAPPROPRIATE_PATTERNS) {
    if (pattern.test(text)) {
      results.push({
        category: CATEGORIES.INAPPROPRIATE,
        blocked: true,
        message: "This request involves academic dishonesty or fraudulent activity, which this system cannot assist with.",
      });
    }
  }

  if (results.some((r) => r.blocked)) {
    const message = results.find((r) => r.blocked).message;
    return {
      category: CATEGORIES.INAPPROPRIATE,
      results,
      blocked: true,
      message,
      reason: message,
      redactedText: text,
      text,
      redacted: false,
    };
  }

  // 3. Off-topic (soft block — redirect, don't hard block)
  for (const pattern of OFF_TOPIC_PATTERNS) {
    if (pattern.test(text)) {
      results.push({
        category: CATEGORIES.OFF_TOPIC,
        blocked: false,
        message: "I'm focused on college planning and admissions. How can I help with your college journey?",
      });
    }
  }

  // 4. PII detection and redaction
  let redactedText = text;
  const piiFound = [];
  for (const { pattern, type, replacement, restorable } of PII_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      for (const match of matches) {
        const token = `${replacement.slice(0, -1)}_${crypto.randomUUID().slice(0, 8)}]`;
        redactedText = redactedText.replace(match, token);
        piiFound.push({ type, original: restorable ? match : null, token, restorable });
      }
    }
  }

  if (piiFound.length > 0) {
    results.push({
      category: CATEGORIES.PII_DETECTED,
      blocked: false,
      piiItems: piiFound,
      message: `${piiFound.length} PII item(s) detected and redacted before processing.`,
    });
  }

  const category = results.length > 0
    ? results[0].category
    : CATEGORIES.SAFE;

  return {
    category,
    results,
    blocked: false,
    redactedText,
    text: redactedText,
    redacted: piiFound.length > 0,
    piiTokenMap: piiFound.filter((p) => p.restorable).reduce((map, p) => {
      map[p.token] = p.original;
      return map;
    }, {}),
  };
}

// ─── Screen output before returning to user ───
export function screenOutput(text, options = {}) {
  if (!text || typeof text !== "string") return { safe: true, text: text || "" };

  const issues = [];

  // Check for leaked PII in model output
  for (const { pattern, type } of PII_PATTERNS) {
    if (type === "ssn" && pattern.test(text)) {
      issues.push({ type: "ssn_leak", message: "SSN detected in model output — redacting." });
      text = text.replace(pattern, "[REDACTED]");
    }
  }

  // Check for credential patterns in output
  for (const { pattern, type } of CREDENTIAL_PATTERNS) {
    if (pattern.test(text)) {
      issues.push({ type: `${type}_leak`, message: `${type} detected in model output — redacting.` });
      text = text.replace(pattern, "[REDACTED]");
    }
  }

  return {
    safe: issues.length === 0,
    text,
    issues,
    modified: issues.length > 0,
  };
}

// ─── Restore redacted PII in response (for restorable items only) ───
export function restorePII(text, tokenMap) {
  if (!text || !tokenMap || Object.keys(tokenMap).length === 0) return text;

  let restored = text;
  for (const [token, original] of Object.entries(tokenMap)) {
    if (original) {
      restored = restored.replaceAll(token, original);
    }
  }
  return restored;
}

// ─── Redact document before inference (when full context is unnecessary) ───
export function redactDocumentForInference(content, docClassification) {
  if (!content) return { redacted: "", piiRemoved: 0 };

  let redacted = content;
  let piiRemoved = 0;

  // Always redact SSN, phone, and addresses
  for (const { pattern, type, replacement } of PII_PATTERNS) {
    const matches = redacted.match(pattern);
    if (matches) {
      piiRemoved += matches.length;
      redacted = redacted.replace(pattern, replacement);
    }
  }

  // For sensitive financial documents, also redact dollar amounts if we only need structure
  if (docClassification === "SENSITIVE_FINANCIAL") {
    // Keep structure but redact specific values
    redacted = redacted.replace(/\$[\d,]+\.?\d{0,2}/g, "$[AMOUNT]");
  }

  return { redacted, piiRemoved };
}

function makeProviderRedactionState() {
  return {
    counters: {},
    tokenMap: {},
    countsByType: {},
    restorableCount: 0,
    nonRestorableCount: 0,
    applied: false,
  };
}

function nextProviderToken(state, label) {
  state.counters[label] = (state.counters[label] || 0) + 1;
  return `[${label}_${String(state.counters[label]).padStart(2, "0")}]`;
}

function redactProviderString(value, state) {
  if (typeof value !== "string" || value.length === 0) return value;
  let out = value;
  for (const rule of PROVIDER_REDACTION_PATTERNS) {
    out = out.replace(rule.pattern, (match) => {
      const original = match.replace(rule.trimPrefix || /^$/, "").replace(rule.trimSuffix || /^$/, "");
      const prefix = rule.trimPrefix ? match.match(rule.trimPrefix)?.[0] || "" : "";
      const suffix = rule.trimSuffix ? match.match(rule.trimSuffix)?.[0] || "" : "";
      const token = nextProviderToken(state, rule.label);
      state.applied = true;
      state.countsByType[rule.type] = (state.countsByType[rule.type] || 0) + 1;
      if (rule.restorable) {
        state.tokenMap[token] = original;
        state.restorableCount += 1;
      } else {
        state.nonRestorableCount += 1;
      }
      return `${prefix}${token}${suffix}`;
    });
  }
  return out;
}

function sanitizeDeep(value, state) {
  if (typeof value === "string") return redactProviderString(value, state);
  if (Array.isArray(value)) return value.map((item) => sanitizeDeep(item, state));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sanitizeDeep(child, state)]));
  }
  return value;
}

export function stripStructuredFinancialPII(payload) {
  const cloned = JSON.parse(JSON.stringify(payload ?? {}));
  const profile = cloned?.metadata?.fafsaProfile;
  if (!profile || typeof profile !== "object") {
    return { payload: cloned, structuredSanitization: { applied: false, strippedFieldCount: 0 } };
  }
  const sensitiveFields = [
    "parentAdjustedGrossIncome",
    "parentIncome",
    "studentIncome",
    "parentAssets",
    "studentAssets",
    "cashSavingsChecking",
    "taxableIncome",
  ];
  let strippedFieldCount = 0;
  for (const field of sensitiveFields) {
    if (profile[field] !== undefined) {
      delete profile[field];
      strippedFieldCount += 1;
    }
  }
  if (strippedFieldCount > 0) {
    profile.rawTaxDataStripped = true;
    profile.strippedFieldCount = strippedFieldCount;
    if (Number(profile.studentAidIndex) <= -1500) {
      profile.financialNeedCategory = "maximum_need";
    } else if (Number.isFinite(Number(profile.studentAidIndex))) {
      profile.financialNeedCategory = "estimated_need";
    }
  }
  return {
    payload: cloned,
    structuredSanitization: { applied: strippedFieldCount > 0, strippedFieldCount },
  };
}

export function sanitizeProviderPayload(payload, options = {}) {
  const structured = stripStructuredFinancialPII(payload);
  const state = makeProviderRedactionState();
  const sanitizedPayload = sanitizeDeep(structured.payload, state);
  const redactionReport = {
    applied: state.applied || structured.structuredSanitization.applied,
    byType: state.countsByType,
    restorableTokens: state.restorableCount,
    nonRestorableTokens: state.nonRestorableCount,
    structuredSanitization: structured.structuredSanitization,
    boundary: options.boundary || "provider",
  };
  return {
    sanitizedPayload,
    payload: sanitizedPayload,
    tokenMap: state.tokenMap,
    redactionReport,
    masking: {
      applied: redactionReport.applied,
      byLayer: {
        deterministic: Object.values(state.countsByType).reduce((sum, count) => sum + count, 0),
        guardian_slm: (state.countsByType.student_name_context || 0) + (state.countsByType.school_context || 0),
      },
      restorableTokens: state.restorableCount,
    },
    structuredSanitization: structured.structuredSanitization,
  };
}

// Need crypto for PII token generation
import crypto from "node:crypto";

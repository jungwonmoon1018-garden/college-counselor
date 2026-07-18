import crypto from "node:crypto";

// Consent is explicit and operation-scoped. Student accounts always use the
// stricter minor-safe defaults; callers cannot downgrade that policy.
export const CONSENT_TYPES = Object.freeze({
  DATA_PROCESSING: "data_processing",
  AI_INTERACTION: "ai_interaction",
  SESSION_PERSISTENCE: "session_persistence",
  FAFSA_CONTRIBUTOR: "fafsa_contributor",
  INSTITUTIONAL_SHARING: "institutional_sharing",
  CROSS_BORDER_TRANSFER: "cross_border_transfer",
  CHAT_TRANSCRIPT_GRAPHING: "chat_transcript_graphing",
});

const VALID_CONSENT_TYPES = new Set(Object.values(CONSENT_TYPES));
const VALID_GRANTORS = new Set(["student", "parent_guardian"]);

export function isValidConsentType(consentType) {
  return VALID_CONSENT_TYPES.has(consentType);
}

export function grantConsent(stmts, studentId, consentType, options = {}) {
  if (!isValidConsentType(consentType)) throw new Error("Unsupported consent type.");
  const grantedBy = options.grantedBy || "student";
  if (!VALID_GRANTORS.has(grantedBy)) throw new Error("Unsupported consent grantor.");

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const expiresAt = options.expiresAt || null;
  const scope = options.scope || null;
  stmts.insertConsent.run(id, studentId, consentType, now, grantedBy, expiresAt, scope);
  return { id, studentId, consentType, grantedAt: now, grantedBy, expiresAt, scope };
}

export function revokeConsent(stmts, consentId, revokedBy = "student") {
  if (!VALID_GRANTORS.has(revokedBy)) throw new Error("Unsupported consent revoker.");
  stmts.revokeConsent.run(revokedBy, consentId);
  return { id: consentId, revoked: true, revokedBy };
}

export function hasActiveConsent(stmts, studentId, consentType) {
  if (!isValidConsentType(consentType)) return { hasConsent: false, record: null };
  const record = stmts.getActiveConsent.get(studentId, consentType);
  return { hasConsent: !!record, record: record || null };
}

export function getConsentHistory(stmts, studentId) {
  return stmts.getAllConsent.all(studentId);
}

export function validateRequiredConsents(stmts, studentId, operation, _isMinor = true) {
  const requiredConsents = getRequiredConsentsForOperation(operation);
  const results = requiredConsents.map((consentType) => {
    const { hasConsent, record } = hasActiveConsent(stmts, studentId, consentType);
    return { consentType, required: true, granted: hasConsent, record };
  });
  const missing = results.filter((result) => !result.granted).map((result) => result.consentType);
  return {
    allowed: missing.length === 0,
    results,
    missing,
    message: missing.length === 0
      ? "All required consents are active."
      : `Missing consent(s): ${missing.join(", ")}.`,
  };
}

function getRequiredConsentsForOperation(operation) {
  const base = [CONSENT_TYPES.DATA_PROCESSING];
  switch (operation) {
    case "ai_interaction":
    case "cross_border":
    case "strategy_council":
      return [...base, CONSENT_TYPES.AI_INTERACTION, CONSENT_TYPES.CROSS_BORDER_TRANSFER];
    case "fafsa_workflow":
      return [...base, CONSENT_TYPES.FAFSA_CONTRIBUTOR];
    case "session_persistence":
      return [...base, CONSENT_TYPES.SESSION_PERSISTENCE];
    case "institutional_sharing":
      return [...base, CONSENT_TYPES.INSTITUTIONAL_SHARING];
    case "chat_transcript_graphing":
      return [...base, CONSENT_TYPES.CHAT_TRANSCRIPT_GRAPHING];
    default:
      return base;
  }
}

const COPY = {
  en: {
    dataLabel: "Data processing consent",
    dataDescription: "I consent to storing the information I enter for local college-counseling features.",
    aiLabel: "External AI processing consent",
    aiDescription: "I understand that redacted chat content is sent to OpenRouter when I use AI advice.",
    transferLabel: "Cross-border transfer consent",
    transferDescription: "I understand that OpenRouter may process redacted content in another country.",
  },
  ko: {
    dataLabel: "데이터 처리 동의",
    dataDescription: "입력한 정보를 로컬 대학 상담 기능을 위해 저장하는 데 동의합니다.",
    aiLabel: "외부 AI 처리 동의",
    aiDescription: "AI 상담을 사용할 때 비식별 처리된 대화 내용이 OpenRouter로 전송됨을 이해합니다.",
    transferLabel: "국외 이전 동의",
    transferDescription: "OpenRouter가 비식별 처리된 내용을 다른 국가에서 처리할 수 있음을 이해합니다.",
  },
};

export function getOnboardingConsentRequirements(_isMinor = true, locale = "en") {
  const copy = locale.toLowerCase().startsWith("ko") ? COPY.ko : COPY.en;
  return [
    {
      consentType: CONSENT_TYPES.DATA_PROCESSING,
      required: true,
      label: copy.dataLabel,
      description: copy.dataDescription,
    },
    {
      consentType: CONSENT_TYPES.AI_INTERACTION,
      required: true,
      label: copy.aiLabel,
      description: copy.aiDescription,
    },
    {
      consentType: CONSENT_TYPES.CROSS_BORDER_TRANSFER,
      required: true,
      label: copy.transferLabel,
      description: copy.transferDescription,
    },
  ];
}

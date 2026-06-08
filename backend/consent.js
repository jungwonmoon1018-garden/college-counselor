// ═══════════════════════════════════════════════════════════════════════
// CONSENT — Consent management for minors and contributors
// ═══════════════════════════════════════════════════════════════════════
// Manages consent records for:
//   - Data processing (required for minors under COPPA/Korea PIPA)
//   - Parental consent for AI features
//   - FAFSA contributor consent
//   - Session persistence opt-in
//   - Data sharing with institutions (FERPA school-integrated mode)
// ═══════════════════════════════════════════════════════════════════════

import crypto from "node:crypto";

// ─── Consent types ───
export const CONSENT_TYPES = {
  DATA_PROCESSING: "data_processing",           // Basic data processing consent
  AI_INTERACTION: "ai_interaction",              // Consent to interact with AI system
  PARENTAL_NOTIFICATION: "parental_notification", // Consent for crisis notifications
  SESSION_PERSISTENCE: "session_persistence",     // Opt-in to persistent sessions (off by default for minors)
  FAFSA_CONTRIBUTOR: "fafsa_contributor",         // FAFSA contributor workflow consent
  INSTITUTIONAL_SHARING: "institutional_sharing", // Sharing data with a school (FERPA)
  CROSS_BORDER_TRANSFER: "cross_border_transfer", // Korea PIPA: data sent to US servers
  BYOK_PARENT_PROVIDED: "byok_parent_provided",   // Parent-provided API key for minor
};

// ─── Grant consent ───
export function grantConsent(stmts, studentId, consentType, options = {}) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const expiresAt = options.expiresAt || null;
  const grantedBy = options.grantedBy || "student";
  const scope = options.scope || null;

  stmts.insertConsent.run(
    id, studentId, consentType, now, grantedBy, expiresAt, scope
  );

  return {
    id,
    studentId,
    consentType,
    grantedAt: now,
    grantedBy,
    expiresAt,
    scope,
  };
}

// ─── Revoke consent ───
export function revokeConsent(stmts, consentId, revokedBy = "student") {
  stmts.revokeConsent.run(revokedBy, consentId);
  return { id: consentId, revoked: true, revokedBy };
}

// ─── Check if a specific consent is active ───
export function hasActiveConsent(stmts, studentId, consentType) {
  const record = stmts.getActiveConsent.get(studentId, consentType);
  return {
    hasConsent: !!record,
    record: record || null,
  };
}

// ─── Get all consent records for a student ───
export function getConsentHistory(stmts, studentId) {
  return stmts.getAllConsent.all(studentId);
}

// ─── Validate required consents for an operation ───
export function validateRequiredConsents(stmts, studentId, operation, isMinor = true) {
  const requiredConsents = getRequiredConsentsForOperation(operation, isMinor);

  const results = requiredConsents.map((ct) => {
    const { hasConsent, record } = hasActiveConsent(stmts, studentId, ct);
    return {
      consentType: ct,
      required: true,
      granted: hasConsent,
      record,
    };
  });

  const allGranted = results.every((r) => r.granted);
  const missing = results.filter((r) => !r.granted).map((r) => r.consentType);

  return {
    allowed: allGranted,
    results,
    missing,
    message: allGranted
      ? "All required consents are active."
      : `Missing consent(s): ${missing.join(", ")}. Please grant required consents before proceeding.`,
  };
}

// ─── Determine required consents per operation ───
function getRequiredConsentsForOperation(operation, isMinor) {
  const base = [CONSENT_TYPES.DATA_PROCESSING, CONSENT_TYPES.AI_INTERACTION];

  switch (operation) {
    case "fafsa_workflow":
      return [...base, CONSENT_TYPES.FAFSA_CONTRIBUTOR];
    case "session_persistence":
      return isMinor ? [...base, CONSENT_TYPES.SESSION_PERSISTENCE] : base;
    case "institutional_sharing":
      return [...base, CONSENT_TYPES.INSTITUTIONAL_SHARING];
    case "byok":
      return isMinor ? [...base, CONSENT_TYPES.BYOK_PARENT_PROVIDED] : base;
    case "cross_border":
      return [...base, CONSENT_TYPES.CROSS_BORDER_TRANSFER];
    default:
      return base;
  }
}

// ─── Build consent requirements disclosure for onboarding ───
export function getOnboardingConsentRequirements(isMinor = true, locale = "en-US") {
  const requirements = [
    {
      consentType: CONSENT_TYPES.DATA_PROCESSING,
      required: true,
      label: locale === "ko" ? "데이터 처리 동의" : "Data Processing Consent",
      description: locale === "ko"
        ? "대학 상담 서비스 제공을 위한 개인정보 처리에 동의합니다."
        : "I consent to the processing of my personal data for college counseling services.",
    },
    {
      consentType: CONSENT_TYPES.AI_INTERACTION,
      required: true,
      label: locale === "ko" ? "AI 상호작용 동의" : "AI Interaction Consent",
      description: locale === "ko"
        ? "이 시스템이 AI를 사용하여 안내를 제공한다는 것을 이해합니다. AI 생성 콘텐츠는 명확히 표시됩니다."
        : "I understand this system uses AI to provide guidance. AI-generated content is clearly labeled.",
    },
    {
      consentType: CONSENT_TYPES.CROSS_BORDER_TRANSFER,
      required: true,
      label: locale === "ko" ? "국외 데이터 전송 동의" : "Cross-Border Data Transfer Consent",
      description: locale === "ko"
        ? "데이터가 미국 소재 서버(Anthropic)로 전송될 수 있음을 이해하고 동의합니다."
        : "I understand that data may be transferred to servers in the United States (Anthropic) for AI processing.",
    },
  ];

  if (isMinor) {
    requirements.push({
      consentType: CONSENT_TYPES.PARENTAL_NOTIFICATION,
      required: false,
      label: locale === "ko" ? "보호자 알림 동의" : "Parental Notification Consent",
      description: locale === "ko"
        ? "위기 상황 시 보호자에게 안전 알림을 보내는 것에 동의합니다 (선택사항)."
        : "I consent to safety notifications being sent to my parent/guardian in case of crisis (optional).",
    });
  }

  return requirements;
}

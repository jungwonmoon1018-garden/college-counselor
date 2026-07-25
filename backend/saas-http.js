import crypto from "node:crypto";
import { grantConsent, revokeConsent } from "./consent.js";
import { normalizeEmail } from "./security-auth.js";
import {
  deleteAllStudentPII,
  hashEmail as hashPIIEmail,
  retrieveStudentPII,
  storeStudentPII,
} from "./pii-vault.js";
import { SaasTenancyError } from "./saas-tenancy.js";

const COOKIE_NAME = "cc_saas_session";
const MANAGER_ROLES = new Set(["owner", "org_admin"]);
const LOCAL_ORIGIN_RE = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/iu;

function freezeConsentDescriptor(descriptor) {
  return Object.freeze({
    ...descriptor,
    dataCategories: Object.freeze([...descriptor.dataCategories]),
    recipients: Object.freeze([...descriptor.recipients]),
    rights: Object.freeze([...descriptor.rights]),
  });
}

export const DEFAULT_SAAS_CONSENT_DESCRIPTORS = Object.freeze({
  data_processing: freezeConsentDescriptor({
    label: "Data processing consent",
    purpose: "Create and operate the student's private college-counseling workspace and provide organization-authorized support.",
    dataCategories: ["Student profile and grade", "Course and activity planning", "Counseling messages and saved work"],
    recipients: ["The student's school or counseling organization", "Service providers acting for the organization"],
    internationalTransfers: "This consent does not itself authorize international AI processing; that requires the separate cross-border transfer consent.",
    retention: "Until account deletion or the organization's documented retention period ends, subject to legal preservation duties.",
    rights: ["Access", "Correction", "Deletion", "Export", "Withdraw consent"],
    policyUrl: "/organization.html",
  }),
  ai_interaction: freezeConsentDescriptor({
    label: "AI interaction consent",
    purpose: "Generate college-counseling guidance from the minimum redacted context needed for the student's request.",
    dataCategories: ["Redacted counseling prompts", "Redacted academic and activity context", "AI responses"],
    recipients: ["The student's school or counseling organization", "Configured AI processors, including OpenRouter and the selected model provider"],
    internationalTransfers: "International processing is used only when the separate cross-border transfer consent is also active.",
    retention: "Application records follow the organization's retention period; processor retention follows the organization's configured provider agreement.",
    rights: ["Choose whether to use AI features", "Access", "Correction", "Deletion", "Withdraw consent"],
    policyUrl: "/organization.html",
  }),
  cross_border_transfer: freezeConsentDescriptor({
    label: "Cross-border transfer consent",
    purpose: "Permit redacted AI request data to be processed in countries where configured AI subprocessors operate.",
    dataCategories: ["Redacted counseling prompts", "Redacted academic and activity context", "Technical request metadata"],
    recipients: ["Configured AI processors, including OpenRouter", "The selected model provider and its approved subprocessors"],
    internationalTransfers: "Redacted data may be processed outside the student's country under the organization's provider safeguards.",
    retention: "Application records follow the organization's retention period; processor retention follows the organization's configured provider agreement.",
    rights: ["Request transfer information", "Access", "Deletion", "Withdraw consent"],
    policyUrl: "/organization.html",
  }),
});

function consentDescriptorMap(requiredConsents, configured) {
  const entries = requiredConsents.map((consentType) => {
    const descriptor = configured?.[consentType];
    const textFields = ["label", "purpose", "internationalTransfers", "retention", "policyUrl"];
    const listFields = ["dataCategories", "recipients", "rights"];
    if (
      !descriptor
      || textFields.some((field) => typeof descriptor[field] !== "string" || !descriptor[field].trim())
      || listFields.some((field) => (
        !Array.isArray(descriptor[field])
        || descriptor[field].length === 0
        || descriptor[field].some((item) => typeof item !== "string" || !item.trim())
      ))
    ) {
      throw new Error(`Consent descriptor ${consentType} is incomplete.`);
    }
    return [consentType, freezeConsentDescriptor({
      label: descriptor.label.trim(),
      purpose: descriptor.purpose.trim(),
      dataCategories: descriptor.dataCategories.map((item) => item.trim()),
      recipients: descriptor.recipients.map((item) => item.trim()),
      internationalTransfers: descriptor.internationalTransfers.trim(),
      retention: descriptor.retention.trim(),
      rights: descriptor.rights.map((item) => item.trim()),
      policyUrl: descriptor.policyUrl.trim(),
    })];
  });
  return Object.freeze(Object.fromEntries(entries));
}

function parseConsentScope(value) {
  try { return typeof value === "string" ? JSON.parse(value) : value; }
  catch { return null; }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]),
    );
  }
  return value;
}

function sameJson(left, right) {
  try { return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right)); }
  catch { return false; }
}

function legacyConsentActive(record, now = Date.now()) {
  if (!record || record.revoked_at) return false;
  if (!record.expires_at) return true;
  const expiry = Date.parse(record.expires_at);
  return Number.isFinite(expiry) && expiry > now;
}

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      try { return decodeURIComponent(part.slice(separator + 1).trim()); }
      catch { return ""; }
    }
  }
  return "";
}

function roleFor(roles = []) {
  return ["owner", "org_admin", "counselor", "guardian", "student"]
    .find((role) => roles.includes(role)) || "member";
}

function validEmail(value) {
  const email = normalizeEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ? email : "";
}

function legacyStudentIdentity(email, organizationId, studentId) {
  return JSON.stringify([
    "saas-student-v1",
    String(organizationId || ""),
    String(studentId || ""),
    normalizeEmail(email),
  ]);
}

function timingSafeSecret(expected, supplied) {
  if (typeof expected !== "string" || !expected || typeof supplied !== "string" || !supplied) {
    return false;
  }
  const left = crypto.createHash("sha256").update(String(expected || "")).digest();
  const right = crypto.createHash("sha256").update(String(supplied || "")).digest();
  return crypto.timingSafeEqual(left, right);
}

function passwordResetFailureCode(error) {
  return String(error?.code || "unknown_failure")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/gu, "")
    .slice(0, 64) || "unknown_failure";
}

function jsonError(res, error) {
  if (error instanceof SaasTenancyError) {
    return res.status(error.status || 400).json({ error: error.message, code: error.code });
  }
  if (error?.code === "email_delivery_failed" || error?.code === "email_not_configured") {
    return res.status(502).json({ error: "Invitation delivery failed. No usable invitation remains.", code: error.code });
  }
  console.error("[SAAS] Request failed:", error?.message || error);
  return res.status(500).json({ error: "The organization service could not complete the request.", code: "saas_internal_error" });
}

export function createSaasHttp({
  tenancy,
  mailer,
  authStore,
  db,
  piiStmts,
  piiVault,
  ragStmts,
  legacyEmailHash,
  publicOrigin,
  provisioningToken,
  nodeEnv = "development",
  guardianConsentRequired = true,
  policyVersion = "2026.1",
  requiredConsents = Object.keys(DEFAULT_SAAS_CONSENT_DESCRIPTORS),
  consentDescriptors = DEFAULT_SAAS_CONSENT_DESCRIPTORS,
  invitationTtlMs = 72 * 60 * 60 * 1000,
  passwordResetTtlMs = 30 * 60 * 1000,
  passwordResetCooldownMs = 60 * 1000,
  sessionIdleTtlMs = 15 * 60 * 1000,
  sessionAbsoluteTtlMs = 7 * 24 * 60 * 60 * 1000,
  kdfGlobalMaxAttempts = 24,
  kdfGlobalWindowMs = 60 * 1000,
} = {}) {
  if (!tenancy) throw new Error("A SaaS tenancy store is required.");
  if (!Number.isSafeInteger(kdfGlobalMaxAttempts) || kdfGlobalMaxAttempts < 1) {
    throw new Error("kdfGlobalMaxAttempts must be a positive integer.");
  }
  if (!Number.isSafeInteger(kdfGlobalWindowMs) || kdfGlobalWindowMs < 1) {
    throw new Error("kdfGlobalWindowMs must be a positive integer.");
  }
  const descriptors = consentDescriptorMap(requiredConsents, consentDescriptors);
  if (guardianConsentRequired && requiredConsents.length > 0 && (
    !piiStmts?.insertConsent?.run
    || !piiStmts?.getAllConsent?.all
    || !piiStmts?.revokeConsent?.run
  )) {
    throw new Error("Guardian consent requires legacy PII-vault consent statements.");
  }

  function consentScopeSnapshot(consentType, studentId) {
    const descriptor = descriptors[consentType];
    return {
      studentId,
      consentType,
      policyVersion,
      purpose: descriptor.purpose,
      dataCategories: [...descriptor.dataCategories],
      recipients: [...descriptor.recipients],
      internationalTransfers: descriptor.internationalTransfers,
      retention: descriptor.retention,
      rights: [...descriptor.rights],
      policyUrl: descriptor.policyUrl,
    };
  }

  function legacyRecordsForGrant(studentId, consentType, saasConsentId, { activeOnly = false } = {}) {
    return piiStmts.getAllConsent.all(studentId).filter((record) => {
      if (record.consent_type !== consentType || (activeOnly && !legacyConsentActive(record))) return false;
      return parseConsentScope(record.scope)?.saasConsentId === saasConsentId;
    });
  }

  function ensureLegacyGuardianConsent({ studentId, consentType, consent, actorAccountId, snapshot }) {
    const expectedScope = {
      source: "saas_guardian_portal",
      guardianActorAccountId: actorAccountId,
      saasConsentId: consent.id,
      policySnapshot: snapshot,
    };
    const current = legacyRecordsForGrant(studentId, consentType, consent.id, { activeOnly: true });
    const exact = current.find((record) => {
      const scope = parseConsentScope(record.scope);
      return JSON.stringify(scope) === JSON.stringify(expectedScope);
    });
    if (exact) return exact;
    current.forEach((record) => revokeConsent(piiStmts, record.id, "parent_guardian"));
    return grantConsent(piiStmts, studentId, consentType, {
      grantedBy: "parent_guardian",
      expiresAt: consent.expiresAt ? new Date(consent.expiresAt).toISOString() : null,
      scope: JSON.stringify(expectedScope),
    });
  }

  function currentGuardianConsent(input) {
    const entry = tenancy.listGuardianStudents({
      organizationId: input.organizationId,
      actorAccountId: input.actorAccountId,
    }).find((item) => item.student.id === input.studentId);
    if (!entry) return null;
    const state = tenancy.getGuardianConsentStatus(input);
    return state.consents.find((consent) => consent.guardianLinkId === entry.link.id) || null;
  }

  function revokeLegacyGuardianConsent(studentId, consentType, saasConsentId) {
    legacyRecordsForGrant(studentId, consentType, saasConsentId, { activeOnly: true })
      .forEach((record) => revokeConsent(piiStmts, record.id, "parent_guardian"));
  }

  function cookieHeader(req, token, maxAgeSeconds) {
    const secure = nodeEnv === "production" || req.secure ? "; Secure" : "";
    return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${maxAgeSeconds}; Priority=High${secure}`;
  }

  function setSessionCookie(req, res, token) {
    res.setHeader("Set-Cookie", cookieHeader(req, token, Math.floor(sessionAbsoluteTtlMs / 1000)));
    res.setHeader("Cache-Control", "no-store");
  }

  function clearSessionCookie(req, res) {
    res.setHeader("Set-Cookie", cookieHeader(req, "", 0));
    res.setHeader("Cache-Control", "no-store");
  }

  let kdfWindowStartedAt = Date.now();
  let kdfAttempts = 0;
  function requireKdfAdmission(_req, res, next) {
    const now = Date.now();
    if (now - kdfWindowStartedAt >= kdfGlobalWindowMs) {
      kdfWindowStartedAt = now;
      kdfAttempts = 0;
    }
    if (kdfAttempts >= kdfGlobalMaxAttempts) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((kdfGlobalWindowMs - (now - kdfWindowStartedAt)) / 1000),
      );
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.setHeader("Cache-Control", "no-store");
      return res.status(429).json({
        error: "Authentication is temporarily unavailable. Try again later.",
        code: "authentication_rate_limited",
      });
    }
    kdfAttempts += 1;
    next();
  }

  function trustedBrowserOrigin(req) {
    const origin = String(req.headers.origin || "");
    if (nodeEnv !== "production") return !origin || origin === publicOrigin || LOCAL_ORIGIN_RE.test(origin);
    return Boolean(origin && origin === publicOrigin);
  }

  function requireBrowserOrigin(req, res, next) {
    if (!trustedBrowserOrigin(req)) {
      return res.status(403).json({ error: "Request origin is not allowed.", code: "origin_forbidden" });
    }
    next();
  }

  function requireExactBrowserOrigin(req, res, next) {
    if (!publicOrigin || String(req.headers.origin || "") !== publicOrigin) {
      return res.status(403).json({ error: "Request origin is not allowed.", code: "origin_forbidden" });
    }
    next();
  }

  function profileComplete(studentId) {
    const snapshot = ragStmts.getLatestSnapshot.get(studentId);
    if (!snapshot) return false;
    const count = (raw) => {
      try { return Array.isArray(JSON.parse(raw || "[]")) ? JSON.parse(raw || "[]").length : 0; }
      catch { return 0; }
    };
    return count(snapshot.courses_json) > 0 || count(snapshot.activities_json) > 0;
  }

  function consentState({ organizationId, accountId, studentId }) {
    if (!guardianConsentRequired) return { granted: true, requiredConsents: [] };
    const states = requiredConsents.map((consentType) => {
      const status = tenancy.getGuardianConsentStatus({
        organizationId,
        studentId,
        actorAccountId: accountId,
        consentType,
        policyVersion,
      });
      return { consentType, policyVersion, granted: status.granted === true };
    });
    return { granted: states.every((item) => item.granted), requiredConsents: states };
  }

  function safeStudentPayload(context) {
    const student = context.student;
    const pii = student?.id ? retrieveStudentPII(piiStmts, piiVault, student.id) : null;
    return {
      id: student?.id || "",
      name: pii?.name || student?.displayName || context.account?.displayName || "Student",
      email: pii?.email || context.account?.email || "",
      grade: student?.grade || authStore.getStudentGrade(student?.id),
    };
  }

  function sessionPayload(context, csrfToken, { includeStudent = false } = {}) {
    const roles = context.membership?.roles || context.roles || [];
    const payload = {
      authenticated: true,
      sessionMode: "cookie",
      csrfToken,
      member: {
        id: context.membership?.id || "",
        name: context.account?.displayName || context.student?.displayName || "Organization member",
        email: context.account?.email || "",
        role: roleFor(roles),
        status: context.membership?.status || "active",
      },
      organization: context.organization,
    };
    if (includeStudent) {
      const consent = consentState({
        organizationId: context.organization.id,
        accountId: context.account.id,
        studentId: context.student.id,
      });
      payload.student = safeStudentPayload(context);
      payload.studentId = context.student.id;
      payload.membershipStatus = consent.granted ? "active" : "pending_guardian";
      payload.requiredConsents = consent.requiredConsents;
      payload.profileComplete = profileComplete(context.student.id);
    }
    return payload;
  }

  function validatedContext(req, { requireCsrf = false } = {}) {
    const sessionToken = readCookie(req, COOKIE_NAME);
    const session = tenancy.validateSession({
      sessionToken,
      csrfToken: req.headers["x-csrf-token"],
      requireCsrf,
    });
    if (!session) return null;
    const context = tenancy.getAccountContext({
      organizationId: session.organizationId,
      accountId: session.accountId,
    });
    return { sessionToken, session, context };
  }

  function requirePortalSession(req, res, next) {
    const mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    if (mutating && !trustedBrowserOrigin(req)) {
      return res.status(403).json({ error: "Request origin is not allowed.", code: "origin_forbidden" });
    }
    const validated = validatedContext(req, { requireCsrf: mutating });
    if (!validated) return res.status(401).json({ error: "Organization session required.", code: "session_required" });
    req.saas = validated;
    next();
  }

  function requireManager(req, res, next) {
    const roles = req.saas?.context?.membership?.roles || [];
    if (!roles.some((role) => MANAGER_ROLES.has(role))) {
      return res.status(403).json({ error: "Organization manager permission is required.", code: "forbidden" });
    }
    next();
  }

  function requireGuardian(req, res, next) {
    const roles = req.saas?.context?.membership?.roles || [];
    if (!roles.includes("guardian") || roles.some((role) => MANAGER_ROLES.has(role))) {
      return res.status(403).json({ error: "Verified guardian permission is required.", code: "guardian_required" });
    }
    next();
  }

  function requireStudentAuth(req, res, next) {
    const mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    if (mutating && !trustedBrowserOrigin(req)) {
      return res.status(403).json({ error: "Request origin is not allowed.", code: "origin_forbidden" });
    }
    const validated = validatedContext(req, { requireCsrf: mutating });
    const roles = validated?.context?.membership?.roles || [];
    if (
      !validated
      || !roles.includes("student")
      || roles.some((role) => MANAGER_ROLES.has(role))
      || !validated.context.student
    ) {
      return res.status(401).json({ error: "Student session required.", code: "student_session_required" });
    }
    const consent = consentState({
      organizationId: validated.session.organizationId,
      accountId: validated.session.accountId,
      studentId: validated.context.student.id,
    });
    const pendingAllowed = new Set([
      "/api/students/session",
      "/api/students/logout",
      "/api/students/logout-all",
      "/api/students/password",
      "/api/students",
    ]).has(req.path);
    if (!consent.granted && !pendingAllowed) {
      return res.status(403).json({
        error: "Verified guardian consent is required before student tools can be used.",
        code: "guardian_consent_required",
        membershipStatus: "pending_guardian",
      });
    }
    req.saas = validated;
    req.saasConsent = consent;
    req.studentId = validated.context.student.id;
    req.studentEmailHash = legacyEmailHash(validated.context.account.email || "");
    req.organizationId = validated.session.organizationId;
    req.saasAccountId = validated.session.accountId;
    next();
  }

  function issueSession(email, password, organizationId) {
    return tenancy.createSession({
      email,
      password,
      organizationId,
      idleTtlMs: sessionIdleTtlMs,
      absoluteTtlMs: sessionAbsoluteTtlMs,
    });
  }

  function mount(app, { studentLimiter, apiLimiter } = {}) {
    const studentLimit = studentLimiter || ((_req, _res, next) => next());
    const apiLimit = apiLimiter || studentLimit;

    app.post("/api/platform/organizations", apiLimit, (req, res) => {
      const auth = String(req.headers.authorization || "");
      const supplied = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      if (!timingSafeSecret(provisioningToken, supplied)) return res.status(404).json({ error: "Not found." });
      try {
        const created = tenancy.createOrganization({
          name: req.body?.name,
          slug: req.body?.slug,
          ownerEmail: req.body?.ownerEmail,
          ownerPassword: req.body?.ownerPassword,
        });
        return res.status(201).json({ created: true, ...created });
      } catch (error) { return jsonError(res, error); }
    });

    app.post("/api/students/register", studentLimit, requireBrowserOrigin, requireKdfAdmission, (req, res) => {
      const email = validEmail(req.body?.email);
      const grade = Number(req.body?.grade);
      if (!email) return res.status(400).json({ error: "A valid email is required.", code: "invalid_email" });
      if (![9, 10, 11, 12].includes(grade)) return res.status(400).json({ error: "Grade 9-12 is required.", code: "invalid_grade" });
      const invitation = tenancy.inspectInvitation({ token: req.body?.invitationToken });
      if (!invitation || invitation.status !== "pending" || invitation.role !== "student") {
        return res.status(403).json({ error: "A valid student invitation is required.", code: "invalid_invitation" });
      }
      let accepted = null;
      try {
        const operational = db.transaction(() => {
          accepted = tenancy.acceptInvitation({
            token: req.body?.invitationToken,
            email,
            password: req.body?.password,
            displayName: req.body?.name,
            grade,
          });
          const studentId = accepted.student.id;
          const scopedIdentity = legacyStudentIdentity(
            email,
            accepted.membership.organizationId,
            studentId,
          );
          const internalPassword = crypto.randomBytes(32).toString("base64url");
          authStore.createStudentCredential(
            studentId,
            legacyEmailHash(scopedIdentity),
            internalPassword,
            { grade },
          );
          storeStudentPII(piiStmts, piiVault, studentId, {
            name: req.body?.name || "",
            email,
            emailHash: hashPIIEmail(scopedIdentity, piiVault.encryptionKey),
            isMinor: true,
          });
          ragStmts.insertSnapshot.run(
            crypto.randomUUID(), studentId, "initial",
            null, null, "[]", "[]", "[]", "[]",
            req.body?.majorInterest || null, "[]", "saas_registration",
          );
          return accepted;
        });
        operational();
        const issued = issueSession(email, req.body?.password, accepted.membership.organizationId);
        setSessionCookie(req, res, issued.sessionToken);
        const context = tenancy.getAccountContext({
          organizationId: issued.session.organizationId,
          accountId: issued.session.accountId,
        });
        return res.status(201).json({ registered: true, ...sessionPayload(context, issued.csrfToken, { includeStudent: true }) });
      } catch (error) {
        if (accepted?.student?.id) {
          try { deleteAllStudentPII(piiStmts, accepted.student.id); } catch {}
        }
        return jsonError(res, error);
      }
    });

    app.post("/api/students/auth", studentLimit, requireBrowserOrigin, requireKdfAdmission, (req, res) => {
      try {
        const email = validEmail(req.body?.email);
        if (!email) return res.status(401).json({ error: "Invalid email or password.", code: "invalid_credentials" });
        const authenticated = tenancy.authenticateCredentials({ email, password: req.body?.password });
        const studentMemberships = (authenticated?.memberships || []).filter((membership) =>
          membership.status === "active" && membership.roles.includes("student") && membership.organization.status === "active");
        const requestedSlug = String(req.body?.organizationSlug || "").trim().toLowerCase();
        const candidates = requestedSlug
          ? studentMemberships.filter((membership) => membership.organization.slug === requestedSlug)
          : studentMemberships;
        if (candidates.length !== 1) {
          return res.status(candidates.length > 1 ? 409 : 401).json({
            error: candidates.length > 1 ? "Select an organization to continue." : "Invalid email or password.",
            code: candidates.length > 1 ? "organization_required" : "invalid_credentials",
          });
        }
        const issued = issueSession(email, req.body?.password, candidates[0].organization.id);
        setSessionCookie(req, res, issued.sessionToken);
        const context = tenancy.getAccountContext({ organizationId: issued.session.organizationId, accountId: issued.session.accountId });
        return res.json(sessionPayload(context, issued.csrfToken, { includeStudent: true }));
      } catch (error) { return jsonError(res, error); }
    });

    app.get("/api/students/session", studentLimit, requireStudentAuth, (req, res) => {
      const csrfToken = tenancy.rotateSessionCsrf({ sessionToken: req.saas.sessionToken });
      if (!csrfToken) {
        clearSessionCookie(req, res);
        return res.status(401).json({ error: "Organization session required.", code: "session_required" });
      }
      return res.json(sessionPayload(req.saas.context, csrfToken, { includeStudent: true }));
    });

    app.post("/api/students/logout", studentLimit, requireBrowserOrigin, (req, res) => {
      tenancy.revokeSession({ sessionToken: readCookie(req, COOKIE_NAME) });
      clearSessionCookie(req, res);
      return res.json({ loggedOut: true });
    });

    app.post("/api/students/logout-all", studentLimit, requireBrowserOrigin, requireStudentAuth, (req, res) => {
      tenancy.invalidateAccountSessions({ accountId: req.saasAccountId, actorAccountId: req.saasAccountId, organizationId: req.organizationId });
      clearSessionCookie(req, res);
      return res.json({ loggedOut: true, all: true });
    });

    app.post("/api/students/recover", studentLimit, requireBrowserOrigin, (_req, res) => res.status(410).json({
      error: "SaaS password recovery is handled by your organization support workflow.",
      code: "organization_recovery_required",
    }));

    app.put("/api/students/password", studentLimit, requireBrowserOrigin, requireStudentAuth, requireKdfAdmission, (req, res) => {
      try {
        tenancy.changePassword({ accountId: req.saasAccountId, currentPassword: req.body?.currentPassword, newPassword: req.body?.newPassword });
        const email = req.saas.context.account.email;
        const issued = issueSession(email, req.body?.newPassword, req.organizationId);
        setSessionCookie(req, res, issued.sessionToken);
        return res.json({ changed: true, sessionMode: "cookie", csrfToken: issued.csrfToken });
      } catch (error) { return jsonError(res, error); }
    });

    app.post("/api/consent/grant", studentLimit, (_req, res) => res.status(403).json({
      error: "Guardian-required consent must be granted by an authenticated verified guardian.",
      code: "guardian_consent_required",
    }));

    app.get("/api/organization/invitations/inspect", apiLimit, (req, res) => {
      const invitation = tenancy.inspectInvitation({ token: req.query?.token, includeEmail: true });
      if (!invitation) return res.status(404).json({ valid: false, error: "Invitation is invalid." });
      return res.json({ valid: invitation.status === "pending", invitation, organization: invitation.organization });
    });

    app.post("/api/organization/invitations/accept", studentLimit, requireBrowserOrigin, requireKdfAdmission, (req, res) => {
      const inspected = tenancy.inspectInvitation({ token: req.body?.token });
      if (!inspected || inspected.role === "student") {
        return res.status(400).json({ error: "Student invitations must be accepted in the student application.", code: "student_onboarding_required" });
      }
      try {
        const accepted = tenancy.acceptInvitation({
          token: req.body?.token,
          email: req.body?.email,
          password: req.body?.password,
          displayName: req.body?.name,
          relationship: req.body?.relationship,
        });
        const issued = issueSession(req.body?.email, req.body?.password, accepted.membership.organizationId);
        setSessionCookie(req, res, issued.sessionToken);
        const context = tenancy.getAccountContext({ organizationId: issued.session.organizationId, accountId: issued.session.accountId });
        return res.json(sessionPayload(context, issued.csrfToken));
      } catch (error) { return jsonError(res, error); }
    });

    app.post(
      "/api/organization/password-reset/request",
      studentLimit,
      requireExactBrowserOrigin,
      (req, res) => {
        let reset = null;
        try {
          reset = tenancy.createPasswordReset({
            email: req.body?.email,
            ttlMs: passwordResetTtlMs,
            cooldownMs: passwordResetCooldownMs,
          });
        } catch (error) {
          console.warn(`[SAAS] password_reset_request_failed code=${passwordResetFailureCode(error)}`);
        }
        if (reset) {
          Promise.resolve().then(() => mailer.sendPasswordReset({
              resetId: reset.id,
              email: validEmail(req.body?.email),
              token: reset.token,
              expiresAt: reset.expiresAt,
            }))
            .catch((error) => {
              try { tenancy.revokePasswordReset({ resetId: reset.id }); }
              catch { console.warn("[SAAS] password_reset_request_failed code=reset_revoke_failed"); }
              console.warn(`[SAAS] password_reset_request_failed code=${passwordResetFailureCode(error)}`);
            });
        }
        return res.status(202).json({ accepted: true });
      },
    );

    app.post(
      "/api/organization/password-reset/complete",
      studentLimit,
      requireExactBrowserOrigin,
      requireKdfAdmission,
      (req, res) => {
        try {
          tenancy.completePasswordReset({
            token: req.body?.token,
            email: req.body?.email,
            newPassword: req.body?.newPassword,
          });
          clearSessionCookie(req, res);
          return res.json({ completed: true });
        } catch (error) { return jsonError(res, error); }
      },
    );

    app.post("/api/organization/auth", studentLimit, requireBrowserOrigin, requireKdfAdmission, (req, res) => {
      try {
        const email = validEmail(req.body?.email);
        const slug = String(req.body?.organizationSlug || "").trim().toLowerCase();
        const authenticated = email ? tenancy.authenticateCredentials({ email, password: req.body?.password }) : null;
        const membership = authenticated?.memberships?.find((item) => item.organization.slug === slug && item.status === "active");
        if (!membership) return res.status(401).json({ error: "Invalid organization credentials.", code: "invalid_credentials" });
        const issued = issueSession(email, req.body?.password, membership.organization.id);
        setSessionCookie(req, res, issued.sessionToken);
        const context = tenancy.getAccountContext({ organizationId: issued.session.organizationId, accountId: issued.session.accountId });
        return res.json(sessionPayload(context, issued.csrfToken));
      } catch (error) { return jsonError(res, error); }
    });

    app.get("/api/organization/session", apiLimit, requirePortalSession, (req, res) => {
      const csrfToken = tenancy.rotateSessionCsrf({ sessionToken: req.saas.sessionToken });
      if (!csrfToken) {
        clearSessionCookie(req, res);
        return res.status(401).json({ error: "Organization session required.", code: "session_required" });
      }
      return res.json(sessionPayload(req.saas.context, csrfToken));
    });

    app.post("/api/organization/logout", studentLimit, requireBrowserOrigin, (req, res) => {
      tenancy.revokeSession({ sessionToken: readCookie(req, COOKIE_NAME) });
      clearSessionCookie(req, res);
      return res.json({ loggedOut: true });
    });

    app.put("/api/organization/password", studentLimit, requirePortalSession, requireKdfAdmission, (req, res) => {
      try {
        const { context } = req.saas;
        if (!context.account.email) {
          return res.status(409).json({
            error: "Account email is unavailable for session rotation.",
            code: "account_email_unavailable",
          });
        }
        tenancy.changePassword({
          accountId: context.account.id,
          currentPassword: req.body?.currentPassword,
          newPassword: req.body?.newPassword,
        });
        const issued = issueSession(
          context.account.email,
          req.body?.newPassword,
          context.organization.id,
        );
        setSessionCookie(req, res, issued.sessionToken);
        return res.json({
          changed: true,
          sessionMode: "cookie",
          csrfToken: issued.csrfToken,
        });
      } catch (error) { return jsonError(res, error); }
    });

    app.get("/api/organization/members", apiLimit, requirePortalSession, requireManager, (req, res) => {
      try {
        const { context } = req.saas;
        const members = tenancy.listMembers({ organizationId: context.organization.id, actorAccountId: context.account.id })
          .map((member) => ({
            id: member.id,
            name: member.displayName || "Organization member",
            email: member.email || "",
            role: roleFor(member.roles),
            roles: member.roles,
            status: member.status,
            studentId: member.studentId || null,
            grade: member.student?.grade ?? null,
            joinedAt: member.createdAt,
          }));
        return res.json({ members });
      } catch (error) { return jsonError(res, error); }
    });

    app.get("/api/organization/invitations", apiLimit, requirePortalSession, requireManager, (req, res) => {
      try {
        const { context } = req.saas;
        return res.json({ invitations: tenancy.listInvitations({ organizationId: context.organization.id, actorAccountId: context.account.id }) });
      } catch (error) { return jsonError(res, error); }
    });

    app.post("/api/organization/invitations", studentLimit, requirePortalSession, requireManager, async (req, res) => {
      const { context } = req.saas;
      let created = null;
      try {
        const email = validEmail(req.body?.email);
        if (!email) return res.status(400).json({ error: "A valid invitee email is required.", code: "invalid_email" });
        created = tenancy.createInvitation({
          organizationId: context.organization.id,
          actorAccountId: context.account.id,
          email,
          role: req.body?.role,
          targetStudentId: req.body?.role === "guardian" ? req.body?.targetStudentId : null,
          expiresAt: Date.now() + invitationTtlMs,
        });
        await mailer.sendInvitation({
          invitationId: created.invitation.id,
          email,
          token: created.token,
          organizationName: context.organization.name,
          role: created.invitation.role,
          expiresAt: created.invitation.expiresAt,
        });
        return res.status(201).json({ created: true, invitation: created.invitation });
      } catch (error) {
        if (created?.invitation?.id) {
          try {
            tenancy.revokeInvitation({
              organizationId: context.organization.id,
              invitationId: created.invitation.id,
              actorAccountId: context.account.id,
            });
          } catch {}
        }
        return jsonError(res, error);
      }
    });

    app.post("/api/organization/invitations/:id/revoke", studentLimit, requirePortalSession, requireManager, (req, res) => {
      try {
        const { context } = req.saas;
        const invitation = tenancy.revokeInvitation({ organizationId: context.organization.id, invitationId: req.params.id, actorAccountId: context.account.id });
        return res.json({ revoked: true, invitation });
      } catch (error) { return jsonError(res, error); }
    });

    app.patch("/api/organization/members/:id/status", studentLimit, requirePortalSession, requireManager, (req, res) => {
      try {
        const status = req.body?.status;
        if (!["active", "suspended"].includes(status)) return res.status(400).json({ error: "Status must be active or suspended.", code: "invalid_status" });
        const { context } = req.saas;
        const membership = tenancy.setMembershipStatus({ organizationId: context.organization.id, membershipId: req.params.id, actorAccountId: context.account.id, status });
        return res.json({ updated: true, membership });
      } catch (error) { return jsonError(res, error); }
    });

    app.get("/api/organization/guardian/students", apiLimit, requirePortalSession, requireGuardian, (req, res) => {
      try {
        const { context } = req.saas;
        const students = tenancy.listGuardianStudents({ organizationId: context.organization.id, actorAccountId: context.account.id })
          .map((entry) => ({
            id: entry.student.id,
            name: entry.student.displayName || "Linked student",
            grade: entry.student.grade,
            requiredConsents: requiredConsents.map((consentType) => {
              const state = tenancy.getGuardianConsentStatus({ organizationId: context.organization.id, studentId: entry.student.id, actorAccountId: context.account.id, consentType, policyVersion });
              const grantedByThisGuardian = state.consents.some(
                (consent) => consent.guardianLinkId === entry.link.id,
              );
              return {
                type: consentType,
                ...descriptors[consentType],
                policyVersion,
                scope: consentScopeSnapshot(consentType, entry.student.id),
                granted: grantedByThisGuardian,
              };
            }),
          }));
        return res.json({ policyVersion, students });
      } catch (error) { return jsonError(res, error); }
    });

    app.post("/api/organization/guardian/consent", studentLimit, requirePortalSession, requireGuardian, (req, res) => {
      try {
        const { context } = req.saas;
        const consentType = String(req.body?.consentType || "");
        if (!requiredConsents.includes(consentType) || req.body?.policyVersion !== policyVersion) {
          return res.status(400).json({ error: "Consent policy is not current.", code: "invalid_consent_policy" });
        }
        const input = { organizationId: context.organization.id, studentId: req.body?.studentId, actorAccountId: context.account.id, consentType, policyVersion };
        let consent;
        if (req.body?.granted === true) {
          const snapshot = consentScopeSnapshot(consentType, input.studentId);
          if (!sameJson(req.body?.scope, snapshot)) {
            return res.status(400).json({
              error: "Consent scope is not current.",
              code: "invalid_consent_scope",
            });
          }
          consent = tenancy.grantGuardianConsent({ ...input, scope: snapshot });
          try {
            ensureLegacyGuardianConsent({
              studentId: input.studentId,
              consentType,
              consent,
              actorAccountId: context.account.id,
              snapshot,
            });
          } catch (error) {
            tenancy.revokeGuardianConsent({ ...input, consentId: consent.id });
            throw error;
          }
        } else {
          const existing = currentGuardianConsent(input);
          if (existing) revokeLegacyGuardianConsent(input.studentId, consentType, existing.id);
          consent = tenancy.revokeGuardianConsentByPolicy(input);
          // The post-revoke pass also covers a consent whose guardian link
          // became inactive before this request, so no legacy grant survives.
          revokeLegacyGuardianConsent(input.studentId, consentType, consent.id);
        }
        return res.json({ updated: true, consent, granted: req.body?.granted === true });
      } catch (error) { return jsonError(res, error); }
    });
  }

  return Object.freeze({
    mount,
    requireStudentAuth,
    closeStudentAccount(req) {
      const close = () => {
        const result = tenancy.closeOwnStudentAccount({
          organizationId: req.organizationId,
          accountId: req.saasAccountId,
        });
        // The legacy erasure pass deletes every table with a student_id column in
        // creation order. Remove child consent rows first so its later guardian-link
        // deletion cannot violate the SaaS foreign key.
        db?.prepare("DELETE FROM saas_consent_grants WHERE student_id = ?").run(req.studentId);
        return result;
      };
      const result = db?.transaction ? db.transaction(close)() : close();
      if (req.res) clearSessionCookie(req, req.res);
      return result;
    },
  });
}

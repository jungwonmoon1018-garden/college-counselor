import React, { useCallback, useEffect, useRef, useState } from "react";
import "./OrganizationApp.css";

const API_BASE = "/api/organization";
const ADMIN_ROLES = new Set(["owner", "organization_owner", "org_admin", "admin"]);
const INVITABLE_ROLES = [
  ["org_admin", "Organization admin"],
  ["counselor", "Counselor"],
  ["student", "Student"],
  ["guardian", "Guardian"],
];

class PortalRequestError extends Error {
  constructor(message, status = 0, payload = {}) {
    super(message);
    this.name = "PortalRequestError";
    this.status = status;
    this.payload = payload;
  }
}

function safeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function titleCase(value) {
  return safeString(value, "member")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value) {
  if (!value) return "Not specified";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return safeString(value, "Not specified");
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

async function readJsonDefensively(response) {
  let text = "";
  try {
    text = await response.text();
  } catch {
    return {};
  }
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function requestErrorMessage(payload, status) {
  const raw = payload?.error;
  const message =
    (typeof raw === "string" && raw) ||
    (typeof raw?.message === "string" && raw.message) ||
    (typeof payload?.message === "string" && payload.message);
  if (message) return message;
  if (status === 401) return "The email, password, or organization could not be verified.";
  if (status === 403) return "You do not have permission to complete that action.";
  if (status === 404) return "The requested organization resource was not found.";
  if (status === 409) return "That action conflicts with the current organization state.";
  if (status === 429) return "Too many attempts. Please wait and try again.";
  return status >= 500
    ? "The organization service is temporarily unavailable."
    : "The request could not be completed.";
}

async function organizationRequest(
  path,
  { method = "GET", body, csrfToken = "", signal } = {},
) {
  const normalizedMethod = method.toUpperCase();
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (!["GET", "HEAD", "OPTIONS"].includes(normalizedMethod) && csrfToken) {
    headers["X-CSRF-Token"] = csrfToken;
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: normalizedMethod,
      credentials: "same-origin",
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new PortalRequestError("Could not reach the organization service.");
  }

  const payload = await readJsonDefensively(response);
  if (!response.ok) {
    throw new PortalRequestError(
      requestErrorMessage(payload, response.status),
      response.status,
      payload,
    );
  }
  return payload;
}

function normalizeSession(payload) {
  const root = payload?.session && typeof payload.session === "object"
    ? payload.session
    : payload || {};
  const member = root.member || root.user || payload?.member || payload?.user || {};
  const organization =
    root.organization || root.org || payload?.organization || payload?.org || {};
  const role = safeString(member.role || root.role || payload?.role).toLowerCase();
  const authenticated =
    root.authenticated === true ||
    payload?.authenticated === true ||
    Boolean((member.id || member.email) && role);

  return {
    authenticated,
    csrfToken: safeString(root.csrfToken || payload?.csrfToken),
    member: {
      id: safeString(member.id || member.memberId),
      name: safeString(member.name || member.displayName, "Organization member"),
      email: safeString(member.email),
      role,
      status: safeString(member.status, "active").toLowerCase(),
    },
    organization: {
      id: safeString(organization.id || organization.organizationId),
      slug: safeString(organization.slug || root.organizationSlug || payload?.organizationSlug),
      name: safeString(
        organization.displayName || organization.name || root.organizationName,
        "Your organization",
      ),
    },
  };
}

function normalizeInvitation(payload) {
  const invite = payload?.invitation && typeof payload.invitation === "object"
    ? payload.invitation
    : payload || {};
  const organization = payload?.organization || invite.organization || {};
  const status = safeString(invite.status, payload?.valid === false ? "invalid" : "pending").toLowerCase();
  return {
    valid:
      payload?.valid !== false &&
      !["invalid", "expired", "revoked", "accepted"].includes(status),
    id: safeString(invite.id || invite.invitationId),
    email: safeString(invite.email || invite.invitedEmail),
    role: safeString(invite.role, "member").toLowerCase(),
    targetStudentId: safeString(invite.targetStudentId || invite.target_student_id),
    expiresAt: invite.expiresAt || invite.expires_at || null,
    status,
    organization: {
      id: safeString(organization.id || invite.organizationId),
      slug: safeString(organization.slug || invite.organizationSlug),
      name: safeString(
        organization.displayName || organization.name || invite.organizationName,
        "Organization",
      ),
    },
  };
}

function normalizeMembers(payload) {
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.members)
      ? payload.members
      : Array.isArray(payload?.items)
        ? payload.items
        : [];
  return items.map((member) => ({
    id: safeString(member?.id || member?.membershipId),
    name: safeString(member?.name || member?.displayName, "Unnamed member"),
    email: safeString(member?.email),
    role: safeString(member?.role, "member").toLowerCase(),
    status: safeString(member?.status, "active").toLowerCase(),
    joinedAt: member?.joinedAt || member?.createdAt || member?.created_at || null,
  }));
}

function normalizeInvitations(payload) {
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.invitations)
      ? payload.invitations
      : Array.isArray(payload?.items)
        ? payload.items
        : [];
  return items.map((invite) => ({
    id: safeString(invite?.id || invite?.invitationId),
    email: safeString(invite?.email || invite?.invitedEmail),
    role: safeString(invite?.role, "member").toLowerCase(),
    status: safeString(invite?.status, "pending").toLowerCase(),
    targetStudentId: safeString(invite?.targetStudentId || invite?.target_student_id),
    expiresAt: invite?.expiresAt || invite?.expires_at || null,
  }));
}

function normalizeDisclosureList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => safeString(item)).filter(Boolean);
}

function normalizePolicyUrl(value) {
  const candidate = safeString(value);
  if (!candidate) return "";
  try {
    const currentOrigin = globalThis.window?.location?.origin;
    if (!currentOrigin && !candidate.toLowerCase().startsWith("https://")) return "";
    const parsed = new URL(candidate, currentOrigin);
    const sameOrigin = Boolean(currentOrigin) && parsed.origin === currentOrigin;
    if ((!sameOrigin && parsed.protocol !== "https:") || parsed.username || parsed.password) {
      return "";
    }
    return parsed.href;
  } catch {
    return "";
  }
}

function normalizeConsent(consent) {
  const type = safeString(consent?.type || consent?.consentType || consent?.key);
  const policyVersion = safeString(
    consent?.policyVersion || consent?.policy_version || consent?.version,
  );
  const purpose = safeString(consent?.purpose);
  const dataCategories = normalizeDisclosureList(consent?.dataCategories);
  const recipients = normalizeDisclosureList(consent?.recipients);
  const internationalTransfers = safeString(consent?.internationalTransfers);
  const retention = safeString(consent?.retention);
  const rights = normalizeDisclosureList(consent?.rights);
  const hasScope =
    Object.prototype.hasOwnProperty.call(consent || {}, "scope") &&
    consent.scope !== null &&
    typeof consent.scope === "object" &&
    !Array.isArray(consent.scope);

  return {
    type,
    label: safeString(
      consent?.label || consent?.name,
      titleCase(type || "Required consent"),
    ),
    policyVersion,
    granted: consent?.granted === true || consent?.status === "granted",
    purpose,
    dataCategories,
    recipients,
    internationalTransfers,
    retention,
    rights,
    policyUrl: normalizePolicyUrl(consent?.policyUrl),
    scope: hasScope ? consent.scope : null,
    reviewReady: Boolean(
      type &&
      policyVersion &&
      purpose &&
      dataCategories.length &&
      recipients.length &&
      internationalTransfers &&
      retention &&
      rights.length &&
      hasScope
    ),
  };
}

function normalizeGuardianStudents(payload) {
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.students)
      ? payload.students
      : Array.isArray(payload?.items)
        ? payload.items
        : [];
  return items.map((student) => {
    const consents = Array.isArray(student?.requiredConsents)
      ? student.requiredConsents
      : Array.isArray(student?.consents)
        ? student.consents
        : [];
    return {
      id: safeString(student?.id || student?.studentId),
      name: safeString(student?.name || student?.displayName, "Linked student"),
      grade: safeString(student?.grade),
      consents: consents.map(normalizeConsent),
    };
  });
}

function statusClass(status) {
  const normalized = safeString(status, "pending").toLowerCase();
  return `status-badge status-${normalized.replace(/[^a-z0-9-]/g, "")}`;
}

function PrivacyBoundary({ compact = false }) {
  return (
    <div className="privacy-boundary">
      <span className="privacy-icon" aria-hidden="true">✓</span>
      <div>
        <strong>{compact ? "Organization access only" : "A strict privacy boundary"}</strong>
        This portal never exposes student profiles, counseling chats, uploaded files,
        transcripts, or application work.
      </div>
    </div>
  );
}

function AuthIntro() {
  return (
    <section className="org-intro" aria-labelledby="portal-intro-title">
      <p className="org-kicker">College Counselor</p>
      <h1 id="portal-intro-title">Coordinate support. Preserve student trust.</h1>
      <p>
        A focused workspace for organization membership, invitations, and guardian
        consent—kept separate from each student&apos;s private counseling experience.
      </p>
      <PrivacyBoundary />
    </section>
  );
}

function LoadingView({ message = "Restoring your secure session…" }) {
  return (
    <div className="org-loading" role="status" aria-live="polite">
      <div>
        <div className="loading-mark" aria-hidden="true" />
        <strong>{message}</strong>
      </div>
    </div>
  );
}

function LoginView({ onSubmit, onUseRecovery, busy, error, statusMessage, headingRef }) {
  const [form, setForm] = useState({ organizationSlug: "", email: "", password: "" });

  const submit = async (event) => {
    event.preventDefault();
    const accepted = await onSubmit(form);
    if (accepted) setForm((current) => ({ ...current, password: "" }));
  };

  return (
    <div className="org-auth-layout">
      <AuthIntro />
      <section className="org-card" aria-labelledby="organization-login-title">
        <header className="org-card-header">
          <h1 id="organization-login-title" ref={headingRef} tabIndex="-1">
            Organization sign in
          </h1>
          <p>Use the organization identifier included in your welcome message.</p>
        </header>
        <form className="org-form" onSubmit={submit}>
          {statusMessage && <div className="alert alert-success" role="status">{statusMessage}</div>}
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          <div className="field">
            <label htmlFor="organization-slug">Organization</label>
            <input
              id="organization-slug"
              name="organization"
              autoComplete="organization"
              value={form.organizationSlug}
              onChange={(event) => setForm({ ...form, organizationSlug: event.target.value })}
              placeholder="northstar-academy"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="organization-email">Email</label>
            <input
              id="organization-email"
              name="email"
              type="email"
              autoComplete="username"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              placeholder="you@organization.org"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="organization-password">Password</label>
            <input
              id="organization-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              required
            />
          </div>
          <button className="button button-primary" type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <button className="button button-link" type="button" onClick={onUseRecovery}>
            Forgot password?
          </button>
        </form>
      </section>
    </div>
  );
}

function PasswordResetRequestView({ onSubmit, onUseLogin, busy, error, headingRef }) {
  const [email, setEmail] = useState("");
  const [accepted, setAccepted] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setAccepted(false);
    const completed = await onSubmit(email.trim().toLowerCase());
    if (completed) {
      setEmail("");
      setAccepted(true);
    }
  };

  return (
    <div className="org-auth-layout">
      <AuthIntro />
      <section className="org-card" aria-labelledby="password-reset-request-title">
        <header className="org-card-header">
          <h1 id="password-reset-request-title" ref={headingRef} tabIndex="-1">
            Reset organization password
          </h1>
          <p>Enter the email address used for your organization account.</p>
        </header>
        <form className="org-form" onSubmit={submit}>
          {accepted && (
            <div className="alert alert-success" role="status">
              If an organization account matches that email, a password reset link will be sent.
            </div>
          )}
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          <div className="field">
            <label htmlFor="password-reset-email">Email</label>
            <input
              id="password-reset-email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div className="form-actions">
            <button className="button button-primary" type="submit" disabled={busy}>
              {busy ? "Sending…" : "Send reset link"}
            </button>
            <button className="button button-link" type="button" onClick={onUseLogin}>
              Back to sign in
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function PasswordResetCompleteView({ onSubmit, onUseLogin, busy, error, headingRef }) {
  const [form, setForm] = useState({ email: "", newPassword: "", confirmPassword: "" });
  const [validationError, setValidationError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setValidationError("");
    if (form.newPassword.length < 12) {
      setValidationError("Use a password with at least 12 characters.");
      return;
    }
    if (form.newPassword !== form.confirmPassword) {
      setValidationError("The new passwords do not match.");
      return;
    }
    await onSubmit({
      email: form.email.trim().toLowerCase(),
      newPassword: form.newPassword,
    });
  };

  return (
    <div className="org-auth-layout">
      <AuthIntro />
      <section className="org-card" aria-labelledby="password-reset-complete-title">
        <header className="org-card-header">
          <p className="org-kicker">Reset link verified</p>
          <h1 id="password-reset-complete-title" ref={headingRef} tabIndex="-1">
            Choose a new organization password
          </h1>
          <p>Confirm the account email and choose a new password.</p>
        </header>
        <form className="org-form" onSubmit={submit}>
          {(validationError || error) && (
            <div className="alert alert-error" role="alert">{validationError || error}</div>
          )}
          <div className="field">
            <label htmlFor="password-reset-complete-email">Email</label>
            <input
              id="password-reset-complete-email"
              name="email"
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              required
            />
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="password-reset-new-password">New password</label>
              <input
                id="password-reset-new-password"
                type="password"
                autoComplete="new-password"
                minLength="12"
                value={form.newPassword}
                onChange={(event) => setForm({ ...form, newPassword: event.target.value })}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="password-reset-confirm-password">Confirm new password</label>
              <input
                id="password-reset-confirm-password"
                type="password"
                autoComplete="new-password"
                minLength="12"
                value={form.confirmPassword}
                onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })}
                required
              />
            </div>
          </div>
          <p className="field-help">Reset links are single-use. You will sign in again after the password is changed.</p>
          <div className="form-actions">
            <button className="button button-primary" type="submit" disabled={busy}>
              {busy ? "Updating…" : "Update password"}
            </button>
            <button className="button button-link" type="button" onClick={onUseLogin}>
              Back to sign in
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function InviteView({
  invite,
  onAccept,
  onUseLogin,
  busy,
  error,
  headingRef,
}) {
  const [form, setForm] = useState({
    email: invite?.email || "",
    name: "",
    password: "",
    confirmPassword: "",
  });
  const [validationError, setValidationError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setValidationError("");
    if (form.password.length < 12) {
      setValidationError("Use a password with at least 12 characters.");
      return;
    }
    if (form.password !== form.confirmPassword) {
      setValidationError("The passwords do not match.");
      return;
    }
    const accepted = await onAccept({
      email: form.email.trim().toLowerCase(),
      name: form.name.trim(),
      password: form.password,
    });
    if (accepted) setForm({ email: "", name: "", password: "", confirmPassword: "" });
  };

  if (!invite?.valid) {
    return (
      <div className="org-auth-layout">
        <AuthIntro />
        <section className="org-card" aria-labelledby="invalid-invite-title">
          <header className="org-card-header">
            <h1 id="invalid-invite-title" ref={headingRef} tabIndex="-1">
              Invitation unavailable
            </h1>
            <p>This invitation is invalid, expired, revoked, or already accepted.</p>
          </header>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          <button className="button button-primary" type="button" onClick={onUseLogin}>
            Go to sign in
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="org-auth-layout">
      <AuthIntro />
      <section className="org-card" aria-labelledby="accept-invite-title">
        <header className="org-card-header">
          <p className="org-kicker">Invitation verified</p>
          <h1 id="accept-invite-title" ref={headingRef} tabIndex="-1">
            Join {invite.organization.name}
          </h1>
          <p>Create your portal credentials to accept this invitation.</p>
        </header>
        <dl className="org-detail-list">
          <div className="org-detail-row">
            <dt>Role</dt>
            <dd>{titleCase(invite.role)}</dd>
          </div>
          {invite.role === "guardian" && invite.targetStudentId && (
            <div className="org-detail-row">
              <dt>Linked student ID</dt>
              <dd className="monospace">{invite.targetStudentId}</dd>
            </div>
          )}
          <div className="org-detail-row">
            <dt>Expires</dt>
            <dd>{formatDate(invite.expiresAt)}</dd>
          </div>
        </dl>
        <form className="org-form" onSubmit={submit}>
          {(validationError || error) && (
            <div className="alert alert-error" role="alert">
              {validationError || error}
            </div>
          )}
          <div className="field">
            <label htmlFor="invite-email-verification">Invitation email</label>
            <input
              id="invite-email-verification"
              name="email"
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              required
            />
            <p className="field-help">
              Enter the exact address that received this invitation.
            </p>
          </div>
          <div className="field">
            <label htmlFor="invite-name">Full name</label>
            <input
              id="invite-name"
              name="name"
              autoComplete="name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
            />
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="invite-password">Password</label>
              <input
                id="invite-password"
                name="password"
                type="password"
                minLength="12"
                autoComplete="new-password"
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="invite-confirm-password">Confirm password</label>
              <input
                id="invite-confirm-password"
                name="confirm-password"
                type="password"
                minLength="12"
                autoComplete="new-password"
                value={form.confirmPassword}
                onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })}
                required
              />
            </div>
          </div>
          <p className="field-help">
            Your session is stored in a secure HttpOnly cookie. Passwords and tokens
            are never saved in browser storage.
          </p>
          <div className="form-actions">
            <button className="button button-primary" type="submit" disabled={busy}>
              {busy ? "Accepting…" : "Accept invitation"}
            </button>
            <button className="button button-link" type="button" onClick={onUseLogin}>
              Sign in instead
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function MemberTable({ members, currentMemberId, actionKey, onStatusChange }) {
  if (!members.length) {
    return <p className="empty-state">No organization members yet.</p>;
  }
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Member</th>
            <th scope="col">Role</th>
            <th scope="col">Status</th>
            <th scope="col">Joined</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => {
            const suspended = member.status === "suspended";
            const isSelf = member.id && member.id === currentMemberId;
            return (
              <tr key={member.id || `${member.email}-${member.role}`}>
                <td data-label="Member">
                  <span className="member-name">
                    <strong>{member.name}</strong>
                    <span>{member.email || "Email unavailable"}</span>
                  </span>
                </td>
                <td data-label="Role"><span className="role-badge">{titleCase(member.role)}</span></td>
                <td data-label="Status"><span className={statusClass(member.status)}>{titleCase(member.status)}</span></td>
                <td data-label="Joined">{formatDate(member.joinedAt)}</td>
                <td data-label="Action">
                  <button
                    className={`button button-small ${suspended ? "button-success" : "button-danger"}`}
                    type="button"
                    disabled={!member.id || isSelf || actionKey === `member:${member.id}`}
                    onClick={() => onStatusChange(member, suspended ? "active" : "suspended")}
                    aria-label={`${suspended ? "Reactivate" : "Suspend"} ${member.name}`}
                  >
                    {actionKey === `member:${member.id}`
                      ? "Saving…"
                      : suspended
                        ? "Reactivate"
                        : "Suspend"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function InvitationTable({ invitations, actionKey, onRevoke }) {
  if (!invitations.length) {
    return <p className="empty-state">No invitations have been created.</p>;
  }
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Invitee</th>
            <th scope="col">Role</th>
            <th scope="col">Status</th>
            <th scope="col">Expires</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {invitations.map((invite) => (
            <tr key={invite.id || `${invite.email}-${invite.role}`}>
              <td data-label="Invitee">
                <span className="member-name">
                  <strong>{invite.email || "Email unavailable"}</strong>
                  {invite.role === "guardian" && invite.targetStudentId && (
                    <span>Student ID: {invite.targetStudentId}</span>
                  )}
                </span>
              </td>
              <td data-label="Role"><span className="role-badge">{titleCase(invite.role)}</span></td>
              <td data-label="Status"><span className={statusClass(invite.status)}>{titleCase(invite.status)}</span></td>
              <td data-label="Expires">{formatDate(invite.expiresAt)}</td>
              <td data-label="Action">
                <button
                  className="button button-small button-danger"
                  type="button"
                  disabled={
                    !invite.id ||
                    invite.status !== "pending" ||
                    actionKey === `invite:${invite.id}`
                  }
                  onClick={() => onRevoke(invite)}
                  aria-label={`Revoke invitation for ${invite.email || "invitee"}`}
                >
                  {actionKey === `invite:${invite.id}` ? "Revoking…" : "Revoke"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdminDashboard({
  session,
  members,
  invitations,
  loading,
  actionKey,
  error,
  statusMessage,
  onCreateInvite,
  onRevokeInvite,
  onMemberStatus,
}) {
  const [inviteForm, setInviteForm] = useState({
    email: "",
    role: "counselor",
    targetStudentId: "",
  });
  const [formError, setFormError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setFormError("");
    if (inviteForm.role === "guardian" && !inviteForm.targetStudentId.trim()) {
      setFormError("A target student ID is required for guardian invitations.");
      return;
    }
    const created = await onCreateInvite({
      email: inviteForm.email.trim(),
      role: inviteForm.role,
      ...(inviteForm.role === "guardian"
        ? { targetStudentId: inviteForm.targetStudentId.trim() }
        : {}),
    });
    if (created) {
      setInviteForm({ email: "", role: "counselor", targetStudentId: "" });
    }
  };

  return (
    <div className="dashboard-grid">
      {(error || formError) && (
        <div className="alert alert-error" role="alert">{formError || error}</div>
      )}
      {statusMessage && (
        <div className="alert alert-success" role="status" aria-live="polite">
          {statusMessage}
        </div>
      )}
      <section className="dashboard-panel" aria-labelledby="members-title" aria-busy={loading}>
        <header className="panel-heading">
          <div>
            <h2 id="members-title">Members</h2>
            <p>Manage organization access status. Student work is never shown here.</p>
          </div>
          <span className="role-badge">{members.length} total</span>
        </header>
        {loading ? (
          <LoadingView message="Loading members…" />
        ) : (
          <MemberTable
            members={members}
            currentMemberId={session.member.id}
            actionKey={actionKey}
            onStatusChange={onMemberStatus}
          />
        )}
      </section>

      <section className="dashboard-panel" aria-labelledby="invitations-title">
        <header className="panel-heading">
          <div>
            <h2 id="invitations-title">Invitations</h2>
            <p>Invite staff, students, or a guardian linked to one student ID.</p>
          </div>
        </header>
        <form className="invite-form" onSubmit={submit}>
          <div className="field">
            <label htmlFor="invite-email">Invitee email</label>
            <input
              id="invite-email"
              type="email"
              autoComplete="off"
              value={inviteForm.email}
              onChange={(event) => setInviteForm({ ...inviteForm, email: event.target.value })}
              placeholder="person@example.org"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="invite-role">Role</label>
            <select
              id="invite-role"
              value={inviteForm.role}
              onChange={(event) =>
                setInviteForm({
                  ...inviteForm,
                  role: event.target.value,
                  targetStudentId:
                    event.target.value === "guardian" ? inviteForm.targetStudentId : "",
                })}
            >
              {INVITABLE_ROLES.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          {inviteForm.role === "guardian" && (
            <div className="field">
              <label htmlFor="target-student-id">Target student ID</label>
              <input
                id="target-student-id"
                value={inviteForm.targetStudentId}
                onChange={(event) =>
                  setInviteForm({ ...inviteForm, targetStudentId: event.target.value })}
                placeholder="student_…"
                required
              />
            </div>
          )}
          <button
            className="button button-primary"
            type="submit"
            disabled={actionKey === "create-invite"}
          >
            {actionKey === "create-invite" ? "Inviting…" : "Create invitation"}
          </button>
        </form>
        <InvitationTable
          invitations={invitations}
          actionKey={actionKey}
          onRevoke={onRevokeInvite}
        />
      </section>
    </div>
  );
}

function GuardianDashboard({
  students,
  loading,
  actionKey,
  error,
  statusMessage,
  onConsentChange,
}) {
  return (
    <section className="dashboard-panel" aria-labelledby="guardian-students-title" aria-busy={loading}>
      <header className="panel-heading">
        <div>
          <h2 id="guardian-students-title">Linked students and consent</h2>
          <p>
            Review only the required consent records for students explicitly linked
            to your membership.
          </p>
        </div>
      </header>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {statusMessage && (
        <div className="alert alert-success" role="status" aria-live="polite">
          {statusMessage}
        </div>
      )}
      {loading ? (
        <LoadingView message="Loading linked students…" />
      ) : students.length === 0 ? (
        <p className="empty-state">No students are linked to this guardian account.</p>
      ) : (
        <div className="student-list">
          {students.map((student) => (
            <article className="student-card" key={student.id || student.name}>
              <header className="student-card-header">
                <div>
                  <h3>{student.name}</h3>
                  <p className="student-meta">
                    {student.grade ? `Grade ${student.grade} · ` : ""}
                    Student ID <span className="monospace">{student.id || "Unavailable"}</span>
                  </p>
                </div>
                <span className="role-badge">Linked student</span>
              </header>
              {student.consents.length === 0 ? (
                <p className="empty-state">No required consent policies are pending.</p>
              ) : (
                <ul className="consent-list">
                  {student.consents.map((consent) => {
                    const key = `consent:${student.id}:${consent.type}:${consent.policyVersion}`;
                    return (
                      <li className="consent-row" key={`${consent.type}:${consent.policyVersion}`}>
                        <span className="consent-copy">
                          <strong>{consent.label}</strong>
                          <span>
                            Policy {consent.policyVersion || "unavailable"} · {consent.granted ? "Granted" : "Not granted"}
                          </span>
                        </span>
                        <dl className="consent-disclosures">
                          <div>
                            <dt>Purpose</dt>
                            <dd>{consent.purpose || "Disclosure unavailable."}</dd>
                          </div>
                          <div>
                            <dt>Data categories</dt>
                            <dd>
                              {consent.dataCategories.length ? (
                                <ul>
                                  {consent.dataCategories.map((category) => (
                                    <li key={category}>{category}</li>
                                  ))}
                                </ul>
                              ) : "Disclosure unavailable."}
                            </dd>
                          </div>
                          <div>
                            <dt>Recipients and providers</dt>
                            <dd>
                              {consent.recipients.length ? (
                                <ul>
                                  {consent.recipients.map((recipient) => (
                                    <li key={recipient}>{recipient}</li>
                                  ))}
                                </ul>
                              ) : "Disclosure unavailable."}
                            </dd>
                          </div>
                          <div>
                            <dt>International and cross-border transfers</dt>
                            <dd>{consent.internationalTransfers || "Disclosure unavailable."}</dd>
                          </div>
                          <div>
                            <dt>Retention</dt>
                            <dd>{consent.retention || "Disclosure unavailable."}</dd>
                          </div>
                          <div>
                            <dt>Guardian and student rights</dt>
                            <dd>
                              {consent.rights.length ? (
                                <ul>
                                  {consent.rights.map((right) => (
                                    <li key={right}>{right}</li>
                                  ))}
                                </ul>
                              ) : "Disclosure unavailable."}
                            </dd>
                          </div>
                          <div>
                            <dt>Policy version</dt>
                            <dd>{consent.policyVersion || "Disclosure unavailable."}</dd>
                          </div>
                        </dl>
                        {consent.policyUrl && (
                          <a
                            className="consent-policy-link"
                            href={consent.policyUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Read the full policy
                            <span className="visually-hidden"> (opens in a new tab)</span>
                          </a>
                        )}
                        {!consent.reviewReady && (
                          <div className="consent-review-blocked" role="status">
                            <strong>Review unavailable</strong>
                            <span>
                              The organization must publish every required disclosure and
                              the exact consent scope before consent can be granted.
                            </span>
                          </div>
                        )}
                        {(consent.granted || consent.reviewReady) && (
                        <div className="consent-actions">
                        <button
                          className={`button button-small ${consent.granted ? "button-danger" : "button-success"}`}
                          type="button"
                          disabled={!student.id || actionKey === key}
                          onClick={() => onConsentChange(student, consent, !consent.granted)}
                        >
                          {actionKey === key
                            ? "Saving…"
                            : consent.granted
                              ? "Revoke consent"
                              : "Grant consent"}
                        </button>
                        </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function PasswordChangePanel({ actionKey, onChangePassword }) {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [message, setMessage] = useState(null);
  const busy = actionKey === "change-password";

  const submit = async (event) => {
    event.preventDefault();
    setMessage(null);
    if (form.newPassword.length < 12) {
      setMessage({ type: "error", text: "The new password must be at least 12 characters." });
      return;
    }
    if (form.newPassword !== form.confirmPassword) {
      setMessage({ type: "error", text: "The new passwords do not match." });
      return;
    }
    const result = await onChangePassword({
      currentPassword: form.currentPassword,
      newPassword: form.newPassword,
    });
    if (!result.ok) {
      setMessage({ type: "error", text: result.error });
      return;
    }
    setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    setMessage({ type: "success", text: "Password updated. Your secure session remains active." });
  };

  return (
    <section className="dashboard-panel" aria-labelledby="account-security-title">
      <header className="panel-heading">
        <div>
          <h2 id="account-security-title">Account security</h2>
          <p>Rotate the password for this organization account.</p>
        </div>
      </header>
      <form className="org-form password-form" onSubmit={submit}>
        {message && (
          <div
            className={`alert ${message.type === "error" ? "alert-error" : "alert-success"}`}
            role={message.type === "error" ? "alert" : "status"}
            aria-live={message.type === "error" ? undefined : "polite"}
          >
            {message.text}
          </div>
        )}
        <div className="field">
          <label htmlFor="organization-current-password">Current password</label>
          <input
            id="organization-current-password"
            type="password"
            autoComplete="current-password"
            value={form.currentPassword}
            onChange={(event) => setForm({ ...form, currentPassword: event.target.value })}
            required
          />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="organization-new-password">New password</label>
            <input
              id="organization-new-password"
              type="password"
              autoComplete="new-password"
              minLength="12"
              value={form.newPassword}
              onChange={(event) => setForm({ ...form, newPassword: event.target.value })}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="organization-confirm-password">Confirm new password</label>
            <input
              id="organization-confirm-password"
              type="password"
              autoComplete="new-password"
              minLength="12"
              value={form.confirmPassword}
              onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })}
              required
            />
          </div>
        </div>
        <div className="form-actions">
          <button className="button button-primary" type="submit" disabled={busy}>
            {busy ? "Updating password…" : "Update password"}
          </button>
        </div>
      </form>
    </section>
  );
}

function Dashboard({
  session,
  members,
  invitations,
  guardianStudents,
  loading,
  actionKey,
  error,
  statusMessage,
  onLogout,
  onCreateInvite,
  onRevokeInvite,
  onMemberStatus,
  onConsentChange,
  onChangePassword,
  headingRef,
}) {
  const role = session.member.role;
  const isAdmin = ADMIN_ROLES.has(role);
  const isGuardian = role === "guardian";

  return (
    <div className="org-dashboard">
      <header className="dashboard-header">
        <div>
          <p className="org-kicker">Organization portal</p>
          <h1 ref={headingRef} tabIndex="-1">{session.organization.name}</h1>
          <p>
            {session.organization.slug
              ? `Organization: ${session.organization.slug}`
              : "Secure membership workspace"}
          </p>
        </div>
        <div className="account-chip">
          <span className="account-chip-text">
            <strong>{session.member.name}</strong>
            <span>{session.member.email || titleCase(role)}</span>
          </span>
          <span className="role-badge">{titleCase(role)}</span>
          <button
            className="button button-small button-secondary"
            type="button"
            onClick={onLogout}
            disabled={actionKey === "logout"}
          >
            {actionKey === "logout" ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </header>

      <PrivacyBoundary compact />

      <main>
        {isAdmin ? (
          <AdminDashboard
            session={session}
            members={members}
            invitations={invitations}
            loading={loading}
            actionKey={actionKey}
            error={error}
            statusMessage={statusMessage}
            onCreateInvite={onCreateInvite}
            onRevokeInvite={onRevokeInvite}
            onMemberStatus={onMemberStatus}
          />
        ) : isGuardian ? (
          <GuardianDashboard
            students={guardianStudents}
            loading={loading}
            actionKey={actionKey}
            error={error}
            statusMessage={statusMessage}
            onConsentChange={onConsentChange}
          />
        ) : (
          <section className="dashboard-panel membership-only">
            <h2>Your organization membership is active</h2>
            <p className="muted">
              This portal contains organization access information only. Continue to
              the student experience for counseling tools available to your role.
            </p>
          </section>
        )}
        <PasswordChangePanel actionKey={actionKey} onChangePassword={onChangePassword} />
      </main>
      <footer className="portal-footer">
        Organization actions are role-scoped and audited by the service. Student
        counseling content remains private and is never returned to this portal.
      </footer>
    </div>
  );
}

export default function OrganizationApp() {
  const initialInviteTokenRef = useRef("");
  const initialResetTokenRef = useRef("");
  const initialRecoveryRequestRef = useRef(false);
  const initialSessionRestoreRef = useRef(null);
  const csrfTokenRef = useRef("");
  const headingRef = useRef(null);
  const [view, setView] = useState("loading");
  const [session, setSession] = useState(null);
  const [invite, setInvite] = useState(null);
  const [members, setMembers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [guardianStudents, setGuardianStudents] = useState([]);
  const [loadingData, setLoadingData] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionKey, setActionKey] = useState("");
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  const installSession = useCallback((payload) => {
    const next = normalizeSession(payload);
    if (!next.authenticated) return null;
    csrfTokenRef.current = next.csrfToken;
    setSession(next);
    setView("dashboard");
    return next;
  }, []);

  const restoreSession = useCallback(async () => {
    const payload = await organizationRequest("/session");
    const restored = installSession(payload);
    if (!restored) {
      csrfTokenRef.current = "";
      setSession(null);
      setView("login");
    }
    return restored;
  }, [installSession]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const params = new URLSearchParams(window.location.search);
    const resetTokenFromUrl = safeString(params.get("reset"));
    const inviteTokenFromUrl = resetTokenFromUrl ? "" : safeString(params.get("invite"));
    const recoveryRequestedFromUrl = params.get("recovery") === "1";
    if (resetTokenFromUrl) initialResetTokenRef.current = resetTokenFromUrl;
    if (inviteTokenFromUrl) initialInviteTokenRef.current = inviteTokenFromUrl;
    if (recoveryRequestedFromUrl) initialRecoveryRequestRef.current = true;
    if (resetTokenFromUrl || inviteTokenFromUrl || recoveryRequestedFromUrl) {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.hash}`,
      );
    }
    const resetToken = resetTokenFromUrl || initialResetTokenRef.current;
    const inviteToken = inviteTokenFromUrl || initialInviteTokenRef.current;

    const bootstrap = async () => {
      setError("");
      if (resetToken) {
        setView("reset-complete");
        return;
      }
      if (initialRecoveryRequestRef.current) {
        setView("reset-request");
        return;
      }
      if (inviteToken) {
        try {
          const payload = await organizationRequest(
            `/invitations/inspect?token=${encodeURIComponent(inviteToken)}`,
            { signal: controller.signal },
          );
          if (!cancelled) {
            setInvite(normalizeInvitation(payload));
            setView("invite");
          }
        } catch (requestError) {
          if (requestError?.name === "AbortError" || cancelled) return;
          setInvite({ valid: false });
          setError(requestError.message);
          setView("invite");
        }
        return;
      }

      try {
        if (!initialSessionRestoreRef.current) {
          initialSessionRestoreRef.current = organizationRequest("/session");
        }
        const payload = await initialSessionRestoreRef.current;
        if (cancelled) return;
        const restored = installSession(payload);
        if (!restored) {
          csrfTokenRef.current = "";
          setSession(null);
          setView("login");
        }
      } catch (requestError) {
        if (requestError?.name === "AbortError" || cancelled) return;
        if (requestError.status === 401) {
          setView("login");
        } else {
          setError(requestError.message);
          setView("login");
        }
      }
    };

    bootstrap();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [installSession]);

  useEffect(() => {
    if (view === "loading") return;
    const frame = window.requestAnimationFrame(() => headingRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [view]);

  const loadRoleData = useCallback(async (activeSession) => {
    if (!activeSession) return;
    setLoadingData(true);
    setError("");
    try {
      if (ADMIN_ROLES.has(activeSession.member.role)) {
        const [memberPayload, invitePayload] = await Promise.all([
          organizationRequest("/members"),
          organizationRequest("/invitations"),
        ]);
        setMembers(normalizeMembers(memberPayload));
        setInvitations(normalizeInvitations(invitePayload));
        setGuardianStudents([]);
      } else if (activeSession.member.role === "guardian") {
        const payload = await organizationRequest("/guardian/students");
        setGuardianStudents(normalizeGuardianStudents(payload));
        setMembers([]);
        setInvitations([]);
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    if (view === "dashboard" && session) loadRoleData(session);
  }, [loadRoleData, session, view]);

  const handleLogin = async ({ email, password, organizationSlug }) => {
    setBusy(true);
    setError("");
    setStatusMessage("");
    try {
      const payload = await organizationRequest("/auth", {
        method: "POST",
        body: {
          email: email.trim().toLowerCase(),
          password,
          organizationSlug: organizationSlug.trim().toLowerCase(),
        },
      });
      const installed = installSession(payload) || await restoreSession();
      return Boolean(installed);
    } catch (requestError) {
      setError(requestError.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleInviteAccept = async ({ email, name, password }) => {
    setBusy(true);
    setError("");
    try {
      const payload = await organizationRequest("/invitations/accept", {
        method: "POST",
        body: {
          token: initialInviteTokenRef.current,
          email,
          name,
          password,
        },
      });
      initialInviteTokenRef.current = "";
      const installed = installSession(payload) || await restoreSession();
      return Boolean(installed);
    } catch (requestError) {
      setError(requestError.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handlePasswordResetRequest = async (email) => {
    setBusy(true);
    setError("");
    try {
      await organizationRequest("/password-reset/request", {
        method: "POST",
        body: { email },
      });
      return true;
    } catch (requestError) {
      setError(requestError.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handlePasswordResetComplete = async ({ email, newPassword }) => {
    const token = initialResetTokenRef.current;
    if (!token) {
      setError("This password reset link is no longer available. Request a new link.");
      return false;
    }
    setBusy(true);
    setError("");
    try {
      await organizationRequest("/password-reset/complete", {
        method: "POST",
        body: { token, email, newPassword },
      });
      initialResetTokenRef.current = "";
      initialRecoveryRequestRef.current = false;
      setStatusMessage("Password reset complete. Sign in with your new password.");
      setView("login");
      return true;
    } catch (requestError) {
      setError(requestError.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    setActionKey("logout");
    setError("");
    try {
      await organizationRequest("/logout", {
        method: "POST",
        body: {},
        csrfToken: csrfTokenRef.current,
      });
      csrfTokenRef.current = "";
      initialInviteTokenRef.current = "";
      setSession(null);
      setMembers([]);
      setInvitations([]);
      setGuardianStudents([]);
      setStatusMessage("");
      setView("login");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setActionKey("");
    }
  };

  const handleCreateInvite = async (body) => {
    setActionKey("create-invite");
    setError("");
    setStatusMessage("");
    try {
      await organizationRequest("/invitations", {
        method: "POST",
        body,
        csrfToken: csrfTokenRef.current,
      });
      const payload = await organizationRequest("/invitations");
      setInvitations(normalizeInvitations(payload));
      setStatusMessage(`Invitation created for ${body.email}.`);
      return true;
    } catch (requestError) {
      setError(requestError.message);
      return false;
    } finally {
      setActionKey("");
    }
  };

  const handleRevokeInvite = async (invitation) => {
    setActionKey(`invite:${invitation.id}`);
    setError("");
    setStatusMessage("");
    try {
      await organizationRequest(
        `/invitations/${encodeURIComponent(invitation.id)}/revoke`,
        {
          method: "POST",
          body: {},
          csrfToken: csrfTokenRef.current,
        },
      );
      setInvitations((current) =>
        current.map((item) =>
          item.id === invitation.id ? { ...item, status: "revoked" } : item));
      setStatusMessage(`Invitation for ${invitation.email || "invitee"} revoked.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setActionKey("");
    }
  };

  const handleMemberStatus = async (member, status) => {
    setActionKey(`member:${member.id}`);
    setError("");
    setStatusMessage("");
    try {
      await organizationRequest(`/members/${encodeURIComponent(member.id)}/status`, {
        method: "PATCH",
        body: { status },
        csrfToken: csrfTokenRef.current,
      });
      setMembers((current) =>
        current.map((item) => item.id === member.id ? { ...item, status } : item));
      setStatusMessage(`${member.name} is now ${status}.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setActionKey("");
    }
  };

  const handleConsentChange = async (student, consent, granted) => {
    const key = `consent:${student.id}:${consent.type}:${consent.policyVersion}`;
    setActionKey(key);
    setError("");
    setStatusMessage("");
    try {
      await organizationRequest("/guardian/consent", {
        method: "POST",
        body: {
          studentId: student.id,
          consentType: consent.type,
          policyVersion: consent.policyVersion,
          granted,
          ...(granted ? { scope: consent.scope } : {}),
        },
        csrfToken: csrfTokenRef.current,
      });
      setGuardianStudents((current) =>
        current.map((item) => item.id !== student.id
          ? item
          : {
              ...item,
              consents: item.consents.map((candidate) =>
                candidate.type === consent.type &&
                candidate.policyVersion === consent.policyVersion
                  ? { ...candidate, granted }
                  : candidate),
            }));
      setStatusMessage(
        `${consent.label} ${granted ? "granted" : "revoked"} for ${student.name}.`,
      );
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setActionKey("");
    }
  };

  const handleChangePassword = async ({ currentPassword, newPassword }) => {
    setActionKey("change-password");
    try {
      const payload = await organizationRequest("/password", {
        method: "PUT",
        body: { currentPassword, newPassword },
        csrfToken: csrfTokenRef.current,
      });
      const rotatedCsrf = safeString(payload?.csrfToken || payload?.session?.csrfToken);
      if (rotatedCsrf) csrfTokenRef.current = rotatedCsrf;
      return { ok: true };
    } catch (requestError) {
      return { ok: false, error: requestError.message };
    } finally {
      setActionKey("");
    }
  };

  return (
    <div className="org-shell">
      {view === "loading" && <LoadingView />}
      {view === "login" && (
        <LoginView
          onSubmit={handleLogin}
          onUseRecovery={() => {
            initialRecoveryRequestRef.current = true;
            setError("");
            setStatusMessage("");
            setView("reset-request");
          }}
          busy={busy}
          error={error}
          statusMessage={statusMessage}
          headingRef={headingRef}
        />
      )}
      {view === "reset-request" && (
        <PasswordResetRequestView
          onSubmit={handlePasswordResetRequest}
          onUseLogin={() => {
            initialRecoveryRequestRef.current = false;
            setError("");
            setView("login");
          }}
          busy={busy}
          error={error}
          headingRef={headingRef}
        />
      )}
      {view === "reset-complete" && (
        <PasswordResetCompleteView
          onSubmit={handlePasswordResetComplete}
          onUseLogin={() => {
            initialResetTokenRef.current = "";
            setError("");
            setView("login");
          }}
          busy={busy}
          error={error}
          headingRef={headingRef}
        />
      )}
      {view === "invite" && (
        <InviteView
          invite={invite}
          onAccept={handleInviteAccept}
          onUseLogin={() => {
            initialInviteTokenRef.current = "";
            setError("");
            setView("login");
          }}
          busy={busy}
          error={error}
          headingRef={headingRef}
        />
      )}
      {view === "dashboard" && session && (
        <Dashboard
          session={session}
          members={members}
          invitations={invitations}
          guardianStudents={guardianStudents}
          loading={loadingData}
          actionKey={actionKey}
          error={error}
          statusMessage={statusMessage}
          onLogout={handleLogout}
          onCreateInvite={handleCreateInvite}
          onRevokeInvite={handleRevokeInvite}
          onMemberStatus={handleMemberStatus}
          onConsentChange={handleConsentChange}
          onChangePassword={handleChangePassword}
          headingRef={headingRef}
        />
      )}
    </div>
  );
}

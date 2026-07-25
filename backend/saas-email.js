import crypto from "node:crypto";

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function invitationUrl(baseUrl, token, role) {
  const url = new URL(role === "student" ? "/" : "/organization.html", baseUrl);
  url.searchParams.set("invite", token);
  return url.toString();
}

function passwordResetUrl(baseUrl, token) {
  const url = new URL("/organization.html", baseUrl);
  url.searchParams.set("reset", token);
  return url.toString();
}

export function initSaasMailer({ apiKey, from, inviteBaseUrl, fetchImpl = globalThis.fetch } = {}) {
  const key = String(apiKey || "").trim();
  const sender = String(from || "").trim();
  let base;
  try { base = new URL(String(inviteBaseUrl || "")); } catch { base = null; }
  const configured = Boolean(key && sender && base && typeof fetchImpl === "function");

  return {
    configured,
    async sendInvitation({ invitationId, email, token, organizationName, role, expiresAt }) {
      if (!configured) {
        const error = new Error("SaaS invitation email is not configured.");
        error.code = "email_not_configured";
        throw error;
      }
      const to = String(email || "").normalize("NFKC").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || !token) {
        const error = new Error("A valid invitation recipient and token are required.");
        error.code = "invalid_invitation_delivery";
        throw error;
      }
      const url = invitationUrl(base, token, role);
      const org = String(organizationName || "your organization").slice(0, 160);
      const expiry = expiresAt ? new Date(expiresAt).toISOString() : "the expiration shown by your administrator";
      const roleLabel = String(role || "member").replaceAll("_", " ");
      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "Idempotency-Key": String(invitationId || crypto.randomUUID()),
        },
        body: JSON.stringify({
          from: sender,
          to: [to],
          subject: `Invitation to ${org}`,
          text: `You were invited to ${org} as ${roleLabel}. This single-use invitation expires at ${expiry}. Open: ${url}`,
          html: `<p>You were invited to <strong>${escapeHtml(org)}</strong> as ${escapeHtml(roleLabel)}.</p><p>This single-use invitation expires at ${escapeHtml(expiry)}.</p><p><a href="${escapeHtml(url)}">Accept invitation</a></p><p>If you did not expect this invitation, you can ignore this email.</p>`,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(`Invitation email provider returned ${response.status}.`);
        error.code = "email_delivery_failed";
        error.status = response.status;
        throw error;
      }
      return { delivered: true, providerId: body.id || null };
    },
    async sendPasswordReset({ resetId, email, token, expiresAt }) {
      if (!configured) {
        const error = new Error("SaaS password reset email is not configured.");
        error.code = "email_not_configured";
        throw error;
      }
      const to = String(email || "").normalize("NFKC").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || !token) {
        const error = new Error("A valid password reset recipient and token are required.");
        error.code = "invalid_password_reset_delivery";
        throw error;
      }
      const url = passwordResetUrl(base, token);
      const expiry = expiresAt
        ? new Date(expiresAt).toISOString()
        : "the expiration shown on the reset page";
      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `password-reset-${String(resetId || crypto.randomUUID())}`,
        },
        body: JSON.stringify({
          from: sender,
          to: [to],
          subject: "Reset your College Counselor password",
          text: `A password reset was requested for your account. This single-use link expires at ${expiry}. Open: ${url}\n\nIf you did not request this reset, you can ignore this email.`,
          html: `<p>A password reset was requested for your account.</p><p>This single-use link expires at ${escapeHtml(expiry)}.</p><p><a href="${escapeHtml(url)}">Reset password</a></p><p>If you did not request this reset, you can ignore this email.</p>`,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(`Password reset email provider returned ${response.status}.`);
        error.code = "email_delivery_failed";
        error.status = response.status;
        throw error;
      }
      return { delivered: true, providerId: body.id || null };
    },
  };
}

export const _test = { escapeHtml, invitationUrl, passwordResetUrl };

import test from "node:test";
import assert from "node:assert/strict";
import { initSaasMailer, _test } from "../saas-email.js";

test("SaaS mailer sends a role-appropriate single-use invitation link", async () => {
  let request;
  const mailer = initSaasMailer({
    apiKey: "provider-secret",
    from: "Counselor <invites@example.test>",
    inviteBaseUrl: "https://app.example.test",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, json: async () => ({ id: "email-1" }) };
    },
  });
  const result = await mailer.sendInvitation({
    invitationId: "invite-1",
    email: "STUDENT@example.test",
    token: "one-time-secret",
    organizationName: "North High",
    role: "student",
    expiresAt: "2030-01-01T00:00:00.000Z",
  });
  assert.deepEqual(result, { delivered: true, providerId: "email-1" });
  const payload = JSON.parse(request.options.body);
  assert.equal(request.url, "https://api.resend.com/emails");
  assert.deepEqual(payload.to, ["student@example.test"]);
  assert.match(payload.text, /https:\/\/app\.example\.test\/\?invite=one-time-secret/);
  assert.equal(request.options.headers["Idempotency-Key"], "invite-1");
});

test("SaaS mailer fails closed when delivery is not configured", async () => {
  const mailer = initSaasMailer({});
  assert.equal(mailer.configured, false);
  await assert.rejects(
    mailer.sendInvitation({ email:"student@example.test", token:"secret", role:"student" }),
    (error) => error.code === "email_not_configured",
  );
});

test("invitation HTML escapes organization-controlled display text", () => {
  assert.equal(_test.escapeHtml('<img src=x onerror="alert(1)">'), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  assert.match(_test.invitationUrl("https://app.example.test/base", "a b", "guardian"), /organization\.html\?invite=a(?:\+|%20)b$/);
});

test("SaaS mailer sends an escaped organization-portal password reset link", async () => {
  let request;
  const mailer = initSaasMailer({
    apiKey: "provider-secret",
    from: "Counselor <security@example.test>",
    inviteBaseUrl: "https://app.example.test",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, json: async () => ({ id: "reset-email-1" }) };
    },
  });
  const result = await mailer.sendPasswordReset({
    resetId: "reset-1",
    email: "MEMBER@example.test",
    token: "reset token&unsafe",
    expiresAt: "2030-02-01T00:00:00.000Z",
  });
  assert.deepEqual(result, { delivered: true, providerId: "reset-email-1" });
  const payload = JSON.parse(request.options.body);
  assert.equal(request.url, "https://api.resend.com/emails");
  assert.deepEqual(payload.to, ["member@example.test"]);
  assert.equal(request.options.headers["Idempotency-Key"], "password-reset-reset-1");
  assert.match(payload.text, /organization\.html\?reset=reset(?:\+|%20)token%26unsafe/u);
  assert.match(payload.html, /organization\.html\?reset=reset(?:\+|%20)token%26unsafe/u);
  assert.doesNotMatch(payload.html, /reset token&unsafe/u);
});

test("password reset delivery failures do not expose the raw token", async () => {
  const mailer = initSaasMailer({
    apiKey: "provider-secret",
    from: "Counselor <security@example.test>",
    inviteBaseUrl: "https://app.example.test",
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ detail: "ignored" }) }),
  });
  const token = "never-log-this-password-reset-token";
  await assert.rejects(
    mailer.sendPasswordReset({
      resetId: "reset-failure",
      email: "member@example.test",
      token,
    }),
    (error) => error.code === "email_delivery_failed" && !error.message.includes(token),
  );
  assert.match(
    _test.passwordResetUrl("https://app.example.test/base", "a b"),
    /organization\.html\?reset=a(?:\+|%20)b$/u,
  );
});

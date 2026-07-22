import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import express from "express";
import { validateRequiredConsents } from "../consent.js";
import { createSaasHttp } from "../saas-http.js";
import { initSaasTenancy } from "../saas-tenancy.js";

const ORIGIN = "https://counselor.school.test";
const PEPPER = "saas-http-test-email-pepper-0123456789";
const KEY = Buffer.alloc(32, 9);
const PASSWORD = "correct horse battery staple";

function store(t) {
  const db = new Database(":memory:");
  t.after(() => db.close());
  const tenancy = initSaasTenancy({ db, emailPepper: PEPPER, encryptionKey: KEY });
  return { db, tenancy };
}

function organization(tenancy, suffix) {
  return tenancy.createOrganization({
    name: `Organization ${suffix}`,
    slug: `http-${suffix}`,
    ownerEmail: `owner-${suffix}@example.test`,
    ownerPassword: PASSWORD,
  });
}

function studentMember(tenancy, owner, suffix, grade = 11) {
  const student = tenancy.createStudent({
    organizationId: owner.organization.id,
    actorAccountId: owner.account.id,
    displayName: `Student ${suffix}`,
    grade,
  });
  const invitation = tenancy.createInvitation({
    organizationId: owner.organization.id,
    actorAccountId: owner.account.id,
    email: `student-${suffix}@example.test`,
    role: "student",
    targetStudentId: student.id,
  });
  const accepted = tenancy.acceptInvitation({
    token: invitation.token,
    email: `student-${suffix}@example.test`,
    password: PASSWORD,
    displayName: `Student Account ${suffix}`,
  });
  return { student, accepted, email: `student-${suffix}@example.test` };
}

function guardianMember(tenancy, owner, student, suffix) {
  const invitation = tenancy.createInvitation({
    organizationId: owner.organization.id,
    actorAccountId: owner.account.id,
    email: `guardian-${suffix}@example.test`,
    role: "guardian",
    targetStudentId: student.id,
  });
  const accepted = tenancy.acceptInvitation({
    token: invitation.token,
    email: `guardian-${suffix}@example.test`,
    password: PASSWORD,
    displayName: `Guardian ${suffix}`,
    relationship: "parent",
  });
  return { accepted, email: `guardian-${suffix}@example.test` };
}

function legacyConsentStatements(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS consent_records (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      consent_type TEXT NOT NULL,
      granted_at TEXT NOT NULL,
      granted_by TEXT,
      expires_at TEXT,
      revoked_at TEXT,
      revoked_by TEXT,
      scope TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  return {
    insertConsent: db.prepare(`
      INSERT INTO consent_records
        (id, student_id, consent_type, granted_at, granted_by, expires_at, scope)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    getActiveConsent: db.prepare(`
      SELECT * FROM consent_records
      WHERE student_id = ? AND consent_type = ? AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > datetime('now'))
      ORDER BY granted_at DESC LIMIT 1
    `),
    revokeConsent: db.prepare(`
      UPDATE consent_records SET revoked_at = datetime('now'), revoked_by = ? WHERE id = ?
    `),
    getAllConsent: db.prepare(`
      SELECT * FROM consent_records WHERE student_id = ? ORDER BY created_at DESC
    `),
    getStudentPII: { get: () => null },
  };
}

function httpLayer(tenancy, db, overrides = {}) {
  return createSaasHttp({
    tenancy,
    db,
    mailer: { sendInvitation: async () => ({ delivered: true }) },
    authStore: {
      getStudentGrade: () => null,
      createStudentCredential: () => {},
      deleteStudentCredential: () => {},
    },
    piiStmts: legacyConsentStatements(db),
    piiVault: { encryptionKey: KEY },
    ragStmts: {
      getLatestSnapshot: { get: () => null },
      insertSnapshot: { run: () => {} },
    },
    legacyEmailHash: (email) => `legacy:${email}`,
    publicOrigin: ORIGIN,
    provisioningToken: "provisioning-token-0123456789-abcdef",
    nodeEnv: "production",
    guardianConsentRequired: false,
    policyVersion: "2026.1",
    requiredConsents: ["data_processing"],
    ...overrides,
  });
}

async function listen(t, layer, addRoutes) {
  const app = express();
  app.use(express.json());
  layer.mount(app);
  if (addRoutes) addRoutes(app, layer);
  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    listening.once("error", reject);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

async function jsonRequest(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json();
  return { response, body };
}

function cookie(token) {
  return `cc_saas_session=${encodeURIComponent(token)}`;
}

test("platform provisioning fails closed when its configured secret is empty", async (t) => {
  const db = new Database(":memory:");
  t.after(() => db.close());
  let createCalls = 0;
  const tenancy = {
    createOrganization() {
      createCalls += 1;
      return { organization: { id: "unexpected" } };
    },
  };
  const layer = httpLayer(tenancy, db, { provisioningToken: "" });
  const baseUrl = await listen(t, layer);
  const { response } = await jsonRequest(baseUrl, "/api/platform/organizations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Unauthorized",
      slug: "unauthorized",
      ownerEmail: "owner@example.test",
      ownerPassword: PASSWORD,
    }),
  });
  assert.equal(response.status, 404);
  assert.equal(createCalls, 0);
});

test("mutating student authentication requires exact origin and CSRF and rejects manager-mixed roles", async (t) => {
  const { db, tenancy } = store(t);
  const owner = organization(tenancy, "student-csrf");
  const member = studentMember(tenancy, owner, "student-csrf");
  const session = tenancy.createSession({
    email: member.email,
    password: PASSWORD,
    organizationId: owner.organization.id,
  });
  const layer = httpLayer(tenancy, db);
  const baseUrl = await listen(t, layer, (app, mounted) => {
    app.post("/api/test/student-mutation", mounted.requireStudentAuth, (req, res) => {
      res.json({ studentId: req.studentId, organizationId: req.organizationId });
    });
    app.get("/api/test/student-read", mounted.requireStudentAuth, (req, res) => {
      res.json({ studentId: req.studentId });
    });
  });
  const cookieHeader = cookie(session.sessionToken);

  assert.equal((await jsonRequest(baseUrl, "/api/test/student-mutation", {
    method: "POST",
    headers: { Cookie: cookieHeader },
  })).response.status, 403);
  assert.equal((await jsonRequest(baseUrl, "/api/test/student-mutation", {
    method: "POST",
    headers: { Cookie: cookieHeader, Origin: "https://attacker.test" },
  })).response.status, 403);
  assert.equal((await jsonRequest(baseUrl, "/api/test/student-mutation", {
    method: "POST",
    headers: { Cookie: cookieHeader, Origin: ORIGIN },
  })).response.status, 401);
  assert.equal((await jsonRequest(baseUrl, "/api/test/student-mutation", {
    method: "POST",
    headers: {
      Cookie: cookieHeader,
      Origin: ORIGIN,
      "X-CSRF-Token": "wrong-token",
    },
  })).response.status, 401);
  const allowed = await jsonRequest(baseUrl, "/api/test/student-mutation", {
    method: "POST",
    headers: {
      Cookie: cookieHeader,
      Origin: ORIGIN,
      "X-CSRF-Token": session.csrfToken,
    },
  });
  assert.equal(allowed.response.status, 200);
  assert.deepEqual(allowed.body, {
    studentId: member.student.id,
    organizationId: owner.organization.id,
  });
  assert.equal((await jsonRequest(baseUrl, "/api/test/student-read", {
    headers: { Cookie: cookieHeader },
  })).response.status, 200);

  tenancy.setMembershipRoles({
    organizationId: owner.organization.id,
    membershipId: member.accepted.membership.id,
    actorAccountId: owner.account.id,
    roles: ["student", "org_admin"],
  });
  assert.equal((await jsonRequest(baseUrl, "/api/test/student-read", {
    headers: { Cookie: cookieHeader },
  })).response.status, 401);
});

test("the same global account registers isolated students in two organizations without legacy hash collisions", async (t) => {
  const { db, tenancy } = store(t);
  const orgA = organization(tenancy, "multi-student-a");
  const orgB = organization(tenancy, "multi-student-b");
  const studentA = tenancy.createStudent({
    organizationId: orgA.organization.id,
    actorAccountId: orgA.account.id,
    displayName: "Student A",
    grade: 10,
  });
  const studentB = tenancy.createStudent({
    organizationId: orgB.organization.id,
    actorAccountId: orgB.account.id,
    displayName: "Student B",
    grade: 11,
  });
  const email = "shared-student@example.test";
  const inviteA = tenancy.createInvitation({
    organizationId: orgA.organization.id,
    actorAccountId: orgA.account.id,
    email,
    role: "student",
    targetStudentId: studentA.id,
  });
  const inviteB = tenancy.createInvitation({
    organizationId: orgB.organization.id,
    actorAccountId: orgB.account.id,
    email,
    role: "student",
    targetStudentId: studentB.id,
  });
  const credentialHashes = new Map();
  const piiRows = new Map();
  const authStore = {
    createStudentCredential(studentId, emailHash, _password, { grade }) {
      if ([...credentialHashes.values()].some((entry) => entry.emailHash === emailHash)) {
        const error = new Error("duplicate legacy email hash");
        error.code = "account_exists";
        throw error;
      }
      credentialHashes.set(studentId, { emailHash, grade });
    },
    getStudentGrade(studentId) { return credentialHashes.get(studentId)?.grade ?? null; },
    deleteStudentCredential() {},
  };
  const piiStmts = {
    upsertStudentPII: {
      run(studentId, emailHash, nameEncrypted, emailEncrypted, parentEmailEncrypted, isMinor) {
        if ([...piiRows.values()].some((entry) => entry.email_hash === emailHash)) {
          throw new Error("duplicate PII email hash");
        }
        piiRows.set(studentId, {
          student_id: studentId,
          email_hash: emailHash,
          name_encrypted: nameEncrypted,
          email_encrypted: emailEncrypted,
          parent_email_encrypted: parentEmailEncrypted,
          is_minor: isMinor,
        });
      },
    },
    getStudentPII: { get: () => null },
  };
  const layer = httpLayer(tenancy, db, {
    authStore,
    piiStmts,
    piiVault: { encryptionKey: KEY },
  });
  const baseUrl = await listen(t, layer);
  const register = (token, grade, name) => jsonRequest(baseUrl, "/api/students/register", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ invitationToken: token, email, password: PASSWORD, grade, name }),
  });
  const first = await register(inviteA.token, 10, "First Tenant Student");
  const second = await register(inviteB.token, 11, "Second Tenant Student");
  assert.equal(first.response.status, 201);
  assert.equal(second.response.status, 201);
  assert.notEqual(first.body.studentId, second.body.studentId);
  assert.deepEqual(new Set(credentialHashes.keys()), new Set([studentA.id, studentB.id]));
  assert.notEqual(
    credentialHashes.get(studentA.id).emailHash,
    credentialHashes.get(studentB.id).emailHash,
  );
  assert.deepEqual(new Set(piiRows.keys()), new Set([studentA.id, studentB.id]));
  assert.notEqual(piiRows.get(studentA.id).email_hash, piiRows.get(studentB.id).email_hash);
});

test("manager routes stay on the cookie tenant and preserve linked-student grade shape", async (t) => {
  const { db, tenancy } = store(t);
  const orgA = organization(tenancy, "tenant-a");
  const orgB = organization(tenancy, "tenant-b");
  const studentA = studentMember(tenancy, orgA, "tenant-a", 10);
  const session = tenancy.createSession({
    email: "owner-tenant-a@example.test",
    password: PASSWORD,
    organizationId: orgA.organization.id,
  });
  const layer = httpLayer(tenancy, db);
  const baseUrl = await listen(t, layer);
  const cookieHeader = cookie(session.sessionToken);

  const listed = await jsonRequest(
    baseUrl,
    `/api/organization/members?organizationId=${encodeURIComponent(orgB.organization.id)}`,
    { headers: { Cookie: cookieHeader } },
  );
  assert.equal(listed.response.status, 200);
  assert.ok(listed.body.members.some((member) =>
    member.studentId === studentA.student.id && member.grade === 10));
  assert.equal(listed.body.members.some((member) => member.id === orgB.membership.id), false);

  const crossTenantMutation = await jsonRequest(
    baseUrl,
    `/api/organization/members/${encodeURIComponent(orgB.membership.id)}/status`,
    {
      method: "PATCH",
      headers: {
        Cookie: cookieHeader,
        Origin: ORIGIN,
        "X-CSRF-Token": session.csrfToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "suspended" }),
    },
  );
  assert.equal(crossTenantMutation.response.status, 404);
  assert.equal(tenancy.listMembers({
    organizationId: orgB.organization.id,
    actorAccountId: orgB.account.id,
  }).find((member) => member.id === orgB.membership.id).status, "active");
});

test("organization authentication defaults to a fifteen-minute server idle lifetime", async (t) => {
  const { db, tenancy } = store(t);
  const owner = organization(tenancy, "default-idle");
  const layer = httpLayer(tenancy, db);
  const baseUrl = await listen(t, layer);
  const signedIn = await jsonRequest(baseUrl, "/api/organization/auth", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "owner-default-idle@example.test",
      password: PASSWORD,
      organizationSlug: owner.organization.slug,
    }),
  });
  assert.equal(signedIn.response.status, 200);
  assert.match(signedIn.response.headers.get("set-cookie") || "", /^cc_saas_session=/u);
  assert.equal(db.prepare(`
    SELECT idle_ttl_ms
    FROM saas_sessions_v2
    WHERE organization_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(owner.organization.id).idle_ttl_ms, 15 * 60 * 1000);
});

test("credential endpoints share a bounded global KDF admission window", async (t) => {
  const { db, tenancy } = store(t);
  const owner = organization(tenancy, "kdf-admission");
  const layer = httpLayer(tenancy, db, {
    kdfGlobalMaxAttempts: 2,
    kdfGlobalWindowMs: 60_000,
  });
  const baseUrl = await listen(t, layer);
  const authenticate = (email) => jsonRequest(baseUrl, "/api/organization/auth", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password: "deliberately incorrect password",
      organizationSlug: owner.organization.slug,
    }),
  });

  assert.equal((await authenticate("unknown-a@example.test")).response.status, 401);
  assert.equal((await authenticate("unknown-b@example.test")).response.status, 401);
  const limited = await authenticate("unknown-c@example.test");
  assert.equal(limited.response.status, 429);
  assert.deepEqual(limited.body, {
    error: "Authentication is temporarily unavailable. Try again later.",
    code: "authentication_rate_limited",
  });
  assert.ok(Number(limited.response.headers.get("retry-after")) >= 1);
  assert.equal(limited.response.headers.get("cache-control"), "no-store");
});

test("session restore fails closed and clears the cookie when CSRF rotation cannot complete", async (t) => {
  const { db, tenancy } = store(t);
  const owner = organization(tenancy, "rotation-failure");
  const session = tenancy.createSession({
    email: "owner-rotation-failure@example.test",
    password: PASSWORD,
    organizationId: owner.organization.id,
  });
  const wrappedTenancy = { ...tenancy, rotateSessionCsrf: () => null };
  const layer = httpLayer(wrappedTenancy, db);
  const baseUrl = await listen(t, layer);
  const result = await jsonRequest(baseUrl, "/api/organization/session", {
    headers: { Cookie: cookie(session.sessionToken) },
  });
  assert.equal(result.response.status, 401);
  assert.equal(result.body.code, "session_required");
  assert.match(result.response.headers.get("set-cookie") || "", /Max-Age=0/u);
});

test("organization password rotation requires origin and CSRF and replaces invalidated sessions", async (t) => {
  const { db, tenancy } = store(t);
  const owner = organization(tenancy, "password-rotation");
  const oldSession = tenancy.createSession({
    email: "owner-password-rotation@example.test",
    password: PASSWORD,
    organizationId: owner.organization.id,
  });
  const layer = httpLayer(tenancy, db);
  const baseUrl = await listen(t, layer);
  const oldCookie = cookie(oldSession.sessionToken);
  const body = JSON.stringify({
    currentPassword: PASSWORD,
    newPassword: "new correct horse battery staple",
  });

  assert.equal((await jsonRequest(baseUrl, "/api/organization/password", {
    method: "PUT",
    headers: {
      Cookie: oldCookie,
      "X-CSRF-Token": oldSession.csrfToken,
      "Content-Type": "application/json",
    },
    body,
  })).response.status, 403);
  assert.equal((await jsonRequest(baseUrl, "/api/organization/password", {
    method: "PUT",
    headers: { Cookie: oldCookie, Origin: ORIGIN, "Content-Type": "application/json" },
    body,
  })).response.status, 401);

  const changed = await jsonRequest(baseUrl, "/api/organization/password", {
    method: "PUT",
    headers: {
      Cookie: oldCookie,
      Origin: ORIGIN,
      "X-CSRF-Token": oldSession.csrfToken,
      "Content-Type": "application/json",
    },
    body,
  });
  assert.equal(changed.response.status, 200);
  assert.equal(changed.body.changed, true);
  assert.equal(changed.body.sessionMode, "cookie");
  assert.ok(changed.body.csrfToken?.length >= 40);
  assert.equal(tenancy.validateSession({ sessionToken: oldSession.sessionToken }), null);
  assert.equal(tenancy.authenticateCredentials({
    email: "owner-password-rotation@example.test",
    password: PASSWORD,
  }), null);
  assert.ok(tenancy.authenticateCredentials({
    email: "owner-password-rotation@example.test",
    password: "new correct horse battery staple",
  }));

  const setCookie = changed.response.headers.get("set-cookie") || "";
  const encodedToken = setCookie.match(/^cc_saas_session=([^;]+)/u)?.[1];
  assert.ok(encodedToken);
  const newSessionToken = decodeURIComponent(encodedToken);
  assert.ok(tenancy.validateSession({
    sessionToken: newSessionToken,
    csrfToken: changed.body.csrfToken,
    requireCsrf: true,
  }));
});

test("guardian portal reports and revokes consent for the authenticated guardian only", async (t) => {
  const { db, tenancy } = store(t);
  const owner = organization(tenancy, "guardian-consent");
  const member = studentMember(tenancy, owner, "guardian-consent");
  const guardianA = guardianMember(tenancy, owner, member.student, "guardian-a");
  const guardianB = guardianMember(tenancy, owner, member.student, "guardian-b");
  const piiStmts = legacyConsentStatements(db);
  const consentTypes = ["data_processing", "ai_interaction", "cross_border_transfer"];
  tenancy.grantGuardianConsent({
    organizationId: owner.organization.id,
    studentId: member.student.id,
    actorAccountId: guardianB.accepted.account.id,
    consentType: "data_processing",
    policyVersion: "2026.1",
    scope: { policyVersion: "2026.1", source: "other_guardian" },
  });
  const session = tenancy.createSession({
    email: guardianA.email,
    password: PASSWORD,
    organizationId: owner.organization.id,
  });
  const layer = httpLayer(tenancy, db, {
    guardianConsentRequired: true,
    piiStmts,
    requiredConsents: consentTypes,
  });
  const baseUrl = await listen(t, layer);
  const cookieHeader = cookie(session.sessionToken);

  const before = await jsonRequest(baseUrl, "/api/organization/guardian/students", {
    headers: { Cookie: cookieHeader },
  });
  assert.equal(before.response.status, 200);
  assert.equal(before.body.policyVersion, "2026.1");
  assert.deepEqual(
    before.body.students[0].requiredConsents.map((item) => item.type),
    consentTypes,
  );
  before.body.students[0].requiredConsents.forEach((descriptor) => {
    assert.equal(descriptor.policyVersion, "2026.1");
    assert.equal(descriptor.granted, false);
    assert.ok(descriptor.purpose.length > 20);
    assert.ok(descriptor.dataCategories.length > 0);
    assert.ok(descriptor.recipients.length > 0);
    assert.ok(descriptor.internationalTransfers.length > 20);
    assert.ok(descriptor.retention.length > 20);
    assert.ok(descriptor.rights.length > 0);
    assert.ok(descriptor.policyUrl);
    assert.equal(descriptor.scope.studentId, member.student.id);
    assert.equal(descriptor.scope.consentType, descriptor.type);
    assert.equal(descriptor.scope.policyVersion, "2026.1");
  });
  const consentScopes = Object.fromEntries(
    before.body.students[0].requiredConsents
      .map((descriptor) => [descriptor.type, descriptor.scope]),
  );

  const noCsrf = await jsonRequest(baseUrl, "/api/organization/guardian/consent", {
    method: "POST",
    headers: { Cookie: cookieHeader, Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({
      studentId: member.student.id,
      consentType: "data_processing",
      policyVersion: "2026.1",
      granted: true,
    }),
  });
  assert.equal(noCsrf.response.status, 401);

  const staleScope = await jsonRequest(baseUrl, "/api/organization/guardian/consent", {
    method: "POST",
    headers: {
      Cookie: cookieHeader,
      Origin: ORIGIN,
      "X-CSRF-Token": session.csrfToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      studentId: member.student.id,
      consentType: "data_processing",
      policyVersion: "2026.1",
      granted: true,
      scope: { ...consentScopes.data_processing, purpose: "A substituted purpose" },
    }),
  });
  assert.equal(staleScope.response.status, 400);
  assert.equal(staleScope.body.code, "invalid_consent_scope");

  for (const consentType of consentTypes) {
    const grant = await jsonRequest(baseUrl, "/api/organization/guardian/consent", {
      method: "POST",
      headers: {
        Cookie: cookieHeader,
        Origin: ORIGIN,
        "X-CSRF-Token": session.csrfToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        studentId: member.student.id,
        consentType,
        policyVersion: "2026.1",
        granted: true,
        scope: consentScopes[consentType],
      }),
    });
    assert.equal(grant.response.status, 200);
    assert.equal(grant.body.granted, true);
    assert.equal(grant.body.consent.consentType, consentType);
    assert.ok(Object.keys(grant.body.consent.scope).length > 0);
    assert.equal(grant.body.consent.scope.policyVersion, "2026.1");
  }
  const legacyAllowed = validateRequiredConsents(
    piiStmts,
    member.student.id,
    "ai_interaction",
  );
  assert.equal(legacyAllowed.allowed, true);
  assert.deepEqual(legacyAllowed.missing, []);
  const legacyRows = piiStmts.getAllConsent.all(member.student.id);
  assert.equal(legacyRows.length, 3);
  legacyRows.forEach((row) => {
    assert.equal(row.granted_by, "parent_guardian");
    const scope = JSON.parse(row.scope);
    assert.equal(scope.source, "saas_guardian_portal");
    assert.equal(scope.guardianActorAccountId, guardianA.accepted.account.id);
    assert.equal(scope.policySnapshot.policyVersion, "2026.1");
  });
  const afterGrant = await jsonRequest(baseUrl, "/api/organization/guardian/students", {
    headers: { Cookie: cookieHeader },
  });
  assert.ok(afterGrant.body.students[0].requiredConsents.every((item) => item.granted));

  const revoke = await jsonRequest(baseUrl, "/api/organization/guardian/consent", {
    method: "POST",
    headers: {
      Cookie: cookieHeader,
      Origin: ORIGIN,
      "X-CSRF-Token": session.csrfToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      studentId: member.student.id,
      consentType: "cross_border_transfer",
      policyVersion: "2026.1",
      granted: false,
    }),
  });
  assert.equal(revoke.response.status, 200);
  assert.equal(revoke.body.consent.status, "revoked");
  const legacyBlocked = validateRequiredConsents(
    piiStmts,
    member.student.id,
    "ai_interaction",
  );
  assert.equal(legacyBlocked.allowed, false);
  assert.deepEqual(legacyBlocked.missing, ["cross_border_transfer"]);
  const afterRevoke = await jsonRequest(baseUrl, "/api/organization/guardian/students", {
    headers: { Cookie: cookieHeader },
  });
  assert.equal(
    afterRevoke.body.students[0].requiredConsents
      .find((item) => item.type === "cross_border_transfer").granted,
    false,
  );
});

test("student account close clears its cookie and pre-deletes consent children for legacy erasure", (t) => {
  const { db, tenancy } = store(t);
  const owner = organization(tenancy, "http-close");
  const member = studentMember(tenancy, owner, "http-close");
  const guardian = guardianMember(tenancy, owner, member.student, "http-close");
  tenancy.grantGuardianConsent({
    organizationId: owner.organization.id,
    studentId: member.student.id,
    actorAccountId: guardian.accepted.account.id,
    consentType: "data_processing",
    policyVersion: "2026.1",
    scope: { policyVersion: "2026.1", purpose: "account closure regression" },
  });
  const session = tenancy.createSession({
    email: member.email,
    password: PASSWORD,
    organizationId: owner.organization.id,
  });
  const layer = httpLayer(tenancy, db);
  const responseHeaders = new Map();
  const req = {
    organizationId: owner.organization.id,
    saasAccountId: member.accepted.account.id,
    studentId: member.student.id,
    secure: true,
    res: {
      setHeader(name, value) { responseHeaders.set(String(name).toLowerCase(), value); },
    },
  };
  const closed = layer.closeStudentAccount(req);
  assert.equal(closed.studentClosed, true);
  assert.equal(db.prepare(
    "SELECT COUNT(*) AS count FROM saas_consent_grants WHERE student_id = ?",
  ).get(member.student.id).count, 0);
  assert.match(responseHeaders.get("set-cookie") || "", /Max-Age=0/u);
  assert.match(responseHeaders.get("set-cookie") || "", /Secure/u);
  assert.equal(tenancy.validateSession({ sessionToken: session.sessionToken }), null);

  const legacyOrder = db.transaction(() => {
    db.prepare("DELETE FROM saas_student_access_grants WHERE student_id = ?").run(member.student.id);
    db.prepare("DELETE FROM saas_guardian_links WHERE student_id = ?").run(member.student.id);
    db.prepare("DELETE FROM saas_consent_grants WHERE student_id = ?").run(member.student.id);
  });
  assert.doesNotThrow(() => legacyOrder());
});

test("password reset cooldown is non-enumerating and preserves the first usable reset", async (t) => {
  const { db, tenancy } = store(t);
  organization(tenancy, "reset-cooldown");
  const deliveries = [];
  const layer = httpLayer(tenancy, db, {
    mailer: {
      sendInvitation: async () => ({ delivered: true }),
      async sendPasswordReset(input) {
        deliveries.push(input);
        return { delivered: true };
      },
    },
    passwordResetCooldownMs: 60_000,
  });
  const baseUrl = await listen(t, layer);
  const requestReset = (email) => jsonRequest(
    baseUrl,
    "/api/organization/password-reset/request",
    {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    },
  );

  const first = await requestReset("owner-reset-cooldown@example.test");
  const suppressed = await requestReset("owner-reset-cooldown@example.test");
  const unknown = await requestReset("unknown-reset-cooldown@example.test");
  assert.equal(first.response.status, 202);
  assert.deepEqual(suppressed.body, first.body);
  assert.deepEqual(unknown.body, first.body);
  for (let attempt = 0; attempt < 20 && deliveries.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(deliveries.length, 1);
  const reset = deliveries[0];
  const row = db.prepare(`
    SELECT used_at, revoked_at FROM saas_password_reset_tokens WHERE id = ?
  `).get(reset.resetId);
  assert.equal(row.used_at, null);
  assert.equal(row.revoked_at, null);

  const completed = await jsonRequest(baseUrl, "/api/organization/password-reset/complete", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({
      token: reset.token,
      email: "owner-reset-cooldown@example.test",
      newPassword: "cooldown replacement password is secure",
    }),
  });
  assert.equal(completed.response.status, 200);
});

test("password reset HTTP flow is uniform, exact-origin, asynchronous, and never auto-logs in", async (t) => {
  const { db, tenancy } = store(t);
  const owner = organization(tenancy, "http-password-reset");
  const oldSession = tenancy.createSession({
    email: "owner-http-password-reset@example.test",
    password: PASSWORD,
    organizationId: owner.organization.id,
  });
  const deliveries = [];
  let failDelivery = false;
  const mailer = {
    sendInvitation: async () => ({ delivered: true }),
    async sendPasswordReset(input) {
      deliveries.push(input);
      if (failDelivery) {
        const error = new Error("provider detail must not be logged");
        error.code = "email_delivery_failed";
        throw error;
      }
      return { delivered: true, providerId: "reset-email" };
    },
  };
  const layer = httpLayer(tenancy, db, {
    mailer,
    passwordResetTtlMs: 1_234,
    passwordResetCooldownMs: 0,
  });
  const baseUrl = await listen(t, layer);
  const requestBody = (email) => JSON.stringify({ email });

  assert.equal((await jsonRequest(baseUrl, "/api/organization/password-reset/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: requestBody("owner-http-password-reset@example.test"),
  })).response.status, 403);

  const invalid = await jsonRequest(baseUrl, "/api/organization/password-reset/request", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: requestBody("not-an-email"),
  });
  const unknown = await jsonRequest(baseUrl, "/api/organization/password-reset/request", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: requestBody("unknown@example.test"),
  });
  const known = await jsonRequest(baseUrl, "/api/organization/password-reset/request", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: requestBody("owner-http-password-reset@example.test"),
  });
  assert.equal(invalid.response.status, 202);
  assert.equal(unknown.response.status, 202);
  assert.equal(known.response.status, 202);
  assert.deepEqual(invalid.body, { accepted: true });
  assert.deepEqual(unknown.body, invalid.body);
  assert.deepEqual(known.body, invalid.body);
  assert.equal(JSON.stringify(known.body).includes("token"), false);

  for (let attempt = 0; attempt < 20 && deliveries.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(deliveries.length, 1);
  const delivered = deliveries[0];
  const resetRow = db.prepare(`
    SELECT * FROM saas_password_reset_tokens WHERE id = ?
  `).get(delivered.resetId);
  assert.equal(resetRow.expires_at - resetRow.created_at, 1_234);
  assert.notEqual(resetRow.token_hash, delivered.token);

  assert.equal((await jsonRequest(baseUrl, "/api/organization/password-reset/complete", {
    method: "POST",
    headers: { Origin: "https://attacker.test", "Content-Type": "application/json" },
    body: JSON.stringify({
      token: delivered.token,
      email: "owner-http-password-reset@example.test",
      newPassword: "reset replacement password is secure",
    }),
  })).response.status, 403);
  assert.equal((await jsonRequest(baseUrl, "/api/organization/password-reset/complete", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({
      token: delivered.token,
      email: "wrong@example.test",
      newPassword: "reset replacement password is secure",
    }),
  })).response.status, 403);
  const completed = await jsonRequest(baseUrl, "/api/organization/password-reset/complete", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({
      token: delivered.token,
      email: "owner-http-password-reset@example.test",
      newPassword: "reset replacement password is secure",
    }),
  });
  assert.equal(completed.response.status, 200);
  assert.deepEqual(completed.body, { completed: true });
  assert.match(completed.response.headers.get("set-cookie") || "", /Max-Age=0/u);
  assert.equal(tenancy.validateSession({ sessionToken: oldSession.sessionToken }), null);
  assert.ok(tenancy.authenticateCredentials({
    email: "owner-http-password-reset@example.test",
    password: "reset replacement password is secure",
  }));
  assert.equal((await jsonRequest(baseUrl, "/api/organization/password-reset/complete", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({
      token: delivered.token,
      email: "owner-http-password-reset@example.test",
      newPassword: "another replacement password is secure",
    }),
  })).response.status, 409);

  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...parts) => warnings.push(parts.join(" "));
  t.after(() => { console.warn = originalWarn; });
  failDelivery = true;
  const failedDeliveryResponse = await jsonRequest(
    baseUrl,
    "/api/organization/password-reset/request",
    {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: requestBody("owner-http-password-reset@example.test"),
    },
  );
  assert.equal(failedDeliveryResponse.response.status, 202);
  assert.deepEqual(failedDeliveryResponse.body, unknown.body);
  for (let attempt = 0; attempt < 20 && deliveries.length < 2; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  const failedDelivery = deliveries[1];
  const failedRow = db.prepare(`
    SELECT revoked_at FROM saas_password_reset_tokens WHERE id = ?
  `).get(failedDelivery.resetId);
  assert.ok(failedRow.revoked_at);
  assert.ok(warnings.some((message) => message.includes("code=email_delivery_failed")));
  assert.equal(warnings.some((message) => message.includes(failedDelivery.token)), false);
  assert.equal(warnings.some((message) => message.includes("owner-http-password-reset@example.test")), false);
});

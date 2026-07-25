import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import {
  SAAS_ROLES,
  SECURITY_RETENTION_DEFAULTS,
  STUDENT_PERMISSIONS,
  initSaasTenancy,
} from "../saas-tenancy.js";

const EMAIL_PEPPER = "saas-tenancy-unit-test-email-pepper";
const ENCRYPTION_KEY = Buffer.alloc(32, 7);
const OWNER_PASSWORD = "correct horse battery staple";
const MEMBER_PASSWORD = "another correct horse battery staple";

function makeStore(t, { legacy = false } = {}) {
  const db = new Database(":memory:");
  if (legacy) db.exec("CREATE TABLE legacy_desktop_marker (id TEXT PRIMARY KEY)");
  t.after(() => db.close());
  const tenancy = initSaasTenancy({
    db,
    emailPepper: EMAIL_PEPPER,
    encryptionKey: ENCRYPTION_KEY,
  });
  return { db, tenancy };
}

function createOrganization(tenancy, suffix, now = 1_000) {
  return tenancy.createOrganization({
    name: `Organization ${suffix}`,
    slug: `organization-${suffix}`,
    ownerEmail: `owner-${suffix}@example.test`,
    ownerPassword: OWNER_PASSWORD,
    now,
  });
}

function hasCode(code) {
  return (error) => error?.code === code;
}

test("schema initialization is additive and idempotent, and opaque secrets are never stored raw", (t) => {
  const { db, tenancy } = makeStore(t, { legacy: true });
  const second = initSaasTenancy({
    db,
    emailPepper: EMAIL_PEPPER,
    encryptionKey: ENCRYPTION_KEY,
  });
  assert.equal(second.schemaVersion, 4);
  assert.deepEqual(
    db.prepare("SELECT version FROM saas_schema_migrations ORDER BY version").all(),
    [{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }],
  );
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name = 'legacy_desktop_marker'").get());
  assert.deepEqual(SAAS_ROLES, ["owner", "org_admin", "counselor", "student", "guardian"]);
  assert.ok(STUDENT_PERMISSIONS.includes("student.profile.read"));

  const owner = createOrganization(tenancy, "secrets");
  const created = tenancy.createInvitation({
    organizationId: owner.organization.id,
    actorAccountId: owner.account.id,
    email: "invitee@example.test",
    role: "counselor",
    now: 2_000,
  });
  const storedInvitation = db.prepare(
    "SELECT token_hash, email_hash, email_ciphertext FROM saas_invitations WHERE id = ?",
  ).get(created.invitation.id);
  assert.notEqual(storedInvitation.token_hash, created.token);
  assert.equal(storedInvitation.token_hash.includes(created.token), false);
  assert.equal(storedInvitation.email_hash.includes("invitee@example.test"), false);
  assert.equal(storedInvitation.email_ciphertext.includes("invitee@example.test"), false);
  assert.equal(JSON.stringify(created.invitation).includes("token_hash"), false);
  assert.equal(JSON.stringify(created.invitation).includes("email_hash"), false);

  const session = tenancy.createSession({
    email: "owner-secrets@example.test",
    password: OWNER_PASSWORD,
    organizationId: owner.organization.id,
    now: 3_000,
  });
  const storedSession = db.prepare(
    "SELECT token_hash, csrf_hash FROM saas_sessions_v2 WHERE membership_id = ?",
  ).get(owner.membership.id);
  assert.notEqual(storedSession.token_hash, session.sessionToken);
  assert.notEqual(storedSession.csrf_hash, session.csrfToken);
  assert.equal(JSON.stringify(session.session).includes("hash"), false);
});

test("invitations enforce email binding, allowlisted roles, expiry, revocation, and single use", (t) => {
  const { tenancy } = makeStore(t);
  const owner = createOrganization(tenancy, "invites", 10_000);
  const student = tenancy.createStudent({
    organizationId: owner.organization.id,
    actorAccountId: owner.account.id,
    displayName: "Target Student",
    grade: 11,
    now: 10_100,
  });

  assert.throws(() => tenancy.createInvitation({
    organizationId: owner.organization.id,
    actorAccountId: owner.account.id,
    email: "escalation@example.test",
    role: "owner",
    now: 10_200,
  }), hasCode("invalid_role"));
  assert.throws(() => tenancy.createInvitation({
    organizationId: owner.organization.id,
    actorAccountId: owner.account.id,
    email: "guardian-without-student@example.test",
    role: "guardian",
    now: 10_200,
  }), hasCode("student_required"));

  const invitation = tenancy.createInvitation({
    organizationId: owner.organization.id,
    actorAccountId: owner.account.id,
    email: "Counselor@Example.test",
    role: "counselor",
    targetStudentId: student.id,
    permissions: ["student.profile.read"],
    expiresAt: 20_000,
    now: 10_300,
  });
  assert.equal(tenancy.inspectInvitation({ token: invitation.token, now: 10_350 }).email, undefined);
  assert.equal(tenancy.inspectInvitation({
    token: invitation.token,
    now: 10_350,
    includeEmail: true,
  }).email, "counselor@example.test");
  assert.throws(() => tenancy.acceptInvitation({
    token: invitation.token,
    email: "attacker@example.test",
    password: MEMBER_PASSWORD,
    now: 10_400,
  }), hasCode("invitation_email_mismatch"));
  assert.equal(tenancy.inspectInvitation({ token: invitation.token, now: 10_400 }).status, "pending");

  const accepted = tenancy.acceptInvitation({
    token: invitation.token,
    email: "counselor@example.test",
    password: MEMBER_PASSWORD,
    displayName: "Casey Counselor",
    now: 10_500,
  });
  assert.equal(accepted.account.displayName, "Casey Counselor");
  assert.equal(accepted.membership.displayName, "Casey Counselor");
  assert.deepEqual(accepted.membership.roles, ["counselor"]);
  assert.deepEqual(accepted.accessGrants.map((grant) => grant.permission), ["student.profile.read"]);
  assert.equal(accepted.invitation.status, "accepted");
  assert.throws(() => tenancy.acceptInvitation({
    token: invitation.token,
    email: "counselor@example.test",
    password: MEMBER_PASSWORD,
    now: 10_600,
  }), hasCode("invitation_used"));

  const expiring = tenancy.createInvitation({
    organizationId: owner.organization.id,
    actorAccountId: owner.account.id,
    email: "expired@example.test",
    role: "counselor",
    expiresAt: 11_000,
    now: 10_700,
  });
  assert.throws(() => tenancy.acceptInvitation({
    token: expiring.token,
    email: "expired@example.test",
    password: MEMBER_PASSWORD,
    now: 11_000,
  }), hasCode("invitation_expired"));

  const revocable = tenancy.createInvitation({
    organizationId: owner.organization.id,
    actorAccountId: owner.account.id,
    email: "revoked@example.test",
    role: "student",
    now: 10_800,
  });
  assert.equal(tenancy.revokeInvitation({
    organizationId: owner.organization.id,
    invitationId: revocable.invitation.id,
    actorAccountId: owner.account.id,
    now: 10_900,
  }).status, "revoked");
  assert.throws(() => tenancy.acceptInvitation({
    token: revocable.token,
    email: "revoked@example.test",
    password: MEMBER_PASSWORD,
    now: 10_950,
  }), hasCode("invitation_revoked"));

  const statuses = tenancy.listInvitations({
    organizationId: owner.organization.id,
    actorAccountId: owner.account.id,
    now: 11_100,
  }).map((row) => row.status);
  assert.ok(statuses.includes("accepted"));
  assert.ok(statuses.includes("expired"));
  assert.ok(statuses.includes("revoked"));
  const listedCounselor = tenancy.listMembers({
    organizationId: owner.organization.id,
    actorAccountId: owner.account.id,
  }).find((row) => row.accountId === accepted.account.id);
  assert.equal(listedCounselor.displayName, "Casey Counselor");
});

test("student context is tenant-scoped and exact-grant based; managers never inherit student data", (t) => {
  const { tenancy } = makeStore(t);
  const orgA = createOrganization(tenancy, "alpha", 20_000);
  const orgB = createOrganization(tenancy, "bravo", 20_100);
  const studentA = tenancy.createStudent({
    organizationId: orgA.organization.id,
    actorAccountId: orgA.account.id,
    displayName: "Alpha Student",
    grade: 10,
    now: 20_200,
  });

  assert.throws(() => tenancy.getStudentContext({
    organizationId: orgA.organization.id,
    studentId: studentA.id,
    actorAccountId: orgA.account.id,
    permission: "student.profile.read",
    now: 20_300,
  }), hasCode("student_access_forbidden"));

  const counselorInvite = tenancy.createInvitation({
    organizationId: orgA.organization.id,
    actorAccountId: orgA.account.id,
    email: "alpha-counselor@example.test",
    role: "counselor",
    targetStudentId: studentA.id,
    permissions: ["student.profile.read"],
    now: 20_400,
  });
  const counselorA = tenancy.acceptInvitation({
    token: counselorInvite.token,
    email: "alpha-counselor@example.test",
    password: MEMBER_PASSWORD,
    now: 20_500,
  });
  const allowed = tenancy.getStudentContext({
    organizationId: orgA.organization.id,
    studentId: studentA.id,
    actorAccountId: counselorA.account.id,
    permission: "student.profile.read",
    now: 20_600,
  });
  assert.equal(allowed.student.id, studentA.id);
  assert.equal(allowed.access.source, "access_grant");
  assert.throws(() => tenancy.getStudentContext({
    organizationId: orgA.organization.id,
    studentId: studentA.id,
    actorAccountId: counselorA.account.id,
    permission: "student.plan.read",
    now: 20_600,
  }), hasCode("student_access_forbidden"));

  const adminInvite = tenancy.createInvitation({
    organizationId: orgA.organization.id,
    actorAccountId: orgA.account.id,
    email: "alpha-admin@example.test",
    role: "org_admin",
    now: 20_650,
  });
  const admin = tenancy.acceptInvitation({
    token: adminInvite.token,
    email: "alpha-admin@example.test",
    password: MEMBER_PASSWORD,
    now: 20_700,
  });
  assert.throws(() => tenancy.getStudentContext({
    organizationId: orgA.organization.id,
    studentId: studentA.id,
    actorAccountId: admin.account.id,
    now: 20_800,
  }), hasCode("student_access_forbidden"));
  assert.throws(() => tenancy.grantStudentAccess({
    organizationId: orgA.organization.id,
    studentId: studentA.id,
    membershipId: admin.membership.id,
    actorAccountId: orgA.account.id,
    permission: "student.profile.read",
    now: 20_800,
  }), hasCode("invalid_grantee"));

  const counselorBInvite = tenancy.createInvitation({
    organizationId: orgB.organization.id,
    actorAccountId: orgB.account.id,
    email: "bravo-counselor@example.test",
    role: "counselor",
    now: 20_900,
  });
  const counselorB = tenancy.acceptInvitation({
    token: counselorBInvite.token,
    email: "bravo-counselor@example.test",
    password: MEMBER_PASSWORD,
    now: 21_000,
  });
  assert.throws(() => tenancy.getStudentContext({
    organizationId: orgA.organization.id,
    studentId: studentA.id,
    actorAccountId: counselorB.account.id,
    now: 21_100,
  }), hasCode("membership_not_found"));
  assert.throws(() => tenancy.getStudentContext({
    organizationId: orgB.organization.id,
    studentId: studentA.id,
    actorAccountId: counselorB.account.id,
    now: 21_100,
  }), hasCode("student_not_found"));
  assert.throws(() => tenancy.grantStudentAccess({
    organizationId: orgA.organization.id,
    studentId: studentA.id,
    membershipId: counselorB.membership.id,
    actorAccountId: orgA.account.id,
    permission: "student.profile.read",
    now: 21_100,
  }), hasCode("membership_not_found"));

  const studentInvite = tenancy.createInvitation({
    organizationId: orgA.organization.id,
    actorAccountId: orgA.account.id,
    email: "alpha-student@example.test",
    role: "student",
    targetStudentId: studentA.id,
    now: 21_200,
  });
  const studentAccount = tenancy.acceptInvitation({
    token: studentInvite.token,
    email: "alpha-student@example.test",
    password: MEMBER_PASSWORD,
    displayName: "Alex Student",
    now: 21_300,
  });
  const selfContext = tenancy.getStudentContext({
    organizationId: orgA.organization.id,
    studentId: studentA.id,
    actorAccountId: studentAccount.account.id,
    permission: "student.plan.write",
    now: 21_400,
  });
  assert.equal(selfContext.access.source, "student_self");
  const accountContext = tenancy.getAccountContext({
    organizationId: orgA.organization.id,
    accountId: studentAccount.account.id,
  });
  assert.equal(accountContext.account.email, "alpha-student@example.test");
  assert.equal(accountContext.account.displayName, "Alex Student");
  assert.deepEqual(accountContext.membership.roles, ["student"]);
  assert.equal(accountContext.student.id, studentA.id);
  assert.throws(() => tenancy.getAccountContext({
    organizationId: orgB.organization.id,
    accountId: studentAccount.account.id,
  }), hasCode("membership_not_found"));
  const studentMember = tenancy.listMembers({
    organizationId: orgA.organization.id,
    actorAccountId: orgA.account.id,
  }).find((row) => row.accountId === studentAccount.account.id);
  assert.equal(studentMember.studentId, studentA.id);
  assert.deepEqual(studentMember.student, {
    id: studentA.id,
    displayName: "Alpha Student",
    grade: 10,
  });

  tenancy.revokeStudentAccess({
    organizationId: orgA.organization.id,
    grantId: counselorA.accessGrants[0].id,
    actorAccountId: orgA.account.id,
    now: 21_500,
  });
  assert.throws(() => tenancy.getStudentContext({
    organizationId: orgA.organization.id,
    studentId: studentA.id,
    actorAccountId: counselorA.account.id,
    permission: "student.profile.read",
    now: 21_600,
  }), hasCode("student_access_forbidden"));
  assert.throws(() => tenancy.listMembers({
    organizationId: orgA.organization.id,
    actorAccountId: counselorA.account.id,
  }), hasCode("forbidden"));
});

test("v2 sessions enforce CSRF, live membership and organization state, auth version, and absolute expiry", (t) => {
  const { tenancy } = makeStore(t);
  const owner = createOrganization(tenancy, "sessions", 30_000);
  const invite = tenancy.createInvitation({
    organizationId: owner.organization.id,
    actorAccountId: owner.account.id,
    email: "session-member@example.test",
    role: "counselor",
    now: 30_100,
  });
  const member = tenancy.acceptInvitation({
    token: invite.token,
    email: "session-member@example.test",
    password: MEMBER_PASSWORD,
    now: 30_200,
  });

  const first = tenancy.createSession({
    email: "session-member@example.test",
    password: MEMBER_PASSWORD,
    organizationId: owner.organization.id,
    idleTtlMs: 500,
    absoluteTtlMs: 2_000,
    now: 30_300,
  });
  assert.equal(tenancy.validateSession({
    sessionToken: first.sessionToken,
    organizationId: owner.organization.id,
    csrfToken: "wrong-csrf-token",
    requireCsrf: true,
    now: 30_350,
  }), null);
  assert.deepEqual(tenancy.validateSession({
    sessionToken: first.sessionToken,
    organizationId: owner.organization.id,
    csrfToken: first.csrfToken,
    requireCsrf: true,
    now: 30_350,
  }).roles, ["counselor"]);
  const rotatedCsrf = tenancy.rotateSessionCsrf({
    sessionToken: first.sessionToken,
    now: 30_355,
  });
  assert.ok(rotatedCsrf?.length >= 40);
  assert.equal(tenancy.validateSession({
    sessionToken: first.sessionToken,
    csrfToken: first.csrfToken,
    requireCsrf: true,
    now: 30_356,
  }), null);
  assert.ok(tenancy.validateSession({
    sessionToken: first.sessionToken,
    csrfToken: rotatedCsrf,
    requireCsrf: true,
    now: 30_356,
  }));
  assert.equal(tenancy.validateSession({
    sessionToken: first.sessionToken,
    organizationId: "another-organization",
    now: 30_360,
  }), null);

  tenancy.setMembershipStatus({
    organizationId: owner.organization.id,
    membershipId: member.membership.id,
    actorAccountId: owner.account.id,
    status: "suspended",
    now: 30_400,
  });
  assert.equal(tenancy.validateSession({ sessionToken: first.sessionToken, now: 30_410 }), null);
  assert.equal(tenancy.rotateSessionCsrf({ sessionToken: first.sessionToken, now: 30_411 }), null);
  assert.throws(() => tenancy.createSession({
    email: "session-member@example.test",
    password: MEMBER_PASSWORD,
    organizationId: owner.organization.id,
    now: 30_420,
  }), hasCode("membership_suspended"));
  tenancy.setMembershipStatus({
    organizationId: owner.organization.id,
    membershipId: member.membership.id,
    actorAccountId: owner.account.id,
    status: "active",
    now: 30_430,
  });
  assert.equal(tenancy.validateSession({ sessionToken: first.sessionToken, now: 30_440 }), null);

  const second = tenancy.createSession({
    email: "session-member@example.test",
    password: MEMBER_PASSWORD,
    organizationId: owner.organization.id,
    now: 30_500,
  });
  tenancy.setOrganizationStatus({
    organizationId: owner.organization.id,
    actorAccountId: owner.account.id,
    status: "suspended",
    now: 30_550,
  });
  assert.equal(tenancy.validateSession({ sessionToken: second.sessionToken, now: 30_560 }), null);
  tenancy.setOrganizationStatus({
    organizationId: owner.organization.id,
    actorAccountId: owner.account.id,
    status: "active",
    now: 30_570,
  });

  const third = tenancy.createSession({
    email: "session-member@example.test",
    password: MEMBER_PASSWORD,
    organizationId: owner.organization.id,
    now: 30_600,
  });
  const changed = tenancy.invalidateAccountSessions({
    accountId: member.account.id,
    actorAccountId: member.account.id,
    organizationId: owner.organization.id,
    now: 30_650,
  });
  assert.equal(changed.authVersion, member.account.authVersion + 1);
  assert.equal(tenancy.validateSession({ sessionToken: third.sessionToken, now: 30_660 }), null);

  const bounded = tenancy.createSession({
    email: "session-member@example.test",
    password: MEMBER_PASSWORD,
    organizationId: owner.organization.id,
    idleTtlMs: 70,
    absoluteTtlMs: 100,
    now: 31_000,
  });
  assert.ok(tenancy.validateSession({ sessionToken: bounded.sessionToken, now: 31_060 }));
  assert.ok(tenancy.validateSession({ sessionToken: bounded.sessionToken, now: 31_099 }));
  assert.equal(tenancy.validateSession({ sessionToken: bounded.sessionToken, now: 31_100 }), null);
  assert.equal(tenancy.rotateSessionCsrf({ sessionToken: bounded.sessionToken, now: 31_101 }), null);

  const listed = tenancy.listMembers({
    organizationId: owner.organization.id,
    actorAccountId: owner.account.id,
  });
  assert.equal(listed.find((row) => row.id === member.membership.id).status, "active");
  assert.throws(() => tenancy.setMembershipStatus({
    organizationId: owner.organization.id,
    membershipId: owner.membership.id,
    actorAccountId: owner.account.id,
    status: "suspended",
    now: 31_200,
  }), hasCode("last_owner"));
});

test("sessions default to fifteen idle minutes and deployment policy clamps older longer sessions", (t) => {
  const { db, tenancy } = makeStore(t);
  const owner = createOrganization(tenancy, "idle-policy", 100_000);
  const defaultSession = tenancy.createSession({
    email: "owner-idle-policy@example.test",
    password: OWNER_PASSWORD,
    organizationId: owner.organization.id,
    now: 100_100,
  });
  assert.equal(defaultSession.session.idleExpiresAt, 100_100 + 15 * 60 * 1000);

  const legacySession = tenancy.createSession({
    email: "owner-idle-policy@example.test",
    password: OWNER_PASSWORD,
    organizationId: owner.organization.id,
    idleTtlMs: 8 * 60 * 60 * 1000,
    now: 100_200,
  });
  const enforced = tenancy.capActiveSessionIdleTtl({
    idleTtlMs: 15 * 60 * 1000,
    now: 100_200 + 5 * 60 * 1000,
  });
  assert.deepEqual(enforced, {
    sessionsClamped: 1,
    sessionsRevoked: 0,
    enforcedAt: 100_200 + 5 * 60 * 1000,
  });
  const stored = db.prepare(`
    SELECT idle_ttl_ms, idle_expires_at
    FROM saas_sessions_v2
    WHERE token_hash = ?
  `).get(crypto.createHash("sha256").update(legacySession.sessionToken).digest("hex"));
  assert.deepEqual(stored, {
    idle_ttl_ms: 15 * 60 * 1000,
    idle_expires_at: 100_200 + 15 * 60 * 1000,
  });
  const lastActiveAt = 100_200 + 15 * 60 * 1000 - 1;
  assert.ok(tenancy.validateSession({
    sessionToken: legacySession.sessionToken,
    now: lastActiveAt,
  }));
  assert.equal(tenancy.validateSession({
    sessionToken: legacySession.sessionToken,
    now: lastActiveAt + 15 * 60 * 1000,
  }), null);

  const staleStore = makeStore(t);
  const staleOwner = createOrganization(staleStore.tenancy, "stale-idle-policy", 200_000);
  const staleSession = staleStore.tenancy.createSession({
    email: "owner-stale-idle-policy@example.test",
    password: OWNER_PASSWORD,
    organizationId: staleOwner.organization.id,
    idleTtlMs: 8 * 60 * 60 * 1000,
    now: 200_100,
  });
  assert.deepEqual(staleStore.tenancy.capActiveSessionIdleTtl({
    idleTtlMs: 15 * 60 * 1000,
    now: 200_100 + 15 * 60 * 1000,
  }), {
    sessionsClamped: 1,
    sessionsRevoked: 1,
    enforcedAt: 200_100 + 15 * 60 * 1000,
  });
  assert.equal(staleStore.tenancy.validateSession({
    sessionToken: staleSession.sessionToken,
    now: 200_100 + 15 * 60 * 1000,
  }), null);
});

test("only verified guardians can grant policy-versioned consent; students cannot self-assert guardianship", (t) => {
  const { tenancy } = makeStore(t);
  const owner = createOrganization(tenancy, "consent", 40_000);
  const student = tenancy.createStudent({
    organizationId: owner.organization.id,
    actorAccountId: owner.account.id,
    displayName: "Consent Student",
    grade: 9,
    now: 40_100,
  });
  const studentInvite = tenancy.createInvitation({
    organizationId: owner.organization.id,
    actorAccountId: owner.account.id,
    email: "consent-student@example.test",
    role: "student",
    targetStudentId: student.id,
    now: 40_200,
  });
  const studentAccount = tenancy.acceptInvitation({
    token: studentInvite.token,
    email: "consent-student@example.test",
    password: MEMBER_PASSWORD,
    displayName: "Sam Student",
    now: 40_300,
  });

  const guardianInvite = tenancy.createInvitation({
    organizationId: owner.organization.id,
    actorAccountId: owner.account.id,
    email: "verified-guardian@example.test",
    role: "guardian",
    targetStudentId: student.id,
    permissions: ["student.profile.read"],
    now: 40_400,
  });
  const guardian = tenancy.acceptInvitation({
    token: guardianInvite.token,
    email: "verified-guardian@example.test",
    password: MEMBER_PASSWORD,
    displayName: "Pat Guardian",
    relationship: "parent",
    now: 40_500,
  });
  assert.equal(guardian.guardianLink.status, "verified");
  assert.equal(guardian.guardianLink.verificationMethod, "email_invitation");
  assert.deepEqual(tenancy.listGuardianStudents({
    organizationId: owner.organization.id,
    actorAccountId: guardian.account.id,
  }), [{
    link: {
      id: guardian.guardianLink.id,
      relationship: "parent",
      verifiedAt: 40_500,
    },
    student: {
      id: student.id,
      displayName: "Consent Student",
      grade: 9,
    },
  }]);
  assert.throws(() => tenancy.listGuardianStudents({
    organizationId: owner.organization.id,
    actorAccountId: owner.account.id,
  }), hasCode("forbidden"));
  assert.equal(tenancy.getStudentContext({
    organizationId: owner.organization.id,
    studentId: student.id,
    actorAccountId: guardian.account.id,
    permission: "student.profile.read",
    now: 40_550,
  }).access.source, "access_grant");

  assert.throws(() => tenancy.grantGuardianConsent({
    organizationId: owner.organization.id,
    studentId: student.id,
    actorAccountId: studentAccount.account.id,
    consentType: "ai_assistance",
    policyVersion: "2026-01",
    scope: { purpose: "authorization-order regression" },
    now: 40_600,
  }), hasCode("guardian_not_verified"));
  assert.throws(() => tenancy.createGuardianLink({
    organizationId: owner.organization.id,
    guardianMembershipId: guardian.membership.id,
    studentId: student.id,
    actorAccountId: studentAccount.account.id,
    now: 40_600,
  }), hasCode("forbidden"));
  assert.throws(() => tenancy.verifyGuardianLink({
    organizationId: owner.organization.id,
    guardianLinkId: guardian.guardianLink.id,
    actorAccountId: studentAccount.account.id,
    verificationMethod: "self_asserted",
    now: 40_600,
  }), hasCode("invalid_verification"));

  const consent = tenancy.grantGuardianConsent({
    organizationId: owner.organization.id,
    studentId: student.id,
    actorAccountId: guardian.account.id,
    consentType: "ai_assistance",
    policyVersion: "2026-01",
    scope: { features: ["essay-feedback"] },
    now: 40_700,
  });
  assert.equal(consent.status, "active");
  assert.equal(consent.policyVersion, "2026-01");
  assert.deepEqual(consent.scope, { features: ["essay-feedback"] });
  assert.throws(() => tenancy.grantGuardianConsent({
    organizationId: owner.organization.id,
    studentId: student.id,
    actorAccountId: guardian.account.id,
    consentType: "data_processing",
    policyVersion: "2026-01",
    scope: {},
    now: 40_710,
  }), hasCode("invalid_consent_scope"));

  const current = tenancy.getGuardianConsentStatus({
    organizationId: owner.organization.id,
    studentId: student.id,
    actorAccountId: studentAccount.account.id,
    consentType: "ai_assistance",
    policyVersion: "2026-01",
    now: 40_800,
  });
  assert.equal(current.granted, true);
  assert.equal(current.consents.length, 1);
  assert.equal(tenancy.getGuardianConsentStatus({
    organizationId: owner.organization.id,
    studentId: student.id,
    actorAccountId: studentAccount.account.id,
    consentType: "ai_assistance",
    policyVersion: "2026-02",
    now: 40_800,
  }).granted, false);

  const coordinateRevocation = tenancy.revokeGuardianConsent({
    organizationId: owner.organization.id,
    studentId: student.id,
    actorAccountId: guardian.account.id,
    consentType: "ai_assistance",
    policyVersion: "2026-01",
    now: 40_820,
  });
  assert.equal(coordinateRevocation.status, "revoked");
  assert.equal(tenancy.getGuardianConsentStatus({
    organizationId: owner.organization.id,
    studentId: student.id,
    actorAccountId: studentAccount.account.id,
    consentType: "ai_assistance",
    policyVersion: "2026-01",
    now: 40_830,
  }).granted, false);
  tenancy.grantGuardianConsent({
    organizationId: owner.organization.id,
    studentId: student.id,
    actorAccountId: guardian.account.id,
    consentType: "ai_assistance",
    policyVersion: "2026-01",
    scope: { features: ["essay-feedback"] },
    now: 40_840,
  });

  const revokedLink = tenancy.revokeGuardianLink({
    organizationId: owner.organization.id,
    guardianLinkId: guardian.guardianLink.id,
    actorAccountId: owner.account.id,
    now: 40_900,
  });
  assert.equal(revokedLink.status, "revoked");
  assert.deepEqual(tenancy.listGuardianStudents({
    organizationId: owner.organization.id,
    actorAccountId: guardian.account.id,
  }), []);
  assert.equal(tenancy.getGuardianConsentStatus({
    organizationId: owner.organization.id,
    studentId: student.id,
    actorAccountId: studentAccount.account.id,
    consentType: "ai_assistance",
    policyVersion: "2026-01",
    now: 41_000,
  }).granted, false);
  assert.throws(() => tenancy.grantGuardianConsent({
    organizationId: owner.organization.id,
    studentId: student.id,
    actorAccountId: guardian.account.id,
    consentType: "ai_assistance",
    policyVersion: "2026-02",
    scope: { features: ["essay-feedback"] },
    now: 41_100,
  }), hasCode("guardian_not_verified"));
  assert.throws(() => tenancy.getStudentContext({
    organizationId: owner.organization.id,
    studentId: student.id,
    actorAccountId: guardian.account.id,
    permission: "student.profile.read",
    now: 41_100,
  }), hasCode("student_access_forbidden"));

  const auditActions = tenancy.listAuditEvents({
    organizationId: owner.organization.id,
    actorAccountId: owner.account.id,
  }).map((event) => event.action);
  assert.ok(auditActions.includes("guardian_consent.granted"));
  assert.ok(auditActions.includes("guardian_link.revoked"));
});

test("student self-closure is exact-org, atomic, and preserves credentials only for another live membership", (t) => {
  const { db, tenancy } = makeStore(t);
  const owner = createOrganization(tenancy, "closure", 50_000);
  const wrongOrg = createOrganization(tenancy, "closure-wrong", 50_050);
  const student = tenancy.createStudent({
    organizationId: owner.organization.id,
    actorAccountId: owner.account.id,
    displayName: "Closing Student",
    grade: 12,
    now: 50_100,
  });
  const invite = tenancy.createInvitation({
    organizationId: owner.organization.id,
    actorAccountId: owner.account.id,
    email: "closing-student@example.test",
    role: "student",
    targetStudentId: student.id,
    now: 50_200,
  });
  const studentAccount = tenancy.acceptInvitation({
    token: invite.token,
    email: "closing-student@example.test",
    password: MEMBER_PASSWORD,
    displayName: "Closing Student Account",
    now: 50_300,
  });
  const staleStudentInvite = tenancy.createInvitation({
    organizationId: owner.organization.id,
    actorAccountId: owner.account.id,
    email: "stale-closing-student@example.test",
    role: "student",
    targetStudentId: student.id,
    now: 50_310,
  });
  tenancy.revokeInvitation({
    organizationId: owner.organization.id,
    invitationId: staleStudentInvite.invitation.id,
    actorAccountId: owner.account.id,
    now: 50_320,
  });
  const studentSession = tenancy.createSession({
    email: "closing-student@example.test",
    password: MEMBER_PASSWORD,
    organizationId: owner.organization.id,
    now: 50_350,
  });
  const guardianInvite = tenancy.createInvitation({
    organizationId: owner.organization.id,
    actorAccountId: owner.account.id,
    email: "closing-guardian@example.test",
    role: "guardian",
    targetStudentId: student.id,
    permissions: ["student.profile.read"],
    now: 50_400,
  });
  const guardian = tenancy.acceptInvitation({
    token: guardianInvite.token,
    email: "closing-guardian@example.test",
    password: MEMBER_PASSWORD,
    now: 50_500,
  });
  tenancy.grantGuardianConsent({
    organizationId: owner.organization.id,
    studentId: student.id,
    actorAccountId: guardian.account.id,
    consentType: "document_analysis",
    policyVersion: "2026-01",
    scope: { purpose: "document analysis" },
    now: 50_600,
  });
  const invitationsBeforeClosure = db.prepare(`
    SELECT id, email_hash, email_ciphertext, token_hash, target_student_id,
           accepted_by_account_id, accepted_at, revoked_at
    FROM saas_invitations
    WHERE id IN (?, ?)
    ORDER BY id
  `).all(invite.invitation.id, staleStudentInvite.invitation.id);
  assert.equal(invitationsBeforeClosure.length, 2);

  assert.throws(() => tenancy.closeOwnStudentAccount({
    organizationId: owner.organization.id,
    accountId: owner.account.id,
    now: 50_650,
  }), hasCode("forbidden"));
  assert.throws(() => tenancy.closeOwnStudentAccount({
    organizationId: wrongOrg.organization.id,
    accountId: studentAccount.account.id,
    now: 50_650,
  }), hasCode("membership_not_found"));

  const closed = tenancy.closeOwnStudentAccount({
    organizationId: owner.organization.id,
    accountId: studentAccount.account.id,
    now: 50_700,
  });
  assert.equal(closed.studentClosed, true);
  assert.equal(closed.student.status, "archived");
  assert.equal(closed.membership.status, "revoked");
  assert.equal(closed.accountClosed, true);
  assert.equal(closed.credentialsRevoked, true);
  assert.equal(closed.invitationsScrubbed, 2);
  assert.equal(closed.account.status, "suspended");
  assert.equal(closed.account.email, undefined);
  assert.equal(closed.account.displayName, null);
  assert.equal(closed.student.accountId, null);
  assert.equal(closed.student.displayName, null);
  assert.equal(closed.student.grade, null);
  assert.equal(tenancy.validateSession({ sessionToken: studentSession.sessionToken, now: 50_710 }), null);
  assert.equal(tenancy.authenticateCredentials({
    email: "closing-student@example.test",
    password: MEMBER_PASSWORD,
  }), null);
  assert.equal(db.prepare(
    "SELECT status FROM saas_guardian_links WHERE id = ?",
  ).get(guardian.guardianLink.id).status, "revoked");
  assert.ok(db.prepare(
    "SELECT revoked_at FROM saas_consent_grants WHERE student_id = ?",
  ).get(student.id).revoked_at);
  assert.ok(db.prepare(
    "SELECT revoked_at FROM saas_student_access_grants WHERE student_id = ?",
  ).get(student.id).revoked_at);
  const invitationsAfterClosure = db.prepare(`
    SELECT id, email_hash, email_ciphertext, token_hash, target_student_id,
           accepted_by_account_id, accepted_at, revoked_at
    FROM saas_invitations
    WHERE id IN (?, ?)
    ORDER BY id
  `).all(invite.invitation.id, staleStudentInvite.invitation.id);
  invitationsAfterClosure.forEach((row, index) => {
    const original = invitationsBeforeClosure[index];
    assert.equal(row.id, original.id);
    assert.notEqual(row.email_hash, original.email_hash);
    assert.equal(row.email_ciphertext, null);
    assert.notEqual(row.token_hash, original.token_hash);
    assert.equal(row.target_student_id, null);
    assert.equal(row.accepted_by_account_id, null);
    assert.equal(row.accepted_at, original.accepted_at);
    assert.equal(row.revoked_at, original.revoked_at);
  });
  assert.equal(tenancy.inspectInvitation({ token: invite.token, now: 50_710 }), null);
  assert.equal(tenancy.inspectInvitation({ token: staleStudentInvite.token, now: 50_710 }), null);
  assert.ok(db.prepare(`
    SELECT email_ciphertext FROM saas_invitations WHERE id = ?
  `).get(guardianInvite.invitation.id).email_ciphertext);

  const retainedStudent = tenancy.createStudent({
    organizationId: owner.organization.id,
    actorAccountId: owner.account.id,
    displayName: "Multi Org Student",
    grade: 11,
    now: 50_800,
  });
  const retainedInvite = tenancy.createInvitation({
    organizationId: owner.organization.id,
    actorAccountId: owner.account.id,
    email: "multi-org-student@example.test",
    role: "student",
    targetStudentId: retainedStudent.id,
    now: 50_900,
  });
  const retainedAccount = tenancy.acceptInvitation({
    token: retainedInvite.token,
    email: "multi-org-student@example.test",
    password: MEMBER_PASSWORD,
    now: 51_000,
  });
  const otherMembership = tenancy.createOrganization({
    name: "Student's Other Organization",
    slug: "student-other-organization",
    ownerEmail: "multi-org-student@example.test",
    ownerPassword: MEMBER_PASSWORD,
    now: 51_100,
  });
  const otherSession = tenancy.createSession({
    email: "multi-org-student@example.test",
    password: MEMBER_PASSWORD,
    organizationId: otherMembership.organization.id,
    now: 51_200,
  });
  assert.throws(() => tenancy.closeOwnStudentAccount({
    organizationId: otherMembership.organization.id,
    accountId: retainedAccount.account.id,
    now: 51_250,
  }), hasCode("forbidden"));
  const retained = tenancy.closeOwnStudentAccount({
    organizationId: owner.organization.id,
    accountId: retainedAccount.account.id,
    now: 51_300,
  });
  assert.equal(retained.accountClosed, false);
  assert.equal(retained.credentialsRevoked, false);
  assert.equal(retained.otherLiveMemberships, 1);
  assert.equal(retained.account.status, "active");
  assert.equal(retained.student.accountId, null);
  assert.equal(retained.student.displayName, null);
  assert.equal(retained.student.grade, null);
  assert.ok(tenancy.authenticateCredentials({
    email: "multi-org-student@example.test",
    password: MEMBER_PASSWORD,
  }));
  assert.ok(tenancy.validateSession({ sessionToken: otherSession.sessionToken, now: 51_400 }));
});

test("password resets are hash-only, email-bound, expiring, single-use, and revoke every session", (t) => {
  const { db, tenancy } = makeStore(t);
  const owner = createOrganization(tenancy, "password-reset", 100_000);
  const session = tenancy.createSession({
    email: "owner-password-reset@example.test",
    password: OWNER_PASSWORD,
    organizationId: owner.organization.id,
    now: 100_100,
  });
  assert.equal(tenancy.createPasswordReset({
    email: "unknown@example.test",
    ttlMs: 500,
    now: 100_200,
  }), null);
  assert.equal(tenancy.createPasswordReset({
    email: "not-an-email",
    ttlMs: 500,
    now: 100_200,
  }), null);

  const first = tenancy.createPasswordReset({
    email: "OWNER-PASSWORD-RESET@example.test",
    ttlMs: 500,
    now: 100_200,
  });
  const stored = db.prepare(`
    SELECT token_hash, email_hash FROM saas_password_reset_tokens WHERE id = ?
  `).get(first.id);
  assert.notEqual(stored.token_hash, first.token);
  assert.equal(stored.token_hash.includes(first.token), false);
  assert.equal(stored.email_hash.includes("owner-password-reset@example.test"), false);
  assert.equal(JSON.stringify(first).includes("hash"), false);

  const suppressed = tenancy.createPasswordReset({
    email: "owner-password-reset@example.test",
    ttlMs: 500,
    now: 100_210,
  });
  assert.equal(suppressed, null);
  assert.equal(db.prepare(`
    SELECT revoked_at FROM saas_password_reset_tokens WHERE id = ?
  `).get(first.id).revoked_at, null);
  assert.throws(() => tenancy.completePasswordReset({
    token: "invalid-reset-token",
    email: "owner-password-reset@example.test",
    newPassword: "short",
    now: 100_210,
  }), hasCode("invalid_password_reset"));

  const replacement = tenancy.createPasswordReset({
    email: "owner-password-reset@example.test",
    ttlMs: 500,
    cooldownMs: 0,
    now: 100_211,
  });
  assert.throws(() => tenancy.completePasswordReset({
    token: first.token,
    email: "owner-password-reset@example.test",
    newPassword: "replacement password is secure",
    now: 100_220,
  }), hasCode("password_reset_revoked"));
  assert.throws(() => tenancy.completePasswordReset({
    token: replacement.token,
    email: "another@example.test",
    newPassword: "replacement password is secure",
    now: 100_220,
  }), hasCode("password_reset_email_mismatch"));

  const completed = tenancy.completePasswordReset({
    token: replacement.token,
    email: "owner-password-reset@example.test",
    newPassword: "replacement password is secure",
    now: 100_230,
  });
  assert.equal(completed.completed, true);
  assert.equal(completed.accountId, owner.account.id);
  assert.equal(tenancy.validateSession({ sessionToken: session.sessionToken, now: 100_240 }), null);
  assert.equal(tenancy.authenticateCredentials({
    email: "owner-password-reset@example.test",
    password: OWNER_PASSWORD,
  }), null);
  assert.ok(tenancy.authenticateCredentials({
    email: "owner-password-reset@example.test",
    password: "replacement password is secure",
  }));
  assert.throws(() => tenancy.completePasswordReset({
    token: replacement.token,
    email: "owner-password-reset@example.test",
    newPassword: "third password is also secure",
    now: 100_250,
  }), hasCode("password_reset_used"));

  const expired = tenancy.createPasswordReset({
    email: "owner-password-reset@example.test",
    ttlMs: 10,
    cooldownMs: 0,
    now: 100_300,
  });
  assert.throws(() => tenancy.completePasswordReset({
    token: expired.token,
    email: "owner-password-reset@example.test",
    newPassword: "third password is also secure",
    now: 100_310,
  }), hasCode("password_reset_expired"));
  db.prepare("UPDATE saas_accounts SET status = 'suspended' WHERE id = ?").run(owner.account.id);
  assert.equal(tenancy.createPasswordReset({
    email: "owner-password-reset@example.test",
    now: 100_320,
  }), null);
});

test("security-record purge honors retention windows for sessions, invitations, and reset tokens", (t) => {
  const { db, tenancy } = makeStore(t);
  const owner = createOrganization(tenancy, "security-purge", 1_000);
  const oldSession = tenancy.createSession({
    email: "owner-security-purge@example.test",
    password: OWNER_PASSWORD,
    organizationId: owner.organization.id,
    idleTtlMs: 10,
    absoluteTtlMs: 20,
    now: 1_100,
  });
  const freshSession = tenancy.createSession({
    email: "owner-security-purge@example.test",
    password: OWNER_PASSWORD,
    organizationId: owner.organization.id,
    idleTtlMs: 2_000,
    absoluteTtlMs: 4_000,
    now: 9_500,
  });
  const oldInvitation = tenancy.createInvitation({
    organizationId: owner.organization.id,
    actorAccountId: owner.account.id,
    email: "old-purge@example.test",
    role: "counselor",
    expiresAt: 1_300,
    now: 1_200,
  });
  const freshInvitation = tenancy.createInvitation({
    organizationId: owner.organization.id,
    actorAccountId: owner.account.id,
    email: "fresh-purge@example.test",
    role: "counselor",
    expiresAt: 20_000,
    now: 9_500,
  });
  const oldReset = tenancy.createPasswordReset({
    email: "owner-security-purge@example.test",
    ttlMs: 100,
    now: 1_400,
  });
  db.prepare(`
    INSERT INTO saas_password_reset_tokens
      (id, token_hash, account_id, email_hash, expires_at, used_at, revoked_at, created_at)
    SELECT 'fresh-reset', 'fresh-reset-hash', account_id, email_hash, 20000, NULL, NULL, 9500
    FROM saas_password_reset_tokens WHERE id = ?
  `).run(oldReset.id);

  assert.ok(SECURITY_RETENTION_DEFAULTS.invitationsMs > SECURITY_RETENTION_DEFAULTS.sessionsMs);
  const purged = tenancy.purgeExpiredSecurityRecords({
    now: 10_000,
    sessionRetentionMs: 1_000,
    invitationRetentionMs: 1_000,
    passwordResetRetentionMs: 1_000,
  });
  assert.deepEqual(purged, {
    sessionsDeleted: 1,
    invitationsDeleted: 1,
    passwordResetsDeleted: 1,
    purgedAt: 10_000,
  });
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM saas_sessions_v2").get().count, 1);
  assert.ok(tenancy.validateSession({ sessionToken: freshSession.sessionToken, now: 9_600 }));
  assert.equal(tenancy.validateSession({ sessionToken: oldSession.sessionToken, now: 9_600 }), null);
  assert.equal(tenancy.inspectInvitation({ token: oldInvitation.token, now: 10_000 }), null);
  assert.equal(tenancy.inspectInvitation({ token: freshInvitation.token, now: 10_000 }).status, "pending");
  assert.ok(db.prepare("SELECT 1 FROM saas_password_reset_tokens WHERE id = 'fresh-reset'").get());
});

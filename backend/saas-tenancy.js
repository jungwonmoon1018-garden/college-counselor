import crypto from "node:crypto";

const SCHEMA_VERSION = 4;
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 256;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_OPTIONS = Object.freeze({ N: 65536, r: 8, p: 2, maxmem: 256 * 1024 * 1024 });
const DUMMY_PASSWORD_SALT = "saas-auth-dummy-v1-2026";
const DUMMY_PASSWORD_HASH = "eb00987c43c940633239779b3eaccf85345098952f71eaa8d67edfdccabd2770588f4f12df3b14f174f4c5e3a92926b8ffd0e86e4da90f259038838206cae3a9";
const DEFAULT_IDLE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_ABSOLUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const DEFAULT_PASSWORD_RESET_COOLDOWN_MS = 60 * 1000;

export const SECURITY_RETENTION_DEFAULTS = Object.freeze({
  sessionsMs: 30 * 24 * 60 * 60 * 1000,
  invitationsMs: 180 * 24 * 60 * 60 * 1000,
  passwordResetsMs: 30 * 24 * 60 * 60 * 1000,
});

export const SAAS_ROLES = Object.freeze([
  "owner",
  "org_admin",
  "counselor",
  "student",
  "guardian",
]);

export const STUDENT_PERMISSIONS = Object.freeze([
  "student.profile.read",
  "student.profile.write",
  "student.plan.read",
  "student.plan.write",
  "student.files.read",
  "student.chat.read",
  "student.export",
  "student.consent.manage",
]);

const INVITABLE_ROLES = new Set(SAAS_ROLES.filter((role) => role !== "owner"));
const ROLE_SET = new Set(SAAS_ROLES);
const PERMISSION_SET = new Set(STUDENT_PERMISSIONS);
const MEMBER_STATUSES = new Set(["active", "suspended", "revoked"]);
const ORG_STATUSES = new Set(["active", "suspended"]);

export class SaasTenancyError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "SaasTenancyError";
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, status = 400) {
  throw new SaasTenancyError(code, message, status);
}

function timestamp(value) {
  const parsed = value === undefined ? Date.now() : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    fail("invalid_timestamp", "A valid millisecond timestamp is required.");
  }
  return parsed;
}

function requiredText(value, field, maxLength = 255) {
  const normalized = String(value ?? "").normalize("NFKC").trim();
  if (!normalized || normalized.length > maxLength) {
    fail("invalid_input", `${field} is required and must be at most ${maxLength} characters.`);
  }
  return normalized;
}

function optionalText(value, field, maxLength = 255) {
  if (value === undefined || value === null || value === "") return null;
  return requiredText(value, field, maxLength);
}

function normalizeEmail(email) {
  const normalized = requiredText(email, "email", 320).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(normalized)) {
    fail("invalid_email", "A valid email address is required.");
  }
  return normalized;
}

function normalizeSlug(slug) {
  const normalized = requiredText(slug, "slug", 63).toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(normalized)) {
    fail("invalid_slug", "Slug must contain lowercase letters, numbers, or interior hyphens.");
  }
  return normalized;
}

function normalizeGrade(grade) {
  if (grade === undefined || grade === null || grade === "") return null;
  const value = Number(grade);
  if (![9, 10, 11, 12].includes(value)) {
    fail("invalid_grade", "Grade must be 9, 10, 11, or 12.");
  }
  return value;
}

function normalizeRole(role, { invitable = false } = {}) {
  const value = String(role ?? "");
  const allowed = invitable ? INVITABLE_ROLES : ROLE_SET;
  if (!allowed.has(value)) fail("invalid_role", "Role is not allowed.");
  return value;
}

function normalizeRoles(roles) {
  if (!Array.isArray(roles) || roles.length === 0) {
    fail("invalid_role", "At least one role is required.");
  }
  const unique = [...new Set(roles.map((role) => normalizeRole(role)))];
  return unique;
}

function normalizePermissions(permissions = []) {
  if (!Array.isArray(permissions)) fail("invalid_permission", "Permissions must be an array.");
  const unique = [...new Set(permissions.map((value) => String(value ?? "")))];
  if (unique.some((permission) => !PERMISSION_SET.has(permission))) {
    fail("invalid_permission", "Student permission is not allowed.");
  }
  return unique;
}

function normalizeStatus(status, allowed, field) {
  const value = String(status ?? "");
  if (!allowed.has(value)) fail("invalid_status", `${field} status is not allowed.`);
  return value;
}

function normalizeTtl(value, fallback, field) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    fail("invalid_ttl", `${field} must be a positive integer.`);
  }
  return parsed;
}

function normalizeRetention(value, fallback, field) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    fail("invalid_retention", `${field} must be a non-negative integer.`);
  }
  return parsed;
}

function assertPassword(password) {
  if (
    typeof password !== "string"
    || password.length < PASSWORD_MIN_LENGTH
    || password.length > PASSWORD_MAX_LENGTH
  ) {
    fail(
      "invalid_password",
      `Password must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters.`,
    );
  }
}

function passwordRecord(password) {
  assertPassword(password);
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(
    password,
    salt,
    SCRYPT_KEY_LENGTH,
    SCRYPT_OPTIONS,
  ).toString("hex");
  return { salt, hash };
}

function passwordMatches(password, salt, expectedHex) {
  if (typeof password !== "string" || !salt || !expectedHex) return false;
  try {
    const actual = crypto.scryptSync(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      SCRYPT_OPTIONS,
    );
    const expected = Buffer.from(expectedHex, "hex");
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token ?? "")).digest("hex");
}

function newToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function resolveEncryptionKey(value) {
  if (value === undefined || value === null || value === "") return null;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const key = Buffer.from(value);
    if (key.length === 32) return key;
  } else if (typeof value === "string") {
    if (/^[a-f0-9]{64}$/iu.test(value)) return Buffer.from(value, "hex");
    try {
      const key = Buffer.from(value, "base64url");
      if (key.length === 32) return key;
    } catch {
      // The stable validation error below is intentionally used for all bad key formats.
    }
  }
  fail("invalid_encryption_key", "encryptionKey must contain exactly 32 bytes.");
}

function encodeEncrypted(value, key) {
  if (!key) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

function decodeEncrypted(value, key) {
  if (!value || !key) return null;
  try {
    const [version, iv, tag, ciphertext] = String(value).split(".");
    if (version !== "v1" || !iv || !tag || !ciphertext) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function jsonObject(value, field) {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    fail("invalid_input", `${field} must be an object.`);
  }
  return value;
}

const MIGRATIONS = Object.freeze([
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS saas_accounts (
        id TEXT PRIMARY KEY,
        email_hash TEXT NOT NULL UNIQUE,
        email_ciphertext TEXT,
        status TEXT NOT NULL CHECK (status IN ('active', 'suspended')),
        auth_version INTEGER NOT NULL DEFAULT 1 CHECK (auth_version >= 1),
        email_verified_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS saas_credentials (
        account_id TEXT PRIMARY KEY REFERENCES saas_accounts(id) ON DELETE CASCADE,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS saas_organizations (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL COLLATE NOCASE UNIQUE,
        name TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'suspended')),
        created_by_account_id TEXT NOT NULL REFERENCES saas_accounts(id),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS saas_memberships (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES saas_organizations(id) ON DELETE CASCADE,
        account_id TEXT NOT NULL REFERENCES saas_accounts(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('active', 'suspended', 'revoked')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (organization_id, account_id),
        UNIQUE (id, organization_id)
      );

      CREATE TABLE IF NOT EXISTS saas_membership_roles (
        membership_id TEXT NOT NULL REFERENCES saas_memberships(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('owner', 'org_admin', 'counselor', 'student', 'guardian')),
        created_at INTEGER NOT NULL,
        PRIMARY KEY (membership_id, role)
      );

      CREATE TABLE IF NOT EXISTS saas_students (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES saas_organizations(id) ON DELETE CASCADE,
        account_id TEXT REFERENCES saas_accounts(id) ON DELETE SET NULL,
        display_name TEXT,
        grade INTEGER CHECK (grade BETWEEN 9 AND 12),
        status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (organization_id, account_id),
        UNIQUE (id, organization_id)
      );

      CREATE TABLE IF NOT EXISTS saas_invitations (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES saas_organizations(id) ON DELETE CASCADE,
        email_hash TEXT NOT NULL,
        email_ciphertext TEXT,
        role TEXT NOT NULL CHECK (role IN ('org_admin', 'counselor', 'student', 'guardian')),
        target_student_id TEXT,
        permissions_json TEXT NOT NULL DEFAULT '[]',
        token_hash TEXT NOT NULL UNIQUE,
        created_by_membership_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        accepted_at INTEGER,
        accepted_by_account_id TEXT REFERENCES saas_accounts(id),
        revoked_at INTEGER,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (created_by_membership_id, organization_id)
          REFERENCES saas_memberships(id, organization_id),
        FOREIGN KEY (target_student_id, organization_id)
          REFERENCES saas_students(id, organization_id)
      );
      CREATE INDEX IF NOT EXISTS idx_saas_invites_org
        ON saas_invitations(organization_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_saas_invites_email
        ON saas_invitations(email_hash, expires_at);

      CREATE TABLE IF NOT EXISTS saas_sessions_v2 (
        token_hash TEXT PRIMARY KEY,
        csrf_hash TEXT NOT NULL,
        account_id TEXT NOT NULL REFERENCES saas_accounts(id) ON DELETE CASCADE,
        organization_id TEXT NOT NULL REFERENCES saas_organizations(id) ON DELETE CASCADE,
        membership_id TEXT NOT NULL,
        auth_version INTEGER NOT NULL,
        idle_ttl_ms INTEGER NOT NULL CHECK (idle_ttl_ms > 0),
        idle_expires_at INTEGER NOT NULL,
        absolute_expires_at INTEGER NOT NULL,
        revoked_at INTEGER,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        FOREIGN KEY (membership_id, organization_id)
          REFERENCES saas_memberships(id, organization_id)
      );
      CREATE INDEX IF NOT EXISTS idx_saas_sessions_account
        ON saas_sessions_v2(account_id, absolute_expires_at);
      CREATE INDEX IF NOT EXISTS idx_saas_sessions_expiry
        ON saas_sessions_v2(idle_expires_at, absolute_expires_at);
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS saas_student_access_grants (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES saas_organizations(id) ON DELETE CASCADE,
        membership_id TEXT NOT NULL,
        student_id TEXT NOT NULL,
        permission TEXT NOT NULL CHECK (permission IN (
          'student.profile.read', 'student.profile.write',
          'student.plan.read', 'student.plan.write',
          'student.files.read', 'student.chat.read',
          'student.export', 'student.consent.manage'
        )),
        granted_by_membership_id TEXT NOT NULL,
        expires_at INTEGER,
        revoked_at INTEGER,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (membership_id, organization_id)
          REFERENCES saas_memberships(id, organization_id),
        FOREIGN KEY (student_id, organization_id)
          REFERENCES saas_students(id, organization_id),
        FOREIGN KEY (granted_by_membership_id, organization_id)
          REFERENCES saas_memberships(id, organization_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_saas_access_active_unique
        ON saas_student_access_grants(organization_id, membership_id, student_id, permission)
        WHERE revoked_at IS NULL;

      CREATE TABLE IF NOT EXISTS saas_guardian_links (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES saas_organizations(id) ON DELETE CASCADE,
        guardian_membership_id TEXT NOT NULL,
        student_id TEXT NOT NULL,
        relationship TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending', 'verified', 'revoked')),
        verification_method TEXT,
        verified_at INTEGER,
        revoked_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (id, organization_id),
        FOREIGN KEY (guardian_membership_id, organization_id)
          REFERENCES saas_memberships(id, organization_id),
        FOREIGN KEY (student_id, organization_id)
          REFERENCES saas_students(id, organization_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_saas_guardian_link_active_unique
        ON saas_guardian_links(organization_id, guardian_membership_id, student_id)
        WHERE revoked_at IS NULL;

      CREATE TABLE IF NOT EXISTS saas_consent_grants (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES saas_organizations(id) ON DELETE CASCADE,
        student_id TEXT NOT NULL,
        guardian_link_id TEXT NOT NULL,
        actor_account_id TEXT NOT NULL REFERENCES saas_accounts(id),
        consent_type TEXT NOT NULL,
        policy_version TEXT NOT NULL,
        scope_json TEXT NOT NULL DEFAULT '{}',
        granted_at INTEGER NOT NULL,
        expires_at INTEGER,
        revoked_at INTEGER,
        revoked_by_account_id TEXT REFERENCES saas_accounts(id),
        FOREIGN KEY (student_id, organization_id)
          REFERENCES saas_students(id, organization_id),
        FOREIGN KEY (guardian_link_id, organization_id)
          REFERENCES saas_guardian_links(id, organization_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_saas_consent_active_unique
        ON saas_consent_grants(organization_id, student_id, guardian_link_id, consent_type, policy_version)
        WHERE revoked_at IS NULL;

      CREATE TABLE IF NOT EXISTS saas_audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id TEXT REFERENCES saas_organizations(id) ON DELETE SET NULL,
        actor_account_id TEXT REFERENCES saas_accounts(id) ON DELETE SET NULL,
        actor_membership_id TEXT,
        subject_student_id TEXT,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_saas_audit_org
        ON saas_audit_events(organization_id, created_at DESC, id DESC);
    `,
  },
  {
    version: 3,
    sql: `
      ALTER TABLE saas_accounts ADD COLUMN display_name TEXT;
    `,
  },
  {
    version: 4,
    sql: `
      CREATE TABLE IF NOT EXISTS saas_password_reset_tokens (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        account_id TEXT NOT NULL REFERENCES saas_accounts(id) ON DELETE CASCADE,
        email_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        revoked_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_saas_password_resets_account
        ON saas_password_reset_tokens(account_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_saas_password_resets_expiry
        ON saas_password_reset_tokens(expires_at);
    `,
  },
]);

function applyMigrations(db) {
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS saas_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);
  const hasMigration = db.prepare(
    "SELECT 1 FROM saas_schema_migrations WHERE version = ?",
  );
  const recordMigration = db.prepare(
    "INSERT INTO saas_schema_migrations (version, applied_at) VALUES (?, ?)",
  );
  for (const migration of MIGRATIONS) {
    if (hasMigration.get(migration.version)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      recordMigration.run(migration.version, Date.now());
    })();
  }
}

export function initSaasTenancy({ db, emailPepper, encryptionKey } = {}) {
  if (
    !db
    || typeof db.prepare !== "function"
    || typeof db.exec !== "function"
    || typeof db.transaction !== "function"
  ) {
    fail("invalid_database", "A better-sqlite3 database connection is required.");
  }
  const pepper = Buffer.isBuffer(emailPepper)
    ? Buffer.from(emailPepper)
    : Buffer.from(String(emailPepper ?? ""), "utf8");
  if (pepper.length < 16) {
    fail("invalid_email_pepper", "emailPepper must contain at least 16 bytes.");
  }
  const encryptionKeyBuffer = resolveEncryptionKey(encryptionKey);
  applyMigrations(db);

  const emailDigest = (email) => crypto
    .createHmac("sha256", pepper)
    .update(normalizeEmail(email))
    .digest("hex");
  const encryptEmail = (email) => encodeEncrypted(normalizeEmail(email), encryptionKeyBuffer);
  const decryptEmail = (value) => decodeEncrypted(value, encryptionKeyBuffer);
  const transact = (work) => (db.inTransaction ? work() : db.transaction(work)());

  function accountView(row) {
    if (!row) return null;
    const view = {
      id: row.id,
      displayName: row.display_name ?? null,
      status: row.status,
      authVersion: row.auth_version,
      emailVerifiedAt: row.email_verified_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    const email = decryptEmail(row.email_ciphertext);
    if (email) view.email = email;
    return view;
  }

  function organizationView(row) {
    if (!row) return null;
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function membershipRoles(membershipId) {
    return db.prepare(`
      SELECT role
      FROM saas_membership_roles
      WHERE membership_id = ?
      ORDER BY CASE role
        WHEN 'owner' THEN 1
        WHEN 'org_admin' THEN 2
        WHEN 'counselor' THEN 3
        WHEN 'guardian' THEN 4
        ELSE 5
      END
    `).all(membershipId).map((row) => row.role);
  }

  function membershipView(row, { includeEmail = false } = {}) {
    if (!row) return null;
    const identity = row.account_display_name !== undefined
      ? {
          display_name: row.account_display_name,
          student_id: row.linked_student_id,
          student_display_name: row.linked_student_display_name,
          student_grade: row.linked_student_grade,
        }
      : db.prepare(`
          SELECT a.display_name,
                 s.id AS student_id,
                 s.display_name AS student_display_name,
                 s.grade AS student_grade
          FROM saas_accounts a
          LEFT JOIN saas_students s
            ON s.account_id = a.id AND s.organization_id = ?
          WHERE a.id = ?
        `).get(row.organization_id, row.account_id);
    const view = {
      id: row.id,
      organizationId: row.organization_id,
      accountId: row.account_id,
      displayName: identity?.display_name ?? null,
      status: row.status,
      roles: membershipRoles(row.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    if (identity?.student_id) {
      view.studentId = identity.student_id;
      view.student = {
        id: identity.student_id,
        displayName: identity.student_display_name ?? null,
        grade: identity.student_grade ?? null,
      };
    }
    if (includeEmail) {
      const email = decryptEmail(row.email_ciphertext);
      if (email) view.email = email;
      if (row.account_status) view.accountStatus = row.account_status;
    }
    return view;
  }

  function studentView(row) {
    if (!row) return null;
    return {
      id: row.id,
      organizationId: row.organization_id,
      accountId: row.account_id ?? null,
      displayName: row.display_name ?? null,
      grade: row.grade ?? null,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function invitationStatus(row, at) {
    if (row.accepted_at !== null) return "accepted";
    if (row.revoked_at !== null) return "revoked";
    if (row.expires_at <= at) return "expired";
    return "pending";
  }

  function invitationView(row, at, { includeEmail = false } = {}) {
    if (!row) return null;
    const view = {
      id: row.id,
      organizationId: row.organization_id,
      role: row.role,
      targetStudentId: row.target_student_id ?? null,
      permissions: safeJson(row.permissions_json, []),
      status: invitationStatus(row, at),
      expiresAt: row.expires_at,
      acceptedAt: row.accepted_at ?? null,
      revokedAt: row.revoked_at ?? null,
      createdAt: row.created_at,
    };
    if (row.organization_name) {
      view.organization = {
        id: row.organization_id,
        slug: row.organization_slug,
        name: row.organization_name,
      };
    }
    if (includeEmail) {
      const email = decryptEmail(row.email_ciphertext);
      if (email) view.email = email;
    }
    return view;
  }

  function accessGrantView(row) {
    if (!row) return null;
    return {
      id: row.id,
      organizationId: row.organization_id,
      membershipId: row.membership_id,
      studentId: row.student_id,
      permission: row.permission,
      expiresAt: row.expires_at ?? null,
      revokedAt: row.revoked_at ?? null,
      createdAt: row.created_at,
    };
  }

  function guardianLinkView(row) {
    if (!row) return null;
    return {
      id: row.id,
      organizationId: row.organization_id,
      guardianMembershipId: row.guardian_membership_id,
      studentId: row.student_id,
      relationship: row.relationship ?? null,
      status: row.status,
      verificationMethod: row.verification_method ?? null,
      verifiedAt: row.verified_at ?? null,
      revokedAt: row.revoked_at ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function consentView(row, at) {
    if (!row) return null;
    return {
      id: row.id,
      organizationId: row.organization_id,
      studentId: row.student_id,
      guardianLinkId: row.guardian_link_id,
      consentType: row.consent_type,
      policyVersion: row.policy_version,
      scope: safeJson(row.scope_json, {}),
      status: row.revoked_at !== null
        ? "revoked"
        : row.expires_at !== null && row.expires_at <= at
          ? "expired"
          : "active",
      grantedAt: row.granted_at,
      expiresAt: row.expires_at ?? null,
      revokedAt: row.revoked_at ?? null,
    };
  }

  function getOrganization(organizationId, { requireActive = false } = {}) {
    const row = db.prepare("SELECT * FROM saas_organizations WHERE id = ?").get(
      requiredText(organizationId, "organizationId", 100),
    );
    if (!row) fail("organization_not_found", "Organization was not found.", 404);
    if (requireActive && row.status !== "active") {
      fail("organization_suspended", "Organization is not active.", 403);
    }
    return row;
  }

  function getMembership(organizationId, accountId, { requireActive = false } = {}) {
    const row = db.prepare(`
      SELECT m.*, a.status AS account_status
      FROM saas_memberships m
      JOIN saas_accounts a ON a.id = m.account_id
      WHERE m.organization_id = ? AND m.account_id = ?
    `).get(
      requiredText(organizationId, "organizationId", 100),
      requiredText(accountId, "accountId", 100),
    );
    if (!row) fail("membership_not_found", "Membership was not found.", 404);
    if (requireActive && row.status !== "active") {
      fail("membership_suspended", "Membership is not active.", 403);
    }
    if (requireActive && row.account_status !== "active") {
      fail("account_suspended", "Account is not active.", 403);
    }
    return row;
  }

  function getMembershipById(organizationId, membershipId) {
    const row = db.prepare(`
      SELECT *
      FROM saas_memberships
      WHERE organization_id = ? AND id = ?
    `).get(
      requiredText(organizationId, "organizationId", 100),
      requiredText(membershipId, "membershipId", 100),
    );
    if (!row) fail("membership_not_found", "Membership was not found.", 404);
    return row;
  }

  function requireManager(
    organizationId,
    actorAccountId,
    { ownerOnly = false, allowSuspendedOrganization = false } = {},
  ) {
    getOrganization(organizationId, { requireActive: !allowSuspendedOrganization });
    const membership = getMembership(organizationId, actorAccountId, { requireActive: true });
    const roles = membershipRoles(membership.id);
    const authorized = ownerOnly
      ? roles.includes("owner")
      : roles.includes("owner") || roles.includes("org_admin");
    if (!authorized) fail("forbidden", "Organization manager access is required.", 403);
    return { membership, roles };
  }

  function requireStudent(organizationId, studentId, { requireActive = true } = {}) {
    const row = db.prepare(`
      SELECT *
      FROM saas_students
      WHERE organization_id = ? AND id = ?
    `).get(
      requiredText(organizationId, "organizationId", 100),
      requiredText(studentId, "studentId", 100),
    );
    if (!row) fail("student_not_found", "Student was not found.", 404);
    if (requireActive && row.status !== "active") {
      fail("student_inactive", "Student is not active.", 403);
    }
    return row;
  }

  function audit({
    organizationId = null,
    actorAccountId = null,
    actorMembershipId = null,
    studentId = null,
    action,
    resourceType,
    resourceId = null,
    metadata = {},
    at,
  }) {
    db.prepare(`
      INSERT INTO saas_audit_events
        (organization_id, actor_account_id, actor_membership_id, subject_student_id,
         action, resource_type, resource_id, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      organizationId,
      actorAccountId,
      actorMembershipId,
      studentId,
      requiredText(action, "action", 100),
      requiredText(resourceType, "resourceType", 100),
      resourceId,
      JSON.stringify(jsonObject(metadata, "metadata")),
      at,
    );
  }

  function createAccount(email, password, at, displayName = null) {
    const normalizedEmail = normalizeEmail(email);
    const digest = emailDigest(normalizedEmail);
    if (db.prepare("SELECT 1 FROM saas_accounts WHERE email_hash = ?").get(digest)) {
      fail("account_exists", "An account already exists for this email.", 409);
    }
    const accountId = crypto.randomUUID();
    const passwordData = passwordRecord(password);
    db.prepare(`
      INSERT INTO saas_accounts
        (id, email_hash, email_ciphertext, display_name, status, auth_version,
         email_verified_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', 1, ?, ?, ?)
    `).run(
      accountId,
      digest,
      encryptEmail(normalizedEmail),
      displayName,
      at,
      at,
      at,
    );
    db.prepare(`
      INSERT INTO saas_credentials
        (account_id, password_salt, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(accountId, passwordData.salt, passwordData.hash, at, at);
    return db.prepare("SELECT * FROM saas_accounts WHERE id = ?").get(accountId);
  }

  function authenticateRow(email, password) {
    let digest;
    try {
      digest = emailDigest(email);
    } catch {
      passwordMatches(password, DUMMY_PASSWORD_SALT, DUMMY_PASSWORD_HASH);
      return null;
    }
    const row = db.prepare(`
      SELECT a.*, c.password_salt, c.password_hash
      FROM saas_accounts a
      JOIN saas_credentials c ON c.account_id = a.id
      WHERE a.email_hash = ?
    `).get(digest);
    if (!row) {
      passwordMatches(password, DUMMY_PASSWORD_SALT, DUMMY_PASSWORD_HASH);
      return null;
    }
    if (!passwordMatches(password, row.password_salt, row.password_hash)) return null;
    return row;
  }

  function createOrganization({ name, slug, ownerEmail, ownerPassword, now } = {}) {
    const at = timestamp(now);
    const normalizedName = requiredText(name, "name", 160);
    const normalizedSlug = normalizeSlug(slug);
    return transact(() => {
      if (db.prepare("SELECT 1 FROM saas_organizations WHERE slug = ? COLLATE NOCASE").get(normalizedSlug)) {
        fail("organization_exists", "An organization already exists for this slug.", 409);
      }
      const ownerDigest = emailDigest(ownerEmail);
      let account = db.prepare("SELECT * FROM saas_accounts WHERE email_hash = ?").get(ownerDigest);
      if (account) {
        account = authenticateRow(ownerEmail, ownerPassword);
        if (!account) fail("invalid_credentials", "Email or password is incorrect.", 401);
        if (account.status !== "active") fail("account_suspended", "Account is not active.", 403);
      } else {
        account = createAccount(ownerEmail, ownerPassword, at);
      }

      const organizationId = crypto.randomUUID();
      const membershipId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO saas_organizations
          (id, slug, name, status, created_by_account_id, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?, ?)
      `).run(organizationId, normalizedSlug, normalizedName, account.id, at, at);
      db.prepare(`
        INSERT INTO saas_memberships
          (id, organization_id, account_id, status, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?)
      `).run(membershipId, organizationId, account.id, at, at);
      db.prepare(`
        INSERT INTO saas_membership_roles (membership_id, role, created_at)
        VALUES (?, 'owner', ?)
      `).run(membershipId, at);
      audit({
        organizationId,
        actorAccountId: account.id,
        actorMembershipId: membershipId,
        action: "organization.created",
        resourceType: "organization",
        resourceId: organizationId,
        at,
      });
      const organization = db.prepare("SELECT * FROM saas_organizations WHERE id = ?").get(
        organizationId,
      );
      const membership = db.prepare("SELECT * FROM saas_memberships WHERE id = ?").get(
        membershipId,
      );
      return {
        organization: organizationView(organization),
        account: accountView(account),
        membership: membershipView(membership),
      };
    });
  }

  function authenticateCredentials({ email, password } = {}) {
    const account = authenticateRow(email, password);
    if (!account || account.status !== "active") return null;
    const memberships = db.prepare(`
      SELECT m.*, o.status AS organization_status, o.name AS organization_name,
             o.slug AS organization_slug
      FROM saas_memberships m
      JOIN saas_organizations o ON o.id = m.organization_id
      WHERE m.account_id = ?
      ORDER BY m.created_at, m.id
    `).all(account.id).map((row) => ({
      ...membershipView(row),
      organization: {
        id: row.organization_id,
        slug: row.organization_slug,
        name: row.organization_name,
        status: row.organization_status,
      },
    }));
    return { account: accountView(account), memberships };
  }

  function getAccountContext({ organizationId, accountId } = {}) {
    const organization = getOrganization(organizationId, { requireActive: true });
    const membership = getMembership(organizationId, accountId, { requireActive: true });
    const account = db.prepare("SELECT * FROM saas_accounts WHERE id = ?").get(membership.account_id);
    if (!account) fail("account_not_found", "Account was not found.", 404);
    const roles = membershipRoles(membership.id);
    if (roles.length === 0) fail("membership_invalid", "Membership has no active role.", 403);
    const linkedStudent = roles.includes("student")
      ? db.prepare(`
          SELECT * FROM saas_students
          WHERE organization_id = ? AND account_id = ? AND status = 'active'
        `).get(organizationId, account.id)
      : null;
    return {
      account: accountView(account),
      membership: membershipView(membership),
      organization: organizationView(organization),
      student: studentView(linkedStudent),
    };
  }

  function createStudent({
    organizationId,
    actorAccountId,
    displayName,
    grade,
    now,
  } = {}) {
    const at = timestamp(now);
    const normalizedName = optionalText(displayName, "displayName", 160);
    const normalizedGrade = normalizeGrade(grade);
    return transact(() => {
      const actor = requireManager(organizationId, actorAccountId);
      const studentId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO saas_students
          (id, organization_id, account_id, display_name, grade, status, created_at, updated_at)
        VALUES (?, ?, NULL, ?, ?, 'active', ?, ?)
      `).run(studentId, organizationId, normalizedName, normalizedGrade, at, at);
      audit({
        organizationId,
        actorAccountId,
        actorMembershipId: actor.membership.id,
        studentId,
        action: "student.created",
        resourceType: "student",
        resourceId: studentId,
        at,
      });
      return studentView(db.prepare("SELECT * FROM saas_students WHERE id = ?").get(studentId));
    });
  }

  function createAccessGrantInternal({
    organizationId,
    membershipId,
    studentId,
    permission,
    grantedByMembershipId,
    expiresAt = null,
    at,
  }) {
    const existing = db.prepare(`
      SELECT *
      FROM saas_student_access_grants
      WHERE organization_id = ? AND membership_id = ? AND student_id = ?
        AND permission = ? AND revoked_at IS NULL
    `).get(organizationId, membershipId, studentId, permission);
    if (existing) return existing;
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO saas_student_access_grants
        (id, organization_id, membership_id, student_id, permission,
         granted_by_membership_id, expires_at, revoked_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
    `).run(
      id,
      organizationId,
      membershipId,
      studentId,
      permission,
      grantedByMembershipId,
      expiresAt,
      at,
    );
    return db.prepare("SELECT * FROM saas_student_access_grants WHERE id = ?").get(id);
  }

  function createInvitation({
    organizationId,
    actorAccountId,
    email,
    role,
    targetStudentId = null,
    permissions = [],
    expiresAt,
    now,
  } = {}) {
    const at = timestamp(now);
    const normalizedRole = normalizeRole(role, { invitable: true });
    const normalizedEmail = normalizeEmail(email);
    const normalizedPermissions = normalizePermissions(permissions);
    const normalizedTarget = targetStudentId === null || targetStudentId === undefined
      ? null
      : requiredText(targetStudentId, "targetStudentId", 100);
    const expiry = expiresAt === undefined
      ? at + (7 * 24 * 60 * 60 * 1000)
      : timestamp(expiresAt);
    if (expiry <= at) fail("invalid_expiry", "Invitation expiry must be in the future.");
    if (normalizedRole === "guardian" && !normalizedTarget) {
      fail("student_required", "Guardian invitations must target a student.");
    }
    if (normalizedRole === "org_admin" && (normalizedTarget || normalizedPermissions.length)) {
      fail("invalid_invitation_scope", "Organization administrators cannot receive student scope.");
    }
    if (normalizedRole === "student" && normalizedPermissions.length) {
      fail("invalid_invitation_scope", "Student invitations cannot receive delegated access.");
    }
    if (normalizedPermissions.length && !normalizedTarget) {
      fail("student_required", "Delegated permissions must target a student.");
    }

    return transact(() => {
      const actor = requireManager(organizationId, actorAccountId);
      if (normalizedTarget) requireStudent(organizationId, normalizedTarget);
      const digest = emailDigest(normalizedEmail);
      const pending = db.prepare(`
        SELECT 1
        FROM saas_invitations
        WHERE organization_id = ? AND email_hash = ? AND role = ?
          AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?
      `).get(organizationId, digest, normalizedRole, at);
      if (pending) fail("invitation_exists", "A matching pending invitation already exists.", 409);

      const id = crypto.randomUUID();
      const token = newToken();
      db.prepare(`
        INSERT INTO saas_invitations
          (id, organization_id, email_hash, email_ciphertext, role, target_student_id,
           permissions_json, token_hash, created_by_membership_id, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        organizationId,
        digest,
        encodeEncrypted(normalizedEmail, encryptionKeyBuffer),
        normalizedRole,
        normalizedTarget,
        JSON.stringify(normalizedPermissions),
        hashToken(token),
        actor.membership.id,
        expiry,
        at,
      );
      audit({
        organizationId,
        actorAccountId,
        actorMembershipId: actor.membership.id,
        studentId: normalizedTarget,
        action: "invitation.created",
        resourceType: "invitation",
        resourceId: id,
        metadata: { role: normalizedRole, permissions: normalizedPermissions },
        at,
      });
      const row = db.prepare("SELECT * FROM saas_invitations WHERE id = ?").get(id);
      return { invitation: invitationView(row, at, { includeEmail: true }), token };
    });
  }

  function inspectInvitation({ token, now, includeEmail = false } = {}) {
    if (typeof token !== "string" || !token) return null;
    const at = timestamp(now);
    const row = db.prepare(`
      SELECT i.*, o.name AS organization_name, o.slug AS organization_slug
      FROM saas_invitations i
      JOIN saas_organizations o ON o.id = i.organization_id
      WHERE i.token_hash = ?
    `).get(hashToken(token));
    return invitationView(row, at, { includeEmail: includeEmail === true });
  }

  function listInvitations({ organizationId, actorAccountId, status, now } = {}) {
    const at = timestamp(now);
    requireManager(organizationId, actorAccountId);
    const requestedStatus = status === undefined ? null : String(status);
    if (requestedStatus && !new Set(["pending", "accepted", "revoked", "expired"]).has(requestedStatus)) {
      fail("invalid_status", "Invitation status is not allowed.");
    }
    const rows = db.prepare(`
      SELECT *
      FROM saas_invitations
      WHERE organization_id = ?
      ORDER BY created_at DESC, id DESC
    `).all(organizationId);
    return rows
      .map((row) => invitationView(row, at, { includeEmail: true }))
      .filter((row) => !requestedStatus || row.status === requestedStatus);
  }

  function revokeInvitation({ organizationId, invitationId, actorAccountId, now } = {}) {
    const at = timestamp(now);
    return transact(() => {
      const actor = requireManager(organizationId, actorAccountId);
      const row = db.prepare(`
        SELECT * FROM saas_invitations WHERE organization_id = ? AND id = ?
      `).get(
        organizationId,
        requiredText(invitationId, "invitationId", 100),
      );
      if (!row) fail("invitation_not_found", "Invitation was not found.", 404);
      const status = invitationStatus(row, at);
      if (status === "accepted") fail("invitation_accepted", "Accepted invitations cannot be revoked.", 409);
      if (status === "revoked") return invitationView(row, at, { includeEmail: true });
      db.prepare("UPDATE saas_invitations SET revoked_at = ? WHERE id = ?").run(at, row.id);
      audit({
        organizationId,
        actorAccountId,
        actorMembershipId: actor.membership.id,
        studentId: row.target_student_id,
        action: "invitation.revoked",
        resourceType: "invitation",
        resourceId: row.id,
        at,
      });
      return invitationView(
        db.prepare("SELECT * FROM saas_invitations WHERE id = ?").get(row.id),
        at,
        { includeEmail: true },
      );
    });
  }

  function acceptInvitation({
    token,
    email,
    password,
    displayName,
    grade,
    relationship,
    now,
  } = {}) {
    const at = timestamp(now);
    if (typeof token !== "string" || !token) {
      fail("invalid_invitation", "Invitation token is invalid.", 400);
    }
    const normalizedEmail = normalizeEmail(email);
    const normalizedName = optionalText(displayName, "displayName", 160);
    const normalizedGrade = normalizeGrade(grade);
    const normalizedRelationship = optionalText(relationship, "relationship", 80);
    return transact(() => {
      const row = db.prepare(`
        SELECT i.*, o.status AS organization_status
        FROM saas_invitations i
        JOIN saas_organizations o ON o.id = i.organization_id
        WHERE i.token_hash = ?
      `).get(hashToken(token));
      if (!row) fail("invalid_invitation", "Invitation token is invalid.", 400);
      const status = invitationStatus(row, at);
      if (status === "accepted") fail("invitation_used", "Invitation has already been accepted.", 409);
      if (status === "revoked") fail("invitation_revoked", "Invitation has been revoked.", 410);
      if (status === "expired") fail("invitation_expired", "Invitation has expired.", 410);
      if (row.organization_status !== "active") {
        fail("organization_suspended", "Organization is not active.", 403);
      }
      const suppliedHash = Buffer.from(emailDigest(normalizedEmail), "hex");
      const expectedHash = Buffer.from(row.email_hash, "hex");
      if (
        suppliedHash.length !== expectedHash.length
        || !crypto.timingSafeEqual(suppliedHash, expectedHash)
      ) {
        fail("invitation_email_mismatch", "Invitation is bound to a different email.", 403);
      }

      let account = db.prepare("SELECT * FROM saas_accounts WHERE email_hash = ?").get(row.email_hash);
      if (account) {
        account = authenticateRow(normalizedEmail, password);
        if (!account) fail("invalid_credentials", "Email or password is incorrect.", 401);
        if (account.status !== "active") fail("account_suspended", "Account is not active.", 403);
      } else {
        account = createAccount(normalizedEmail, password, at, normalizedName);
      }
      if (normalizedName && account.display_name !== normalizedName) {
        db.prepare(`
          UPDATE saas_accounts SET display_name = ?, updated_at = ? WHERE id = ?
        `).run(normalizedName, at, account.id);
        account = db.prepare("SELECT * FROM saas_accounts WHERE id = ?").get(account.id);
      }
      if (db.prepare(`
        SELECT 1 FROM saas_memberships WHERE organization_id = ? AND account_id = ?
      `).get(row.organization_id, account.id)) {
        fail("already_member", "Account already has a membership in this organization.", 409);
      }

      const membershipId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO saas_memberships
          (id, organization_id, account_id, status, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?)
      `).run(membershipId, row.organization_id, account.id, at, at);
      db.prepare(`
        INSERT INTO saas_membership_roles (membership_id, role, created_at)
        VALUES (?, ?, ?)
      `).run(membershipId, row.role, at);

      let student = null;
      let guardianLink = null;
      const accessGrants = [];
      const permissions = normalizePermissions(safeJson(row.permissions_json, []));
      if (row.role === "student") {
        if (row.target_student_id) {
          student = requireStudent(row.organization_id, row.target_student_id);
          const result = db.prepare(`
            UPDATE saas_students
            SET account_id = ?,
                display_name = COALESCE(display_name, ?),
                grade = COALESCE(grade, ?),
                updated_at = ?
            WHERE id = ? AND organization_id = ? AND account_id IS NULL
          `).run(
            account.id,
            normalizedName,
            normalizedGrade,
            at,
            student.id,
            row.organization_id,
          );
          if (result.changes !== 1) {
            fail("student_already_linked", "Student is already linked to an account.", 409);
          }
        } else {
          const studentId = crypto.randomUUID();
          db.prepare(`
            INSERT INTO saas_students
              (id, organization_id, account_id, display_name, grade, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
          `).run(
            studentId,
            row.organization_id,
            account.id,
            normalizedName,
            normalizedGrade,
            at,
            at,
          );
          student = db.prepare("SELECT * FROM saas_students WHERE id = ?").get(studentId);
        }
        student = db.prepare("SELECT * FROM saas_students WHERE id = ?").get(student.id);
      } else if (row.role === "guardian") {
        const target = requireStudent(row.organization_id, row.target_student_id);
        const linkId = crypto.randomUUID();
        db.prepare(`
          INSERT INTO saas_guardian_links
            (id, organization_id, guardian_membership_id, student_id, relationship,
             status, verification_method, verified_at, revoked_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'verified', 'email_invitation', ?, NULL, ?, ?)
        `).run(
          linkId,
          row.organization_id,
          membershipId,
          target.id,
          normalizedRelationship,
          at,
          at,
          at,
        );
        guardianLink = db.prepare("SELECT * FROM saas_guardian_links WHERE id = ?").get(linkId);
      }

      if (row.target_student_id && ["counselor", "guardian"].includes(row.role)) {
        for (const permission of permissions) {
          accessGrants.push(createAccessGrantInternal({
            organizationId: row.organization_id,
            membershipId,
            studentId: row.target_student_id,
            permission,
            grantedByMembershipId: row.created_by_membership_id,
            at,
          }));
        }
      }

      const consumed = db.prepare(`
        UPDATE saas_invitations
        SET accepted_at = ?, accepted_by_account_id = ?
        WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?
      `).run(at, account.id, row.id, at);
      if (consumed.changes !== 1) {
        fail("invitation_unavailable", "Invitation is no longer available.", 409);
      }
      audit({
        organizationId: row.organization_id,
        actorAccountId: account.id,
        actorMembershipId: membershipId,
        studentId: row.target_student_id ?? student?.id ?? null,
        action: "invitation.accepted",
        resourceType: "invitation",
        resourceId: row.id,
        metadata: { role: row.role },
        at,
      });

      const freshMembership = db.prepare("SELECT * FROM saas_memberships WHERE id = ?").get(
        membershipId,
      );
      const freshInvitation = db.prepare("SELECT * FROM saas_invitations WHERE id = ?").get(row.id);
      return {
        invitation: invitationView(freshInvitation, at),
        account: accountView(db.prepare("SELECT * FROM saas_accounts WHERE id = ?").get(account.id)),
        membership: membershipView(freshMembership),
        student: studentView(student),
        guardianLink: guardianLinkView(guardianLink),
        accessGrants: accessGrants.map(accessGrantView),
      };
    });
  }

  function createSession({
    email,
    password,
    organizationId,
    idleTtlMs,
    absoluteTtlMs,
    now,
  } = {}) {
    const at = timestamp(now);
    const idleTtl = normalizeTtl(idleTtlMs, DEFAULT_IDLE_TTL_MS, "idleTtlMs");
    const absoluteTtl = normalizeTtl(
      absoluteTtlMs,
      DEFAULT_ABSOLUTE_TTL_MS,
      "absoluteTtlMs",
    );
    const absoluteExpiresAt = at + absoluteTtl;
    if (!Number.isSafeInteger(absoluteExpiresAt)) fail("invalid_ttl", "Session expiry is too large.");
    return transact(() => {
      const account = authenticateRow(email, password);
      if (!account) fail("invalid_credentials", "Email or password is incorrect.", 401);
      if (account.status !== "active") fail("account_suspended", "Account is not active.", 403);
      getOrganization(organizationId, { requireActive: true });
      const membership = getMembership(organizationId, account.id, { requireActive: true });
      const roles = membershipRoles(membership.id);
      if (roles.length === 0) fail("membership_invalid", "Membership has no active role.", 403);

      const sessionToken = newToken();
      const csrfToken = newToken();
      const idleExpiresAt = Math.min(at + idleTtl, absoluteExpiresAt);
      db.prepare(`
        INSERT INTO saas_sessions_v2
          (token_hash, csrf_hash, account_id, organization_id, membership_id, auth_version,
           idle_ttl_ms, idle_expires_at, absolute_expires_at, revoked_at, created_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      `).run(
        hashToken(sessionToken),
        hashToken(csrfToken),
        account.id,
        organizationId,
        membership.id,
        account.auth_version,
        idleTtl,
        idleExpiresAt,
        absoluteExpiresAt,
        at,
        at,
      );
      audit({
        organizationId,
        actorAccountId: account.id,
        actorMembershipId: membership.id,
        action: "session.created",
        resourceType: "session",
        metadata: { absoluteExpiresAt, idleExpiresAt },
        at,
      });
      return {
        sessionToken,
        csrfToken,
        session: {
          accountId: account.id,
          organizationId,
          membershipId: membership.id,
          roles,
          idleExpiresAt,
          absoluteExpiresAt,
          createdAt: at,
        },
      };
    });
  }

  function validateSession({
    sessionToken,
    organizationId,
    csrfToken,
    requireCsrf = false,
    now,
  } = {}) {
    if (typeof sessionToken !== "string" || !sessionToken) return null;
    const at = timestamp(now);
    const tokenHash = hashToken(sessionToken);
    const row = db.prepare(`
      SELECT s.*, a.status AS account_status, a.auth_version AS live_auth_version,
             o.status AS organization_status, m.status AS membership_status,
             m.account_id AS membership_account_id
      FROM saas_sessions_v2 s
      JOIN saas_accounts a ON a.id = s.account_id
      JOIN saas_organizations o ON o.id = s.organization_id
      JOIN saas_memberships m ON m.id = s.membership_id
      WHERE s.token_hash = ?
    `).get(tokenHash);
    if (!row || row.revoked_at !== null) return null;
    if (organizationId !== undefined && organizationId !== row.organization_id) return null;
    if (
      row.idle_expires_at <= at
      || row.absolute_expires_at <= at
      || row.account_status !== "active"
      || row.organization_status !== "active"
      || row.membership_status !== "active"
      || row.membership_account_id !== row.account_id
      || row.live_auth_version !== row.auth_version
    ) {
      db.prepare(`
        UPDATE saas_sessions_v2 SET revoked_at = COALESCE(revoked_at, ?) WHERE token_hash = ?
      `).run(at, tokenHash);
      return null;
    }
    if (requireCsrf) {
      if (typeof csrfToken !== "string" || !csrfToken) return null;
      const supplied = Buffer.from(hashToken(csrfToken), "hex");
      const expected = Buffer.from(row.csrf_hash, "hex");
      if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
        return null;
      }
    }
    const roles = membershipRoles(row.membership_id);
    if (roles.length === 0) return null;
    const idleExpiresAt = Math.min(row.absolute_expires_at, at + row.idle_ttl_ms);
    db.prepare(`
      UPDATE saas_sessions_v2
      SET idle_expires_at = ?, last_seen_at = ?
      WHERE token_hash = ? AND revoked_at IS NULL
    `).run(idleExpiresAt, at, tokenHash);
    return {
      accountId: row.account_id,
      organizationId: row.organization_id,
      membershipId: row.membership_id,
      roles,
      idleExpiresAt,
      absoluteExpiresAt: row.absolute_expires_at,
      createdAt: row.created_at,
      lastSeenAt: at,
    };
  }

  function capActiveSessionIdleTtl({ idleTtlMs, now } = {}) {
    const at = timestamp(now);
    const maximumIdleTtl = normalizeTtl(
      idleTtlMs,
      DEFAULT_IDLE_TTL_MS,
      "idleTtlMs",
    );
    return transact(() => {
      const sessionsClamped = db.prepare(`
        UPDATE saas_sessions_v2
        SET idle_ttl_ms = ?,
            idle_expires_at = MIN(idle_expires_at, last_seen_at + ?, absolute_expires_at)
        WHERE revoked_at IS NULL AND idle_ttl_ms > ?
      `).run(maximumIdleTtl, maximumIdleTtl, maximumIdleTtl).changes;
      const sessionsRevoked = db.prepare(`
        UPDATE saas_sessions_v2
        SET revoked_at = ?
        WHERE revoked_at IS NULL
          AND (idle_expires_at <= ? OR absolute_expires_at <= ?)
      `).run(at, at, at).changes;
      return { sessionsClamped, sessionsRevoked, enforcedAt: at };
    });
  }

  function rotateSessionCsrf({ sessionToken, now } = {}) {
    if (typeof sessionToken !== "string" || !sessionToken) return null;
    const at = timestamp(now);
    return transact(() => {
      if (!validateSession({ sessionToken, now: at })) return null;
      const csrfToken = newToken();
      const updated = db.prepare(`
        UPDATE saas_sessions_v2
        SET csrf_hash = ?
        WHERE token_hash = ? AND revoked_at IS NULL
      `).run(hashToken(csrfToken), hashToken(sessionToken));
      return updated.changes === 1 ? csrfToken : null;
    });
  }

  function revokeSession({ sessionToken, now } = {}) {
    if (typeof sessionToken !== "string" || !sessionToken) return false;
    const at = timestamp(now);
    return db.prepare(`
      UPDATE saas_sessions_v2 SET revoked_at = COALESCE(revoked_at, ?) WHERE token_hash = ?
    `).run(at, hashToken(sessionToken)).changes === 1;
  }

  function invalidateAccountSessions({
    accountId,
    actorAccountId,
    organizationId,
    now,
  } = {}) {
    const at = timestamp(now);
    const targetAccountId = requiredText(accountId, "accountId", 100);
    const actorId = requiredText(actorAccountId, "actorAccountId", 100);
    return transact(() => {
      let actorMembershipId = null;
      if (actorId !== targetAccountId) {
        if (!organizationId) fail("forbidden", "Organization manager access is required.", 403);
        const actor = requireManager(organizationId, actorId);
        const targetMembership = getMembership(organizationId, targetAccountId);
        const targetRoles = membershipRoles(targetMembership.id);
        if (targetRoles.includes("owner") && !actor.roles.includes("owner")) {
          fail("forbidden", "Only an owner can invalidate an owner's sessions.", 403);
        }
        actorMembershipId = actor.membership.id;
      } else if (organizationId) {
        actorMembershipId = getMembership(organizationId, actorId).id;
      }
      const updated = db.prepare(`
        UPDATE saas_accounts
        SET auth_version = auth_version + 1, updated_at = ?
        WHERE id = ?
      `).run(at, targetAccountId);
      if (updated.changes !== 1) fail("account_not_found", "Account was not found.", 404);
      audit({
        organizationId: organizationId ?? null,
        actorAccountId: actorId,
        actorMembershipId,
        action: "account.sessions_invalidated",
        resourceType: "account",
        resourceId: targetAccountId,
        at,
      });
      return accountView(db.prepare("SELECT * FROM saas_accounts WHERE id = ?").get(targetAccountId));
    });
  }

  function changePassword({ accountId, currentPassword, newPassword, now } = {}) {
    const at = timestamp(now);
    const targetAccountId = requiredText(accountId, "accountId", 100);
    assertPassword(newPassword);
    return transact(() => {
      const row = db.prepare(`
        SELECT a.*, c.password_salt, c.password_hash
        FROM saas_accounts a
        JOIN saas_credentials c ON c.account_id = a.id
        WHERE a.id = ?
      `).get(targetAccountId);
      if (!row || !passwordMatches(currentPassword, row.password_salt, row.password_hash)) {
        fail("invalid_credentials", "Current password is incorrect.", 401);
      }
      const passwordData = passwordRecord(newPassword);
      db.prepare(`
        UPDATE saas_credentials
        SET password_salt = ?, password_hash = ?, updated_at = ?
        WHERE account_id = ?
      `).run(passwordData.salt, passwordData.hash, at, targetAccountId);
      db.prepare(`
        UPDATE saas_accounts
        SET auth_version = auth_version + 1, updated_at = ?
        WHERE id = ?
      `).run(at, targetAccountId);
      audit({
        actorAccountId: targetAccountId,
        action: "account.password_changed",
        resourceType: "account",
        resourceId: targetAccountId,
        at,
      });
      return accountView(db.prepare("SELECT * FROM saas_accounts WHERE id = ?").get(targetAccountId));
    });
  }

  function createPasswordReset({
    email,
    ttlMs = DEFAULT_PASSWORD_RESET_TTL_MS,
    cooldownMs = DEFAULT_PASSWORD_RESET_COOLDOWN_MS,
    now,
  } = {}) {
    const at = timestamp(now);
    const ttl = normalizeTtl(ttlMs, DEFAULT_PASSWORD_RESET_TTL_MS, "ttlMs");
    const cooldown = normalizeRetention(
      cooldownMs,
      DEFAULT_PASSWORD_RESET_COOLDOWN_MS,
      "cooldownMs",
    );
    if (ttl > 7 * 24 * 60 * 60 * 1000) {
      fail("invalid_ttl", "Password reset ttlMs cannot exceed seven days.");
    }
    if (cooldown > 24 * 60 * 60 * 1000) {
      fail("invalid_ttl", "Password reset cooldownMs cannot exceed one day.");
    }
    let digest;
    try {
      digest = emailDigest(email);
    } catch {
      return null;
    }
    return transact(() => {
      const account = db.prepare(`
        SELECT * FROM saas_accounts WHERE email_hash = ?
      `).get(digest);
      if (!account || account.status !== "active") return null;

      const latest = db.prepare(`
        SELECT created_at
        FROM saas_password_reset_tokens
        WHERE account_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `).get(account.id);
      if (latest && at - latest.created_at < cooldown) {
        // Returning null is deliberately indistinguishable from an unknown
        // account. Most importantly, the still-usable credential is preserved.
        return null;
      }

      db.prepare(`
        UPDATE saas_password_reset_tokens
        SET revoked_at = ?
        WHERE account_id = ? AND used_at IS NULL AND revoked_at IS NULL
      `).run(at, account.id);
      const id = crypto.randomUUID();
      const token = newToken();
      const expiresAt = at + ttl;
      if (!Number.isSafeInteger(expiresAt)) fail("invalid_ttl", "Password reset expiry is too large.");
      db.prepare(`
        INSERT INTO saas_password_reset_tokens
          (id, token_hash, account_id, email_hash, expires_at, used_at, revoked_at, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)
      `).run(id, hashToken(token), account.id, digest, expiresAt, at);
      audit({
        action: "password_reset.requested",
        resourceType: "account",
        resourceId: account.id,
        metadata: { resetId: id, expiresAt },
        at,
      });
      return { id, token, expiresAt, createdAt: at };
    });
  }

  function revokePasswordReset({ resetId, now } = {}) {
    const at = timestamp(now);
    return transact(() => {
      const row = db.prepare(`
        SELECT * FROM saas_password_reset_tokens WHERE id = ?
      `).get(requiredText(resetId, "resetId", 100));
      if (!row || row.used_at !== null || row.revoked_at !== null) return false;
      db.prepare(`
        UPDATE saas_password_reset_tokens SET revoked_at = ? WHERE id = ?
      `).run(at, row.id);
      audit({
        action: "password_reset.revoked",
        resourceType: "account",
        resourceId: row.account_id,
        metadata: { resetId: row.id },
        at,
      });
      return true;
    });
  }

  function completePasswordReset({ token, email, newPassword, now } = {}) {
    const at = timestamp(now);
    if (typeof token !== "string" || !token) {
      fail("invalid_password_reset", "Password reset token is invalid.", 400);
    }
    let suppliedEmailHash;
    try {
      suppliedEmailHash = emailDigest(email);
    } catch {
      fail("invalid_password_reset", "Password reset token is invalid.", 400);
    }
    return transact(() => {
      const row = db.prepare(`
        SELECT r.*, a.status AS account_status
        FROM saas_password_reset_tokens r
        JOIN saas_accounts a ON a.id = r.account_id
        WHERE r.token_hash = ?
      `).get(hashToken(token));
      if (!row) fail("invalid_password_reset", "Password reset token is invalid.", 400);
      if (row.used_at !== null) {
        fail("password_reset_used", "Password reset token has already been used.", 409);
      }
      if (row.revoked_at !== null) {
        fail("password_reset_revoked", "Password reset token is no longer active.", 410);
      }
      if (row.expires_at <= at) {
        fail("password_reset_expired", "Password reset token has expired.", 410);
      }
      if (row.account_status !== "active") {
        fail("account_suspended", "Account is not active.", 403);
      }
      const supplied = Buffer.from(suppliedEmailHash, "hex");
      const expected = Buffer.from(row.email_hash, "hex");
      if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
        fail("password_reset_email_mismatch", "Password reset is bound to a different email.", 403);
      }

      // Do not spend the deliberately expensive password KDF until the
      // reset capability, email binding, account state, and expiry are valid.
      const passwordData = passwordRecord(newPassword);
      const consumed = db.prepare(`
        UPDATE saas_password_reset_tokens
        SET used_at = ?
        WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?
      `).run(at, row.id, at);
      if (consumed.changes !== 1) {
        fail("password_reset_unavailable", "Password reset token is no longer available.", 409);
      }
      const credentialUpdate = db.prepare(`
        UPDATE saas_credentials
        SET password_salt = ?, password_hash = ?, updated_at = ?
        WHERE account_id = ?
      `).run(passwordData.salt, passwordData.hash, at, row.account_id);
      if (credentialUpdate.changes !== 1) {
        fail("credential_not_found", "Account credentials are unavailable.", 409);
      }
      db.prepare(`
        UPDATE saas_accounts
        SET auth_version = auth_version + 1, updated_at = ?
        WHERE id = ?
      `).run(at, row.account_id);
      db.prepare(`
        UPDATE saas_sessions_v2
        SET revoked_at = COALESCE(revoked_at, ?)
        WHERE account_id = ?
      `).run(at, row.account_id);
      db.prepare(`
        UPDATE saas_password_reset_tokens
        SET revoked_at = ?
        WHERE account_id = ? AND id <> ? AND used_at IS NULL AND revoked_at IS NULL
      `).run(at, row.account_id, row.id);
      audit({
        action: "password_reset.completed",
        resourceType: "account",
        resourceId: row.account_id,
        metadata: { resetId: row.id },
        at,
      });
      return { completed: true, accountId: row.account_id, completedAt: at };
    });
  }

  function purgeExpiredSecurityRecords({
    now,
    sessionRetentionMs,
    invitationRetentionMs,
    passwordResetRetentionMs,
  } = {}) {
    const at = timestamp(now);
    const sessionRetention = normalizeRetention(
      sessionRetentionMs,
      SECURITY_RETENTION_DEFAULTS.sessionsMs,
      "sessionRetentionMs",
    );
    const invitationRetention = normalizeRetention(
      invitationRetentionMs,
      SECURITY_RETENTION_DEFAULTS.invitationsMs,
      "invitationRetentionMs",
    );
    const resetRetention = normalizeRetention(
      passwordResetRetentionMs,
      SECURITY_RETENTION_DEFAULTS.passwordResetsMs,
      "passwordResetRetentionMs",
    );
    return transact(() => {
      const sessionCutoff = at - sessionRetention;
      const invitationCutoff = at - invitationRetention;
      const resetCutoff = at - resetRetention;
      const sessionsDeleted = db.prepare(`
        DELETE FROM saas_sessions_v2
        WHERE (revoked_at IS NOT NULL AND revoked_at <= ?)
           OR absolute_expires_at <= ?
           OR idle_expires_at <= ?
      `).run(sessionCutoff, sessionCutoff, sessionCutoff).changes;
      const invitationsDeleted = db.prepare(`
        DELETE FROM saas_invitations
        WHERE (accepted_at IS NOT NULL AND accepted_at <= ?)
           OR (revoked_at IS NOT NULL AND revoked_at <= ?)
           OR (accepted_at IS NULL AND revoked_at IS NULL AND expires_at <= ?)
      `).run(invitationCutoff, invitationCutoff, invitationCutoff).changes;
      const passwordResetsDeleted = db.prepare(`
        DELETE FROM saas_password_reset_tokens
        WHERE (used_at IS NOT NULL AND used_at <= ?)
           OR (revoked_at IS NOT NULL AND revoked_at <= ?)
           OR (used_at IS NULL AND revoked_at IS NULL AND expires_at <= ?)
      `).run(resetCutoff, resetCutoff, resetCutoff).changes;
      return {
        sessionsDeleted,
        invitationsDeleted,
        passwordResetsDeleted,
        purgedAt: at,
      };
    });
  }

  function listMembers({ organizationId, actorAccountId } = {}) {
    requireManager(organizationId, actorAccountId);
    return db.prepare(`
      SELECT m.*, a.email_ciphertext, a.display_name AS account_display_name,
             a.status AS account_status,
             s.id AS linked_student_id,
             s.display_name AS linked_student_display_name,
             s.grade AS linked_student_grade
      FROM saas_memberships m
      JOIN saas_accounts a ON a.id = m.account_id
      LEFT JOIN saas_students s
        ON s.organization_id = m.organization_id AND s.account_id = m.account_id
      WHERE m.organization_id = ?
      ORDER BY m.created_at, m.id
    `).all(organizationId).map((row) => membershipView(row, { includeEmail: true }));
  }

  function activeOwnerCount(organizationId) {
    return db.prepare(`
      SELECT COUNT(*) AS count
      FROM saas_memberships m
      JOIN saas_membership_roles r ON r.membership_id = m.id AND r.role = 'owner'
      JOIN saas_accounts a ON a.id = m.account_id
      WHERE m.organization_id = ? AND m.status = 'active' AND a.status = 'active'
    `).get(organizationId).count;
  }

  function setOrganizationStatus({ organizationId, actorAccountId, status, now } = {}) {
    const at = timestamp(now);
    const normalizedStatus = normalizeStatus(status, ORG_STATUSES, "organization");
    return transact(() => {
      const actor = requireManager(organizationId, actorAccountId, {
        ownerOnly: true,
        allowSuspendedOrganization: true,
      });
      db.prepare(`
        UPDATE saas_organizations SET status = ?, updated_at = ? WHERE id = ?
      `).run(normalizedStatus, at, organizationId);
      audit({
        organizationId,
        actorAccountId,
        actorMembershipId: actor.membership.id,
        action: "organization.status_changed",
        resourceType: "organization",
        resourceId: organizationId,
        metadata: { status: normalizedStatus },
        at,
      });
      return organizationView(
        db.prepare("SELECT * FROM saas_organizations WHERE id = ?").get(organizationId),
      );
    });
  }

  function setMembershipStatus({
    organizationId,
    membershipId,
    actorAccountId,
    status,
    now,
  } = {}) {
    const at = timestamp(now);
    const normalizedStatus = normalizeStatus(status, MEMBER_STATUSES, "membership");
    return transact(() => {
      const actor = requireManager(organizationId, actorAccountId);
      const target = getMembershipById(organizationId, membershipId);
      const targetRoles = membershipRoles(target.id);
      if (targetRoles.includes("owner") && !actor.roles.includes("owner")) {
        fail("forbidden", "Only an owner can change an owner's membership.", 403);
      }
      if (
        targetRoles.includes("owner")
        && target.status === "active"
        && normalizedStatus !== "active"
        && activeOwnerCount(organizationId) <= 1
      ) {
        fail("last_owner", "The last active owner cannot be suspended or revoked.", 409);
      }
      db.prepare(`
        UPDATE saas_memberships SET status = ?, updated_at = ?
        WHERE id = ? AND organization_id = ?
      `).run(normalizedStatus, at, target.id, organizationId);
      audit({
        organizationId,
        actorAccountId,
        actorMembershipId: actor.membership.id,
        action: "membership.status_changed",
        resourceType: "membership",
        resourceId: target.id,
        metadata: { status: normalizedStatus },
        at,
      });
      return membershipView(
        db.prepare("SELECT * FROM saas_memberships WHERE id = ?").get(target.id),
      );
    });
  }

  function setMembershipRoles({
    organizationId,
    membershipId,
    actorAccountId,
    roles,
    now,
  } = {}) {
    const at = timestamp(now);
    const normalizedRoles = normalizeRoles(roles);
    return transact(() => {
      const actor = requireManager(organizationId, actorAccountId);
      const target = getMembershipById(organizationId, membershipId);
      const currentRoles = membershipRoles(target.id);
      const targetIsOwner = currentRoles.includes("owner");
      if (targetIsOwner && !actor.roles.includes("owner")) {
        fail("forbidden", "Only an owner can change an owner's roles.", 403);
      }
      if (targetIsOwner && !normalizedRoles.includes("owner")) {
        fail("owner_role_immutable", "Owner transfer must use a dedicated administrative flow.", 409);
      }
      if (!targetIsOwner && normalizedRoles.includes("owner")) {
        fail("owner_role_immutable", "Owner transfer must use a dedicated administrative flow.", 409);
      }
      db.prepare("DELETE FROM saas_membership_roles WHERE membership_id = ?").run(target.id);
      const insertRole = db.prepare(`
        INSERT INTO saas_membership_roles (membership_id, role, created_at) VALUES (?, ?, ?)
      `);
      for (const role of normalizedRoles) insertRole.run(target.id, role, at);
      audit({
        organizationId,
        actorAccountId,
        actorMembershipId: actor.membership.id,
        action: "membership.roles_changed",
        resourceType: "membership",
        resourceId: target.id,
        metadata: { roles: normalizedRoles },
        at,
      });
      return membershipView(
        db.prepare("SELECT * FROM saas_memberships WHERE id = ?").get(target.id),
      );
    });
  }

  function setAccountStatus({
    organizationId,
    accountId,
    actorAccountId,
    status,
    now,
  } = {}) {
    const at = timestamp(now);
    const normalizedStatus = normalizeStatus(status, new Set(["active", "suspended"]), "account");
    return transact(() => {
      const actor = requireManager(organizationId, actorAccountId, { ownerOnly: true });
      const target = getMembership(organizationId, accountId);
      const roles = membershipRoles(target.id);
      if (
        roles.includes("owner")
        && normalizedStatus !== "active"
        && activeOwnerCount(organizationId) <= 1
      ) {
        fail("last_owner", "The last active owner cannot be suspended.", 409);
      }
      const updated = db.prepare(`
        UPDATE saas_accounts
        SET status = ?, auth_version = auth_version + 1, updated_at = ?
        WHERE id = ?
      `).run(normalizedStatus, at, target.account_id);
      if (updated.changes !== 1) fail("account_not_found", "Account was not found.", 404);
      audit({
        organizationId,
        actorAccountId,
        actorMembershipId: actor.membership.id,
        action: "account.status_changed",
        resourceType: "account",
        resourceId: target.account_id,
        metadata: { status: normalizedStatus },
        at,
      });
      return accountView(db.prepare("SELECT * FROM saas_accounts WHERE id = ?").get(target.account_id));
    });
  }

  function closeOwnStudentAccount({ organizationId, accountId, now } = {}) {
    const at = timestamp(now);
    return transact(() => {
      getOrganization(organizationId, { requireActive: true });
      const membership = getMembership(organizationId, accountId, { requireActive: true });
      const roles = membershipRoles(membership.id);
      if (roles.length !== 1 || roles[0] !== "student") {
        fail("forbidden", "Only an exact student membership can close its own student account.", 403);
      }
      const student = db.prepare(`
        SELECT * FROM saas_students
        WHERE organization_id = ? AND account_id = ? AND status = 'active'
      `).get(organizationId, membership.account_id);
      if (!student) {
        fail("student_not_found", "A linked active student was not found.", 404);
      }

      db.prepare(`
        UPDATE saas_students
        SET status = 'archived', account_id = NULL, display_name = NULL,
            grade = NULL, updated_at = ?
        WHERE id = ?
      `).run(at, student.id);
      db.prepare(`
        UPDATE saas_student_access_grants
        SET revoked_at = ?
        WHERE organization_id = ? AND (student_id = ? OR membership_id = ?)
          AND revoked_at IS NULL
      `).run(at, organizationId, student.id, membership.id);
      db.prepare(`
        UPDATE saas_guardian_links
        SET status = 'revoked', revoked_at = ?, updated_at = ?
        WHERE organization_id = ? AND student_id = ? AND revoked_at IS NULL
      `).run(at, at, organizationId, student.id);
      db.prepare(`
        UPDATE saas_consent_grants
        SET revoked_at = ?, revoked_by_account_id = ?
        WHERE organization_id = ? AND student_id = ? AND revoked_at IS NULL
      `).run(at, membership.account_id, organizationId, student.id);
      db.prepare(`
        UPDATE saas_invitations
        SET revoked_at = ?
        WHERE organization_id = ? AND target_student_id = ?
          AND accepted_at IS NULL AND revoked_at IS NULL
      `).run(at, organizationId, student.id);
      const studentInvitations = db.prepare(`
        SELECT id
        FROM saas_invitations
        WHERE organization_id = ? AND role = 'student'
          AND (target_student_id = ? OR accepted_by_account_id = ?)
      `).all(organizationId, student.id, membership.account_id);
      const scrubInvitation = db.prepare(`
        UPDATE saas_invitations
        SET email_hash = ?, email_ciphertext = NULL, token_hash = ?,
            target_student_id = NULL, accepted_by_account_id = NULL
        WHERE organization_id = ? AND id = ?
      `);
      for (const invitation of studentInvitations) {
        scrubInvitation.run(
          crypto.randomBytes(32).toString("hex"),
          crypto.randomBytes(32).toString("hex"),
          organizationId,
          invitation.id,
        );
      }
      db.prepare(`
        UPDATE saas_memberships SET status = 'revoked', updated_at = ? WHERE id = ?
      `).run(at, membership.id);
      db.prepare(`
        UPDATE saas_sessions_v2
        SET revoked_at = COALESCE(revoked_at, ?)
        WHERE organization_id = ? AND membership_id = ?
      `).run(at, organizationId, membership.id);

      const otherLiveMemberships = db.prepare(`
        SELECT COUNT(*) AS count
        FROM saas_memberships m
        JOIN saas_organizations o ON o.id = m.organization_id
        WHERE m.account_id = ? AND m.id <> ?
          AND m.status = 'active' AND o.status = 'active'
      `).get(membership.account_id, membership.id).count;
      const accountClosed = otherLiveMemberships === 0;
      if (accountClosed) {
        db.prepare("DELETE FROM saas_credentials WHERE account_id = ?").run(membership.account_id);
        db.prepare(`
          UPDATE saas_password_reset_tokens
          SET revoked_at = COALESCE(revoked_at, ?)
          WHERE account_id = ? AND used_at IS NULL
        `).run(at, membership.account_id);
        db.prepare(`
          UPDATE saas_accounts
          SET email_hash = ?, email_ciphertext = NULL, display_name = NULL,
              status = 'suspended', auth_version = auth_version + 1, updated_at = ?
          WHERE id = ?
        `).run(crypto.randomBytes(32).toString("hex"), at, membership.account_id);
      }
      audit({
        organizationId,
        actorAccountId: membership.account_id,
        actorMembershipId: membership.id,
        studentId: student.id,
        action: "student_account.closed",
        resourceType: "student",
        resourceId: student.id,
        metadata: {
          accountClosed,
          otherLiveMemberships,
          invitationsScrubbed: studentInvitations.length,
        },
        at,
      });
      const closedStudent = db.prepare("SELECT * FROM saas_students WHERE id = ?").get(student.id);
      const closedMembership = db.prepare("SELECT * FROM saas_memberships WHERE id = ?").get(
        membership.id,
      );
      const account = db.prepare("SELECT * FROM saas_accounts WHERE id = ?").get(
        membership.account_id,
      );
      return {
        student: studentView(closedStudent),
        membership: membershipView(closedMembership),
        account: accountView(account),
        studentClosed: closedStudent.status === "archived",
        accountClosed,
        credentialsRevoked: accountClosed,
        otherLiveMemberships,
        invitationsScrubbed: studentInvitations.length,
        closedAt: at,
      };
    });
  }

  function getStudentContext({
    organizationId,
    studentId,
    actorAccountId,
    permission = "student.profile.read",
    now,
  } = {}) {
    const at = timestamp(now);
    const normalizedPermission = normalizePermissions([permission])[0];
    getOrganization(organizationId, { requireActive: true });
    const membership = getMembership(organizationId, actorAccountId, { requireActive: true });
    const student = requireStudent(organizationId, studentId);
    const roles = membershipRoles(membership.id);
    if (student.account_id === actorAccountId && roles.includes("student")) {
      return {
        student: studentView(student),
        access: { source: "student_self", permission: normalizedPermission, grantId: null },
      };
    }
    if (roles.includes("owner") || roles.includes("org_admin")) {
      fail("student_access_forbidden", "Organization managers do not receive student-data access.", 403);
    }
    const grant = db.prepare(`
      SELECT *
      FROM saas_student_access_grants
      WHERE organization_id = ? AND membership_id = ? AND student_id = ?
        AND permission = ? AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
    `).get(organizationId, membership.id, student.id, normalizedPermission, at);
    if (!grant) fail("student_access_forbidden", "Student access was not granted.", 403);
    if (roles.includes("guardian")) {
      const link = db.prepare(`
        SELECT 1
        FROM saas_guardian_links
        WHERE organization_id = ? AND guardian_membership_id = ? AND student_id = ?
          AND status = 'verified' AND revoked_at IS NULL
      `).get(organizationId, membership.id, student.id);
      if (!link) fail("guardian_not_verified", "Guardian relationship is not verified.", 403);
    } else if (!roles.includes("counselor")) {
      fail("student_access_forbidden", "Membership role cannot receive student-data access.", 403);
    }
    return {
      student: studentView(student),
      access: { source: "access_grant", permission: normalizedPermission, grantId: grant.id },
    };
  }

  function grantStudentAccess({
    organizationId,
    studentId,
    membershipId,
    actorAccountId,
    permission,
    expiresAt = null,
    now,
  } = {}) {
    const at = timestamp(now);
    const normalizedPermission = normalizePermissions([permission])[0];
    const expiry = expiresAt === null || expiresAt === undefined ? null : timestamp(expiresAt);
    if (expiry !== null && expiry <= at) fail("invalid_expiry", "Grant expiry must be in the future.");
    return transact(() => {
      const actor = requireManager(organizationId, actorAccountId);
      const student = requireStudent(organizationId, studentId);
      const target = getMembershipById(organizationId, membershipId);
      if (target.status !== "active") fail("membership_suspended", "Membership is not active.", 403);
      const roles = membershipRoles(target.id);
      if (roles.includes("owner") || roles.includes("org_admin") || roles.includes("student")) {
        fail("invalid_grantee", "Only counselor or verified guardian memberships may receive grants.");
      }
      if (!roles.includes("counselor") && !roles.includes("guardian")) {
        fail("invalid_grantee", "Only counselor or verified guardian memberships may receive grants.");
      }
      if (roles.includes("guardian")) {
        const verified = db.prepare(`
          SELECT 1 FROM saas_guardian_links
          WHERE organization_id = ? AND guardian_membership_id = ? AND student_id = ?
            AND status = 'verified' AND revoked_at IS NULL
        `).get(organizationId, target.id, student.id);
        if (!verified) fail("guardian_not_verified", "Guardian relationship is not verified.", 403);
      }
      const grant = createAccessGrantInternal({
        organizationId,
        membershipId: target.id,
        studentId: student.id,
        permission: normalizedPermission,
        grantedByMembershipId: actor.membership.id,
        expiresAt: expiry,
        at,
      });
      audit({
        organizationId,
        actorAccountId,
        actorMembershipId: actor.membership.id,
        studentId: student.id,
        action: "student_access.granted",
        resourceType: "student_access_grant",
        resourceId: grant.id,
        metadata: { membershipId: target.id, permission: normalizedPermission },
        at,
      });
      return accessGrantView(grant);
    });
  }

  function revokeStudentAccess({
    organizationId,
    grantId,
    actorAccountId,
    now,
  } = {}) {
    const at = timestamp(now);
    return transact(() => {
      const actor = requireManager(organizationId, actorAccountId);
      const grant = db.prepare(`
        SELECT * FROM saas_student_access_grants WHERE organization_id = ? AND id = ?
      `).get(organizationId, requiredText(grantId, "grantId", 100));
      if (!grant) fail("grant_not_found", "Student access grant was not found.", 404);
      if (grant.revoked_at === null) {
        db.prepare(`
          UPDATE saas_student_access_grants SET revoked_at = ? WHERE id = ?
        `).run(at, grant.id);
        audit({
          organizationId,
          actorAccountId,
          actorMembershipId: actor.membership.id,
          studentId: grant.student_id,
          action: "student_access.revoked",
          resourceType: "student_access_grant",
          resourceId: grant.id,
          at,
        });
      }
      return accessGrantView(
        db.prepare("SELECT * FROM saas_student_access_grants WHERE id = ?").get(grant.id),
      );
    });
  }

  function listStudentAccessGrants({ organizationId, studentId, actorAccountId, now } = {}) {
    const at = timestamp(now);
    requireManager(organizationId, actorAccountId);
    requireStudent(organizationId, studentId, { requireActive: false });
    return db.prepare(`
      SELECT *
      FROM saas_student_access_grants
      WHERE organization_id = ? AND student_id = ?
      ORDER BY created_at DESC, id DESC
    `).all(organizationId, studentId).map((row) => ({
      ...accessGrantView(row),
      status: row.revoked_at !== null
        ? "revoked"
        : row.expires_at !== null && row.expires_at <= at
          ? "expired"
      : "active",
    }));
  }

  function createGuardianLink({
    organizationId,
    guardianMembershipId,
    studentId,
    actorAccountId,
    relationship,
    now,
  } = {}) {
    const at = timestamp(now);
    const normalizedRelationship = optionalText(relationship, "relationship", 80);
    return transact(() => {
      const actor = requireManager(organizationId, actorAccountId);
      const guardianMembership = getMembershipById(organizationId, guardianMembershipId);
      if (guardianMembership.status !== "active") {
        fail("membership_suspended", "Membership is not active.", 403);
      }
      const roles = membershipRoles(guardianMembership.id);
      if (!roles.includes("guardian") || roles.includes("owner") || roles.includes("org_admin")) {
        fail("invalid_guardian", "A guardian membership is required.");
      }
      const student = requireStudent(organizationId, studentId);
      const existing = db.prepare(`
        SELECT 1 FROM saas_guardian_links
        WHERE organization_id = ? AND guardian_membership_id = ? AND student_id = ?
          AND revoked_at IS NULL
      `).get(organizationId, guardianMembership.id, student.id);
      if (existing) fail("guardian_link_exists", "Guardian link already exists.", 409);
      const id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO saas_guardian_links
          (id, organization_id, guardian_membership_id, student_id, relationship,
           status, verification_method, verified_at, revoked_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, ?, ?)
      `).run(
        id,
        organizationId,
        guardianMembership.id,
        student.id,
        normalizedRelationship,
        at,
        at,
      );
      audit({
        organizationId,
        actorAccountId,
        actorMembershipId: actor.membership.id,
        studentId: student.id,
        action: "guardian_link.created",
        resourceType: "guardian_link",
        resourceId: id,
        metadata: { guardianMembershipId: guardianMembership.id },
        at,
      });
      return guardianLinkView(
        db.prepare("SELECT * FROM saas_guardian_links WHERE id = ?").get(id),
      );
    });
  }

  function verifyGuardianLink({
    organizationId,
    guardianLinkId,
    actorAccountId,
    verificationMethod = "manager_verified",
    now,
  } = {}) {
    const at = timestamp(now);
    const method = requiredText(verificationMethod, "verificationMethod", 80);
    if (method === "self_asserted") fail("invalid_verification", "Self-assertion is not verification.");
    return transact(() => {
      const actor = requireManager(organizationId, actorAccountId);
      const link = db.prepare(`
        SELECT * FROM saas_guardian_links WHERE organization_id = ? AND id = ?
      `).get(organizationId, requiredText(guardianLinkId, "guardianLinkId", 100));
      if (!link) fail("guardian_link_not_found", "Guardian link was not found.", 404);
      if (link.status === "revoked" || link.revoked_at !== null) {
        fail("guardian_link_revoked", "Guardian link is revoked.", 409);
      }
      if (link.status !== "verified") {
        db.prepare(`
          UPDATE saas_guardian_links
          SET status = 'verified', verification_method = ?, verified_at = ?, updated_at = ?
          WHERE id = ?
        `).run(method, at, at, link.id);
        audit({
          organizationId,
          actorAccountId,
          actorMembershipId: actor.membership.id,
          studentId: link.student_id,
          action: "guardian_link.verified",
          resourceType: "guardian_link",
          resourceId: link.id,
          metadata: { verificationMethod: method },
          at,
        });
      }
      return guardianLinkView(
        db.prepare("SELECT * FROM saas_guardian_links WHERE id = ?").get(link.id),
      );
    });
  }

  function revokeGuardianLink({
    organizationId,
    guardianLinkId,
    actorAccountId,
    now,
  } = {}) {
    const at = timestamp(now);
    return transact(() => {
      const actor = requireManager(organizationId, actorAccountId);
      const link = db.prepare(`
        SELECT * FROM saas_guardian_links WHERE organization_id = ? AND id = ?
      `).get(organizationId, requiredText(guardianLinkId, "guardianLinkId", 100));
      if (!link) fail("guardian_link_not_found", "Guardian link was not found.", 404);
      if (link.revoked_at === null) {
        db.prepare(`
          UPDATE saas_guardian_links
          SET status = 'revoked', revoked_at = ?, updated_at = ? WHERE id = ?
        `).run(at, at, link.id);
        db.prepare(`
          UPDATE saas_consent_grants
          SET revoked_at = ?, revoked_by_account_id = ?
          WHERE guardian_link_id = ? AND revoked_at IS NULL
        `).run(at, actorAccountId, link.id);
        db.prepare(`
          UPDATE saas_student_access_grants
          SET revoked_at = ?
          WHERE organization_id = ? AND membership_id = ? AND student_id = ?
            AND revoked_at IS NULL
        `).run(at, organizationId, link.guardian_membership_id, link.student_id);
        audit({
          organizationId,
          actorAccountId,
          actorMembershipId: actor.membership.id,
          studentId: link.student_id,
          action: "guardian_link.revoked",
          resourceType: "guardian_link",
          resourceId: link.id,
          at,
        });
      }
      return guardianLinkView(
        db.prepare("SELECT * FROM saas_guardian_links WHERE id = ?").get(link.id),
      );
    });
  }

  function listGuardianLinks({ organizationId, studentId, actorAccountId } = {}) {
    requireManager(organizationId, actorAccountId);
    requireStudent(organizationId, studentId, { requireActive: false });
    return db.prepare(`
      SELECT * FROM saas_guardian_links
      WHERE organization_id = ? AND student_id = ?
      ORDER BY created_at, id
    `).all(organizationId, studentId).map(guardianLinkView);
  }

  function listGuardianStudents({ organizationId, actorAccountId } = {}) {
    getOrganization(organizationId, { requireActive: true });
    const membership = getMembership(organizationId, actorAccountId, { requireActive: true });
    const roles = membershipRoles(membership.id);
    if (
      !roles.includes("guardian")
      || roles.includes("owner")
      || roles.includes("org_admin")
    ) {
      fail("forbidden", "An active guardian membership is required.", 403);
    }
    return db.prepare(`
      SELECT gl.id AS link_id, gl.relationship, gl.verified_at,
             s.id AS student_id, s.display_name, s.grade
      FROM saas_guardian_links gl
      JOIN saas_students s
        ON s.id = gl.student_id AND s.organization_id = gl.organization_id
      WHERE gl.organization_id = ? AND gl.guardian_membership_id = ?
        AND gl.status = 'verified' AND gl.revoked_at IS NULL
        AND s.status = 'active'
      ORDER BY s.display_name, s.id
    `).all(organizationId, membership.id).map((row) => ({
      link: {
        id: row.link_id,
        relationship: row.relationship ?? null,
        verifiedAt: row.verified_at,
      },
      student: {
        id: row.student_id,
        displayName: row.display_name ?? null,
        grade: row.grade ?? null,
      },
    }));
  }

  function grantGuardianConsent({
    organizationId,
    studentId,
    actorAccountId,
    consentType,
    policyVersion,
    scope,
    expiresAt = null,
    now,
  } = {}) {
    const at = timestamp(now);
    const normalizedType = requiredText(consentType, "consentType", 80);
    if (!/^[a-z][a-z0-9_.-]*$/u.test(normalizedType)) {
      fail("invalid_consent_type", "Consent type is not allowed.");
    }
    const normalizedPolicy = requiredText(policyVersion, "policyVersion", 100);
    const normalizedScope = jsonObject(scope, "scope");
    if (Object.keys(normalizedScope).length === 0) {
      fail("invalid_consent_scope", "Consent scope must contain an explicit policy snapshot.");
    }
    let serializedScope;
    try {
      serializedScope = JSON.stringify(normalizedScope);
    } catch {
      fail("invalid_input", "scope must be JSON serializable.");
    }
    const expiry = expiresAt === null || expiresAt === undefined ? null : timestamp(expiresAt);
    if (expiry !== null && expiry <= at) fail("invalid_expiry", "Consent expiry must be in the future.");
    return transact(() => {
      getOrganization(organizationId, { requireActive: true });
      const student = requireStudent(organizationId, studentId);
      const membership = getMembership(organizationId, actorAccountId, { requireActive: true });
      const roles = membershipRoles(membership.id);
      if (!roles.includes("guardian") || roles.includes("owner") || roles.includes("org_admin")) {
        fail("guardian_not_verified", "A verified guardian must grant consent.", 403);
      }
      const link = db.prepare(`
        SELECT * FROM saas_guardian_links
        WHERE organization_id = ? AND guardian_membership_id = ? AND student_id = ?
          AND status = 'verified' AND revoked_at IS NULL
      `).get(organizationId, membership.id, student.id);
      if (!link) fail("guardian_not_verified", "A verified guardian must grant consent.", 403);

      let existing = db.prepare(`
        SELECT * FROM saas_consent_grants
        WHERE organization_id = ? AND student_id = ? AND guardian_link_id = ?
          AND consent_type = ? AND policy_version = ? AND revoked_at IS NULL
      `).get(
        organizationId,
        student.id,
        link.id,
        normalizedType,
        normalizedPolicy,
      );
      if (existing && existing.expires_at !== null && existing.expires_at <= at) {
        db.prepare(`
          UPDATE saas_consent_grants
          SET revoked_at = ?, revoked_by_account_id = ? WHERE id = ?
        `).run(at, actorAccountId, existing.id);
        existing = null;
      }
      if (existing) return consentView(existing, at);

      const id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO saas_consent_grants
          (id, organization_id, student_id, guardian_link_id, actor_account_id,
           consent_type, policy_version, scope_json, granted_at, expires_at, revoked_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `).run(
        id,
        organizationId,
        student.id,
        link.id,
        actorAccountId,
        normalizedType,
        normalizedPolicy,
        serializedScope,
        at,
        expiry,
      );
      audit({
        organizationId,
        actorAccountId,
        actorMembershipId: membership.id,
        studentId: student.id,
        action: "guardian_consent.granted",
        resourceType: "consent_grant",
        resourceId: id,
        metadata: { consentType: normalizedType, policyVersion: normalizedPolicy },
        at,
      });
      return consentView(
        db.prepare("SELECT * FROM saas_consent_grants WHERE id = ?").get(id),
        at,
      );
    });
  }

  function revokeGuardianConsent({
    organizationId,
    consentId,
    studentId,
    actorAccountId,
    consentType,
    policyVersion,
    now,
  } = {}) {
    const at = timestamp(now);
    return transact(() => {
      getOrganization(organizationId, { requireActive: true });
      const membership = getMembership(organizationId, actorAccountId, { requireActive: true });
      if (!membershipRoles(membership.id).includes("guardian")) {
        fail("forbidden", "Only the consenting guardian may revoke consent.", 403);
      }
      let consent;
      if (consentId !== undefined && consentId !== null) {
        consent = db.prepare(`
          SELECT c.*
          FROM saas_consent_grants c
          JOIN saas_guardian_links gl ON gl.id = c.guardian_link_id
          WHERE c.organization_id = ? AND c.id = ?
            AND gl.guardian_membership_id = ?
        `).get(
          organizationId,
          requiredText(consentId, "consentId", 100),
          membership.id,
        );
      } else {
        const student = requireStudent(organizationId, studentId, { requireActive: false });
        const normalizedType = requiredText(consentType, "consentType", 80);
        const normalizedPolicy = requiredText(policyVersion, "policyVersion", 100);
        consent = db.prepare(`
          SELECT c.*
          FROM saas_consent_grants c
          JOIN saas_guardian_links gl ON gl.id = c.guardian_link_id
          WHERE c.organization_id = ? AND c.student_id = ?
            AND c.consent_type = ? AND c.policy_version = ?
            AND gl.guardian_membership_id = ?
          ORDER BY c.granted_at DESC, c.id DESC
          LIMIT 1
        `).get(
          organizationId,
          student.id,
          normalizedType,
          normalizedPolicy,
          membership.id,
        );
      }
      if (!consent) fail("consent_not_found", "Consent grant was not found.", 404);
      if (consent.revoked_at === null) {
        db.prepare(`
          UPDATE saas_consent_grants
          SET revoked_at = ?, revoked_by_account_id = ? WHERE id = ?
        `).run(at, actorAccountId, consent.id);
        audit({
          organizationId,
          actorAccountId,
          actorMembershipId: membership.id,
          studentId: consent.student_id,
          action: "guardian_consent.revoked",
          resourceType: "consent_grant",
          resourceId: consent.id,
          at,
        });
      }
      return consentView(
        db.prepare("SELECT * FROM saas_consent_grants WHERE id = ?").get(consent.id),
        at,
      );
    });
  }

  function revokeGuardianConsentByPolicy(options = {}) {
    return revokeGuardianConsent({ ...options, consentId: undefined });
  }

  function getGuardianConsentStatus({
    organizationId,
    studentId,
    actorAccountId,
    consentType,
    policyVersion,
    now,
  } = {}) {
    const at = timestamp(now);
    const normalizedType = requiredText(consentType, "consentType", 80);
    const normalizedPolicy = requiredText(policyVersion, "policyVersion", 100);
    getOrganization(organizationId, { requireActive: true });
    const student = requireStudent(organizationId, studentId);
    const membership = getMembership(organizationId, actorAccountId, { requireActive: true });
    const roles = membershipRoles(membership.id);
    let authorized = student.account_id === actorAccountId && roles.includes("student");
    if (!authorized && roles.includes("guardian")) {
      authorized = Boolean(db.prepare(`
        SELECT 1 FROM saas_guardian_links
        WHERE organization_id = ? AND guardian_membership_id = ? AND student_id = ?
          AND status = 'verified' AND revoked_at IS NULL
      `).get(organizationId, membership.id, student.id));
    }
    if (!authorized && roles.includes("counselor")) {
      authorized = Boolean(db.prepare(`
        SELECT 1 FROM saas_student_access_grants
        WHERE organization_id = ? AND membership_id = ? AND student_id = ?
          AND permission = 'student.consent.manage' AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > ?)
      `).get(organizationId, membership.id, student.id, at));
    }
    if (!authorized) fail("student_access_forbidden", "Consent status access was not granted.", 403);

    const rows = db.prepare(`
      SELECT c.*
      FROM saas_consent_grants c
      JOIN saas_guardian_links gl ON gl.id = c.guardian_link_id
      JOIN saas_memberships gm ON gm.id = gl.guardian_membership_id
      JOIN saas_accounts ga ON ga.id = gm.account_id
      WHERE c.organization_id = ? AND c.student_id = ?
        AND c.consent_type = ? AND c.policy_version = ?
        AND c.revoked_at IS NULL AND (c.expires_at IS NULL OR c.expires_at > ?)
        AND gl.status = 'verified' AND gl.revoked_at IS NULL
        AND gm.status = 'active' AND ga.status = 'active'
      ORDER BY c.granted_at, c.id
    `).all(organizationId, student.id, normalizedType, normalizedPolicy, at);
    return { granted: rows.length > 0, consents: rows.map((row) => consentView(row, at)) };
  }

  function listAuditEvents({ organizationId, actorAccountId, limit = 100 } = {}) {
    requireManager(organizationId, actorAccountId);
    const normalizedLimit = Number(limit);
    if (!Number.isInteger(normalizedLimit) || normalizedLimit < 1 || normalizedLimit > 500) {
      fail("invalid_limit", "Audit limit must be between 1 and 500.");
    }
    return db.prepare(`
      SELECT * FROM saas_audit_events
      WHERE organization_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(organizationId, normalizedLimit).map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      actorAccountId: row.actor_account_id,
      actorMembershipId: row.actor_membership_id,
      subjectStudentId: row.subject_student_id,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      metadata: safeJson(row.metadata_json, {}),
      createdAt: row.created_at,
    }));
  }

  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    createOrganization,
    authenticateCredentials,
    getAccountContext,
    changePassword,
    createPasswordReset,
    revokePasswordReset,
    completePasswordReset,
    purgeExpiredSecurityRecords,
    createInvitation,
    inspectInvitation,
    listInvitations,
    revokeInvitation,
    acceptInvitation,
    createSession,
    issueSession: createSession,
    validateSession,
    capActiveSessionIdleTtl,
    rotateSessionCsrf,
    revokeSession,
    invalidateAccountSessions,
    listMembers,
    setOrganizationStatus,
    setMembershipStatus,
    setMembershipRoles,
    setAccountStatus,
    closeOwnStudentAccount,
    createStudent,
    getStudentContext,
    grantStudentAccess,
    revokeStudentAccess,
    listStudentAccessGrants,
    createGuardianLink,
    verifyGuardianLink,
    revokeGuardianLink,
    listGuardianLinks,
    listGuardianStudents,
    grantGuardianConsent,
    revokeGuardianConsent,
    revokeGuardianConsentByPolicy,
    getGuardianConsentStatus,
    listAuditEvents,
  });
}

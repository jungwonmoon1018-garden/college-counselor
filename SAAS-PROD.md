# Multi-tenant SaaS production profile

This profile runs the student SaaS behind automatic HTTPS with one application
replica, a durable data volume, hardened containers, bounded resources, and
rotated container logs. It is suitable for a small, single-region production
launch after the application checks and operator gates below pass.

It is **not horizontal high availability**. The current persistence layer is
SQLite plus files on one volume. Run exactly one `app` replica and one active
writer. Do not deploy it on an ephemeral filesystem, a serverless runtime, or a
platform that automatically scales containers. A host or availability-zone
failure causes downtime until restore. Moving to multiple writers requires a
designed database/object-storage migration, not a Compose scale command.

This runbook is operational guidance, not a representation of legal
certification. Have counsel and the deploying organization approve the privacy,
consent, retention, and incident-response policies for every jurisdiction in
which the service is offered.

## Production prerequisites

- A Linux host with Docker Engine and Compose 2.23.1 or newer. The Compose
  `configs.content` field is used for the optional Litestream profile.
- A dedicated HTTPS hostname with DNS pointed at the host.
- TCP 80/443 open; UDP 443 is optional but enables HTTP/3.
- Provider/host disk encryption for the `counselor-data` volume. Docker named
  volumes do not encrypt storage.
- A transactional email domain with SPF, DKIM, and DMARC configured.
- A separate private backup account and bucket when continuous backup is used.
- An organization owner/operator who will complete tenant bootstrap.

## Configure secrets

Copy `.env.saas.example` to `.env.saas`, set mode `0600`, and replace every
placeholder:

```sh
cp .env.saas.example .env.saas
chmod 600 .env.saas
```

Generate every local secret independently:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Do not reuse secrets between environments or fields. Keep `.env.saas` out of
source control, terminal transcripts, support tickets, and `docker compose
config` output. Docker administrators on the host are trusted administrators
because they can inspect container environments.

`ENCRYPTION_KEY` protects stored student data and cannot be replaced like a
normal API token. Rotate it only through a tested re-encryption migration.
Rotate `SAAS_PROVISIONING_TOKEN`, model-provider keys, mail keys, and backup
credentials at least on staff departure or suspected disclosure; support an
overlap window in the application before routine zero-downtime rotation.
`SAAS_EMAIL_PEPPER` changes require an identity lookup migration.

Keep `SAAS_PASSWORD_RESET_TTL_MINUTES=30` unless the approved policy requires
a shorter lifetime. Reset links are single-use credentials: never log them,
put them in tickets, or extend their lifetime beyond the server's 5-120 minute
validation range. Expired and consumed reset records belong in routine cleanup.

Keep bounded attachment storage configured with
`SAAS_STUDENT_UPLOAD_QUOTA_MB`, `SAAS_TENANT_UPLOAD_QUOTA_MB`, and
`SAAS_MIN_FREE_STORAGE_MB`. The application reserves capacity before a
disk-backed upload, counts concurrent uploads on the single writer, and rejects
new work before the volume reaches the reserve. Alert well before the reserve;
quotas are a last line of defense, not capacity planning.

Keep `SAAS_SESSION_IDLE_MINUTES=15` aligned with the student's 15-minute
inactivity timer. The server applies this as a sliding idle lifetime and caps
longer active sessions at startup, so a failed or offline browser logout cannot
leave an old multi-hour session valid. Production accepts 5-120 minutes; change
it only with matching client behavior, approved policy, and expiry/reconnect
tests. `SAAS_SESSION_IDLE_HOURS` is a deprecated compatibility alias only when
the minute setting is absent, and only legacy values of 1 or 2 are accepted.

## Pre-deployment validation

Install from the lockfiles and run the application gate against the built
production bundle:

```sh
npm ci
npm --prefix backend ci
npm --prefix frontend ci
npm run check:saas
```

The gate must finish with zero lint errors, zero test failures, a successful
SaaS build, and a successful live multi-tenant smoke test. For the full browser
floor used by CI:

```sh
npx playwright install --with-deps chromium firefox webkit chrome msedge
npm run smoke:browsers:saas
```

Also run the Compose, Caddy, Litestream, and hardened-container checks from the
`saas` CI job on the exact commit and image to be released. Do not promote an
image whose required CI job is skipped, pending, or failing.

## Deploy

Build and start the single-writer application:

```sh
docker compose --env-file .env.saas -f compose.saas.yaml config --quiet
docker compose --env-file .env.saas -f compose.saas.yaml up -d --build
```

Caddy requests and renews the public certificate automatically. The application
port is not published; only Caddy exposes ports. Confirm the origin and health:

```sh
curl --fail https://counselor.example.org/api/health
curl --fail https://counselor.example.org/api/ready
```

Before launch, verify the runtime reports SaaS mode, rejects direct/open student
registration, rejects cross-origin state-changing requests, and does not enable
desktop administrator endpoints.

## Tenant bootstrap and invitation gate

The first organization must be created through the application's privileged
provisioning workflow using `SAAS_PROVISIONING_TOKEN`; never expose that token
to a browser. The expected flow is:

1. An authorized operator generates a unique temporary password and submits the
   organization name/slug, owner email, and that password to the server-to-server
   `POST /api/platform/organizations` endpoint. Provisioning creates an active
   owner account; it does not send an owner invitation.
2. The operator gives the owner the tenant slug and temporary password through
   an approved authenticated out-of-band channel. Never put the provisioning
   token or temporary password in a browser URL, ticket, or ordinary email.
3. The owner signs in at `/organization.html` and immediately replaces the
   temporary password through the authenticated password-change control. Do not
   create invitations until this rotation succeeds; changing the password
   invalidates the account's older sessions.
4. The owner configures the organization policy, then invites counselors,
   students, and guardians with least-privilege roles.
5. Student enrollment remains invitation-only. No tenant may discover or access
   another tenant's members or data.
6. Keep the provisioning token in the production secret manager, out of routine
   operator/browser environments, and rotate it after suspected disclosure or
   the approved organization-provisioning window.

Treat this as a release blocker until the integration tests exercise owner
bootstrap and password rotation, invite expiry/replay, membership suspension,
role denial, tenant isolation, and guardian approval.

## Child privacy and guardian policy

Use high-privacy defaults for every student, not only users who self-report a
young age:

- collect only data required for counseling;
- keep profiles private to the student unless a specific, auditable grant
  authorizes organization access;
- prohibit targeted advertising, data sale, and unrelated model training;
- require guardian approval where the approved tenant/jurisdiction policy says
  it is needed, and keep pending accounts blocked from normal product use;
- show plain-language, age-appropriate privacy and deletion controls;
- record policy/terms/consent versions, actor, tenant, source, and timestamp;
- provide export, correction, access-revocation, and deletion workflows; and
- complete a child-safety/privacy impact assessment before launch.

`SAAS_GUARDIAN_CONSENT_REQUIRED`, `SAAS_POLICY_VERSION`, invite lifetime, and
idle/absolute session lifetimes must match the tenant policy implemented by the
application. The
first SaaS release defaults to denying normal student access until a verified
guardian grant exists. Changing an environment value is not a substitute for
policy review or proof that the application enforces it.

## Optional encrypted continuous SQLite backup

The `backup` profile uses pinned Litestream 0.5.14 to replicate
`counselor.db`, `pii-vault.db`, and `vectors.db` to S3. AWS deployments use the
configured KMS key for server-side encryption. For another S3-compatible
provider, first remove the unsupported KMS field in a reviewed deployment
overlay and enforce encryption through a provider bucket policy. Never run an
unencrypted replica.

Start it only after verifying the bucket, least-privilege credentials, KMS
permissions, retention/lifecycle policy, and alerts. Litestream remote deletion
is disabled, so the credential does not need `DeleteObject`; enforce the
approved expiry in the bucket lifecycle policy:

```sh
docker compose --env-file .env.saas -f compose.saas.yaml --profile backup up -d --build
docker compose --env-file .env.saas -f compose.saas.yaml logs litestream
```

Litestream is disaster recovery, not high availability. It does not include
`ec-attachments` or other non-SQLite files. Protect those with encrypted,
versioned volume snapshots or an approved object-storage export. Alert on a
stopped/restarting Litestream container, authentication errors, validation
errors, and a replication lag beyond the recovery-point objective.

The simulation sidecar is intentionally different: `SIM_DATA_DIR` points to
`/tmp/simulations` on the application's tmpfs. Its two SQLite databases contain
disposable, derived simulation state with a default seven-day TTL; they are not
replicated, snapshotted, or restored and may disappear on any restart or
deployment. Recompute simulations from the authoritative student inputs when
needed. Never move this directory onto `counselor-data` without adding a
reviewed backup, restore, retention, and deletion design for both databases.

### Restore drill

Run a restore drill at least quarterly and after backup/configuration changes:

1. Record the target recovery timestamp and stop `app` and `litestream`.
2. Restore each database to a new empty directory/volume with the pinned
   Litestream image and the same replica configuration. Never overwrite the
   only local copy.
3. Restore the matching attachment/volume snapshot.
4. Start an isolated application with outbound email disabled and a non-public
   hostname.
5. Run SQLite integrity checks, `/api/ready`, tenant-isolation tests, and
   representative encrypted-record reads.
6. Record achieved RPO/RTO, restore timestamp, operator, and evidence; destroy
   the drill copy under the retention policy.
7. Promote only after approval. Preserve the old volume until post-restore
   validation is complete.

For a real incident, use the exact restore command documented for the pinned
Litestream version and selected timestamp. A backup is not accepted until this
drill succeeds.

## Monitoring and alerts

Collect Caddy/app/Litestream container logs centrally with access controls and a
retention period that does not exceed policy. Do not log passwords, invitation
tokens, cookies, authorization headers, student submissions, or decrypted PII.
The bundled Caddy profile redacts `invite`/`reset`/`token` query values and referrers
and coarsens client IP addresses before encoding access logs; preserve those
filters in any replacement edge proxy.
Alert on:

- `/api/ready` failing for two consecutive probes;
- elevated 5xx, authentication failures, rate limits, and invitation abuse;
- process/container restarts, disk above 75%, inode pressure, and volume I/O
  errors;
- model/mail provider failures, abnormal spend, and queue/backlog growth;
- backup errors or lag past the stated RPO; and
- cross-tenant authorization denials or privileged-role changes.

Define on-call ownership, escalation, breach assessment, evidence preservation,
student/guardian communications, and credential revocation before launch.

## Retention and deletion

Set explicit per-record retention for account data, counseling content,
attachments, audits, invitations, password resets, sessions, consents, and
backups. Expired invitations, password resets, and sessions should be purged
automatically.

Student account closure creates a durable erasure job before credentials and
tenant membership are revoked. The first pass removes operational and PII
records, vector/search copies, attachments, legacy credentials, SaaS tenant
links, and both simulation databases. A sidecar or storage failure returns HTTP
`202` with `deletionPending: true`; it must never be reported to the user as
completed. Failed and interrupted jobs retry at process start and every 15
minutes. Alert on `student_erasure_retry_required` and
`student_erasure_recovery_failed`, and investigate any job that remains failed
past the approved deletion SLA. Do not manually discard a failed job: restore
the unavailable dependency and let the idempotent job finish. Completed job
subjects are replaced with non-identifying tombstones and the job records age
out after 30 days.

Student export is also fail-closed: if the simulation sidecar cannot supply its
exact-student records, the server returns an error instead of producing a
partial archive. Exercise both the success path and sidecar-outage path during
staging acceptance.

Tenant deletion must include active storage, search/vector copies, exports,
attachments, and backup expiry. A live-store erasure does not rewrite existing
encrypted backup generations; enforce the approved deletion window through
bucket lifecycle rules and restrict restoration so erased data is not silently
reintroduced. Keep the minimum immutable, de-identified audit evidence required
by the approved policy. Test deletion, failed-job recovery, restoration after a
deletion, and tenant offboarding on staging before accepting live student data.
The template uses `RETENTION_MODE=institutional`; the deploying organization
must map every category to its approved schedule and verify cleanup and
legal-hold behavior before accepting live student data.

## Browser acceptance gates

CI builds the production SaaS bundle and runs 40 Playwright entry checks. The
automated matrix uses bundled Chromium, Firefox, and WebKit plus the actual
stable Google Chrome and Microsoft Edge channels installed by Playwright. Each
browser runs at 1440x900 and a 390x844 mobile viewport across student sign-in,
student invitation, organization sign-in, and organization password-recovery
entries. The credential cases verify that invitation/reset secrets disappear
from the address bar, browser history, web storage, and rendered text.

The automated job runs on Linux and is a fast compatibility floor, not the
complete release sign-off. It does not substitute for testing the previous
browser major, operating-system integration, touch behavior on physical
devices, or Safari/iOS behavior. Record the browser/OS versions and evidence
from the following staging matrix for every release.

Test the built production bundle, not the Vite development server, on the
current and previous major versions of:

- Chrome and Edge on Windows and macOS;
- Firefox on Windows and macOS;
- Safari on macOS and iOS; and
- Chrome on Android.

At minimum, cover owner bootstrap, all invite roles, student/guardian approval,
cookie session restore/logout, password recovery, uploads/downloads, model
streaming, export/deletion, keyboard-only use, 200% zoom, reduced motion,
mobile widths, expired/replayed invites, offline/reconnect behavior, and tenant
isolation. Block release on console exceptions, mixed content, failed
same-origin/CORS/CSRF controls, third-party-cookie dependence, inaccessible
critical paths, or use of a desktop-only API.

## Updates and rollback

Take and verify a backup before every deployment. Build an immutable versioned
image, run migrations once, and deploy with the app fixed at one replica.
Before launch, pin the reviewed Caddy and Litestream images by digest in the
deployment environment and scan the application image/SBOM for known critical
vulnerabilities:

```sh
docker compose --env-file .env.saas -f compose.saas.yaml up -d --build
```

Never use `docker compose down -v`; it deletes the named data volumes. Database
migrations require a tested forward/restore plan. Roll back application code
only when its schema remains compatible; otherwise restore the pre-deploy
volume to a new volume and validate before promotion.

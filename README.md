# College Counselor

College Counselor provides evidence-grounded college application guidance. It
combines deterministic FAFSA and deadline rules, student-specific planning
tools, source-aware AI coaching, and explicit uncertainty instead of admissions
guarantees.

Three deployment profiles are supported:

- **Desktop:** a single household on Windows or macOS. Student records stay on
  that computer, and the device administrator remains localhost-only.
- **Private web:** one household or a small private cohort on one persistent,
  single-replica server behind HTTPS. New accounts require the installation's
  registration access code. See [WEB-DEPLOY.md](WEB-DEPLOY.md).
- **Multi-tenant SaaS:** invitation-only organizations with owner/admin,
  counselor, student, and verified-guardian roles; HttpOnly cookie sessions;
  live membership checks; policy-versioned guardian consent; and strict
  organization isolation. See [SAAS-PROD.md](SAAS-PROD.md).

The private web profile remains intentionally separate from the multi-tenant
SaaS profile. The bundled SaaS deployment is a single-writer, single-region
production profile; it is not horizontally available until the data plane is
migrated away from local SQLite/files.
OpenRouter receives redacted text only after the student grants the required
external-processing consents.

## Packages

| Path | Purpose |
| --- | --- |
| `desktop/` | Electron host, operating-system secret storage, backend lifecycle, NSIS/DMG packaging |
| `frontend/` | React student application and separate administrator screen |
| `backend/` | Local Express API, encrypted PII vault, evidence/rules engines, IPEDS integration |

The application deliberately has no student BYOK flow, arbitrary LLM endpoint,
general web-search provider, Logseq integration, remote counselor dashboard, or
parent-notification email endpoint.

## Trust model

- In the desktop profile, the backend binds to a random `127.0.0.1` port and is
  not a LAN service. Its localhost-only administrator stores secrets through
  Electron `safeStorage` using Windows DPAPI or macOS Keychain.
- In the private web profile, the app and API share one HTTPS origin, durable
  state stays on one persistent volume, registration requires an access code,
  and the service runs at exactly one replica. Server secrets come only from
  the deployment environment; the desktop administrator is not exposed.
- In the SaaS profile, every browser session is bound to one live organization
  membership. Invitations are hashed, expiring, email/role/tenant-bound, and
  single-use. Organization managers can manage membership but receive no
  student-profile, chat, or file access by default. Student tools remain locked
  until the required verified-guardian policy grants are active.
- Student accounts require email and password; passwords and recovery codes are
  stored as salted hashes.
- PII-vault and chat content are application-encrypted at rest. The private
  web profile additionally requires host- or provider-level encryption for its
  persistent volume, which also protects operational records and attachments.
  Export and deletion cover student-owned records, sessions, attachments,
  vectors, and cached files.
- Human review is not available in this release. The UI must never claim that
  an answer has been reviewed by a counselor.

## Cost limits

Paid model calls are capped per student per calendar month:

- Grades 9-11: USD 10
- Grade 12: USD 15

The server reserves the worst-case request cost before calling OpenRouter.
Unknown-price models and calls that would exceed the cap are rejected. Strategy
Council is explicit-only and shows its estimated maximum cost before starting.

## Development

Node.js 22.12 or newer is required.

```powershell
cd backend
npm install
npm test

cd ..\frontend
npm install
npm run build

cd ..\desktop
npm install
npm start
```

Development may provide the three server secrets through environment variables.
Packaged production builds use Electron `safeStorage` instead.

After installing the backend and frontend packages, run the complete repository
gate from the project root:

```powershell
npm run check
```

## Build installers

```powershell
cd desktop
npm run dist:win
# On macOS:
npm run dist:mac
```

## Build the private web bundle

```powershell
npm run build:web
```

## Build and validate the SaaS bundle

```powershell
npm run build:saas
npm run smoke:saas
```

See [backend/SETUP.md](backend/SETUP.md) for desktop administrator setup,
[backend/DEPLOY.md](backend/DEPLOY.md) for desktop packaging and release
requirements, [WEB-DEPLOY.md](WEB-DEPLOY.md) for the private single-instance
web profile, and [SAAS-PROD.md](SAAS-PROD.md) for tenant provisioning,
deployment, backups, restore drills, monitoring, and browser acceptance.

# College Counselor

College Counselor is a local desktop application for evidence-grounded college
application guidance. It combines deterministic FAFSA and deadline rules,
student-specific planning tools, source-aware AI coaching, and explicit
uncertainty instead of admissions guarantees.

The supported deployment is a single household on Windows or macOS. Student
records stay on that computer. OpenRouter receives redacted text only after the
student grants the external-processing consents.

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

- The backend binds to a random `127.0.0.1` port and is not a LAN service.
- Student accounts require email and password; passwords and recovery codes are
  stored as salted hashes.
- One localhost-only administrator can configure only the encryption,
  OpenRouter, and IPEDS/College Scorecard keys.
- Secret values are encrypted with Windows DPAPI or macOS Keychain through
  Electron `safeStorage`; they are never returned to the renderer.
- Student content is encrypted at rest. Export and deletion cover all
  student-owned records, sessions, attachments, vectors, and cached files.
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

## Build installers

```powershell
cd desktop
npm run dist:win
# On macOS:
npm run dist:mac
```

See [backend/SETUP.md](backend/SETUP.md) for administrator setup and
[backend/DEPLOY.md](backend/DEPLOY.md) for packaging and release requirements.

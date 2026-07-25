# Desktop Release Guide

This guide covers the local household desktop profile. The separate private,
single-instance web profile is documented in [WEB-DEPLOY.md](../WEB-DEPLOY.md).
The invitation-only organization SaaS profile is documented in
[SAAS-PROD.md](../SAAS-PROD.md); it has its own tenancy, guardian-consent,
cookie-session, backup, and release gates and must not be enabled by merely
exposing a desktop/private-web process.

## Requirements

- Node.js 22.12 or newer
- Windows 10/11 with WebView support supplied by Electron, or a supported
  macOS release
- Windows code-signing certificate for public NSIS releases
- Apple Developer signing and notarization credentials for public DMG releases

## Build

```powershell
cd backend
npm ci
npm test
npm run lint

cd ..\frontend
npm ci
npm run build

cd ..\desktop
npm ci
npm run dist:win
# Run npm run dist:mac on macOS.
```

The installer bundles the React build and backend. At runtime Electron selects
private random ports, starts the backend on `127.0.0.1`, waits for its health
check, and stops it when the desktop application exits.

## Release gates

- Backend and frontend tests pass on Node.js 22.12 or newer.
- Frontend production build and Electron directory packaging succeed.
- `npm audit --omit=dev --audit-level=high` reports no high or critical
  production findings.
- Account takeover, CSRF, IDOR, SSRF, malicious provider URL, and secret leakage
  tests pass.
- FAFSA/deadline fixtures and evidence-claim validation tests pass.
- Export/deletion tests verify every student-owned table and file.
- Windows and macOS smoke tests run from clean user profiles with no developer
  tools or pre-existing server.
- Production artifacts are signed; macOS artifacts are notarized.

## Runtime data

Application databases, encrypted configuration, attachments, and exports live
under Electron's per-user application-data directory. They are excluded from
the installer and source tree. Uninstall does not silently delete student data;
students delete their account from inside the application or explicitly remove
application data through the operating system.

## Supported external hosts

Only these provider classes are used:

- `openrouter.ai` for explicitly consented AI coaching
- `api.data.gov` for IPEDS/College Scorecard data
- versioned, allowlisted official Federal Student Aid, Common Data Set, and
  college admissions sources

Caller-supplied hosts, general web search, Tavily, local model servers, OpenAI
compatibility URLs, and live Logseq endpoints are rejected.

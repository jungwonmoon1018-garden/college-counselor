# Development Orientation

The supported product is the packaged Electron application. Start with
`README.md`, then read `PROJECT-OVERVIEW.md`.

## Main entry points

- `desktop/main.mjs`: safeStorage, private ports, backend lifecycle, admin IPC
- `frontend/src/App.jsx`: student workflow
- `frontend/src/AdminApp.jsx`: secrets-only local administrator
- `backend/server.js`: local API composition root
- `backend/security-auth.js`: passwords, recovery codes, student/admin sessions
- `backend/policy-router.js` and `answer-composer.js`: advice policy and claim lanes
- `backend/usage-budget.js`: fixed grade-based cost reservations

## Invariants

- Do not add a caller-controlled network destination.
- Do not expose secret values to an HTTP or IPC response.
- Do not accept a student ID without comparing it to the authenticated session.
- Do not label extracted, expired, or irrelevant content as verified.
- Do not persist raw input before safety screening and encryption.
- Do not add automatic Council invocation.
- Do not claim human review is available.
- Do not recreate BYOK, Tavily, Logseq, counselor Basic auth, or parent-alert email routes.

Run backend tests, frontend build/tests, production audits, and Electron
packaging checks before merging.

## Current feature work (2026-07-15)

- Chat threads are named after the first completed turn. Crisis-related turns
  use the deterministic `Support resources` title and never send crisis text
  through the title model.
- Removing a target school cascades its deadlines inside the authenticated
  tenant, with literal school-name matching and exact IPEDS/unit-ID matching.
- Strategy Council is a disclosed, explicit, one-message action in chat. It is
  never selected automatically, disallows attachments, uses a stable request
  ID, screens provider input and output, short-circuits crisis requests without
  model or budget work, and scopes idempotency by student.

## Last verified (2026-07-15)

- Backend: 501 total, 496 passed, 5 skipped, and 0 failed. Lint completed with
  0 errors and 73 warnings.
- Frontend: Vitest passed 2 files / 8 tests and the Vite production build
  passed.
- `npm audit` reported zero vulnerabilities for the backend production
  dependency set and the complete frontend and desktop dependency sets.
- Electron 43.1, the better-sqlite3 12.11 native rebuild, Windows unpacked
  package, packaged smoke, and the 250,479,199-byte NSIS installer were last
  verified on 2026-07-11; packaging was not rerun for these UI/API-only changes.
- Remaining release gates: the installer is Authenticode `NotSigned`, and
  macOS packaging/smoke was not run locally. Signing/notarization and macOS CI
  must pass before release.

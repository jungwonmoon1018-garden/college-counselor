# Backend setup — secrets & first-run configuration

This backend needs a few **server-side** secrets. They are deployment secrets,
not per-user values, and are deliberately never collected from the student
apps. There are two ways to put them in place: a CLI, or a guarded setup UI.

| Secret | What it protects | Required? |
| --- | --- | --- |
| `ENCRYPTION_KEY` | AES-256-GCM master key for the PII vault — encrypts **every** student's PII and their encrypted BYOK key. | **Yes in production** (the server refuses to boot without it). Dev auto-generates a persistent `.dev-encryption-key`. |
| `JWT_SECRET` | Signs session tokens. | Yes in production. |
| `SCORECARD_API_KEY` | The federal **College Scorecard / IPEDS** data API (api.data.gov). Enables live college data. | Optional — without it the backend serves bundled **offline baseline** data. |

> ⚠️ **Never rotate `ENCRYPTION_KEY` on a populated deployment.** All existing
> PII is encrypted with the current key; a new key makes it permanently
> unrecoverable. Both setup paths refuse to overwrite an existing key unless you
> explicitly force it via the CLI.

---

## Option A — CLI (recommended for most deployments)

```sh
cd backend
npm run setup                                   # interactive prompts
# or, non-interactive:
npm run setup -- --scorecard=YOUR_KEY --yes
```

What it does:
- generates `ENCRYPTION_KEY` + `JWT_SECRET` only if missing/placeholder,
- prompts for / accepts the Scorecard (IPEDS) key,
- writes `.env` **atomically** (temp file + rename) with a timestamped
  `.env.bak-*` backup,
- **keeps** any existing valid `ENCRYPTION_KEY` (rotation requires
  `--force-encryption` and typing `ROTATE`).

Then `npm start` and confirm the boot banner shows `Scorecard: LIVE` (or
`OFFLINE`) and no `ENCRYPTION_KEY` fatal.

---

## Option B — Setup UI (web `/setup.html` or the macOS app)

For finishing configuration from a UI instead of hand-editing `.env`. Backed by
two endpoints in `server.js`:

- `GET /api/setup/status` — booleans only (what still needs configuring). Never
  returns a secret.
- `POST /api/setup/initialize` — generates the vault key and/or saves the
  Scorecard key.

### Security model

1. **Loopback only.** Both endpoints reject any request that doesn't originate
   from `127.0.0.1` / `::1`. Run the setup UI on the **server host**.
   - Web: open `http://localhost:3001/setup.html` (or the Vite dev server's
     `/setup.html`, which proxies to the backend).
   - macOS app: Settings → Operator → **Operator Setup** (only useful when the
     app runs on the backend host).
2. **One-time token.** `initialize` also requires the `X-Setup-Token` header.
   The token is regenerated every boot and printed to the server console **only
   when setup is still needed**:
   ```
   [SETUP] First-run setup available. One-time token (localhost only):
   [SETUP]   3f9c…<64 hex chars>
   ```
3. **The vault key is generated on the server.** The UI only *triggers*
   generation — the master secret never travels to or through the browser/app.
4. **First-run only.** If `ENCRYPTION_KEY` is already set via the environment,
   `initialize` returns `409` and refuses (no rotation → no data orphaning). If a
   valid dev key exists on disk, it is *promoted* into `.env` so existing local
   data stays readable.

### Request shape

```http
POST /api/setup/initialize
X-Setup-Token: <token from server console>
Content-Type: application/json

{ "generateEncryptionKey": true, "scorecardApiKey": "<optional api.data.gov key>" }
```

Response:

```json
{ "ok": true, "wrote": ["ENCRYPTION_KEY","JWT_SECRET"], "promotedDevKey": false,
  "backup": ".env.bak-ab12cd", "restartRequired": true,
  "message": "Saved to .env. Restart the backend for the changes to take effect." }
```

> **Restart required.** Secrets are read at boot, so changes written via the
> endpoint (or the CLI) only take effect after restarting the backend.

---

## Getting a Scorecard (IPEDS) key

It's free from <https://api.data.gov/signup/>. Sign up with your email; the key
arrives by email. Paste it into the setup UI (or pass `--scorecard=` to the
CLI). The key is validated as 20–64 alphanumeric characters before it's saved.

api.data.gov's signup requires email verification and can't be driven
programmatically without their signup credentials, so the UI links to the
signup form rather than auto-registering.

---

## Keeping the `collegeapp-ai` skill in sync

The Claude Code skill harness lives at `backend/skills/collegeapp-ai/` (the
**source of truth**). Claude Code reads the *installed* copy at
`~/.claude/skills/collegeapp-ai/`, which otherwise drifts by hand — it was
stranded at v1.0.0 (no `register.js`, Anthropic-era tiers) while the repo moved
to v1.2.0 (OpenRouter-native).

```bash
cd backend
npm run skill:sync              # copy SKILL.md + scripts/ to the active install
npm run skill:sync -- --dry-run # preview what would change, write nothing
npm run skill:sync -- --check   # exit 2 if installed version != repo (deploy guard)
```

The target can be overridden with `--target /path/to/skills/collegeapp-ai` or
the `COLLEGEAPP_SKILL_TARGET` env var. The script only overwrites the known
file set (`SKILL.md` + `scripts/*`) — it never deletes the target tree. Run it
after editing `SKILL.md`, and wire `--check` into CI to catch drift.

---

## Seasonal credible-source research (optional)

Refreshes last-application-season admissions stats and AP score distributions,
and proposes AP concept updates from the latest official exam PDFs — from
**official sources only** (Common Data Set, `collegescorecard.ed.gov`,
`collegeboard.org`; never forums/blogs). Every scraped figure is adversarially
re-checked against its cited source before it's trusted; anything unconfirmed
is quarantined, and AP concept changes are *proposed*, never auto-applied.

It runs without a student session, so it needs an **OpenRouter operator key**
and is off by default. In `.env`:

```sh
OPENROUTER_API_KEY=sk-or-...        # operator key (web research runs on this)
ENABLE_SEASONAL_RESEARCH=1          # opt in
SEASONAL_RESEARCH_INTERVAL_DAYS=90  # scheduled cadence (default 90; 365 = annual)
SEASONAL_TOP_N=25                   # most-selective baseline colleges per run
```

With those set + a restart, a scheduled `seasonal_research` job appears in the
`[BATCH]` boot log and in `GET /api/methodology` (`seasonalResearch`). A
counselor can also run it on demand:

```sh
# Basic auth with COUNSELOR_USER / COUNSELOR_PASS:
COUNSELOR_USER=... COUNSELOR_PASS=... \
  node skills/collegeapp-ai/scripts/seasonal-run.js --colleges "MIT,Rice University"
# or POST /api/admin/seasonal-research/run  (counselor Basic auth)
```

Without `OPENROUTER_API_KEY`, the feature is inert by design (it logs
"unavailable" and never fabricates data).

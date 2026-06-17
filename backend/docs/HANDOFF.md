# Session handoff — college-counselor

_Working notes carried with the repo for the next coding session. Tracked under `backend/docs/` so it travels to other machines. File paths below are relative to the repo root. Last updated end of the OpenRouter v2 session, 2026-06-17._

## Where things stand

The OpenRouter-only migration is **complete and merged to `master`**. Two PRs shipped:

- **PR #10** (`6d0f88e`) — v1: removed Anthropic entirely, renamed `/api/anthropic` → `/api/chat`, added the live OpenRouter catalog, wired the Crimson EC exemplars.
- **PR #11** (squash `09a9cf8`) — v2: harness rebuild + onboarding/session fixes + scheduled freshness + the de-Anthropic cleanup that v1 missed.

Local checkout is on `master` at `09a9cf8`, clean and in sync with origin. The `v2-harness-app-fix` branch was squash-merged and deleted (local + remote).

There is a **stray nested git repo** at `./college-counselor/` (its own `.git`, predates this work). It is untracked and was deliberately excluded from every commit. Don't `git add -A` blindly — it would pull this in. Stage `backend/` and `frontend/` explicitly.

## The `.md` network (governance + harness)

These are the markdown files that govern editing and the AI behavior. Read them first next session.

- **`CLAUDE.md`** (repo root) — the editing-guidance entry point; imports `@CLAUDE-FABLE-5.md`. Auto-loaded by Claude Code for any session here.
- **`CLAUDE-FABLE-5.md`** (repo root) — the operative rule set applied **at edit time**: prose-first/minimal formatting, accuracy/epistemics, refusals, and especially child-safety + user-wellbeing (the app's end users are minors). This is NOT background docs — apply it while editing and while talking about edits.
- **`backend/skills/collegeapp-ai/SKILL.md`** — the Claude Code skill harness, now **v1.2.0** (OpenRouter-native: generic small/medium/large tiers, web-plugin prestige, BYOK/onboarding/freshness sections). Source of truth.
- **`backend/skills/collegeapp-ai/scripts/sync-skill.mjs`** — copies SKILL.md + scripts to the installed `~/.claude/skills/collegeapp-ai/`. **After editing SKILL.md, run `cd backend && npm run skill:sync`.** `npm run skill:sync -- --check` exits non-zero on version drift (CI/deploy guard). The installed copy drifts by hand otherwise (it was stranded at v1.0.0 before).
- **`backend/SETUP.md`** — secrets/first-run config + the skill-sync section.
- **`backend/docs/METHODOLOGY.md`, `backend/docs/DATA_FLOW.md`, `backend/compliance/*`** — the wider `.md` network SKILL.md cross-links.

## Architecture facts worth not re-deriving

- **OpenRouter is the default/primary provider**; OpenAI, Google, DeepSeek, Together, Zhipu, Ollama, LM Studio also work via the same provider-agnostic adapter layer (`backend/llm-adapters/`).
- **Tiers, not model ids.** Callers pick `small`/`medium`/`large`; the backend resolves to a model. Live list: `GET /api/llm/openrouter/models`; per-provider defaults: `GET /api/llm/providers`. Current OpenRouter defaults (verified live in catalog): `google/gemma-4-26b-a4b-it`, `google/gemma-4-31b-it`, `deepseek/deepseek-v4-pro`. **Always re-verify default ids against the live catalog** before trusting them.
- **Web access** flows through the OpenRouter web plugin, triggered by `wantsWeb: true` and translated in `buildStudentCallLLM` / the inline `callLLM` closures (server.js). Adapters take **no `tools` arg** — the old Anthropic-native `makeWebSearchTool`/`makeWebFetchTool` builders were removed this session.
- **"Anthropic-shape" is intentional.** The adapters' internal canonical message format is still called Anthropic-shape (`translate*ToAnthropic` in `llm-adapters/openai.js`, `google.js`). That is the chosen internal format, **not** a leftover to strip. Leave it.
- **Session auth:** bearer token in `window.__CC_SESSION_TOKEN__`, now also persisted to `cc_active_session` (localStorage) and rehydrated on boot (App.jsx ~3558). Durable server side via the `session_tokens` table + cold-path `validateToken`. **Never persist the passphrase.**
- **Consent gate:** `/api/chat` requires the `cross_border_transfer` consent. `chatReady` (from `GET /api/students/apikey`) mirrors the exact gate (key on file AND consent).
- **Scheduled jobs** (`batch-jobs.js`, registered in server.js startup): `cds_refresh` default-on weekly; `scorecard_refresh` only when `SCORECARD_API_KEY` is set; `domain_monitor` opt-in via `ENABLE_DOMAIN_MONITOR=1`. All `runOnStartup:false`. Status + per-source `lastRefreshed` surface in `GET /api/methodology`.

## Running it locally

- Backend: `.claude/launch.json` runs `node backend/server.js` on `:3001`. Or `cd backend && npm run dev` (watch). Boots OFFLINE without `SCORECARD_API_KEY` (bundled baseline data) — that's expected.
- Frontend: Vite on `:5180` (proxies `/api` to the backend). Dev CORS allows any localhost origin.
- The `.env` and `data/` (DBs) are git-ignored; they hold the encrypted PII vault. Never commit them. Never rotate `ENCRYPTION_KEY` on a populated vault.

## Tests

`cd backend && node --test tests/*.test.js` → **458 pass is the healthy baseline.** The ~3-4 red leaf tests (`Vanderbilt`/`Georgetown` fallback, simulation-sidecar `waitFor` timeouts) are **pre-existing environment/data flakes**, confirmed to fail identically on clean master — not regressions. Compare leaf-failure *names* against this baseline; anything new is real. (Details in the `college-counselor-known-test-flakes` memory.)

## Things that still need a real key (not verifiable headless)

- Full onboarding → chat round-trip and competition prestige web-research need a real `sk-or-…` OpenRouter key entered through the API-key screen (the user's job — never enter BYOK keys for them). Structural wiring is verified; the live model call is not.

## Candidate next steps (not started)

- Optionally remove the simulation-suite flake by raising the `waitFor` timeout in `tests/simulations-endpoint.test.js` (test-only; don't touch app code for it).
- Decide whether to delete or relocate the stray `./college-counselor/` nested repo.
- Remaining Anthropic *mentions* are now only accurate internal-format names + a couple of historical comments (`content-moderation.js` "Required by Anthropic Usage Policy", `ec-strength-vectorizer.js` source-list comment) — cosmetic, low priority.

# College Counselor — Project Overview

_A feature-by-feature summary of the whole repository, written from a read of the
code and docs (not marketing copy). Generated 2026-06-18._

## What this project is

College Counselor is a provider-agnostic, "bring-your-own-key" (BYOK) AI college-application
counselor for high-school students. Its defining design choice is that it is **rules-first**:
deterministic logic, retrieval, and cited sources do as much of the work as possible, and a
language model is only an escalation layer on top. The product is built for minors, so
compliance (FAFSA advisory posture, FERPA, Korea's AI-Basic-Act / PIPA), a separate encrypted
PII vault, consent gating, content moderation, and a crisis-to-parent notification path are
treated as core product features rather than afterthoughts.

The repository is a monorepo combined from two previously separate repos (their full histories
are preserved under subdirectories). All intelligence lives server-side; every client — the
React web app, the macOS/iOS wrapper, and the Windows wrapper — is presentation and input only,
talking to the same HTTP/JSON backend.

## Repository layout

| Path | Stack | Role |
|------|-------|------|
| `backend/` | Node/Express + better-sqlite3, ESM (Node ≥18) | API, PII vault, rules/positioning/evidence engines, CDS store, BYOK LLM routing, web grounding, compliance |
| `frontend/` | React 18 + Vite | Single-page counselor UI (chat, College Fit, ECs, courses, deadlines, narrative) plus login/setup/methodology/pre-signup pages |
| `apple-webview/` | Swift + WKWebView (XcodeGen) | Thin native shell wrapping the SPA; one codebase, iOS + macOS targets |
| `windows-webview/` | .NET 8 WPF + WebView2 | Thin native Windows shell wrapping the SPA |
| `docs/` | Markdown | Architecture/client-dev orientation for native apps |
| `backend/skills/collegeapp-ai/` | Claude Code skill | The thin reasoning layer that drives the backend (SKILL.md v1.4.0 + helper scripts) |

There is also a nested, separately-tracked `college-counselor/` directory (its own git repo,
currently untracked from the parent) — it is not part of the monorepo build.

## Architecture in one picture

```
[ macOS/iOS app ]  [ Windows app ]  [ React SPA ]   [ collegeapp-ai skill ]
            \            |              /                 /
                  HTTPS / JSON  (Bearer session token)
                              |
                      Backend  (:3001)  ──► per-student BYOK LLM (OpenRouter / OpenAI / …)
                              |              └─ web grounding (web_search / web_fetch / OR web plugin)
            counselor.db · pii-vault.db (AES-256-GCM) · vectors.db · cds-cache
                              |
                  simulation sidecar (:3002, optional)
```

The backend is a single Express process holding one set of prepared SQLite statements
(`rag-engine.js`) that it passes down to every other module. Three orthogonal data flows share
that one database and API surface without depending on each other at the data-model level:
the **student-data flow** (PII-vaulted profile, ECs, narrative, deadlines → evidence vectors),
the **CDS flow** (public Common Data Set PDFs → validated institutional ground truth), and the
**skill bundle** (`GET /api/context/bundle`, a read-only join of both, served per request in the
student's locale). Deployment is documented for a Caddy reverse proxy with TLS.

## The request pipeline (rules-first)

Every model-eligible request flows through the same gauntlet, designed so the cheapest correct
answer wins and the model is the last resort:

1. **Content moderation** (`content-moderation.js`) screens input and output. It detects crisis
   language, blocks credentials from ever reaching the system (SSN, FSA ID, passwords, API keys,
   bank/routing numbers), redacts PII before anything crosses the model boundary, and applies
   age-appropriate filtering for minors.
2. **Policy router** (`policy-router.js`) — 100% deterministic, no LLM — classifies the query
   into `regulated` (FAFSA/FERPA/eligibility/legal), `high_stakes` (deadlines, aid amounts,
   school policy), `coaching` (EC/essay/list strategy), `administrative`, or `crisis`. It picks
   the source constraints, selects a model tier, and enforces compliance gates.
3. **Orchestration engine** (`orchestration-engine.js`) routes across tiers: **T0** (rules/fact
   store, $0, no model), **T1 small** (routing/extraction/classification/moderation), **T2 medium**
   (source-grounded coaching/synthesis), **T3 large** (cross-source conflict, essay critique).
   The large tier is gated: medium must have been tried and reported low confidence, the query
   must genuinely involve conflict or multi-factor strategy, the session must be active, and the
   student's large-tier budget must not be exceeded.
4. **Answer composer** (`answer-composer.js`) emits three labeled lanes that are never merged:
   `verified_facts` (only from the fact store, only for trusted-domain sources), `model_inferences`
   (must reference evidence objects), and `coaching_suggestions` (non-binding). For regulated and
   high-stakes topics, if there is no verified source the answer is "no verified answer available"
   rather than a guess. Every response carries an AI-disclosure block (localized).

Supporting this are the **fact store** (`fact-store.js`, canonical facts with full provenance and
an extracted→verified→stale→expired lifecycle), the **source registry** (`source-registry.js`,
trusted-domain allowlists per topic — e.g. only `studentaid.gov`/`ed.gov` may populate FAFSA
facts), and the **evidence graph** (`evidence-graph.js`, three evidence types — official,
preparation, inferred — that are vectorized along nine dimensions and never collapsed into a single
desirability score).

## Student modeling — the evidence vectors

The product's analytical core is a set of independent, explainable vectors rather than one opaque
"chance" number.

- **EC scoring** (`ec-vectorizer.js`) rates each activity 0–1 on six independent factors —
  impact & scope, leadership & initiative, passion & consistency, talents & awards, relevance to
  intended major, and community & character — with weights that sum to 1.0 and a composite mapped
  only to a coarse orientation band (early_stage → exceptional). The factor scores, not the label,
  are what students act on.
- **EC strength vector** (`ec-strength-vectorizer.js`) is a separate five-factor read —
  `dedication`, `achievement`, `leadership`, `prestige`, `narrative_fit` — that consumes uploaded
  evidence (award letters, certificates) and emits a tier label (`tier_1_distinctive` →
  `tier_4_foundational`). It is the engine behind the "Spike Finder."
- **Prestige** (`competition-research.js`) is the fifth strength factor: how selective/well-known a
  program is, independent of what the student achieved. It resolves through a cost-ordered chain —
  30-day cache → seeded benchmark table → official competition catalog → OpenRouter web-plugin
  research bounded to an allowlist of official-organizer/.edu/.gov pages. Web research only fires
  on an OpenRouter key; otherwise prestige is `0.0` and explicitly labeled `unavailable` (never
  invented).
- **Narrative fit** (`narrative-fit-llm.js`) scores how well an activity supports the student's
  stated story, with a 60-day cache and a deterministic fallback.
- **Directionality** (in `ec-vectorizer.js`) reads the academic trajectory — academic momentum,
  test-score strength, major-academic fit, and rigor/challenge — summarized to an overall standing
  label, with trend and override support.
- **AP concept mastery** (`ap-concept-catalog.js` + `ap-concept-vectorizer.js`) decomposes each AP
  subject into 6–10 weighted concepts drawn from real released FRQ content (2023–2025) and models
  per-concept mastery from the student's own prompts and uploaded work. This concept-level academic
  reasoning is the project's hardest-to-copy differentiator.
- **Course sequencing** (`course-sequence-catalog.js`) holds auditable, major-aligned reference
  course ladders (foundational → advanced) so the app can reason about transcript coherence, not
  just "take more APs."
- **Narrative store** (`narrative-store.js`) keeps the student's 100–1,500-char self-presentation
  as a versioned history (new active row per edit, never UPDATE-in-place). `extractNarrativeThemes()`
  derives the theme keyword set deterministically — no LLM — so the narrative is the organizing
  spine every other module references, and drift from it can be flagged.

## College Fit — calibrated positioning

`positioning-engine.js` produces the "College Fit" read deliberately as **bands, not a single
inflated percentage.** Each target returns an overall label (Highly competitive / Competitive /
Reach / High reach), three dimension scores (academic readiness / major competitiveness — which
now blends real institutional selectivity — / institutional priority fit), an evidence-confidence
block, `scoreRanges` (low evidence widens the band), and `dataProvenance` describing exactly where
the underlying admit rate came from. A documented past bug — thin-evidence schools showing a
confident score next to "very low" confidence — was fixed by de-inflating defaults, folding in real
selectivity, and surfacing provenance with an "unverified" treatment for live/web-read data.

`simulation-engine.js` (optionally run as a standalone sidecar on port 3002 via
`simulation-sidecar.js`) powers "what if" scenarios — e.g. modeling the effect of adding a research
internship — over a constrained set of profile-patch fields, always labeled a model inference rather
than a promise.

## Institutional ground truth — the CDS pipeline

A multi-stage pipeline turns public Common Data Set PDFs into validated, cited school data:
`cds-search.js` (locates PDFs from the College Transitions repository), `cds-ingest-pipeline.js`
(resolves and caches the PDF), `cds-pdf-parser.js` (positional extraction via pdf.js with an OCR
fallback using tesseract.js + `@napi-rs/canvas`), `cds-pdf-form-fields.js`, and `cds-validator.js`.
The validator detects wrong-institution PDFs (the documented "Columbia GS" case), checks admit-rate
and SAT-band drift against web-sourced truth, applies severity-graded overrides, and writes an
append-only validation trail alongside the canonical record. Records are exportable as a six-sheet
audit workbook (`cds-canonical-export.js`, via exceljs). When validated CDS data is missing, the fit
engine falls back along a chain — validated store → live-parsed PDF → web-LLM CDS read → IPEDS
baseline → web admit-rate lookup → neutral — tagging anything unverified with a confidence penalty
and a provenance label.

## External data and freshness

- **College Scorecard** (`college-scorecard.js`) — the U.S. Dept. of Education API for 4,000+
  institutions; live admission stats, costs, outcomes, comparison, financial aid, and multi-year
  history (needs a free `SCORECARD_API_KEY`; runs in offline baseline mode without one).
- **Baselines** (`baseline-data.js`) — NCES / CollegeBoard / ACT / NACAC reference distributions,
  optionally augmented by generated IPEDS college profiles built offline.
- **Admissions intelligence** (`admissions-intelligence.js` + loader) — official CIP→major mapping,
  IPEDS major-growth signals, major-policy and strategic-focus data.
- **Domain monitor** (`domain-monitor.js`) — daily diff-based monitoring of official university
  pages via SHA-256 hashing, re-indexing only what changed, respecting robots.txt, routing
  high-stakes changes to human review.
- **Seasonal research** (`seasonal-research.js`) — an opt-in, operator-keyed refresh of last-season
  admissions stats and AP distributions from **credible sources only** (`credible-sources.js`
  allowlist: Common Data Set, collegescorecard.ed.gov, nces.ed.gov, collegeboard.org, and each
  college's own `.edu` host resolved from Scorecard). Every scraped figure is cross-checked through
  three independent lenses, and any contradiction quarantines the value so it never reaches a
  student. AP concept changes are proposed, never auto-applied.

## LLM routing and BYOK

Each student supplies their own API key, stored encrypted server-side and never returned to the
client. The system is provider-agnostic via a small adapter layer (`llm-adapters/`): **OpenRouter
is the default**, with OpenAI, Google Gemini, DeepSeek, Together/Qwen, Zhipu/GLM, and local
Ollama / LM Studio also supported, plus a generic OpenAI-compatible mode. Google has a bespoke wire
protocol; everyone else speaks OpenAI Chat Completions. Every response — whichever provider answered
— is normalized to an Anthropic-shaped payload (`content: [{type:"text"|"tool_use", …}]`).

Callers choose a **reasoning tier** (small / medium / large), never a model id; `tier-defaults.js`
maps each provider to per-tier models, overridable per student or by env var. `openrouter-model-refresh.js`
validates and refreshes the tier targets against OpenRouter's live `/models` catalog at boot and every
24h, so the BYOK dropdown only offers currently-served models. Model migration is handled honestly:
retired Anthropic IDs auto-migrate, while newer OpenRouter models are *proposed* and only applied with
explicit student approval. `usage-budget.js` enforces an optional per-student monthly USD cap (priced
from OpenRouter's live catalog) with a 402 cutoff. Reasoning models (o1/o3, DeepSeek R1/V4-Pro, GLM
reasoning) are detected so their token budgets are sized correctly.

## Privacy, compliance, and safety

- **PII vault** (`pii-vault.js`) — a physically separate, AES-256-GCM-encrypted store for names,
  emails, parent contacts, and uploaded documents. The operational DB holds only opaque UUIDs; model
  context uses a `[STUDENT]` placeholder and logs use a hashed student id. The vault is touched only
  by authentication, notification, export, and deletion — never by retrieval or model assembly.
- **Consent** (`consent.js`) — eight consent types including data processing, AI interaction,
  parental notification, session persistence, FAFSA contributor, institutional sharing, Korea-PIPA
  cross-border transfer, and parent-provided BYOK. Chat is gated on cross-border consent (a 403 means
  route to the consent flow, never reroute the provider).
- **Retention** (`retention.js`) — automated lifecycle with distinct consumer vs. institutional
  policies (uploaded docs 72h; conversation logs 30 days or per-agreement; audit events 90 days or
  7 years for FERPA; etc.).
- **Review queue** (`review-queue.js`) — human review for low-confidence regulated answers,
  cross-source conflicts, school-specific policy, unsourced legal questions, non-crisis moderation
  flags, disputed facts, and high-stakes page changes.
- **Crisis path** — crisis detection routes to a heavily rate-limited, content-redacted parent
  notification endpoint; the skill is instructed to stop reasoning and display backend crisis
  resources verbatim.
- **Audit log** — every write touching student data is appended as an evidence trail; there is no
  third-party analytics or telemetry sink, by design.
- **Transparency** (`methodology.js`) — factor weights, thresholds, data sources, freshness, model
  catalog status, and seasonal-research counts are served live at `GET /api/methodology` and rendered
  at `/methodology.html`, so the running system and the published methodology never drift.
- **Compliance docs** under `backend/compliance/` cover FAFSA advisory posture, FERPA, Korea
  AI-Basic-Act/PIPA, and Anthropic API usage — these are the rules the backend actually enforces.

A hard product line, enforced server-side as of skill v1.4.0: the tool **assists with structure,
theme, brainstorming, and feedback but never ghost-writes an application essay** — a "write my essay"
request is refused with a coaching redirect. This is both an ethical stance for minors and a defense
against AI-detection rejection.

## API surface

The backend exposes on the order of ninety routes (the docs cite 84 JSON endpoints), all student
routes behind a Bearer session token and rate limiting (≈30 req/min/IP for the student limiter).
Grouped by area:

- **Auth & account**: register, auth (passphrase → session token), sync, profile, structured
  metrics, timeline, milestones, threads (CRUD + search), data export, account delete.
- **Consent & setup**: consent requirements/grant, setup status/initialize, baselines status, health.
- **LLM & chat**: `POST /api/chat`, `POST /api/llm`, `GET /api/llm/providers`,
  `GET /api/llm/openrouter/models`, `POST /api/agents/orchestrate`, `GET /api/context/bundle`.
- **BYOK & budget**: API-key put/get/delete (get never returns the secret), budget get/put, usage.
- **College Fit & colleges**: `POST /api/positioning/targets`, college search/detail/financial-aid/
  history/compare, `POST/GET/DELETE /api/colleges/values`.
- **ECs**: spike, candidates rank, strength (+ per-EC, prestige, recompute, override), prestige
  research/recompute, competitions search, ideas generate, plan, upload, narrative (CRUD + active),
  narrative drift, component-cache admin.
- **AP concepts & courses**: catalog, vectors, input/classify/override/recompute, course
  recommendations, calendar context.
- **Directionality**: read, override, recompute, trend.
- **CDS**: schools, school, validation, targets, parse, ingest, revalidate, canonical xlsx export.
- **Deadlines**: create, bulk, list, patch, delete.
- **Simulations**: create, get, delete.
- **Admin/counselor**: audit dashboard/export, review stats, admissions-intel summary + loaders,
  seasonal-research run, CDS counselor operations, the `/dashboard` safety console.
- **Public**: beta-signup, beta-impact (real or zero, never fabricated), credible-sources, methodology.
- **Safety**: notify-parent (crisis only, content-redacted, heavily rate-limited).

## Frontend

The React SPA centers on `App.jsx` (a large single component carrying chat, survey-first onboarding,
a grading scale, and a GPA calculator with rigor-weighted bonuses) plus focused components:
`CalibratedFitCard`, `SpikeFinder`, `CandidateRanker`, `CourseSequencer`, `DeadlineTracker`,
`NarrativeEditor`, `DriftBanner`, `FactorVector5`, `PrestigeCard`, and `DisclosurePanel`. Separate
entry pages cover login, methodology, setup, and a public beta pre-signup page. The UI surfaces the
"trust machinery" — evidence panels, three output lanes, confidence bands, source provenance, and a
disclosure panel explaining AI usage, advisory-only scope, FAFSA status, and data practices. It is
fully localized for `en-US` and `ko` (`i18n.js`), and `friendly-labels.js` translates internal
machine strings (e.g. `tier_1_distinctive`) into student-facing copy.

## Native clients

Both native apps are intentionally thin webview shells over the same `frontend/` SPA, so every
feature comes along automatically and stays in sync. `apple-webview/` is one Swift `WKWebView`
codebase with iOS and macOS targets (XcodeGen-generated project, persistent cookies/localStorage,
configurable frontend URL). `windows-webview/` is a .NET 8 WPF + WebView2 shell with the same
configurable-URL behavior and off-host links opening in the system browser. The backend URL is
configured inside the web app; the wrappers only choose which frontend to load.
`docs/SESSION-SUMMARY.md` orients developers building these (and future Kotlin/Flutter/Swift-native)
clients against the API contract.

## Tooling, ops, and tests

- **Bundled skill** (`backend/skills/collegeapp-ai/`) — SKILL.md (v1.4.0) plus helper scripts
  (`register`, `fetch-context`, `upload-attachment`, `seasonal-run`, `sync-skill`). The skill is a
  thin reasoning layer; the backend is the source of truth, and `npm run skill:sync` keeps the
  installed copy aligned (with a `--check` deploy guard).
- **MCP codebase server** (`tools/mcp-codebase-server.mjs`) — exposes the codebase (e.g. route
  scans) over MCP, path-confined to the repo root.
- **Architecture viz** (`workflow-viz/index.html`) and the counselor **safety dashboard**
  (`GET /dashboard`).
- **Batch jobs** (`batch-jobs.js`) — scheduled baseline normalization, profile cache refresh, daily
  domain monitoring, hourly fact expiry, retention cleanup, and 72h document auto-deletion.
- **Scripts** (`scripts/`) — operator secret setup (atomic `.env` writes with backup via
  `env-file.js`; the encryption key is never silently rotated), IPEDS college-profile generation,
  college-data and CDS refresh, CDS cache ingest, and positioning scenario runs.
- **File extraction** (`file-extractors.js`) — PDF/DOCX/XLSX/OCR text extraction for uploaded
  evidence (mammoth, pdf-parse/pdfjs-dist, tesseract.js, exceljs).
- **Tests & CI** — 35 backend test files run with `node --test`; CI (`.github/workflows/ci.yml`)
  runs backend tests + lint (lint non-blocking) on a generated IPEDS fixture, and separately builds
  the Apple (iOS + macOS) and Windows wrappers.

## The positioning thesis (from the differentiation strategy doc)

The repository's strategy doc frames the product against thin "AI wrapper" competitors and against
raw ChatGPT/Claude. Its thesis: where competitors generate fluent text and hope it's right, this
system is grounded, calibrated, concept-level, and persistent. The four ownable pillars are
provenance by default (every factual claim ships with its source, or the system says it doesn't
know), calibrated rather than flattering fit, course-level academic reasoning via the AP concept
catalog, and student wellbeing as a designed constraint (sustainable-hours ceilings). Summed up in
the doc's own line: *"ChatGPT guesses. We retrieve, cite, and remember."*

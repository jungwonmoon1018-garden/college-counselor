# Session Summary & Client-Dev Orientation (macOS / Windows / Android)

_Last updated: 2026-06-08._

This document orients a developer building **native clients** (macOS, Windows,
Android) against the College Counselor backend. It covers the architecture,
the client-facing API contract, what changed in the most recent work session,
and platform-specific guidance.

---

## 1. Architecture in one paragraph

The product is a **hosted HTTP/JSON backend** (`backend/`, Node/Express +
better-sqlite3, ESM, default port `3001`) plus a **thin client** (today a React
SPA in `frontend/`). **All intelligence lives server-side** — rules/positioning
engine, evidence graph, CDS data, LLM routing, compliance. Clients are
presentation + input only. A native macOS/Windows/Android app is "just another
client" of the same API; it does **not** embed the database or the LLM logic.

```
[ macOS app ]  [ Windows app ]  [ Android app ]  [ React SPA ]
        \            |                |              /
                 HTTPS / JSON  (Bearer session token)
                            |
                    [ Backend :3001 ]  ──► per-student BYOK LLM (OpenRouter/Anthropic/…)
                            |                └─ web grounding (web_search / web_fetch)
            counselor.db · pii-vault.db (AES-256-GCM) · vectors.db
```

Deployment: see `backend/DEPLOY.md` and `backend/Caddyfile` (Caddy reverse
proxy / TLS). Mobile clients **require** a hosted backend — SQLite + the vault
do not run on-device.

---

## 2. Core concepts a client dev must understand

- **BYOK (Bring Your Own Key).** Each student supplies their own LLM API key.
  It is stored **encrypted** server-side (pii-vault, AES-256-GCM) and never
  returned to the client. Provider-agnostic: OpenRouter (default), Anthropic,
  OpenAI, Google, DeepSeek, Qwen/Together, Zhipu, local Ollama/LM Studio.
  All provider responses are **normalized to an Anthropic-shaped** payload
  (`content: [{ type: "text" | "tool_use" | … }]`).
- **Tiered models.** `small` / `medium` / `large`. The large tier is
  web-capable (e.g. `deepseek/deepseek-v4-pro`) and is used for grounded
  research (deadlines, CDS, admit-rate lookups).
- **Compliance is product, not paperwork.** FAFSA advisory posture, FERPA,
  Korea AI-Basic-Act / PIPA. Consent gating, content moderation, and a crisis
  → parent-notification path are first-class. Clients must surface consent and
  must **not** display LLM/model names in the consent agreement or chat
  disclosure (a deliberate compliance-UX decision).
- **Locale.** `en-US` and `ko` (Korean) are supported end-to-end (i18n).

---

## 3. Client-facing API contract

Base URL: `https://<host>/api` (dev: `http://localhost:3001/api`). JSON in/out.

### Auth & session
- `POST /api/students/register` — create account (email + passphrase + consent).
- `POST /api/students/auth` — unlock with passphrase → returns a **session
  token** (random 32-byte hex). Send it as `Authorization: Bearer <token>` on
  every authenticated call. Tokens are stored hashed server-side and **expire**;
  handle `401 "Invalid or expired session token"` by re-authenticating.
- `GET /api/consent/requirements`, `POST /api/consent/grant` — consent flow.
- `PUT /api/students/apikey`, `GET /api/students/apikey`, `DELETE …` — manage
  the student's BYOK key (the GET never returns the secret, only presence/meta).
- `GET /api/students/budget`, `PUT /api/students/budget`, `GET /api/students/usage`
  — token-budget controls + usage accounting.

### The screen this session focused on — "College Fit"
- `POST /api/positioning/targets` — the calibrated read shown on the fit card.
  Body: `{ targets?: [{ schoolName, unitId? }], major?, refreshCds?, searchCds?, webCds? }`.
  Returns `targets: [...]`, each with:
  - `overallPositioningLabel` (`Highly competitive` | `Competitive` | `Reach` | `High reach`)
  - `admissibility.academicReadinessScore`, `competitiveness.majorCompetitivenessScore`
    (now blends real institutional selectivity), `fit.institutionalPriorityFitScore`
  - `confidence.{ evidenceConfidence, evidenceConfidenceScore, evidenceValidated }`
  - **`scoreRanges`** — `{ admissibility|competitiveness|fit: { point, low, high } }`.
    Low evidence ⇒ wide band. **Render these as a band, not a single number.**
  - **`dataProvenance`** — `{ kind, validated, sourceUrl, year?, admitRatePercent?, admitRate? }`.
    `kind` ∈ `cds_store` (validated) · `cds_live` (live-parsed PDF, unverified) ·
    `cds_web` (AI web-read, unverified) · `baseline_only` (IPEDS). When the admit
    rate came from a web lookup, `dataProvenance.admitRate = { source:"web",
    admitRatePercent, season, sourceUrl }`. Surface the source + "unverified" state.
- `POST /api/colleges/values` / `GET /api/colleges/values/:slug` — school core
  values (header + value list on the fit card).

### Other student-facing surfaces (all `Bearer`-auth, `studentLimiter` applies)
- Chat / LLM: `POST /api/anthropic` (normalized chat), `POST /api/llm`,
  `GET /api/llm/providers`.
- ECs: `GET /api/ec/spike` (Spike Finder), `POST /api/ec/candidates/rank`,
  `GET /api/ec/strength`, `POST /api/ec/ideas/generate`, `POST /api/ec/plan`,
  `POST /api/ec/upload`, `POST /api/files/extract-text`.
- Courses: `GET /api/courses/recommendations`.
- Narrative: `GET/POST /api/ec/narrative`, `POST /api/narrative/draft`,
  `GET /api/narrative/drift`.
- Colleges: `POST /api/colleges/search`, `GET /api/colleges/:id`,
  `GET /api/colleges/:id/financial-aid`, `POST /api/colleges/compare`.
- CDS data: `GET /api/cds/schools`, `GET /api/cds/school/:slug`,
  `GET /api/cds/validation/:slug`.
- Calendar/deadlines: `POST /api/calendar/context`, `GET /api/students/deadlines`,
  `POST /api/students/deadlines/bulk`, `PATCH/DELETE …`.
- Profile/threads: `GET /api/students/profile`, `POST /api/students/sync`,
  `GET/POST /api/students/threads`, `POST /api/students/threads/:id/messages`,
  `GET /api/students/export` (data-portability).
- Safety: `POST /api/notify-parent` (crisis path — heavily rate-limited).
- `GET /api/health` — unauthenticated health check.

### Cross-cutting client rules
- **Rate limit**: `studentLimiter` ≈ **30 req/min/IP**. Batch where possible
  (e.g. use `…/deadlines/bulk`, not N single POSTs) and back off on `429`.
- **Error shape**: LLM/provider errors pass through the **upstream status**
  (e.g. `429`, `401`, `402`) with an actionable `error` message — show it to the
  user (e.g. "switch to a paid web-capable model"), don't swallow it.
- **Caching**: positioning/CDS responses are cached server-side; pass
  `refreshCds: true` to force a recompute after data changes.

---

## 4. What changed this session (so the fit screen is built correctly)

The "College Fit" positioning was previously **inflated** (a thin-evidence
school showed a confident-looking score next to "Very Low" confidence). Fixes:

1. **De-inflation**: fixed a college-name matching bug (real CDS/IPEDS data was
   silently dropped → optimistic defaults); folded real institutional
   selectivity into the displayed **Competitiveness**; fixed
   `normalizePercentValue(null) → 0` (unknown admit rate read as 0% = maximally
   selective).
2. **Confidence-aware ranges** (`scoreRanges`): low evidence widens the bands.
3. **Real CDS data, with a fallback chain**:
   `validated store → live CDS PDF → web-LLM CDS read → IPEDS baseline → web admit-rate lookup → neutral`.
   Live/web-read records are tagged **unvalidated** (confidence penalty, capped
   below "High") and carry `dataProvenance` so the UI can show the source and an
   "unverified" badge.

**Client implication:** the fit card must render (a) a **band** per dimension,
(b) a **confidence** indicator, and (c) a **provenance/source** line with an
"unverified" treatment for `cds_live` / `cds_web`. Never present an
unvalidated/low-confidence number as authoritative.

> Open item the backend team flagged: the overall `finalScore` selectivity
> *adjustment* is currently inverted (more-selective schools get a higher
> multiplier). Pending a product decision — don't hard-code assumptions about
> the overall label until it's resolved.

---

## 5. Platform guidance

### Fastest path (recommended first): wrap the existing React SPA
- **macOS + Windows**: **Tauri** (Rust shell, tiny binaries, native webview) or
  **Electron**. Point it at the hosted backend; reuse `frontend/` almost as-is.
  Tauri is preferred for size/security; Electron if you need broad plugin
  ecosystem. This gets desktop apps on both OSes from one codebase quickly.
- **Android (and iOS later)**: **Capacitor** wrapping the same SPA, or a
  thin WebView shell, for a v1.

### Native path (better UX, more work)
- **macOS**: Swift + SwiftUI. Use `URLSession` + `Codable` models matching the
  JSON above; Keychain for the session token.
- **Windows**: WinUI 3 / .NET (C#) or Flutter (also covers Android). `HttpClient`
  + `System.Text.Json`; DPAPI/Credential Locker for the token.
- **Android**: Kotlin + Jetpack Compose, Retrofit/OkHttp + kotlinx.serialization;
  EncryptedSharedPreferences/Keystore for the token. Or **Flutter** for one
  Android+Windows(+iOS) codebase.

### Shared client checklist (every platform)
- Implement: register/consent → unlock (passphrase) → store Bearer token
  securely → BYOK key entry screen (write-only; never log/echo the key).
- Render the **fit card** per §3/§4 (bands + confidence + provenance).
- Handle `401` (re-auth), `429` (backoff), and pass-through provider errors.
- Localize `en-US` / `ko`.
- Surface consent + crisis disclosures; **do not** show model names in consent.
- Treat all student data as PII: no analytics/telemetry on profile content,
  TLS only, respect data-export/delete (`GET /api/students/export`,
  `DELETE /api/students`).

---

## 6. Gotchas carried from prior work
- `better-sqlite3` is native — the backend host must match its build ABI
  (irrelevant to clients, but relevant to whoever deploys it).
- Web grounding only works on web-capable providers (DeepSeek V4 Pro /
  Anthropic); other tiers can't fetch.
- Cycle/calendar logic pivots in **February** (don't assume a July rollover).
- i18n `ko` block stores values as `\uXXXX` escapes — match exact bytes if a
  client ever edits shared locale files.

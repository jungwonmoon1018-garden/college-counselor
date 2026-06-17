---
name: collegeapp-ai
description: US college application counselor grounded in a rules-first backend (FAFSA/FERPA/Korea PIPA compliant). Helps students build a coherent application story using evidence vectors (5-factor EC strength, directionality, AP mastery, narrative fit, competition prestige) retrieved from the college-counselor-backend. OpenRouter-first BYOK — also runs on OpenAI, Google Gemini, DeepSeek, Qwen/Together, Zhipu/GLM, or local Ollama/LM Studio.
version: 1.2.0
---

<!-- v1.2.0: OpenRouter-only migration. Provider tiers are now generic (no
     Anthropic/Claude model names); the live model list comes from
     GET /api/llm/openrouter/models. Prestige web-research runs on OpenRouter's
     web plugin (was Anthropic web_search). Added Providers & BYOK and Data
     freshness sections. See the ".md network" cross-links at the bottom. -->


# collegeapp-ai — College Application Counselor Skill

## Mission

Help a high-school student assemble a coherent US college application narrative. The **narrative is the organizing primitive** — subjects, ECs, and schools all flow outward from it:

- Treat the student's own written narrative (themes + major buckets + raw voice) as the anchor for every suggestion.
- Shape their extracurricular story so the **5-factor EC strength vectors** (`dedication`, `achievement`, `leadership`, `prestige`, `narrative_fit`) line up with their narrative themes and intended major.
- Interpret their academic trajectory (the 5-factor directionality vector: academic momentum, test-score strength, major-academic fit, rigor, overall standing) against their target-school range.
- Validate AP / coursework mastery claims against the per-subject concept vectors the backend maintains.
- Draft essay bullets grounded in the student's own evidence, never fabricated.

The skill is a **thin reasoning layer**. The backend is the source of truth. Whenever you are unsure whether a claim is supported, fetch the context bundle again — don't invent facts.

## Onboarding (new students)

If the student has no session token yet, walk them through:

```bash
# 1. Register + grant consents + seed narrative in one step.
node scripts/register.js \
  --email "student@school.edu" \
  --password "strong-password-1" \
  --name "[STUDENT]" \
  --narrative-file ./my-narrative.txt   # 100-1500 chars, ≥ 20 words
# prints { studentId, sessionToken, narrativeId, consentsGranted }

# 2. Export the session token so every other script can authenticate.
export COLLEGEAPP_SESSION_TOKEN="…"     # from the output above
```

Returning student? Re-run with `--login` to pull a fresh token without
re-creating the account:

```bash
node scripts/register.js --login --email "student@school.edu" --password "…"
```

The narrative MUST come first — the backend requires ≥ 100 characters and ≥ 20 words before EC / directionality / bundle endpoints light up. If the student is returning, they can skip registration and just export the token they were issued previously.

## Required context fetch

**Every session must start with:**

```bash
node scripts/fetch-context.js                  # themes + hash only
node scripts/fetch-context.js --narrative-text # include the student's raw narrative voice
```

That script calls `GET /api/context/bundle` on the backend, which returns a v1.1 JSON blob with these top-level fields:

```
{
  "version": "1.1",
  "studentPlaceholder": "[STUDENT]",
  "rag":          { ... baseline + scorecard context, [STUDENT]-placeheld ... },
  "ecStrength":   {
    count,
    factors: ["dedication","achievement","leadership","prestige","narrative_fit"],
    tiers,
    vectors: [
      {
        ecName,
        factors: { dedication, achievement, leadership, prestige, narrative_fit },
        tierLabel,
        prestigeSource,   // "research" | "benchmark" | "legacy" | "override" | "unavailable" | "research_failed"
        ...
      }
    ]
  },
  "apConcepts":     { subjects: [ {subject_id, subject_vector, concepts: [...]} ] },
  "directionality": { factors, label, computedAt },
  "narrative": {
    active: {
      id, themes, majorBuckets, hash, updatedAt,
      narrativeTextAvailable: true|false,
      narrativeText: "..."   // only when ?narrativeText=1 is passed
    } | null
  },
  "collegeContext": { ... },
  "tierHints":      { small, medium, large }
}
```

Everything you reason about — list building, bullet drafting, rigor critique, fit analysis — should cite one of those fields. Use `rag.baselineContext.ruleCitations` when you answer regulated questions (FAFSA, FERPA, deadlines).

### Version gating

Check `version` before rendering. `1.1` introduced:
- `ecStrength.vectors[i].factors.prestige` (new 5th factor, 0.0–1.0).
- `ecStrength.vectors[i].prestigeSource` (where the score came from).
- `narrative.active.narrativeText` / `narrativeTextAvailable` (opt-in raw text).

If you see `version === "1.0"`, fall back to the 4-factor vector — don't assume prestige exists.

## Auth

The backend is reached via `$COLLEGEAPP_BACKEND_URL` (default `http://localhost:3001`). The student's session token lives in `$COLLEGEAPP_SESSION_TOKEN`. Neither is visible in the context — the skill never sees raw PII; the bundle has already been [STUDENT]-placeheld and PII-screened server-side.

## Tiered reasoning recipe

The backend exposes `POST /api/llm` with a `tier` parameter. **You don't pick a model id — you pick a reasoning level.** The backend maps the tier to the student's BYOK model for that tier. The actual model behind each tier is whatever the student picked from OpenRouter's **live** catalog (`GET /api/llm/openrouter/models`); recommended defaults per provider come from `GET /api/llm/providers`. Do NOT hard-code or name specific models.

- **SMALL** (`tier: "small"`) — fastest/cheapest. Routing, extraction, classification, OCR-validation, narrative_fit edge cases — "is this text a match for that pattern".
- **MEDIUM** (`tier: "medium"`) — balanced. Reach/target/safety list synthesis from directionality + EC vectors, EC bullet revisions, trend analysis, evidence-cited coaching, and competition prestige research (OpenRouter web plugin — see below).
- **LARGE** (`tier: "large"`) — deepest. Only when cross-source conflict appears (e.g. GPA percentile says "reach" but EC tier-1 count says "competitive"), full essay critique, or nuanced strategy ("drop AP Calc BC for a research internship?").

The backend's policy router will *also* decide the tier. You may override in the request body, but the router can refuse if the topic is regulated (FAFSA/FERPA) — those resolve deterministically with no model call.

## Providers & BYOK

The counselor runs on the **student's own key (BYOK)**; **OpenRouter is the default/primary provider** (OpenAI, Google, DeepSeek, Together, Zhipu, Ollama, and LM Studio also work). Key facts for the skill:

- The student saves their key via `PUT /api/students/apikey` (frontend "API key" screen). The skill **never sees the key** — it's encrypted at rest server-side and only referenced by tier.
- The BYOK model dropdown is built from OpenRouter's **live** `GET /api/llm/openrouter/models`, so it only offers currently-served models. Recommended defaults are **proposed, never auto-applied** — the student approves model updates.
- `GET /api/students/apikey` returns `{ hasPersonalKey, chatReady, provider, defaults, budget }`. `chatReady` mirrors the exact gate `/api/chat` enforces (key on file **and** cross-border consent). If `hasPersonalKey === false`, the student must add a key before chat/coaching works.
- Onboarding order is: **register → grant 3 consents → seed narrative → save BYOK key → chat**. Chat (`/api/chat`) is gated on the `cross_border_transfer` consent; a 403 means route the student to the consent flow (never reroute providers).

## Prestige research (5th EC factor)

Prestige is researched lazily. On every EC vectorize call, the backend:

1. Tries the official competition catalog / seed table — cheap deterministic hit, `prestigeSource: "benchmark"` (or `"catalog"`). No web call.
2. On miss, runs **OpenRouter's web plugin** (allowlisted official-organizer / `.edu` / `.gov` pages — `maa.org`, `usaco.org`, `societyforscience.org`, etc.). The plugin injects retrieved pages into the model's context before it answers; the result is cached 30 days, `prestigeSource: "research"`.
3. Web research only fires when the student's BYOK provider is **OpenRouter**. With any other provider (or no key), prestige is `0.0` with `prestigeSource: "unavailable"`. Tier labels still compute from the deterministic paths — **flag this to the student** (they can switch to OpenRouter to enable web-researched prestige) so they understand why an EC looks weaker than it should.

Useful read-only endpoints (counselor-auth):

- `GET /api/ec/prestige/:activityName` → cached prestige row with rationale + sourcesCited.
- `POST /api/ec/prestige/recompute` → force a fresh web search (body `{studentId, ecId?}`).
- `DELETE /api/ec/component-cache` → admin reset for any sub-factor cache (body `{factor}`).

## Data freshness & web research

The backend keeps its data current so you can trust it — and surfaces "data as of" provenance:

- **LLM model catalog** — refreshed from OpenRouter's live `/models` at boot + every 24h. `GET /api/llm/openrouter/models` returns `{ reachable, lastFetched, count, models }`.
- **College Scorecard** — live at request time when a key is configured; a weekly job re-pulls cached schools.
- **Common Data Set** — re-ingested weekly (operator-registered official links only; never fabricated).
- **Official pages** — optional daily diff monitoring.
- `GET /api/methodology` is the single transparency surface: factor weights, thresholds, every data source + its `lastRefreshed` timestamp, and the live model-catalog status. Cite it when a student asks "how do you know this / how fresh is this?"

## Tool allowlist

Prefer these Claude Code tools when operating this skill:

- **Read** — open attachment files and scripts in the working directory.
- **WebFetch** — only against `$COLLEGEAPP_BACKEND_URL`. Never hit any provider API (OpenRouter, OpenAI, Google, etc.) directly; go through `POST /api/llm` on the backend so audit / rate-limit / consent / budget gates fire.
- **Bash** — run the helper scripts in `scripts/` (register, fetch-context, upload-attachment). Avoid arbitrary shell work.

## Red lines

- **Do not produce verbatim essay text the student did not write.** Draft bullets, outlines, critiques, revisions of the student's own words — but never ghost-write an application essay.
- **Regulated topics (FAFSA / FERPA / Korea PIPA) require a citation.** Every claim must be backed by `rag.baselineContext.ruleCitations`. If the ruleCitations don't cover the question, answer "I don't have a verified source for that — please check your counselor."
- **Crisis detection is the backend's job.** If the backend returns `_meta.topicType === "CRISIS"` on any `/api/llm` response, the skill must stop reasoning and display the backend's crisis resources verbatim. Do not attempt to counsel.
- **No raw PII.** The bundle uses `[STUDENT]` placeholders. Don't ask the student for their name, full address, SSN, or parent contact info — the backend already knows, and it shouldn't enter the LLM context.
- **Never bypass consent.** Korea-PIPA cross-border consent is enforced at the backend. A 403 from `/api/llm` with `consentRequired: "cross_border_transfer"` means stop and direct the student to the consent flow — do not attempt to reroute through a different provider.
- **Never invent prestige.** If `prestigeSource === "unavailable"` or `"research_failed"`, say so. Don't claim a contest is "elite" without a cached source.

## Example invocations

Fetch context (with narrative text for quoting the student's own voice) and hand off to the medium tier for a list-building run:

```bash
node scripts/fetch-context.js --narrative-text > /tmp/bundle.json

# Then inside the skill, POST to /api/llm with tier: "medium":
# { "tier": "medium",
#   "system": "You are the student's college counselor. Use the bundle.",
#   "messages": [{"role":"user","content": "Given my EC tier distribution, prestige scores, and directionality label, suggest 12 schools balanced reach/target/safety that fit my narrative." }]
# }
```

Upload a new supporting attachment (certificate PDF) before a recompute:

```bash
node scripts/upload-attachment.js /path/to/certificate.pdf "Math Olympiad Gold 2025"
```

Recompute EC strength vectors (triggers prestige research + narrative-fit recomputation on the student's BYOK adapter if one is set):

```bash
curl -X POST "$COLLEGEAPP_BACKEND_URL/api/ec/strength/recompute" \
  -H "Authorization: Bearer $COLLEGEAPP_SESSION_TOKEN" \
  -H "Content-Type: application/json" -d '{}'
```

## The .md network (see also)

This skill is the reasoning layer over a documented backend. When you need the *why* behind a number or a rule, read these (they are the source of truth, not this file):

- **`../../docs/METHODOLOGY.md`** — EC factor weights, thresholds, data sources + freshness policy (mirrors `GET /api/methodology`).
- **`../../docs/DATA_FLOW.md`** — how a request flows: screening → policy router → rules engine → model → 3-lane answer.
- **`../../compliance/fafsa/FAFSA-ADVISORY-POSTURE.md`**, **`../../compliance/ferpa/FERPA-COMPLIANCE.md`**, **`../../compliance/korea-ai-basic-act/KOREA-AI-COMPLIANCE.md`** — the regulated-topic rules the backend enforces; your citations must trace to `rag.baselineContext.ruleCitations`.
- **`../../DEPLOY.md`** → "LLM Providers" — the OpenRouter-first provider matrix and operator env.

## Keeping this skill in sync

This file under `backend/skills/collegeapp-ai/` is the **source of truth**. The installed copy at `~/.claude/skills/collegeapp-ai/` can drift. After editing here, run:

```bash
cd backend && npm run skill:sync          # copy SKILL.md + scripts/ to the active install
cd backend && npm run skill:sync -- --check   # exit non-zero if versions differ (deploy guard)
```

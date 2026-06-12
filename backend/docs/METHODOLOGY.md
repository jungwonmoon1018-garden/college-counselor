# How the scoring works (methodology)

We believe a score you can't see inside is a score you can't trust. This page
documents exactly how recommendations are produced. The same data is served
live at **`GET /api/methodology`** and rendered in-app at **`/methodology.html`**,
so the doc and the running system never drift.

> These scores are an automated, evidence-based read of what you tell us — a
> starting point for conversation, **never a verdict**. You can override any
> factor, and a human counselor (and your own judgment) should always have the
> final say.

## Extracurricular (EC) scoring

Each activity is scored 0–1 on **six independent factors**. We keep them
independent on purpose — there is no single hidden ranking number.

| Factor | Weight | What it measures |
| --- | --- | --- |
| Impact & scope | **0.20** | How far the work reaches beyond you (people, $, audience). |
| Leadership & initiative | **0.20** | Whether you started/drove something, not just held a title. |
| Passion & consistency | **0.20** | Sustained, multi-year commitment + a visible body of work. |
| Talents & awards | **0.16** | External validation and competitive achievement. |
| Relevance to intended major | **0.14** | How clearly it connects to your declared field (your "spike"). |
| Community & character | **0.10** | Service, empathy, mentorship, integrity — never inferred from nothing. |

Weights sum to **1.00**. The composite is a plain weighted sum:

```
composite = Σ (factor_score × factor_weight)
```

The composite maps to a coarse **band for orientation only** — act on the
underlying factor scores, not the label:

| Composite ≥ | Label |
| --- | --- |
| 0.80 | exceptional |
| 0.65 | strong |
| 0.45 | developing |
| 0.25 | emerging |
| 0.00 | early_stage |

## Narrative quality & essays (no ghostwriting)

Narrative drafts are grounded **only** in your real profile — we never invent
awards, titles, or experiences. A draft is **editable scaffolding in your own
voice**, not a finished essay and not words handed to you. Narrative quality
influences EC *relevance/fit* signals (how well an activity supports your stated
story); it never manufactures accomplishments. Idea brainstorming may suggest a
community/character activity, but you carry it out and write about it yourself.

## Human oversight (we are not a counselor)

This tool does not replace a human counselor. **Non-US curricula, unusual
transcripts, special-needs accommodations, visa/eligibility questions, and
complex family contexts** can be misread by an automated system — bring those to
a real counselor. Use this output to *prepare*, not to decide.

## Data sources & freshness

| Data | Source | Freshness |
| --- | --- | --- |
| Admissions stats (acceptance, SAT/ACT, cost, outcomes) | U.S. Dept. of Education **College Scorecard API** | Live, fetched at request time |
| Qualitative weights (factor importance, essay weight) | Institutional **Common Data Set** | Operator-registered official links, parsed + validated before ingest |
| Official pages (admissions/aid/deadlines) | University websites | **Daily** diff-based monitoring (respects robots.txt) |
| AP concepts | Released AP FRQ content (2023–2025) | Curated catalog |
| Baseline GPA/SAT/ACT distributions | NCES / NACAC / CollegeBoard | 2024 aggregate reports |

Nothing here is scraped blindly or fabricated. International curricula coverage
is the known weak spot — verify with an advisor familiar with your system.

## Model transparency & migration

Free-text quality depends on the model behind your BYOK key. We keep
recommendations current and tell you when yours is behind:

- **Anthropic** — retired model IDs are **auto-migrated** to the current
  recommended target (no action needed). Targets refresh from Anthropic's
  `/v1/models` at boot and every 24h.
- **OpenRouter & other BYOK providers** — newer recommended models are detected
  and **proposed**; migration happens **only with your explicit approval**,
  never silently. (Refreshed daily from OpenRouter's live model list.)

Live status — current targets, last refresh, and any pending proposals — is in
the `modelTransparency` block of `GET /api/methodology`.

## Your controls

- **Override** any factor score; your override survives every recompute.
- Every plan is marked **open for correction** — the numbers are an automated
  read, not ground truth.
- Your data is **encrypted, exportable, and deletable** at any time.

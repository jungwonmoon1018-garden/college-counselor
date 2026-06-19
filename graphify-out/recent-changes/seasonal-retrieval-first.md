# Seasonal retrieval-first verification

## What changed

The seasonal refresh that pulls last-season admissions stats and AP score
distributions was reworked from "ask the web plugin once per lens per record"
to a **retrieval-first 3-lens council**. The expensive web call is now the
exception, not the rule.

Sources stay restricted to official ones — `collegeboard.org`,
`collegescorecard.ed.gov`, and each college's own official `.edu` admissions /
Common Data Set pages (the per-college host is resolved from the Scorecard
`school.school_url`, stored on `baseline_colleges.website`). The credible-source
allowlist lives in `credible-sources.js`; anything off it is refused.

## How the three lenses work

For each scraped figure, three lenses are fetched **deterministically** (no LLM):

- **Lens A — CDS:** parse the locally cached Common Data Set PDF via the
  CDS PDF parser.
- **Lens B — Scorecard:** hit the College Scorecard JSON API directly.
- **Lens C — cited:** reuse the existing cached scrape of the cited source.

`compareLensValues()` is a deterministic comparator with numeric tolerances —
each lens votes confirm / contradict / unconfirmed against the scraped value.
The embedded Qwen2.5-1.5B only fires on genuine disagreement (≥1 lens confirms
AND ≥1 contradicts), reading the structured tuple `{scraped, lensA, lensB,
lensC}` and emitting a short adjudication (~200 tokens in, ~100 out). A figure
that cannot be confirmed is **quarantined** so it never reaches a student.

## Files touched

- `backend/seasonal-verification-v2.js` — the 3-lens council, deterministic
  comparator, embedded-LLM adjudication on disagreement.
- `backend/seasonal-research.js` — orchestration: AP distributions and CED units
  from `collegeboard.org` only, per-college host resolution, quarantine wiring.
- `backend/credible-sources.js` — the source allowlist.

## Why it matters

This is the token-economy and trust story for fresh data: most figures are
confirmed without any LLM call, the model is reserved for the few contested ones,
and the child-safety posture is preserved — an unverifiable stat is dropped
rather than shown to a minor.

## Validation

Freshness surfaces in `GET /api/methodology` (the `seasonalResearch` block);
a run is triggered by `POST /api/admin/seasonal-research/run` (counselor) or
`scripts/seasonal-run.js`. The lens-fetch and comparator paths are deterministic
and unit-testable; the adjudication path requires the embedded model to be
present.

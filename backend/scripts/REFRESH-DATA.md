# Refreshing college data after an application season

This explains how the app's college data stays current and how to refresh the
parts that don't update themselves. **No step here invents numbers** — every
value comes from an authoritative source (federal Scorecard API or an official
Common Data Set you register).

## What's already current (no action needed)

- **Application calendar / cycle** — computed live from the server clock in
  `buildAdmissionsCalendar()`. It rolls forward automatically once RD season
  ends, so "current cycle", deadlines outline, and phase are never stale.
- **Live admissions stats shown to students** — acceptance rate, SAT/ACT
  ranges, cost, and outcomes are fetched live from the **U.S. Dept. of
  Education College Scorecard API** at request time (`college-scorecard.js`).
  Already the latest federal data.
- **Deadlines** — student-entered (`student_deadlines`), not a central dataset.

## What can go stale (and how to refresh it)

### 1. Offline fallback profiles — `generated/college-profiles.generated.js`

Used when the Scorecard API is unavailable. Built from a static IPEDS CSV
snapshot by default (`npm run generate:colleges`). To refresh it from the
**live Scorecard API** instead — current federal data, CDS-only qualitative
fields preserved:

```bash
# Refresh every school already in the generated file (by unitId):
npm run refresh:colleges

# Or refresh a specific set by name:
node scripts/refresh-college-data.mjs --names "Stanford University,Brown University"
node scripts/refresh-college-data.mjs --from-cds            # all CDS-listed schools
node scripts/refresh-college-data.mjs --dry-run --limit 5   # preview, no write
```

Requires `SCORECARD_API_KEY` in `.env`. `DEMO_KEY` works but is rate-limited
(~30 req/hr) — fine for a few schools, not for hundreds. Quantitative fields
(acceptance, SAT/ACT, enrollment, cost, outcomes) are refreshed; CDS-only
fields (`avgGpaAdmitted`, `apCoursesValued`, `topMajors`, `ecEmphasis`) are
**preserved**, never overwritten or guessed.

### 2. Common Data Set records — `tools/cds-cache/` → `cds_records`

These carry the qualitative signals Scorecard lacks (factor importance, essay
weight, etc.). Some cached entries are several cycles old. Refreshing to a new
cycle is a two-step flow, because the source CDS PDFs must come from each
school's official publication — the app does not scrape or fabricate them:

```bash
# 1. Register the new cycle's source links (a JSON map you supply from each
#    school's official CDS page). slug or name → URL, or → { "<cycle>": url }.
node scripts/add-cds-cycle.mjs --in new-cds-links.json --cycle 2024-25

# 2. Download → parse → validate → ingest the newest cycle for each school.
npm run refresh:cds -- --year 2024-25
#    (subset: node scripts/refresh-cds.mjs --year 2024-25 --names "Brown University")
```

`downloadCDS` already prefers the **newest** cycle key present in
`tools/cds-cache/index.json`, so once a `2024-25` link is registered it is
picked up automatically. Validation flags discrepancies; nothing is invented.

## Recommended post-season routine

1. `npm run refresh:colleges` — refresh the offline fallback from Scorecard.
2. Collect official 2024-25 CDS links → `node scripts/add-cds-cycle.mjs --in links.json --cycle 2024-25`.
3. `npm run refresh:cds -- --year 2024-25` — ingest the new CDS cycle.
4. Restart the backend so the refreshed fallback + CDS records load.

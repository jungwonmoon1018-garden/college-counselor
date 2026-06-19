# Strategy Council

## What it is

For high-stakes subintents — college-list shape, major pivot, narrative arc, EC
strategy change, ED/EA choice, late-cycle pivot — `POST /api/strategy-council/convene`
runs five councilors instead of one model:

- **Strategist, Skeptic, Devil's Advocate** — embedded (zero cost).
- **Data Checker, Compliance** — BYOK medium, falling back to embedded when there
  is no BYOK key or no cross-border consent.

A deterministic moderator aggregates the five voices; Compliance holds a hard
veto. Five voices for ~5k tokens total is cheaper than a single large-tier call
and comes with structured dissent.

## What the council reads

All five councilors see the **same** ~2k-token (~8000-char) envelope from
`council/context-builder.js`, so they disagree about interpretation, not about
facts. The envelope packs, in priority order:

1. student profile summary (grade, narrative arc, target list — no PII);
2. a graphify BFS subgraph for the question (~1k tokens);
3. Logseq excerpts — `college-list` + `narrative` + the recent daily journals;
4. baseline facts from the fact store when present.

`packSections` drops the lowest-priority sections first (journals, then pages,
then graph, then profile) until it fits the budget. The vault excerpt and packing
logic is now the shared code in `context/graph-vault-context.js` (see
[chat-graph-vault-context](chat-graph-vault-context.md)) — the council imports it
rather than carrying its own copy.

This round also threaded the **real** Logseq creds into the council context
(previously `logseq: {}`), so when Logseq desktop is live the excerpts are read
over HTTP, otherwise from the filesystem.

## What the council writes

A convening persists twice:

- a `council_convenings` row in `counselor.db` (visible via
  `GET /api/strategy-council/convenings`); and
- an audit trail back into the vault — `council/audit-trail.js` appends a block
  to `strategy-council-log.md` and cross-links the daily journal via
  `appendBlock` / `writeJournalEntry`, using the resolved creds (HTTP when live,
  filesystem otherwise).

The write-back was already implemented in `audit-trail.js`; this round's change
was passing it real creds rather than an empty object.

## Files touched

- `backend/council/context-builder.js` — imports shared
  `collectVaultExcerpts` / `packSections`; envelope unchanged
  (`TOTAL_CHAR_BUDGET = 8000`, `MAX_GRAPH_CHARS = 4000`).
- `backend/server-routes-pillars.js` — convene route passes
  `resolveLogseqCreds(studentId)` into the context builder.
- `backend/council/audit-trail.js` — receives a `logseq` creds param (no body
  change needed).

## Validation

Against the mock student a convening ran end-to-end: all five seats produced
output, the envelope cited real vault content (`College List: Reach: MIT`), the
Data Checker correctly flagged that MIT has no Early Decision program, a
`council_convenings` row was written, and a new block landed in
`strategy-council-log.md` with a journal cross-link. Citations included both a
graph node and a logseq block.

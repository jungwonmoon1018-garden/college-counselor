# Chat + graph/vault context

## What changed

Before this round, only the Strategy Council read the student's vault and graph;
routine chat re-derived context every turn from DB snapshots. Now both
`POST /api/chat` and `POST /api/agents/orchestrate` prepend a **compact
(~500-token / ~2000-char) graph/vault context** to the model's system prompt,
gated on consent and graceful on absence.

## The shared helper

`backend/context/graph-vault-context.js` is the single source of truth, created
this round and imported by both the chat path and the council:

- `assembleGraphVaultContext({ studentId, dataDir, query, logseq = {}, budgetChars = 2000 })`
  — one `queryStudentGraph(..., mode:"bfs", budgetTokens:500)` plus the
  `college-list` and `narrative` vault pages (no journals — those are reserved
  for the heavier council envelope). Returns a packed string, or `""` on any
  failure.
- `collectVaultExcerpts({ ... })` and `packSections(sections, budgetChars)` were
  refactored *out* of `council/context-builder.js` into this module; the council
  now imports them, so there is no duplicate excerpt/packing logic.

## The injection path

`buildGraphVaultInjection(studentId, query)` in `server.js`:

1. returns `""` immediately if there is no `studentId`;
2. checks `hasActiveConsent(piiStmts, studentId, "logseq_vault")` and returns
   `""` without consent;
3. otherwise calls `assembleGraphVaultContext` and returns its string;
4. on any thrown error, logs a warning and returns `""`.

- **Chat** wraps the result in a `─── STUDENT KNOWLEDGE GRAPH / NOTEBOOK ───`
  header and appends it to `effectiveSystemRaw`, which then flows through
  `redactProviderText` so PII is masked before it leaves to the model.
- **Orchestrate** passes the string into `buildOrchestration(...)`, which threads
  it to `buildPromptPackage` as a **non-cacheable** context part
  (`role:"context", cacheable:false`) so it doesn't poison the prompt cache.

## Graceful degradation (by design)

No `studentId`, no `logseq_vault` consent, no vault, or no built graph all
collapse to an empty injection that never blocks a turn. During validation the
original hard `getStudentGraphStatus().built` gate was deliberately *relaxed*:
even without a built graph the vault pages are still injected, and the now-unused
`getStudentGraphStatus` import was removed. The net effect on tokens is a
reduction — the compact injection replaces broad per-turn re-derivation rather
than adding to it.

## Files touched

- `backend/context/graph-vault-context.js` — **new**; shared assembler +
  `collectVaultExcerpts` + `packSections`.
- `backend/council/context-builder.js` — imports the shared helpers; duplicated
  bodies and now-dead constants removed.
- `backend/server.js` — `buildGraphVaultInjection`, chat injection, orchestrate
  handler made `async`, `assembleGraphVaultContext` import.
- `backend/orchestration-engine.js` — `graphVaultContext` param on
  `buildOrchestration` / `buildPromptPackage`, added as a non-cacheable part.

## Validation

Orchestrate ran clean end-to-end. The chat **model** round-trip was not exercised
live because the mock account has no BYOK key (the chat route returns 503 before
injection when no key is configured); the injection logic itself was validated
directly against the seeded student via a Node one-liner that called
`buildGraphVaultInjection` and confirmed it returned the vault content (with
consent) and `""` (without consent). Comparing `api_usage_log` input tokens
before/after the injection is the intended token-reduction check once a BYOK key
is available.

# Logseq PII vault

## What it is

Each student now has their own Logseq markdown vault stored inside the PII store:

```
backend/data/student-storage/<sha256(studentId)>/vault/
  pages/      college-list.md, narrative.md, ec-evidence.md, ...
  journals/   YYYY-MM-DD.md
  logseq/     config.edn   (makes the folder a valid Logseq graph)
```

The markdown is **plaintext** — it has to be, because Logseq reads files
directly. The trust boundary is the hashed directory name plus OS disk
encryption, not field-level encryption. This is a deliberate trade documented in
the client header: the same vault is usable from Logseq desktop and from the
in-app notebook panel without a format conversion.

## Dual-mode client (filesystem-first)

`backend/logseq/api-client.js` reads and writes the vault two ways:

- **HTTP** — when Logseq desktop is running with the Local REST API community
  plugin and the student's endpoint + token are registered. `isLogseqLive()`
  probes the endpoint and caches the alive/dead decision per student for 30s.
- **Filesystem** — the default and robust path. When the endpoint is absent or
  the probe fails, the same `readPage` / `appendBlock` / `readJournal` /
  `writeJournalEntry` / `listPages` calls fall through to direct file I/O.

Path-safety is enforced at the filesystem layer, not just the route:
`safePageName()` strips `/`, `\`, and leading dots; `journalFilename()` throws
unless the date is strictly `YYYY-MM-DD`, so no crafted page name or date can
traverse out of `pages/` or `journals/`.

## Linking it per student (what this round added)

- **Credentials store.** A `logseq_credentials` table
  (`student_id PK, http_endpoint, token, updated_at`) in `counselor.db`, created
  in `mountPillarRoutes`. `resolveLogseqCreds(studentId)` returns the stored
  endpoint/token or `{}` (→ filesystem) when unset, so creds survive restarts and
  the default stays the robust filesystem path.
- **Config endpoint.** `PUT /api/students/:id/notebook/logseq-config`
  (auth + `ensureVaultConsent`) validates the endpoint against `^https?://`,
  slices the token to a sane length, clears on empty, and round-trips
  `{ok, configured}`.
- **Creds threaded through every caller.** `server-routes-pillars.js` now passes
  `resolveLogseqCreds(req.params.id)` into the notebook read/append routes and
  into the council's context builder, replacing the old empty `{}`.
- **Bootstrap + watch on init.** `POST /api/students/:id/notebook/init` calls
  `bootstrapStudentVault` and then `watchStudentVault(studentId, dataDir)` from
  `logseq/file-watcher.js`, so edits made directly in Logseq debounce-trigger an
  incremental graph rebuild. `unwatchAll()` is registered on server shutdown
  (the shutdown handler is now `async` and awaits it).
- **Journal route guards.** Notebook journal routes validate `:date` with
  `isValidJournalDate()` and return 400 on a bad date, in addition to the
  filesystem-layer check.

## Consent gating

The vault is only touched when the student has active `logseq_vault` consent
(`ensureVaultConsent` on the routes; `hasActiveConsent(..., "logseq_vault")` on
the injection path). End users are minors, so this gate is load-bearing, not
decorative.

## Citations

Vault content is cited as `[[logseq:page#block]]` and graph nodes as
`[[graph:nodeId]]`. The page half of a logseq citation resolves to
`pages/<page>.md` (or a `journals/YYYY-MM-DD.md` entry) via the same client, so a
citation works whether Logseq desktop is open or not.

## Files touched

- `backend/logseq/api-client.js` — `journalFilename()` strict-date guard applied
  in `readJournal` / `writeJournalEntry`.
- `backend/server-routes-pillars.js` — creds table + `resolveLogseqCreds`,
  `logseq-config` endpoint, init→watch, threaded creds, journal route guards.
- `backend/server.js` — `unwatchAll` on shutdown (async).
- `backend/logseq/file-watcher.js` — `watchStudentVault` / `unwatchAll` (reused).

## Validation

Against the mock student: `notebook/init` bootstrapped the vault; `college-list`,
`narrative`, and journal entries were appended and read back; `logseq-config`
round-tripped on set, clear, and invalid-endpoint cases. The vault read path and
filesystem fallback were confirmed live.

**Known gap:** building the graphify knowledge graph from the markdown corpus
needs an LLM for semantic extraction (a Gemini/Google key, or the `/graphify`
subagent flow) — neither was present in the validation environment, so a
full rebuild produced zero nodes. This is an environment limitation, not a code
bug; the injection path was deliberately made to degrade gracefully when the
graph is empty (see [chat-graph-vault-context](chat-graph-vault-context.md)).

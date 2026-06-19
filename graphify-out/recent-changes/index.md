# Recent changes

Hand-written summaries of the work landed in this round, written to sit alongside
the auto-generated `wiki/`. Where the wiki maps the *whole* graph, these pages
explain *what just changed and why* — each claim is grounded in the actual files
named, not in aspiration.

The through-line of this round: each student's data is now stored as their own
Logseq markdown vault inside the encrypted PII store, and that vault (plus the
knowledge graph built from it) is read by **both** the chat/generation models and
the 5-seat Strategy Council. The point is token economy — cite the student's
persistent structured memory instead of re-deriving context every turn.

## Pages

- [Embedded LLM stack](embedded-llm-stack.md) — zero-cost Qwen2.5-1.5B + bge-small
  embeddings, in-process via node-llama-cpp, with BYOK escalation.
- [Seasonal retrieval-first verification](seasonal-retrieval-first.md) — last-season
  stats refreshed from official sources only, each figure triple-checked or
  quarantined.
- [Logseq PII vault](logseq-pii-vault.md) — the per-student markdown vault, its
  filesystem-first / HTTP-optional client, consent gating, and how it is linked.
- [Chat + graph/vault context](chat-graph-vault-context.md) — the compact
  ~500-token injection added to `POST /api/chat` and `POST /api/agents/orchestrate`.
- [Strategy Council](strategy-council.md) — the 5-seat convening, the ~2k-token
  envelope it reads, and the audit trail it writes back to the vault.

## How to read these

Each page lists *what changed*, the *files touched*, and *how it was validated*.
"Validated" means run end-to-end against the mock student account
(`jungwonm_2026@gmail.com`) on a backend booted at `:3001`, except where a page
explicitly flags a gap (e.g. the graph build needs an LLM key that was not present
in the validation environment).

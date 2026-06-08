# Anthropic API Usage Compliance

## Commercial Use
This system uses the Anthropic API for commercial purposes under the Anthropic Usage Policy.

## Minor Safeguards

### BYOK Age Gate
Anthropic Terms of Service require users to be 18+ to create an account.
- `isBYOKAllowed()` in `pii-vault.js` blocks BYOK for minors
- Minors can only use the system via the server's shared API key
- Parent-provided keys are supported via `BYOK_PARENT_PROVIDED` consent type

### Content Safety
- All input is screened via `content-moderation.js` before reaching the API
- Crisis detection triggers immediate local response (no API call)
- Academic dishonesty and fraud requests are blocked
- Output is screened for leaked PII before returning to the client

## PII Handling with Anthropic

### What We Send
- Hashed student IDs (`hashStudentIdForProvider()`) — never raw email/name
- Academic profile data (GPA, test scores, courses) — not PII
- Activities and goals — not PII
- User queries (with PII redacted via `screenInput()`)

### What We Never Send
- Student names or email addresses
- SSN or FSA IDs (blocked at input screening)
- Parent/guardian contact information
- Financial account numbers
- Raw document content (redacted first via `redactDocumentForInference()`)

## Model Tiering
- **Haiku** (T1): Low-stakes coaching, general Q&A — cheapest, most calls
- **Sonnet** (T2): Essay review, strategy analysis — moderate cost
- **Opus** (T3): Complex regulated queries requiring high accuracy — <8% of total budget
- **T0 (Rules Engine)**: No API call at all — deterministic responses at $0

## Rate Limiting
- Server-side rate limiting prevents abuse (30 req/min per IP)
- Per-student usage tracking via `api_usage_log` table
- Opus usage capped at budget threshold via `checkOpusBudget()`

## Prompt Caching
- System instructions are designed for Anthropic's prompt caching
- FAFSA corpus uses long-lived cache entries to reduce costs
- Small-context retrieval keeps input tokens minimal

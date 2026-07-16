# Data Flow

## Local runtime

```text
React renderer
  -> Electron private proxy (127.0.0.1, random port)
  -> Express API (127.0.0.1, random port)
  -> encrypted PII vault / operational evidence stores
```

The renderer has no Node or filesystem access. Electron main owns operating
system secret storage and backend lifecycle. The backend is not reachable from
the LAN.

## Student authentication

Email and password are submitted to the local backend. Password and recovery
code become salted hashes. The email is encrypted in the PII vault and indexed
by a non-plaintext hash. Session tokens are random, stored hashed server-side,
and revocable per session or per student.

Every student resource derives identity from the authenticated session. Route
IDs are rejected when they do not match that identity.

## Administrator secrets

The administrator authenticates locally with an HttpOnly session and CSRF
token. Bootstrap/recovery and secret changes use privileged Electron IPC.
Electron verifies the backend admin session, validates provider keys against a
fixed endpoint, encrypts them with DPAPI or Keychain, and restarts the backend.
No response contains a secret value.

## Advice request

1. Screen input in memory for crisis, ghostwriting, credentials, and sensitive
   data.
2. Classify the topic and run deterministic FAFSA/deadline rules when
   applicable.
3. Retrieve relevant, current evidence.
4. For AI coaching, redact provider payloads and reserve worst-case cost.
5. Send only to `https://openrouter.ai/api/v1`.
6. Screen the output, reconcile cost, and compose claim-level lanes.
7. Encrypt chat/advice history before persistence.

Regulated requests without verified evidence return a limitation and official
source action instead of a model guess.

## External services

| Destination | Data | Gate |
| --- | --- | --- |
| OpenRouter | redacted coaching prompt | authenticated student, explicit consent, budget reservation |
| api.data.gov | college identifier/query | configured IPEDS key |
| allowlisted official education source | public source refresh | deterministic scheduled ingestion |

There is no general web search, arbitrary URL, student BYOK, parent email
notification, Logseq API, or remote counselor dashboard flow.

## Export and deletion

Export includes profile, consents, chats, advice claims and sources, deadlines,
Council output, usage, narratives, attachments, and legacy notebook Markdown.

Deletion revokes sessions and removes credentials, encrypted PII, operational
rows, evidence/vectors owned by the student, attachments, caches, exports, and
legacy notebook files. Success is returned only after all deletion steps
complete.

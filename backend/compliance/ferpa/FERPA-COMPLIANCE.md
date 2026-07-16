# Student Privacy and FERPA Posture

## Scope

This document describes product controls, not a legal certification or a
determination that FERPA does or does not apply in a particular situation.
College Counselor is a local desktop product used directly by a student or
family. It is not a school deployment and does not provide a school-official
mode.

## Access Boundaries

- Students sign in with their own email and password.
- Student records are scoped to the authenticated student.
- PII and chat content are encrypted at rest with AES-GCM.
- The local secrets administrator can manage only the encryption key,
  OpenRouter API key, and official College Scorecard API key.
- The administrator cannot browse student profiles, chats, essays, exports, or
  advice history.
- There is no remote administrator dashboard, counselor dashboard, parent
  email notification, or human review queue.

## External Processing

AI requests use OpenRouter only after the student gives explicit consent.
Identifying fields are redacted before external processing. The product does
not represent that redaction makes all submitted text anonymous; students
should avoid entering unnecessary identifying or credential information.

Institution data comes from the official College Scorecard source. Regulated
questions fail closed when current, relevant official evidence is unavailable.
AI output is advisory and is not a school record decision.

## Student Controls

An authenticated student can export their own stored data and request deletion
of their own account data. Legacy local Markdown notebooks can be exported
before an explicit deletion. Product logs must not expose student content,
credentials, encryption material, or provider keys.

## Deployment Limits

Schools or other institutions considering deployment would need a separate
legal, contractual, retention, access-control, and security assessment. This
repository does not implement those institutional requirements.

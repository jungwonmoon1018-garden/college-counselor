# FAFSA Advisory Posture

## Scope

FAFSA guidance is advisory only. College Counselor does not submit a FAFSA,
act as a preparer, make an aid determination, or accept FSA IDs, passwords,
Social Security numbers, tax credentials, or contributor credentials.

## Safety Controls

- Credential-like and sensitive identifier input is blocked before advice is
  generated.
- Deterministic rules are used where the repository has a current rule.
- A regulated FAFSA claim requires current, relevant official evidence.
- When official evidence is missing or stale, the system fails closed and
  directs the student to Federal Student Aid instead of inventing an answer.
- AI-generated facts, inferences, and coaching suggestions remain visibly
  distinct.
- There is no counselor or human review fallback.

Official FAFSA guidance should be verified at
https://studentaid.gov/ or through the Federal Student Aid contact channels
published there. The product must not preserve obsolete eligibility conditions
merely because they appeared in an earlier award year.

## Privacy and Processing

The product runs as a local desktop application with student email/password
authentication. PII and chat content are encrypted at rest with AES-GCM.
OpenRouter processing requires explicit consent, and identifying fields are
redacted before external processing. Students should not enter credentials or
unnecessary identifying information into free-form advice prompts.

The local secrets administrator manages only the encryption key, OpenRouter
API key, and official College Scorecard API key and cannot view student
content. There is no remote dashboard, parent email notification, or human
review queue.

Authenticated students can export and delete their own stored data. Institution
context, when used, comes from the official College Scorecard source; College
Scorecard data does not replace Federal Student Aid as the authority for FAFSA
rules.

## Maintenance

FAFSA rules and forms change by award year. Each release must verify rule text,
deadlines, contributor guidance, contacts, and citations against current
Federal Student Aid sources. This document is an engineering posture, not
financial or legal advice and not a compliance certification.

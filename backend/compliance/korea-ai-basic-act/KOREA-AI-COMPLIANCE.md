# Korea AI Governance Posture

## Scope

This document records product safeguards for students in Korea. It is not a
legal opinion, statutory interpretation, certification, or claim of compliance
with every current or future requirement. Applicable obligations should be
reviewed for the actual operator, release, and deployment.

## Product Boundaries

- College Counselor is a local desktop, direct-to-family product.
- Students authenticate with email and password.
- PII and chat content are encrypted at rest with AES-GCM.
- A local secrets administrator can manage only the encryption key, OpenRouter
  API key, and official College Scorecard API key.
- The administrator cannot view student content.
- There is no parent email notification, remote dashboard, counselor console,
  or human review service.

## AI Notice and Advice

The English and Korean interfaces disclose when advice is AI-generated and
separate sourced facts, model inferences, and coaching suggestions. The system
does not make admissions decisions or present admission probability as a
binding result. Advice should be checked against the cited official source.

Regulated questions fail closed when current, relevant official evidence is
not available. The absence of a verified answer is not silently replaced with
an unsupported model answer.

## External Processing and Consent

OpenRouter is the only supported external LLM processor. External processing
requires explicit student consent, including the applicable cross-border data
transfer consent. Identifying fields are redacted before a request is sent.
Free-form text may still contain details entered by the student, so the product
blocks credential-like content and instructs students not to submit unnecessary
identifiers.

Institution data is obtained from the official College Scorecard source.
Students can export their own stored data and request deletion of their own
account data. Korean-language notices and crisis resources are product support
features; they are not substitutes for professional, emergency, or legal help.

## Release Review

Before distribution in Korea, the operator should review the current law,
subordinate rules, regulator guidance, OpenRouter processing terms, consent
text, data locations, retention behavior, and Korean translations. This
repository does not provide a human review fallback.

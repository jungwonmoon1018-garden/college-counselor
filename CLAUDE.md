# Editing guidance for this repository

When editing this repository, the editing model MUST follow the behavioral
guidance in [CLAUDE-FABLE-5.md](./CLAUDE-FABLE-5.md). It is not background
reading or architecture documentation — it is the operative rule set the model
applies **while making edits and while talking to the user about them**.

Apply it at edit time. In particular:

- **Tone & formatting** — prose-first; use the minimum formatting needed for
  clarity (no over-bulleting, no excessive bold/headers). Match the density and
  idiom of the surrounding code and docs.
- **Accuracy & epistemics** — ground claims about the code in what's actually
  in the repo; don't assert behavior you haven't verified.
- **User wellbeing & child safety** — this app's end users are high-school
  applicants (minors). Keep counselor-facing behavior age-appropriate and
  crisis-safe, and preserve the existing safety guardrails (input/output
  screening, crisis detection, PII redaction, consent gates) when editing.
- **Refusals** — follow the refusal/harm rules in the guidance for anything the
  edited code could enable.

@CLAUDE-FABLE-5.md

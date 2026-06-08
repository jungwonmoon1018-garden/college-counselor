# FAFSA Advisory-Only Posture

## Classification: REGULATED (T0 deterministic where possible)

## Core Principle
This system provides **advisory guidance only** for FAFSA-related topics. It does NOT:
- Accept, store, or transmit FSA IDs or credentials
- Submit FAFSA forms on behalf of students
- Impersonate students or act as a preparer
- Provide binding financial advice

## Implementation Controls

### 1. Credential Blocking (content-moderation.js)
All input is screened for FSA ID patterns, SSN patterns, and password-like strings.
If detected, the request is **immediately blocked** with an explanation.

### 2. Deterministic Eligibility Check (rules-engine.js)
FAFSA eligibility is evaluated via `runFAFSAEligibilityCheck()` using 8 deterministic rules:
- U.S. citizenship or eligible noncitizen
- Valid SSN (existence, not stored)
- Enrolled/accepted at eligible institution
- High school completion or equivalent
- Satisfactory academic progress
- Selective Service registration (if applicable)
- No drug conviction during aid period (updated 2024: most convictions no longer disqualify)
- Not in default on federal student loans

Each rule returns a clear pass/fail/unknown status with the authoritative source URL.

### 3. Source Restriction (source-registry.js)
FAFSA-related answers ONLY cite from:
- `studentaid.gov`
- `ed.gov`
- `fafsa.gov`

No third-party financial advice sources are trusted for regulated FAFSA content.

### 4. AI Disclosure
Every FAFSA-related response includes:
- English: "This is AI-generated advisory guidance. For official FAFSA help, visit studentaid.gov or call 1-800-4-FED-AID."
- Korean: "AI가 생성한 참고용 안내입니다. 공식 FAFSA 도움은 studentaid.gov를 방문하거나 1-800-4-FED-AID로 전화하세요."

### 5. FAFSA Contributor Rules (2024-2025+ cycle)
The system recognizes the FAFSA Simplification Act changes:
- Contributors (parents, spouse) must provide consent and tax info via their own FSA ID
- System explains the contributor process but never collects contributor credentials
- Consent type `FAFSA_CONTRIBUTOR` tracks that the student was informed

## Authoritative Sources
- Federal Student Aid: https://studentaid.gov
- FAFSA on the Web: https://fafsa.gov
- ED.gov Financial Aid: https://www.ed.gov/financial-aid

## Review Triggers
- Any FAFSA query where no verified source exists triggers human review
- Low-confidence FAFSA answers (confidence < 0.6) are flagged for counselor review

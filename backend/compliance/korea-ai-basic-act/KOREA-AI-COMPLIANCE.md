# Korea AI Basic Act Compliance

## Overview
The Korea AI Basic Act (enacted 2025) establishes requirements for AI systems
operating in South Korea. As this system may serve Korean students and families,
the following compliance measures are implemented.

## 1. Prior Notice (Article 23)

### Implementation
- AI disclosure banner shown at session start
- Korean locale: "이 서비스는 인공지능(AI)을 사용하여 대학 진학 상담을 제공합니다"
- English locale: "This service uses artificial intelligence (AI) to provide college counseling guidance"
- Disclosure included in every API response via `ai_disclosure` field

### What is Disclosed
- That AI is being used
- That advice is advisory only (not binding)
- Which model generated the response
- That the system is AI-generated, not human counselor output

## 2. AI Labeling (Article 24)

### Implementation
- Every response includes `ai_disclosure.generated_by` field identifying the model
- Three-lane output clearly labels:
  - `verified_fact` — sourced from official data
  - `model_inference` — AI-generated with grounding
  - `coaching_suggestion` — AI opinion, clearly labeled
- Korean labels via `i18n.js`:
  - "확인된 사실" (verified fact)
  - "AI 추론" (AI inference)
  - "코칭 제안" (coaching suggestion)
  - "확인된 답변 없음" (no verified answer)

## 3. Explanation Capability (Article 25)

### Implementation
- Every response includes `explanation` object with:
  - `routing_logic` — how the query was classified and routed
  - `model_tier` — which model tier was used and why
  - `evidence_count` — how many evidence items informed the answer
  - `gates_applied` — what compliance gates were checked
  - `sources_used` — list of source URLs
- Korean explanation strings in `i18n.js`:
  - "이 답변이 어떻게 생성되었는지" (how this answer was generated)
  - "사용된 출처" (sources used)
  - "사용된 모델" (model used)
  - "라우팅 로직" (routing logic)

## 4. Human Oversight (Article 26)

### Implementation
- Review queue (`review-queue.js`) for human counselor oversight
- Automatic triggers for review:
  - Low confidence on regulated topics
  - No verified source found
  - School-integrated mode
  - Content flag from moderation
- Counselor dashboard (`/dashboard`) provides:
  - Real-time event monitoring
  - Review queue management
  - Crisis alert tracking
  - Audit export capability

## 5. Impact Assessment for Scoring (Article 27)

### No Desirability Scores
This system explicitly does NOT produce:
- Admissions probability scores
- Student ranking or scoring
- "Chance of admission" percentages

### What It Does Instead
- Multi-dimensional evidence profiles (leadership, service, research, etc.)
- Three evidence types never merged (official, preparation, inferred)
- Percentile context from national/cohort distributions
- College fit analysis across multiple dimensions (SAT fit, GPA fit, AP alignment, EC alignment)

### Risk Assessment
- Evidence typed as "inferred" (Type 3) is always labeled
- No single composite "desirability" score
- Students see dimensional profiles, not rankings
- System cannot be used for automated admissions decisions

## 6. Data Protection

### Cross-Border Transfer
- `CROSS_BORDER_TRANSFER` consent type for Korean students
- Student data sent to Anthropic API is:
  - PII-redacted
  - Student ID hashed
  - No names or emails in API calls
- Korean crisis hotlines included: 1393, 1577-0199

## Korean Locale Support
- All consent forms available in Korean
- Crisis resources include Korean hotlines
- AI disclosure in Korean
- Output labels in Korean
- Explanation capability in Korean

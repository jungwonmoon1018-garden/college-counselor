# College Counselor Backend — Architecture Redesign

**Date**: 2026-04-01
**Scope**: Full product architecture, legal/policy compliance, privacy/hallucination controls, admissions-intelligence layer, cost optimization
**Baseline**: Current codebase analysis (server.js, orchestration-engine.js, rag-engine.js, baseline-data.js, college-scorecard.js)

---

## PART 0: CURRENT STATE ASSESSMENT

### What Exists Today

| Layer | Status | Key Files |
|-------|--------|-----------|
| Express API (34 endpoints) | Functional | server.js (2150 lines) |
| Multi-agent orchestration | Keyword-based routing, PII masking, FAFSA grounding | orchestration-engine.js (1200 lines) |
| RAG engine | Structured profile retrieval, percentile baselines, change detection | rag-engine.js (900 lines) |
| Baseline data | GPA/SAT/ACT distributions, 2000+ college profiles, EC benchmarks | baseline-data.js, generated/college-profiles.generated.js |
| College Scorecard | Live API integration for 4000+ institutions | college-scorecard.js |
| Database | SQLite with WAL, AES-256-GCM encryption, audit logging | data/counselor.db |
| Security | Helmet, CORS, rate limiting, PII masking, encrypted emails/keys | server.js middleware |

### Critical Gaps Identified

1. **Model-first architecture**: All non-trivial queries route to Claude. No rules engine for deterministic logic.
2. **No source registry**: FAFSA corpus is a flat text file. No trusted-domain enforcement. No evidence provenance tracking.
3. **No PII vault separation**: Student PII (name_encrypted, email_hash) lives in the same SQLite database as profile snapshots and audit logs.
4. **No human review queue**: No mechanism for flagging legal, policy, or school-integrated decisions for human review.
5. **No answer composition from evidence objects**: The Strategist and Compliance Officer produce free-form LLM output without structured citation.
6. **No output labeling**: No distinction between verified facts, model inferences, and coaching suggestions in API responses.
7. **No Korea AI Basic Act compliance**: No prior notice, no output labeling, no explanation capability, no impact review.
8. **No parent/contributor surfaces**: Parental interaction is limited to one-way crisis alerts.
9. **Session tokens in-memory**: Not persistent across restarts.
10. **No vector store**: College matching uses hand-crafted scoring. No semantic search.
11. **Opus available but not gated**: `claude-opus-4-6` is in ALLOWED_MODELS but has no escalation-only routing.
12. **90-day audit retention**: May not meet FERPA 7-year institutional requirements.
13. **No diff-based monitoring**: No official-domain change detection for university pages.

---

## PART 1: PRODUCT ARCHITECTURE REDESIGN

### 1.1 Tiered Model Routing — Retrieval-and-Rules First

**Principle**: The default path for any query is retrieval + rules engine. Models are escalation layers.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        INCOMING REQUEST                             │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   POLICY ROUTER     │  (rules engine, no LLM)
                    │   Classify intent   │
                    │   Check topic type  │
                    │   Enforce gates     │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
     ┌────────▼───────┐ ┌─────▼──────┐ ┌───────▼────────┐
     │  DETERMINISTIC  │ │  RETRIEVAL │ │  MODEL TIER    │
     │  RULES ENGINE   │ │  + GROUNDED│ │  SELECTION     │
     │                 │ │  SYNTHESIS │ │                │
     │ - FAFSA workflow│ │            │ │ Haiku: route,  │
     │ - Deadline calc │ │ Source     │ │   extract,     │
     │ - Doc complete  │ │ Registry → │ │   classify,    │
     │ - Compliance    │ │ Evidence   │ │   moderate     │
     │   gating        │ │ Objects →  │ │                │
     │ - GPA percentile│ │ Answer     │ │ Sonnet: source-│
     │ - Eligibility   │ │ Composer   │ │   grounded     │
     │   checks        │ │            │ │   coaching,    │
     │                 │ │ [Citation  │ │   summary      │
     │ NO MODEL CALL   │ │  required] │ │                │
     │                 │ │            │ │ Opus: complex  │
     └────────┬────────┘ └─────┬──────┘ │   synthesis,   │
              │                │        │   conflict     │
              │                │        │   resolution,  │
              │                │        │   nuanced      │
              │                │        │   essay review  │
              │                │        └───────┬────────┘
              │                │                │
              └────────────────┼────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   ANSWER COMPOSER   │
                    │   Attach evidence   │
                    │   Label output type │
                    │   Apply disclosure  │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   RESPONSE WITH     │
                    │   - verified_facts[] │
                    │   - model_inferences[]│
                    │   - coaching[]       │
                    │   - sources[]        │
                    │   - ai_disclosure    │
                    └─────────────────────┘
```

### 1.2 Policy Router (New Module: `policy-router.js`)

The policy router is deterministic — no LLM call. It classifies every request into:

| Topic Type | Routing | Model Allowed | Source Constraint |
|------------|---------|---------------|-------------------|
| `regulated` (FAFSA, FERPA, eligibility, legal, compliance) | Rules engine first → retrieval from trusted sources only → Sonnet grounded synthesis if needed | No Opus unless human-escalated | Trusted domains only. No-source-no-answer enforced. |
| `high_stakes` (deadlines, school policies, financial aid amounts, scholarship eligibility) | Canonical fact store lookup → rules engine → retrieval if needed | Sonnet for synthesis, Haiku for extraction | Official source required. Speculative responses blocked. |
| `coaching` (EC strategy, essay brainstorming, activity suggestions, college list building) | Retrieval for evidence → Sonnet for grounded coaching | Sonnet default, Opus for complex cases | Evidence-grounded but coaching label applied. |
| `administrative` (profile updates, data export, account management) | Rules engine only | None | N/A |
| `crisis` (self-harm, abuse, emergency) | Immediate crisis protocol → parental notification → resources | None (deterministic response) | N/A |

**Escalation to Opus** requires ALL of:
1. Sonnet-tier synthesis attempted and flagged as insufficient (confidence < threshold)
2. Query involves cross-source conflict resolution, nuanced essay critique, or multi-factor admissions strategy
3. Student has active session (no anonymous Opus calls)
4. Per-student Opus budget not exceeded (configurable daily/monthly cap)

```javascript
// policy-router.js — Proposed structure
export function classifyTopic(query, conversationContext) {
  // Returns: { topicType, intent, sourceConstraint, modelTier, gates[] }
  // Pure rules — keyword patterns, regex, conversation state
  // No LLM call
}

export function enforceGates(topicType, availableEvidence) {
  // Returns: { allowed: boolean, reason: string, fallback: string }
  // For regulated topics: blocks response if no verified source
  // For high_stakes: requires canonical fact store match
}

export function selectModelTier(topicType, queryComplexity, priorAttempt) {
  // Returns: 'none' | 'haiku' | 'sonnet' | 'opus'
  // Opus only if priorAttempt.confidence < ESCALATION_THRESHOLD
}
```

### 1.3 Source Registry (New Module: `source-registry.js`)

Restricted to trusted domains for regulated topics.

```javascript
// source-registry.js — Proposed structure
const TRUSTED_DOMAINS = {
  fafsa: [
    'studentaid.gov',
    'fafsa.ed.gov',
    'ed.gov/offices/OSFAP',
  ],
  ferpa: [
    'ed.gov/policy/gen/guid/fpco',
    'studentprivacy.ed.gov',
  ],
  deadlines: [
    // Per-university official admissions pages (maintained in canonical fact store)
  ],
  financial_aid: [
    'studentaid.gov',
    'collegescorecard.ed.gov',
    // Per-university financial aid offices
  ],
  scholarships: [
    // Only verified scholarship program pages, not aggregator sites
  ],
};

export function isSourceTrusted(url, topicType) {
  // Returns: boolean
}

export function getSourcesForTopic(topicType) {
  // Returns: TrustedSource[]
}
```

### 1.4 Canonical Fact Store (New Module: `fact-store.js`)

Stores verified facts with provenance, expiration, and review status.

```javascript
// Database schema for canonical facts
CREATE TABLE IF NOT EXISTS canonical_facts (
  id TEXT PRIMARY KEY,
  topic_type TEXT NOT NULL,           -- 'fafsa', 'deadline', 'financial_aid', 'policy'
  entity_id TEXT,                      -- e.g., college IPEDS unit_id
  fact_key TEXT NOT NULL,              -- e.g., 'regular_decision_deadline'
  fact_value TEXT NOT NULL,            -- e.g., '2027-01-01'
  fact_type TEXT NOT NULL,             -- 'date', 'amount', 'boolean', 'text', 'url'
  source_url TEXT NOT NULL,            -- exact URL where fact was found
  source_domain TEXT NOT NULL,         -- domain for trust verification
  source_snapshot_hash TEXT,           -- SHA256 of page content at extraction time
  extracted_at TEXT NOT NULL,
  verified_at TEXT,                    -- NULL until human-verified or auto-verified
  verified_by TEXT,                    -- 'auto:diff_stable' | 'human:counselor_id'
  expires_at TEXT,                     -- after this date, fact requires re-verification
  confidence TEXT DEFAULT 'extracted', -- 'extracted' | 'verified' | 'stale' | 'disputed'
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_facts_topic ON canonical_facts(topic_type, entity_id, fact_key);
CREATE INDEX IF NOT EXISTS idx_facts_confidence ON canonical_facts(confidence, expires_at);
```

### 1.5 Rules Engine (New Module: `rules-engine.js`)

Handles deterministic logic without any model call.

**Covered workflows**:

| Workflow | Logic | Current State | Change Required |
|----------|-------|---------------|-----------------|
| FAFSA eligibility pre-check | Citizenship status, enrollment status, Selective Service, drug conviction rules | Not implemented | New |
| FAFSA contributor workflow | Step-by-step guided workflow with completeness checks | Not implemented | New |
| Deadline calculations | Days until, early/regular/rolling cutoffs | Partial (deadlines JSON lookup) | Expand to rules engine |
| Document completeness | Required docs per application type, missing-item checklist | Not implemented | New |
| GPA/test percentile lookup | Interpolate against baseline distributions | Exists in rag-engine.js | Refactor into rules engine |
| AP rigor index calculation | Tier-weighted course count | Exists in baseline-data.js | Refactor into rules engine |
| Financial aid net price estimate | COA - EFC - grants (deterministic formula) | Not implemented | New |
| Compliance gating | Topic × available evidence → allow/block decision | Not implemented | New |

```javascript
// rules-engine.js — Proposed exports
export function runFAFSAEligibilityCheck(studentData) { /* returns checklist with pass/fail per rule */ }
export function runDocumentCompletenessCheck(applicationId, submittedDocs) { /* returns missing items */ }
export function calculateDeadlineStatus(collegeId, applicationType) { /* returns days_remaining, status */ }
export function computePercentile(metric, value, scope) { /* deterministic interpolation */ }
export function computeAPRigorIndex(courses) { /* deterministic calculation */ }
export function estimateNetPrice(collegeId, familyIncome, dependents) { /* COA - EFC formula */ }
export function evaluateComplianceGate(topicType, evidenceObjects) { /* allow/block + reason */ }
```

### 1.6 Answer Composer (New Module: `answer-composer.js`)

Assembles final responses with structured output lanes.

```javascript
// Response schema returned by answer composer
{
  "response_id": "uuid",
  "timestamp": "ISO8601",
  "topic_type": "regulated | high_stakes | coaching | administrative",
  "model_used": "none | haiku | sonnet | opus",

  // Three output lanes — UI renders these distinctly
  "verified_facts": [
    {
      "statement": "The FAFSA deadline for the 2026-2027 cycle is June 30, 2027.",
      "source": {
        "url": "https://studentaid.gov/apply-for-aid/fafsa/fafsa-deadlines",
        "domain": "studentaid.gov",
        "extracted_at": "2026-03-15T00:00:00Z",
        "confidence": "verified"
      },
      "fact_id": "ref to canonical_facts.id"
    }
  ],

  "model_inferences": [
    {
      "statement": "Based on your GPA and test scores, you appear competitive for...",
      "label": "AI-generated inference",
      "grounding_sources": ["fact_id_1", "fact_id_2"],
      "model": "sonnet",
      "confidence_note": "This is a model-generated assessment, not an admissions decision."
    }
  ],

  "coaching_suggestions": [
    {
      "statement": "Consider adding a research experience to strengthen your STEM profile.",
      "label": "Non-binding coaching suggestion",
      "basis": "EC benchmarks for STEM applicants show 45% research participation."
    }
  ],

  // Evidence panel data
  "sources": [
    { "url": "...", "title": "...", "domain": "...", "accessed": "...", "trust_level": "official | verified | inferred" }
  ],

  // Session-level AI disclosure
  "ai_disclosure": {
    "session_disclosure": "This response was generated with AI assistance. Verified facts are sourced from official publications. Inferences and suggestions are AI-generated and should not be treated as professional advice.",
    "model_disclosure": "Model: Claude Sonnet 4.6 via Anthropic API",
    "content_labels": {
      "verified_facts_count": 1,
      "model_inferences_count": 1,
      "coaching_suggestions_count": 1
    }
  },

  // Official-source mode indicator
  "official_source_mode": {
    "active": true,
    "topic": "fafsa",
    "no_verified_answer_items": []  // If non-empty, these items had no verified source
  }
}
```

**Official-Source Mode**: For FAFSA, FERPA, deadlines, scholarships, and other high-stakes topics:
- If `canonical_facts` has no verified entry for the requested fact → return `"no_verified_answer_available": true` for that item
- Never generate speculative content in official-source mode
- UI should render this as: "No verified answer available for this question. Please consult [official source link] directly."

### 1.7 Human Review Queue (New Module: `review-queue.js`)

```javascript
// Database schema
CREATE TABLE IF NOT EXISTS review_queue (
  id TEXT PRIMARY KEY,
  created_at TEXT DEFAULT (datetime('now')),
  review_type TEXT NOT NULL,         -- 'legal', 'policy', 'school_integration', 'fact_dispute', 'content_flag'
  priority TEXT DEFAULT 'normal',    -- 'urgent', 'normal', 'low'
  status TEXT DEFAULT 'pending',     -- 'pending', 'in_review', 'approved', 'rejected', 'escalated'

  -- Context
  student_id TEXT,                   -- may be NULL for system-level reviews
  query_text TEXT,                   -- the original query (redacted)
  proposed_response TEXT,            -- what the system would have returned
  model_used TEXT,
  topic_type TEXT,

  -- Evidence
  evidence_objects_json TEXT,        -- the evidence used to compose the response
  missing_sources TEXT,              -- sources that were expected but not found
  confidence_score REAL,             -- model's self-reported confidence

  -- Review
  reviewer_id TEXT,
  reviewer_notes TEXT,
  reviewed_at TEXT,
  disposition TEXT,                  -- 'release', 'edit_and_release', 'block', 'escalate'

  -- Tracking
  resolved_at TEXT,
  resolution_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_review_status ON review_queue(status, priority, created_at);
```

**Triggers for human review**:
1. Model confidence below threshold on regulated topics
2. Cross-source conflict detected in canonical facts
3. School-integrated deployment: any response touching school-specific policies
4. Legal/compliance topics with no verified source
5. Content moderation flags (not crisis — crisis has its own protocol)
6. Student or parent disputes a fact

### 1.8 Frontend Surface Guidance

The API should support these frontend surfaces (frontend implementation is separate, but the API must provide the data):

**Student Surface**:
- Guided workflows (not open-ended chat) for: FAFSA, college list building, essay planning, EC strategy, deadline tracking
- Evidence panel on every response showing sources
- Three-lane output rendering (verified / inference / coaching)
- Session-level AI disclosure banner
- "Official source mode" indicator when active
- Progress tracker tied to milestones

**Parent/Contributor Surface**:
- FAFSA contributor workflow (separate guided flow)
- Financial aid information viewer (read-only student data with consent)
- Crisis notification settings
- AI disclosure and data practices summary
- No direct model interaction — structured forms only

**Counselor Surface** (existing dashboard, expanded):
- Human review queue management
- Fact dispute resolution
- Student progress oversight (with institutional authorization)
- Audit log viewer (existing)
- Source registry management

---

## PART 2: LEGAL AND POLICY ANALYSIS

### 2.1 FAFSA Analysis

**Assumption**: System is advisory and document-assisted only. It does NOT submit forms, request StudentAid.gov credentials, or act on behalf of users.

| Requirement | Implementation | Status |
|-------------|---------------|--------|
| **No credential collection** | System must never request, store, or proxy StudentAid.gov login credentials. No FSA ID fields in any form. | NOT YET ENFORCED — add explicit input validation that rejects credential-shaped data. |
| **No submission on behalf** | System provides guidance and document preparation only. All FAFSA submissions are performed by the user on StudentAid.gov directly. | COMPLIANT by design — no submission endpoint exists. Add explicit disclosure. |
| **No contributor impersonation** | Parent/contributor surface must authenticate the contributor independently. System must never allow a student to act as a contributor or vice versa. | NOT IMPLEMENTED — contributor surface does not exist yet. |
| **No account sharing** | Each user session is single-identity. System must not facilitate sharing of StudentAid.gov accounts or FSA IDs. | PARTIALLY COMPLIANT — session tokens are per-emailHash, but no explicit prohibition in UI. |
| **FAFSA Submission Summary as sensitive data** | If a student uploads or references their FAFSA Submission Summary (SAR), treat as highly sensitive financial data: encrypt at rest, do not persist in model context, redact before any LLM call, short retention. | PARTIALLY IMPLEMENTED — PII masking exists for financial figures, but no specific SAR handling or document classification. |
| **Tax-derived contributor data** | Any data from contributor tax returns (W-2, 1040, etc.) must be treated as IRS-grade sensitive: encrypt at rest, never sent to LLM, never logged, deleted after workflow completion. | NOT IMPLEMENTED — no document upload classification system. |
| **Aid letter information** | Financial aid award letters contain sensitive institutional offers. Encrypt at rest, do not use for cross-student comparison, redact before LLM calls. | NOT IMPLEMENTED — no aid letter ingestion pathway. |
| **Advisory-only disclosure** | Every FAFSA-related response must include disclosure that this is not an official FAFSA tool and does not replace StudentAid.gov. | NOT IMPLEMENTED — add to answer composer for `topic_type: regulated` + `topic: fafsa`. |

**Required FAFSA safeguards for the redesign**:
1. Add `DocumentClassifier` to detect and tag FAFSA-related uploads (SAR, aid letters, tax docs)
2. Enforce `SENSITIVE_FINANCIAL` classification → encrypt, short retention (72h), no LLM forwarding of raw content
3. FAFSA workflow must be guided (step-by-step) not chat-based
4. Every FAFSA response includes advisory-only disclosure
5. Rules engine handles FAFSA eligibility checks — no model speculation on eligibility
6. Contributor workflow is a separate authenticated surface

### 2.2 FERPA Analysis

**Distinction**: Direct-to-family consumer product vs. school-integrated deployment.

#### Consumer Product (Direct-to-Family)

| Factor | Analysis |
|--------|----------|
| **FERPA applicability** | FERPA regulates educational agencies and institutions that receive federal funding, not direct-to-consumer products. A student or parent voluntarily providing their own data to a consumer tool is NOT a FERPA-regulated disclosure. |
| **However** | If the system ingests school records (transcripts, report cards) uploaded by the student/parent, those records originated from a FERPA-covered institution. The system should treat them with FERPA-grade care even though it is not legally required to, as a best practice and trust signal. |
| **Recommendation** | Treat all school-originated documents with FERPA-equivalent protections: encrypt at rest, purpose-limited use, no redisclosure, deletion on request. Label this as "FERPA-equivalent voluntary protections" in privacy policy. |

#### School-Integrated Deployment

| Requirement | Implementation Needed |
|-------------|----------------------|
| **School official exception (34 CFR 99.31(a)(1))** | System must be designated as a "school official" with "legitimate educational interest." Requires: (1) written agreement with institution, (2) direct institutional control over data use, (3) purpose limitation to educational services, (4) compliance with institution's FERPA policies. |
| **Institutional control** | School must have admin access to configure what data the system can access, what functions are available, and what model interactions are permitted. Add `institution_config` table and admin API. |
| **Purpose limitation** | System may only use student education records for the specific educational purpose defined in the institutional agreement. No cross-institution data sharing. No use for marketing. No model training. |
| **Redisclosure controls** | System must not disclose student education records to any third party without meeting FERPA redisclosure exceptions. This includes: model providers (Anthropic), analytics services, parent notifications (except as permitted). |
| **Model provider as subprocessor** | Anthropic receives student data via API calls. Under FERPA, this makes Anthropic a subprocessor. Required: (1) Anthropic DPA/BAA equivalent for FERPA, (2) data minimization before API calls, (3) no model training on student data (Anthropic API TOS confirms this), (4) documented in institutional agreement. |
| **Directory information** | Even in school-integrated mode, the system should not treat any student data as "directory information" (publicly releasable) unless the institution explicitly designates it as such. |
| **Retention** | FERPA requires institutions to maintain records of disclosures for inspection. Audit logs must be retained for the institutional relationship duration + 5 years minimum. Current 90-day retention is INSUFFICIENT for school-integrated mode. |
| **Parent/eligible student rights** | Right to inspect records: data export endpoint (exists). Right to amend: add dispute/correction workflow. Right to consent: add explicit consent management per data category. |

**Required FERPA safeguards for school-integrated mode**:
1. `institutions` table with institutional agreements, configuration, and admin accounts
2. Per-institution data isolation (tenant separation)
3. Audit log retention extended to institutional requirement (minimum 5 years)
4. Anthropic DPA/subprocessor documentation
5. Consent management per data category
6. Record amendment/dispute workflow
7. Redisclosure controls enforced at API layer

### 2.3 Anthropic Commercial/API Usage Analysis

**Assumption**: Commercial API usage through the product operator's account (not consumer Claude.ai accounts used directly by minors).

| Requirement | Source | Implementation |
|-------------|--------|----------------|
| **Acceptable Use Policy** | Anthropic AUP | System must not generate content that violates AUP: no deceptive practices, no impersonation of official entities, no unauthorized practice of professional advice (legal, medical, financial). Advisory-only framing required. |
| **Minor safety** | Anthropic Usage Policy for minors | When the system knows the user is a minor (high school student): (1) age-appropriate content filtering, (2) no collection of unnecessary personal data, (3) parental notification capabilities, (4) enhanced content moderation, (5) no behavioral profiling for non-educational purposes. |
| **Disclosure of AI** | Anthropic Usage Policy | Users must be informed they are interacting with AI. Session-level disclosure required. AI-generated content must be labeled. |
| **Human oversight for high-risk advice** | Anthropic Usage Policy | Financial aid guidance, college admissions strategy, and any advice that could materially affect a minor's educational trajectory requires human oversight mechanisms. Human review queue satisfies this. |
| **Moderation** | Anthropic Usage Policy | Input and output moderation required. Current system has PII masking but no content moderation (beyond crisis detection). Add content moderation layer. |
| **No model training** | Anthropic API TOS | API inputs are not used for model training by default. Confirm this is documented in privacy policy. |
| **Data processing** | Anthropic DPA | If processing EU/EEA personal data: Anthropic DPA required. If processing Korean personal data: Korean PIPA considerations apply. Document data flows. |
| **BYOK implications** | Current system allows students to use personal API keys. This means the student's Anthropic account TOS applies, not the operator's. | For minors: BYOK should be disabled or restricted to parent-provided keys with explicit consent. Anthropic TOS requires users to be 18+ for account creation. A minor using their own API key may violate Anthropic TOS. |

**Required Anthropic safeguards**:
1. Disable BYOK for users identified as minors (under 18), or require parental-provided keys with consent
2. Add content moderation layer (input + output) beyond current PII masking
3. Session-level AI disclosure on every response
4. AI-generated content labels in response schema
5. Human review queue for high-risk advice categories
6. Document Anthropic as subprocessor in privacy policy
7. Advisory-only framing enforced for all financial, legal, and admissions guidance

### 2.4 Korea AI Basic Act Analysis

**Posture**: Conservative compliance appropriate for a system used by Korean high school students. The AI Basic Act (enacted 2025, enforcement phased) establishes obligations for AI systems affecting individuals, with heightened requirements for systems involving minors and educational decisions.

| Requirement | Implementation |
|-------------|----------------|
| **Prior notice of AI use** | Before any AI interaction, user must be notified that AI is being used. Implement: (1) onboarding disclosure screen, (2) session-level banner, (3) per-response `ai_disclosure` field. Localize to Korean (i18n.js already supports Korean locale). |
| **Labeling of AI-generated outputs** | All AI-generated content must be clearly labeled. The three-lane output structure (verified_facts / model_inferences / coaching_suggestions) satisfies this when the UI renders labels. Add `generated_by: 'ai'` metadata to all model outputs. |
| **Explanation capability** | Users must be able to request an explanation of how an AI-generated output was produced. Implement: (1) per-response `explanation` field showing which sources were used, which model was invoked, and what the routing logic was, (2) "Why this answer?" button support in API. |
| **Human oversight** | AI systems affecting individuals must have human oversight mechanisms. The human review queue, counselor dashboard, and escalation protocols satisfy this. Document the oversight chain. |
| **Compliance documentation** | Maintain documentation of: AI system description, intended purpose, risk assessment, data processing practices, oversight mechanisms, complaint handling procedures. Create `compliance/korea-ai-basic-act/` directory with required documents. |
| **Risk management** | Document risk assessment for the AI system. For a system advising minors on education: classify as elevated risk. Document mitigations (source grounding, human review, official-source mode, advisory-only framing). |
| **Impact review for ranking/scoring** | If the system produces any ranking, scoring, or screening of students or colleges, an impact review is required. College matching (`/api/rag/college-match`) produces fit scores. EC strategy may imply activity ranking. Implement: (1) document impact assessment for scoring features, (2) add explanation capability to all scoring outputs, (3) consider opt-in for scoring features. |
| **Data protection (PIPA alignment)** | Korea's Personal Information Protection Act applies. Minimum necessary data collection, purpose limitation, consent management, cross-border transfer documentation (data sent to Anthropic US servers). |
| **Minor-specific protections** | Heightened protections for minors: parental consent for data processing, age verification, restricted data collection, no behavioral profiling. |

**Required Korea AI Basic Act safeguards**:
1. Korean-language AI disclosure (add to i18n.js)
2. `explanation` field in answer composer response
3. `compliance/korea-ai-basic-act/` documentation directory
4. Impact assessment document for scoring features
5. Cross-border data transfer documentation (Korea → US/Anthropic)
6. Parental consent flow for Korean minor users
7. Per-response `generated_by` metadata

---

## PART 3: PRIVACY AND HALLUCINATION CONTROLS

### 3.1 No-Source-No-Answer Rule

For all high-stakes topics (`regulated` and `high_stakes` topic types):

```javascript
// In answer-composer.js
function composeRegulatedAnswer(query, evidenceObjects, topicType) {
  // Step 1: Check if evidence exists for the query
  const relevantEvidence = evidenceObjects.filter(e =>
    e.confidence !== 'stale' &&
    e.source_domain &&
    isSourceTrusted(e.source_domain, topicType)
  );

  if (relevantEvidence.length === 0) {
    return {
      verified_facts: [],
      model_inferences: [],
      coaching_suggestions: [],
      official_source_mode: {
        active: true,
        topic: topicType,
        no_verified_answer_items: [{
          query_aspect: query,
          message: "No verified answer available for this question.",
          suggested_source: getSuggestedOfficialSource(topicType),
          reason: "No official source matched this query in our verified database."
        }]
      }
    };
  }

  // Step 2: Compose ONLY from evidence objects
  // Model may synthesize/summarize but cannot add claims not in evidence
  // ...
}
```

### 3.2 Three Output Lanes

Every API response must separate:

| Lane | Definition | Source Requirement | UI Treatment |
|------|------------|-------------------|--------------|
| `verified_facts` | Statements extracted directly from official sources with citation | Must have `canonical_facts` entry with `confidence: 'verified'` | Rendered as factual, with source link |
| `model_inferences` | Model-generated analysis grounded in verified data | Must reference specific evidence objects | Labeled "AI-generated inference" |
| `coaching_suggestions` | Non-binding guidance and recommendations | May use broader evidence base + model knowledge | Labeled "Suggestion — not professional advice" |

### 3.3 Deterministic Handlers (Rules Engine Priority)

Before any model call, check if the query can be handled deterministically:

| Query Type | Deterministic Handler | Model Needed? |
|------------|----------------------|---------------|
| "When is the deadline for X?" | `fact-store.js` → `canonical_facts` lookup | No |
| "Am I eligible for FAFSA?" | `rules-engine.js` → eligibility checklist | No |
| "What's my GPA percentile?" | `rules-engine.js` → `computePercentile()` | No |
| "What documents do I need?" | `rules-engine.js` → `runDocumentCompletenessCheck()` | No |
| "What's the net price of X?" | `rules-engine.js` → `estimateNetPrice()` | No |
| "Compare colleges A, B, C" | `college-scorecard.js` + `rules-engine.js` | No (structured comparison) |
| "Help me brainstorm essay topics" | Retrieval + Sonnet | Yes (coaching lane) |
| "Review my essay draft" | Retrieval + Sonnet → Opus if complex | Yes |
| "What ECs should I add?" | Retrieval + Sonnet (grounded in benchmarks) | Yes (coaching lane) |

### 3.4 PII Architecture — Vault Separation

**Current state**: PII (name_encrypted, email_hash) is in the same SQLite DB as profiles, snapshots, and audit logs.

**Redesign**: Separate PII vault from operational data.

```
┌─────────────────────────────────┐    ┌─────────────────────────────────┐
│     PII VAULT (pii-vault.db)     │    │    OPERATIONAL DB (counselor.db) │
│     Encrypted at rest (AES-256)  │    │    Standard SQLite with WAL      │
│     Strict access controls       │    │                                  │
│                                  │    │                                  │
│  students_pii:                   │    │  students:                       │
│    student_id (FK)               │    │    id (PK)                       │
│    name_encrypted                │◄──►│    student_id_hash               │
│    email_encrypted               │    │    grade, state, school_domain   │
│    parent_email_encrypted        │    │    major_interest                │
│    phone_encrypted               │    │                                  │
│    address_encrypted             │    │  profile_snapshots               │
│    ssn_hash (if ever needed)     │    │  milestones                      │
│    dob_encrypted                 │    │  capability_timeline             │
│                                  │    │  canonical_facts                 │
│  consent_records:                │    │  review_queue                    │
│    student_id                    │    │  audit_events                    │
│    consent_type                  │    │  api_usage_log                   │
│    granted_at                    │    │                                  │
│    expires_at                    │    │  (NO PII in this database)       │
│    revoked_at                    │    │                                  │
│                                  │    │                                  │
│  document_vault:                 │    │  vector_store (separate):        │
│    doc_id                        │    │    embedding_id                  │
│    student_id                    │    │    vector BLOB                   │
│    doc_type (sar, aid_letter)    │    │    metadata_json                 │
│    content_encrypted             │    │    source_id (FK to facts)       │
│    retention_expires_at          │    │    (NO PII in vectors)           │
│    auto_delete: true             │    │                                  │
└─────────────────────────────────┘    └─────────────────────────────────┘
```

**Access rules**:
- PII vault is accessed ONLY by: (1) authentication flows, (2) notification sender, (3) data export, (4) data deletion
- PII vault is NEVER accessed by: model context assembly, RAG retrieval, vector search, audit queries
- Model context uses `[STUDENT]` placeholder, never real names
- Logs use `student_id_hash`, never email or name

### 3.5 Data Minimization for Minors

| Control | Implementation |
|---------|---------------|
| Minimum necessary collection | Registration collects only: email (hashed), grade, state, major interest. Name is optional. |
| Redact before inference | Documents are redacted (names, addresses, SSN, financial figures) before any content is sent to a model. Only extracted structured data is used in model context. |
| No persistent memory by default for minors | Conversation history is NOT persisted between sessions for users identified as minors. Each session starts fresh. User may opt-in to session persistence with parental consent. |
| Short retention windows | Uploaded documents: 72 hours then auto-deleted. Conversation logs: 30 days then purged. Profile data: retained until deletion requested. Audit logs: per compliance requirement (90 days consumer, 5+ years institutional). |
| Separate logs from identity | Audit logs use `student_id_hash` (one-way hash of student_id). Cannot be reversed to identify student without PII vault access. |
| Hash user identifiers to model providers | When sending requests to Anthropic API, use `metadata.user_id = SHA256(student_id + salt)`. Never send email, name, or raw student_id to Anthropic. |
| Vector store isolation | Vector store contains only: embeddings of official sources, college descriptions, and anonymized benchmarks. No student PII in vectors. Logically and physically separate from PII vault. |

### 3.6 Hallucination Bounding — Not Elimination

**Design objective**: The system does not claim to eliminate hallucination. It bounds generation so that hallucinated content cannot appear in the `verified_facts` lane and is always labeled in other lanes.

| Layer | Hallucination Control |
|-------|----------------------|
| Verified facts | Can ONLY be populated from `canonical_facts` with `confidence: 'verified'`. Model cannot add to this lane. |
| Model inferences | Must reference specific evidence objects. Answer composer validates that every claim in this lane has a grounding source. If a model output contains a claim without grounding, it is moved to coaching or dropped. |
| Coaching suggestions | Labeled as AI-generated. May use broader model knowledge. User is warned these are suggestions, not facts. |
| Official-source mode | No model generation at all for the factual component. Only retrieval from canonical fact store. Model may explain or summarize retrieved facts but cannot add new claims. |
| Confidence scoring | Every model output includes a self-assessed confidence. Below threshold → human review queue. |

---

## PART 4: EXTRACURRICULARS AND ADMISSIONS INTELLIGENCE REDESIGN

### 4.1 Why Not a Universal "What Universities Want" Model

The current system's EC benchmarks (baseline-data.js) assume universal patterns: "STEM applicants should have 45% research participation." This is:

1. **Not supported by official evidence** — universities rarely publish explicit EC requirements
2. **Unstable** — admissions priorities change yearly, vary by reader, and differ across programs
3. **Misleading** — presenting inferred patterns as institutional requirements is deceptive
4. **Legally risky** — if the system implies "MIT wants X" without official source, this is a falsifiable claim

### 4.2 Typed Evidence Graph

Replace the flat EC benchmark tables with a typed evidence graph that explicitly distinguishes evidence types.

```
┌─────────────────────────────────────────────────────────────────────┐
│                     EVIDENCE GRAPH                                   │
│                                                                      │
│  ┌─────────────────────────────────────────────┐                    │
│  │  TYPE 1: OFFICIAL EXPLICIT SIGNALS           │                    │
│  │  Source: University websites, CDS, catalogs   │                    │
│  │  Trust: HIGH — directly attributable          │                    │
│  │                                               │                    │
│  │  Examples:                                    │                    │
│  │  - "MIT values demonstrated interest in       │                    │
│  │    STEM through research or projects"         │                    │
│  │    (source: MIT admissions page, 2026-03-01)  │                    │
│  │  - "Stanford holistic review considers        │                    │
│  │    intellectual vitality"                      │                    │
│  │    (source: Stanford admissions FAQ)          │                    │
│  │  - "UMich Ross requires 2 essays on           │                    │
│  │    business interest"                          │                    │
│  │    (source: Ross BBA application page)        │                    │
│  └─────────────────────────────────────────────┘                    │
│                                                                      │
│  ┌─────────────────────────────────────────────┐                    │
│  │  TYPE 2: PROGRAM-PREPARATION SIGNALS         │                    │
│  │  Source: Curriculum guides, prerequisites     │                    │
│  │  Trust: MEDIUM-HIGH — objective preparation   │                    │
│  │                                               │                    │
│  │  Examples:                                    │                    │
│  │  - CS programs generally expect: AP CS A,     │                    │
│  │    math through calculus, programming projects│                    │
│  │  - Art programs require: portfolio (12-20     │                    │
│  │    pieces), artist statement                  │                    │
│  │  - Pre-med preparation: biology, chemistry,   │                    │
│  │    research experience recommended            │                    │
│  │  - Music: audition required for performance   │                    │
│  │    majors at most conservatories              │                    │
│  └─────────────────────────────────────────────┘                    │
│                                                                      │
│  ┌─────────────────────────────────────────────┐                    │
│  │  TYPE 3: INFERRED / NON-OFFICIAL PATTERNS    │  ⚠ ALWAYS LABELED │
│  │  Source: Class profiles, counselor heuristics │                    │
│  │  Trust: LOW — patterns, not requirements      │                    │
│  │                                               │                    │
│  │  Examples:                                    │                    │
│  │  - "Harvard Class of 2029 profile: 83%        │                    │
│  │    held leadership positions"                  │                    │
│  │    (source: Harvard CDS, descriptive only)    │                    │
│  │  - "Counselor heuristic: T20 STEM admits      │                    │
│  │    commonly show research experience"          │                    │
│  │    (source: aggregated counselor surveys)     │                    │
│  │  - "Historical pattern: acceptance rates       │                    │
│  │    for ED are higher than RD at selective     │                    │
│  │    schools"                                    │                    │
│  │    (source: CDS data, descriptive trend)      │                    │
│  │                                               │                    │
│  │  ⚠ NEVER merged with Type 1 claims            │                    │
│  │  ⚠ ALWAYS rendered with "pattern" label        │                    │
│  │  ⚠ NEVER presented as institutional requirement│                    │
│  └─────────────────────────────────────────────┘                    │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.3 Database Schema for Evidence Graph

```sql
CREATE TABLE IF NOT EXISTS evidence_items (
  id TEXT PRIMARY KEY,
  evidence_type INTEGER NOT NULL,    -- 1=official, 2=preparation, 3=inferred

  -- What entity does this evidence relate to?
  entity_type TEXT NOT NULL,          -- 'university', 'program', 'major_field', 'general'
  entity_id TEXT,                     -- IPEDS unit_id for universities, program identifier, etc.
  entity_name TEXT,

  -- The evidence itself
  claim TEXT NOT NULL,                -- the factual claim
  claim_category TEXT,               -- 'admissions_criteria', 'preparation', 'class_profile',
                                     -- 'deadline', 'requirement', 'heuristic', 'trend'

  -- Source provenance
  source_url TEXT,
  source_domain TEXT,
  source_title TEXT,
  source_accessed_at TEXT,
  source_snapshot_hash TEXT,          -- SHA256 of source page at time of extraction

  -- Trust and lifecycle
  trust_level TEXT NOT NULL,          -- 'official', 'verified', 'inferred', 'disputed'
  confidence REAL,                    -- 0.0-1.0
  verified_at TEXT,
  verified_by TEXT,
  expires_at TEXT,
  superseded_by TEXT,                 -- points to newer evidence_item if updated

  -- Metadata
  academic_year TEXT,                 -- '2026-2027'
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_evidence_entity ON evidence_items(entity_type, entity_id, evidence_type);
CREATE INDEX IF NOT EXISTS idx_evidence_category ON evidence_items(claim_category, evidence_type);
CREATE INDEX IF NOT EXISTS idx_evidence_trust ON evidence_items(trust_level, expires_at);
```

### 4.4 Evidence Dimensions (Not Desirability Scores)

Replace the current single-score college matching with multi-dimensional evidence vectors.

| Dimension | Definition | Source Type | Measurement |
|-----------|-----------|-------------|-------------|
| `leadership` | Demonstrated leadership roles and scope | Type 2 (preparation) + Type 3 (patterns) | Count of leadership roles × scope (club/school/regional/national) |
| `service` | Community service and social impact | Type 2 + Type 3 | Hours + sustained commitment indicator |
| `sustained_commitment` | Multi-year dedication to activities | Type 1 (some schools explicitly value this) + Type 2 | Years of participation per activity |
| `field_preparation` | Major-specific coursework, projects, experience | Type 1 (prerequisites) + Type 2 | Checklist completion against program requirements |
| `research_creative_output` | Research papers, publications, creative portfolios | Type 2 (program expectations) | Output count + venue quality |
| `work_family_responsibility` | Employment, family caregiving, financial contribution | Type 1 (holistic review acknowledgment) | Hours + context |
| `context_opportunity_constraints` | First-gen status, resource limitations, geographic constraints | Type 1 (many schools explicitly consider) | Binary indicators + narrative |
| `major_specific_evidence` | Demonstrated interest in intended major | Type 1 + Type 2 | Courses + activities + projects aligned to major |
| `mission_fit` | Alignment with specific institution's stated mission | Type 1 (mission statements) | Qualitative alignment indicators |

**Vectorization applies to these dimensions, not to a combined score.** The system shows a student their profile across dimensions, compared to what each school officially values (Type 1) and what preparation typically looks like (Type 2).

### 4.5 Official Domain Monitoring

```javascript
// domain-monitor.js — Proposed structure

const MONITORED_PAGE_CATEGORIES = [
  'admissions',           // admissions.{university}.edu
  'financial_aid',        // finaid.{university}.edu, financial-aid pages
  'department_majors',    // department pages, major requirements
  'application_faq',      // application process FAQ pages
  'policy',               // institutional policies relevant to applicants
  'deadlines',            // application deadline pages
];

// Change detection workflow
export async function runDailyMonitor() {
  // 1. For each monitored university + page category:
  //    a. Fetch current page content
  //    b. Compute SHA256 hash
  //    c. Compare to stored source_snapshot_hash
  //    d. If changed: extract diff, create review_queue entry

  // 2. Diff-based re-indexing (NOT full recrawl):
  //    a. Only re-process pages where hash changed
  //    b. Extract new/changed facts
  //    c. Mark old facts as 'stale' (do not delete)
  //    d. New facts enter as 'extracted' (not yet 'verified')

  // 3. High-stakes changes trigger review:
  //    a. Deadline changes → urgent review
  //    b. Admissions criteria changes → normal review
  //    c. Financial aid policy changes → urgent review
  //    d. New pages detected → low priority review
}

// Schedule: daily at 02:00 UTC
// Rate limiting: 1 request per second per domain
// Respect robots.txt
// Store only hashes + extracted structured data, not full page content
```

---

## PART 5: COST OPTIMIZATION

### 5.1 Tiered Model Usage

| Tier | Model | Cost (approx) | Use Cases | Expected % of Queries |
|------|-------|---------------|-----------|----------------------|
| **T0: No model** | Rules engine, fact store, deterministic handlers | $0 | Deadlines, eligibility, percentiles, document checks, compliance gates | 30-40% |
| **T1: Haiku** | claude-haiku-4-5 | ~$0.25/M input, $1.25/M output | Routing, extraction, classification, moderation, simple Q&A | 25-30% |
| **T2: Sonnet** | claude-sonnet-4-6 | ~$3/M input, $15/M output | Source-grounded coaching, essay feedback, college list synthesis | 25-35% |
| **T3: Opus** | claude-opus-4-6 | ~$15/M input, $75/M output | Complex cross-source synthesis, nuanced essay critique, conflict resolution | 3-8% |

**Current state**: Most queries go to Sonnet or Opus. No T0 handling.
**Target**: 30-40% handled at T0, reducing model costs by ~40%.

### 5.2 Prompt Caching

```javascript
// Cacheable system instructions and corpora
const CACHED_BLOCKS = {
  system_instruction: {
    content: SYSTEM_PROMPT,           // ~2000 tokens, used on every call
    cache_control: { type: 'ephemeral' }
  },
  fafsa_corpus: {
    content: FAFSA_GUIDANCE,          // ~8000 tokens, used on financial aid queries
    cache_control: { type: 'ephemeral' }
  },
  college_baselines: {
    content: COLLEGE_CONTEXT,         // ~4000 tokens, used on college match queries
    cache_control: { type: 'ephemeral' }
  }
};

// Cache hit rate target: 80%+ for system instructions, 60%+ for corpora
// Cost savings: cached tokens at 10% of input token price
```

### 5.3 Batch Processing

| Operation | Current | Redesign |
|-----------|---------|----------|
| Baseline normalization | On-demand per request | Nightly batch job |
| College profile enrichment | Live Scorecard API call | Daily batch with cache |
| Evidence graph updates | N/A | Daily batch monitoring + diff indexing |
| Stale fact expiration | N/A | Hourly batch cleanup |
| Audit log archival | Daily (90-day delete) | Daily (archive to cold storage, then delete) |

### 5.4 Small-Context Retrieval

**Current**: RAG context assembly includes full profile + all snapshots + all milestones + baselines → large context window.

**Redesign**:
- Retrieve only the specific evidence objects relevant to the query (top-K retrieval, K=3-5)
- Include only the latest profile snapshot, not full history (unless query is about trends)
- Use structured summaries (100-200 tokens) instead of raw data dumps
- For college comparisons: retrieve only the compared colleges, not all 2000+

**Expected context reduction**: 60-70% smaller contexts → proportional cost reduction.

### 5.5 Diff-Based Recrawls

**Current**: No automated monitoring. FAFSA corpus is a static file. Deadlines are a static JSON.

**Redesign**: Daily diff-based monitoring (Part 4.5) processes only changed pages. Expected:
- 95%+ of monitored pages unchanged on any given day
- Only 5% require re-processing
- Full recrawl reserved for quarterly scheduled maintenance

### 5.6 Rules Before Models

Every query passes through the policy router (Part 1.2) which checks:
1. Can this be answered deterministically? → Rules engine (T0, $0)
2. Is this a simple extraction/classification? → Haiku (T1)
3. Does this require grounded synthesis? → Sonnet (T2)
4. Is this a complex escalation? → Opus (T3)

The waterfall ensures the cheapest sufficient handler is always used first.

### 5.7 Document Retention

| Data Type | Retention | Reason |
|-----------|-----------|--------|
| Uploaded documents (SAR, transcripts, aid letters) | 72 hours | Extracted structured data persists; raw document deleted |
| Conversation logs | 30 days (consumer), per-institution (school-integrated) | Privacy minimization for minors |
| Profile snapshots | Until deletion requested | Needed for trend analysis |
| Canonical facts | Until superseded + 90 days | Evidence provenance |
| Audit logs | 90 days (consumer), 5+ years (school-integrated) | Compliance |
| Vector embeddings | Updated on diff, no raw document backing | Cost + privacy |

### 5.8 Architectural Separation: Vector Store vs PII Vault

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   PII VAULT       │     │   OPERATIONAL DB  │     │   VECTOR STORE   │
│   (pii-vault.db)  │     │   (counselor.db)  │     │   (vectors.db)   │
│                   │     │                   │     │                  │
│  Student identity │     │  Profiles (no PII)│     │  Embeddings of:  │
│  Encrypted docs   │     │  Facts            │     │  - Official pages│
│  Consent records  │     │  Evidence graph   │     │  - College desc  │
│                   │     │  Audit logs       │     │  - Anonymized    │
│  Access: auth,    │     │  Review queue     │     │    benchmarks    │
│  export, delete   │     │                   │     │                  │
│  only             │     │  Access: all app  │     │  Access: retrieval│
│                   │     │  functions        │     │  only            │
│                   │     │                   │     │                  │
│  Optimized for:   │     │  Optimized for:   │     │  Optimized for:  │
│  security         │     │  query perf       │     │  similarity      │
│                   │     │                   │     │  search          │
└──────────────────┘     └──────────────────┘     └──────────────────┘

Three independent databases, three independent optimization paths.
PII vault can be migrated to HSM/KMS without touching retrieval.
Vector store can be replaced (SQLite → Pinecone → Qdrant) without touching PII.
```

---

## PART 6: IMPLEMENTATION ROADMAP

### Phase 1 — Foundation (Weeks 1-3)

| Task | Files | Priority |
|------|-------|----------|
| Create `policy-router.js` with deterministic topic classification | New file | P0 |
| Create `rules-engine.js` with FAFSA eligibility, deadline calc, percentile lookup | New file (refactor from rag-engine.js) | P0 |
| Create `fact-store.js` with canonical facts schema + CRUD | New file | P0 |
| Create `answer-composer.js` with three-lane output + AI disclosure | New file | P0 |
| Separate PII vault from operational DB | Refactor server.js + rag-engine.js | P0 |
| Add content moderation middleware | New middleware in server.js | P0 |
| Disable BYOK for minors | Modify server.js BYOK endpoints | P1 |
| Hash student_id before sending to Anthropic | Modify orchestration-engine.js | P1 |

### Phase 2 — Compliance (Weeks 3-5)

| Task | Files | Priority |
|------|-------|----------|
| Session-level AI disclosure on all responses | answer-composer.js | P0 |
| Korean AI Basic Act: prior notice, labeling, explanation | i18n.js + answer-composer.js | P0 |
| FERPA school-integrated mode: institution config, tenant separation | New `institutions.js` module | P1 |
| FAFSA advisory-only disclosure on all financial aid responses | answer-composer.js | P0 |
| Consent management for minors | New `consent.js` module + PII vault schema | P0 |
| Create `compliance/` documentation directory | New directory | P1 |
| Extend audit retention for institutional mode | server.js audit cleanup | P1 |

### Phase 3 — Intelligence Layer (Weeks 5-8)

| Task | Files | Priority |
|------|-------|----------|
| Create `evidence-graph.js` with typed evidence schema | New file | P0 |
| Migrate EC benchmarks from flat tables to evidence graph | Refactor baseline-data.js | P1 |
| Create `domain-monitor.js` for official page monitoring | New file | P1 |
| Create `source-registry.js` with trusted domain enforcement | New file | P0 |
| Create `review-queue.js` for human review workflow | New file | P1 |
| Implement diff-based re-indexing | domain-monitor.js | P2 |
| Add vector store (separate DB) for semantic search | New `vector-store.js` | P2 |

### Phase 4 — Cost Optimization (Weeks 8-10)

| Task | Files | Priority |
|------|-------|----------|
| Implement T0 routing (rules engine first) | policy-router.js | P0 |
| Add prompt caching for system instructions + corpora | orchestration-engine.js | P1 |
| Implement batch processing for baselines + monitoring | New `batch-jobs.js` | P2 |
| Reduce RAG context size (small-context retrieval) | rag-engine.js | P1 |
| Implement Opus budget caps per student | orchestration-engine.js | P1 |
| Document retention automation (72h doc cleanup, 30d log purge) | New `retention.js` | P1 |

### Phase 5 — Parent/Contributor Surface (Weeks 10-12)

| Task | Files | Priority |
|------|-------|----------|
| Contributor authentication flow (separate from student) | server.js + consent.js | P1 |
| FAFSA contributor guided workflow API | rules-engine.js + new endpoints | P1 |
| Financial aid viewer (read-only with consent) | New endpoints | P2 |
| Crisis notification settings for parents | server.js notification endpoints | P2 |

---

## PART 7: NEW FILE STRUCTURE

```
college-counselor-backend/
├── server.js                          (slimmed — routing + middleware only)
├── policy-router.js                   (NEW — deterministic topic classification + gates)
├── rules-engine.js                    (NEW — FAFSA, deadlines, eligibility, calculations)
├── fact-store.js                      (NEW — canonical verified facts with provenance)
├── source-registry.js                 (NEW — trusted domain enforcement)
├── evidence-graph.js                  (NEW — typed evidence: official/preparation/inferred)
├── answer-composer.js                 (NEW — three-lane output + AI disclosure + citations)
├── review-queue.js                    (NEW — human review for legal/policy/school cases)
├── domain-monitor.js                  (NEW — daily diff-based monitoring of official pages)
├── vector-store.js                    (NEW — semantic search, separate from PII)
├── consent.js                         (NEW — consent management for minors + contributors)
├── retention.js                       (NEW — automated data lifecycle management)
├── batch-jobs.js                      (NEW — scheduled batch processing)
├── content-moderation.js              (NEW — input/output moderation middleware)
├── orchestration-engine.js            (REFACTORED — tiered model routing with Opus gating)
├── rag-engine.js                      (REFACTORED — small-context retrieval, no PII)
├── baseline-data.js                   (REFACTORED — migrated to evidence graph)
├── college-scorecard.js               (unchanged)
├── i18n.js                            (EXPANDED — Korean AI disclosure, labeling)
├── package.json
├── data/
│   ├── counselor.db                   (operational DB — no PII)
│   ├── pii-vault.db                   (NEW — encrypted PII vault)
│   ├── vectors.db                     (NEW — vector embeddings, no PII)
│   ├── fafsa/
│   └── admissions-deadlines.json
├── compliance/
│   ├── korea-ai-basic-act/            (NEW — required documentation)
│   │   ├── system-description.md
│   │   ├── risk-assessment.md
│   │   ├── impact-review-scoring.md
│   │   └── data-processing-practices.md
│   ├── ferpa/                         (NEW)
│   │   ├── consumer-product-analysis.md
│   │   └── school-integrated-requirements.md
│   ├── fafsa/                         (NEW)
│   │   └── advisory-only-safeguards.md
│   └── anthropic/                     (NEW)
│       └── api-usage-compliance.md
├── generated/
│   └── college-profiles.generated.js
├── scripts/
│   └── generate-college-profiles.mjs
└── tests/
    ├── endpoints.test.js
    ├── policy-router.test.js          (NEW)
    ├── rules-engine.test.js           (NEW)
    ├── answer-composer.test.js        (NEW)
    └── evidence-graph.test.js         (NEW)
```

---

## SUMMARY OF DESIGN OBJECTIVES

| Axis | Current | Redesigned |
|------|---------|------------|
| **Compliance** | Partial PII masking, 90-day audit, no FERPA institutional mode, no Korea AI Act | Full FAFSA/FERPA/Anthropic/Korea coverage, tiered retention, consent management, institutional mode |
| **Hallucination** | Model-first for all queries, no source enforcement, no output labeling | Rules-first, no-source-no-answer for regulated topics, three-lane labeled output, evidence-grounded composition |
| **Cost** | Most queries hit Sonnet/Opus, large context windows, no caching | 30-40% handled at T0 ($0), Opus <8% of queries, prompt caching, small-context retrieval, diff-based monitoring |
| **Privacy** | PII in same DB, no vault separation, no minor-specific controls | Separate PII vault, hashed IDs to providers, 72h doc retention, no persistent memory for minors, vector store isolated |
| **Architecture** | Monolithic server.js (2150 lines), model-first routing | Modular (15+ focused modules), retrieval-and-rules-first, model as escalation layer |
| **Evidence quality** | Flat EC benchmarks presented as universal truth | Typed evidence graph with official/preparation/inferred distinction, never merging Type 3 with Type 1 |

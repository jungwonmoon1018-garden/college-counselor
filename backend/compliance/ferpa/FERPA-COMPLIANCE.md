# FERPA Compliance Framework

## Dual-Mode Architecture

### Mode 1: Consumer (Direct-to-Family)
- Student/family accesses the system directly
- No school involvement required
- FERPA does not apply directly (student is the data subject and user)
- Privacy protections still enforced as best practice

**Retention:** 90-day audit trail, 30-day conversation logs

### Mode 2: School-Integrated ("School Official" Exception)
- School deploys the system for its students
- System acts as a "school official" with "legitimate educational interest"
- Requires written agreement under FERPA 99.31(a)(1)
- Annual notification to parents required

**Retention:** 7-year audit trail (matching institutional record requirements)

## Implementation Controls

### Data Minimization
- PII stored in physically separate `pii-vault.db` with AES-256-GCM encryption
- Student IDs sent to Anthropic are SHA-256 hashed (never raw email/name)
- Documents auto-expire after 72 hours
- Conversation logs retained for 30 days maximum

### Right to Access (FERPA 99.10)
- `GET /api/students/export` provides complete data portability
- Returns all snapshots, milestones, capability data
- Available to authenticated students at any time

### Right to Amend (FERPA 99.20)
- Students can update their profile via `POST /api/students/sync`
- Previous versions are retained as snapshots (audit trail)
- Students can request correction via the review queue

### Right to Consent (FERPA 99.30)
- Consent management via `consent.js` module
- 8 consent types tracked with full audit trail
- Institutional sharing requires explicit `INSTITUTIONAL_SHARING` consent
- Cross-border data transfer requires `CROSS_BORDER_TRANSFER` consent

### Right to Erasure
- `DELETE /api/students` removes all data from:
  - PII vault (name, email, documents, consent records)
  - Operational DB (snapshots, milestones, capabilities, usage logs)
- Audit log entry retained for compliance (anonymized)

### Directory Information
- The system does NOT treat any student data as "directory information"
- All student data requires authentication to access
- No student data is publicly accessible

## School-Integrated Additional Requirements
When deployed in school-integrated mode:
1. Written agreement must specify:
   - What data is accessed
   - Purpose of data use
   - Who has access
   - Data security measures
2. Annual FERPA notification to parents
3. 7-year record retention
4. Human review queue for counselor oversight
5. Audit dashboard access for designated school officials

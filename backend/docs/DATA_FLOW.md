# Backend data flow

Three orthogonal data flows live side-by-side in this codebase, each owned
by its own module triad. They share one SQLite database (`rag-engine.js`)
and a single API surface (`server.js`), but they don't depend on each
other at the data-model level.

```
                  ┌────────────────────────────────────────┐
                  │             server.js (84 endpoints)   │
                  └─────┬───────────────┬──────────────┬────┘
                        │               │              │
        ┌───────────────▼──┐   ┌────────▼─────┐  ┌─────▼─────────┐
        │ Student-data flow │   │ CDS flow     │  │ Skill bundle  │
        │ (PII-vaulted)     │   │ (institutional│  │ /api/context/  │
        │                   │   │  ground truth)│  │  bundle)      │
        └─────────┬─────────┘   └───────┬───────┘  └───┬───────────┘
                  │                     │              │
                  └──────► rag-engine.js (SQLite) ◄─────┘
```

The three flows are:

1. **Student-data flow** — what the student gives us (profile, ECs,
   narrative, deadlines), processed into evidence vectors.
2. **CDS flow** — what we collect from public sources (Common Data Set
   PDFs), processed into school-level positioning data.
3. **Skill bundle** — the read-only join across both, served to the
   collegeapp-ai skill in JSON form per request.

This document maps each flow end-to-end. Numbers in brackets refer to
line numbers in the codebase as of writing.

---

## 1. Student-data flow (write path)

When a student updates their profile, ECs, narrative, or deadlines:

```
Browser  ──► server.js
              POST /api/students/sync
              POST /api/narrative/save
              POST /api/ec/upload
              POST /api/deadlines
                     │
                     ├──► rag-engine.js::syncStudentData()      [604]
                     │      └──► profile_snapshots, milestones,
                     │           capability_timeline,
                     │           baseline_colleges (read)
                     │
                     ├──► narrative-store.js::saveNarrative()
                     │      └──► narratives, narrative_versions
                     │
                     ├──► ec-strength-vectorizer.js::vectorizeECStrength()
                     │      ├──► ec-vectorizer.js (helpers)
                     │      ├──► competition-research.js (prestige)
                     │      │      └──► ec_prestige_cache (30d TTL)
                     │      ├──► narrative-fit-llm.js (narrative_fit)
                     │      │      └──► narrative_fit_cache (60d TTL)
                     │      └──► ec_component_cache (5-factor cache)
                     │           ec_strength_vectors (final vectors)
                     │
                     └──► rag-engine.js::stmts.deadlines.insert
                              └──► student_deadlines
```

Cross-cutting:
- **`pii-vault.js`** wraps every `student_id` lookup that passes through PII
  (email, name, parent contact) — opaque UUIDs in the DB, real values
  encrypted at rest.
- **`consent.js`** gates writes to `narratives` and `student_deadlines` on
  prior `data_processing` + `ai_interaction` consent rows.
- **`audit_log`** rows are appended for every write touching student data
  (FERPA/PIPA evidence trail).

### Where the 5-factor EC strength vector is built

```
Student says: "I founded the bioinformatics club, 6h/wk, won regional
                gold at the bio olympiad"
                │
                ▼
ec-strength-vectorizer::vectorizeECStrength(ec, ctx)
                │
                ├──► dedication      ◄─ hours × years × recency
                │                       (ec_component_cache)
                │
                ├──► achievement     ◄─ baseline_ec_competitive
                │                       (admissions_weight + claim verify)
                │
                ├──► leadership      ◄─ role-string parser
                │                       (ec_component_cache)
                │
                ├──► prestige        ◄─ competition-research.js
                │                       (Anthropic web_search,
                │                        ec_prestige_cache)
                │
                └──► narrative_fit   ◄─ narrative-fit-llm.js
                                        (narrative_fit_cache)
                ▼
            tier label (tier_1 .. tier_4)
                ▼
            ec_strength_vectors row (one per EC)
```

---

## 2. CDS flow (institutional ground truth)

This is the flow we built most recently. CDS PDFs come in, get parsed,
get validated against web-sourced truth, and land in `cds_records`.

```
                         ┌───────────────────────────────────┐
                         │ College Transitions repo          │
                         │ collegetransitions.com/dataverse  │
                         │   (~317 schools, Drive-hosted)    │
                         └─────────────┬─────────────────────┘
                                       │ HTTPS + browser headers
                                       ▼
              cds-search.js::fetchRepositoryIndex() / parseCdsRepositoryIndex()
                      └──► [school name → year → Drive URL] map
                                       │
                                       ▼
              cds-ingest-pipeline.js::resolveDownloadURL()
                      └──► drive view URL → uc?export=download
                                       │
                                       ▼
              cds-ingest-pipeline.js::downloadCDS()
                      └──► PDF cached at data/cds-cache/pdfs/<slug>.<year>.pdf
                                       │
                                       ▼
                           cds-pdf-parser.js::parseCDSPositional({ method })
                                       │
                  ┌────────────────────┼────────────────────┐
                  │                    │                    │
            method="auto"        method="ocr"         method="pdfjs"
                  │                    │                    │
                  ▼                    ▼                    ▼
          extractItems(pdfjs)   extractItemsViaOCR    extractItems(pdfjs)
          + OCR fallback if    (tesseract.js +         only — no fallback
            looksLikeImage     @napi-rs/canvas,
            OnlyPDF()          PSM 6, 2× scale)
                  │                    │                    │
                  └─────► [{page, x, y, str, width}] ◄──────┘
                                       │
                                       ▼
                  ┌────────────────────┼────────────────────┐
                  │                    │                    │
         extractC1Counts /    extractC9Bands       extractC7Positional
         extractC1SubBreakdowns                            │
                  │                    │                    │
                  ▼                    ▼                    ▼
            applied/admitted/   SAT 25/75            { rigor, gpa,
            enrolled +          ACT 25/75              test_scores,
            ED/RD/residency     test policy            essays, ec, ... }
            /per-gender                                  → label values
                  │                    │                    │
                  └────────────────────┼────────────────────┘
                                       ▼
                  + extractC12GPA    (cumulative bands → p25/p75)
                  + extractC12AverageGPA  (mean GPA when published)
                  + extractTestPolicyPositional
                  + extractFormFields  ── cds-pdf-form-fields.js
                  ▼
                  PARSED RECORD (canonical JSON)
                                       │
                                       ▼
                       cds-validator.js::persistAndValidate()
                              │
                              ├── extractDocumentScope(pdf)  ◄ catches
                              │     wrong-institution PDFs (Columbia GS bug)
                              │
                              ├── validateRecord(record, CORRECTIONS[slug], scope)
                              │     │
                              │     ├── scope mismatch → critical override
                              │     ├── admit-rate drift > 0.5pp → high override
                              │     ├── SAT band drift > 30pts → medium override
                              │     └── sanity: admitted ≤ applied
                              │
                              ├── stmts.cds.upsert.run(...)
                              │     └─► cds_records table
                              │
                              └── stmts.cds.insertValidation.run(...)
                                    └─► cds_validations table (append-only)
```

### Storage shape (`cds_records`)

```
slug (PK)            "princeton-university"
school_name          "Princeton University"
year_label           "2023-24"
year                 2024
overall_admit_rate   0.0462     ← post-validation override
yield_rate           0.7548
enrolled_sat_p25     1500
enrolled_sat_p75     1560
enrolled_act_p25     34
enrolled_act_p75     35
enrolled_gpa_p25     3.75       ← derived from C12 bands
enrolled_gpa_p75     4.00
enrolled_gpa_avg     3.91       ← from C12 mean (when published)
test_policy          "test_optional"
c7_json              {"rigor":"very_important", "gpa":"very_important", ...}
b1_json              {"applied":40468,"admitted":1868,"enrolled":1410}
c1_breakdown_json    {"byGender":{"men":{...},"women":{...}}, "byDecisionPlan":{...}}
source_url           https://drive.google.com/file/d/.../view
source_kind          "pdf_text" | "pdf_form" | "pdf_merged"
parser_version       3
parser_notes_json    ["merged_form_fields"] | ["ocr_primary"] | ...
```

### Storage shape (`cds_validations`, append-only)

```
id (auto)             1
slug                  "columbia-university"
status                "scope_mismatch" | "discrepancies" | "ok" | "no_truth"
scope_from_pdf        "Columbia General Studies"
discrepancies_json    [{severity:"critical", field:"scope", note:"..."}]
overrides_json        {overallAdmitRate: 0.0389, enrolledSAT: {p25:1490,p75:1560}}
sources_json          ["https://opir.columbia.edu/cds"]
validated_at          2026-05-02 14:02:11
```

### Output / consumption paths

```
cds_records ──┬── GET /api/cds/schools           (list)
              │── GET /api/cds/school/:slug      (single + latest validation)
              │── GET /api/cds/validation/:slug  (latest report only)
              │── POST /api/cds/ingest           (counselor: trigger pipeline)
              │── POST /api/cds/revalidate       (counselor: re-run validation)
              │── GET /api/cds/canonical/:slug.xlsx
              │       │
              │       └── cds-canonical-export.js
              │             └── 6-sheet workbook:
              │                  Cover / C1 / C7 / C9 / C12 / Validation
              │
              └── /api/context/bundle (cdsContext block)
```

---

## 3. Skill bundle (read-only join)

`GET /api/context/bundle` is the single read endpoint the
collegeapp-ai skill calls. It joins everything the AI needs to ground
its reply, in one shot, in the student's locale.

```
Skill ──► GET /api/context/bundle?locale=ko&narrativeText=1
              │
              ▼
        server.js [897-1098]  (async handler)
              │
              ├── resolveLocale(req)             ── ?locale > X-CollegeApp-Locale > Accept-Language
              │
              ├── rag-engine.js::assembleRAGContext()    [856]
              │     ├── profile_snapshots (latest)
              │     ├── milestones (recent)
              │     ├── capability_timeline (trend)
              │     ├── baseline_colleges (target schools)
              │     └── scorecard_history (multi-year)
              │
              ├── ec_strength_vectors → ecStrength.vectors[]
              │
              ├── ap_concept_vectors → apConcepts.subjects[]
              │
              ├── directionality_vectors → directionality.factors{}
              │
              ├── narratives (active only) → narrative.active{themes,majorBuckets,drift}
              │
              ├── student_deadlines.summary (overdue / dueIn7) → narrative.summary
              │
              ├── ★ cds_records + cds_validations → cdsContext.schools[]    [NEW]
              │     │
              │     ├── for each goal school name:
              │     │   slugify(name) → loadValidatedRecord(stmts, slug)
              │     │   loadLatestValidation(stmts, slug)
              │     │
              │     └── per-school payload:
              │           overallAdmitRate, yieldRate, enrolled* bands, testPolicy
              │           c7 (raw labels) + c7Weighted (numeric weights)
              │           c1Breakdown (ED/RD/gender/residency)
              │           validation { status, corrections, sources, validatedAt }
              │
              ├── localizeFriendlyLabels(locale) → friendlyLegendI18n
              │
              ▼
        JSON { version: "1.2", rag, ecStrength, apConcepts,
               directionality, narrative, collegeContext, cdsContext,
               friendlyLegendI18n, tierHints }
              │
              ▼
        collegeapp-ai skill (Claude) renders advice grounded in the
        cited source URLs, with corrections labeled and locale honored.
```

---

## 4. Module dependency graph

Static imports between root-level modules. Everything reads from
`rag-engine.js` for storage; nothing else depends on `server.js`.

```
                           rag-engine.js
                          (SQLite + stmts)
                                 ▲
            ┌────────────────────┼────────────────────────┐
            │                    │                        │
    ec-strength-     positioning-engine.js          cds-validator.js
    vectorizer.js   (uses ec-vectorizer for         ▲      ▲
            │       clamp01, matchMajorBucket)      │      │
            │                    ▲                  │      │
            │                    │                  │      │
    ec-vectorizer.js             │       cds-pdf-parser.js │
    competition-research.js      │              ▲          │
    narrative-fit-llm.js         │              │          │
            │                    │       cds-pdf-form-fields.js
            │                    │              │          │
            │                    │              │          │
            ▼                    │              │          │
    LLM adapters                 │              │   cds-ingest-pipeline.js
    (anthropic / openai)         │              │       ▲
                                 │              │       │
                                 │              └───────┤
                                 │                      │
                                 │              cds-search.js
                                 │              (CT repo + flat-text parse)
                                 │
                                 │              cds-canonical-export.js
                                 │              (xlsx via exceljs)
                                 │              ▲
                                 │              │
                                 │              cds-validator.js
                                 │
                                 ▼
                          server.js (one process,
                          one DB connection,
                          84 endpoints)
```

Key invariant: every module exports pure functions or stmts-consuming
functions. `server.js` is the only place that owns the
`prepareRAGStatements()` instance and passes it down to whatever module
needs DB access.

---

## 5. Where data leaves the box

| Data | Direction | Channel | Auth |
|---|---|---|---|
| Student profile | server → student | `/api/students/profile` | studentAuth |
| Student profile (encrypted) | server → student | `/api/students/export` | studentAuth + passphrase |
| Skill bundle | server → skill (Claude) | `/api/context/bundle` | studentAuth |
| CDS records | server → student | `/api/cds/schools` `/api/cds/school/:slug` | studentAuth |
| CDS xlsx audit | server → counselor | `/api/cds/canonical/:slug.xlsx` | counselorAuth |
| Audit dashboard | server → counselor | `/api/audit/dashboard` `/api/audit/export` | counselorAuth |
| Crisis email | server → parent guardian | `/api/notify-parent` | crisis-detected only, content-redacted |
| LLM forward | server → Claude/OpenAI/Gemini/etc. | `/api/anthropic` `/api/llm` | studentAuth + per-student key option |

Anything else stays inside the SQLite file. There is no analytics
sink, no observability provider — `audit_log` is the only place every
significant event lands and it's consumed only via the counselor
endpoints.

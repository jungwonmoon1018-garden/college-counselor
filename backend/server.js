// ═══════════════════════════════════════════════════════════════════════
// COLLEGE COUNSELOR — BACKEND SERVER (redesigned)
// ═══════════════════════════════════════════════════════════════════════
// Slim routing shell that wires together the rules-first architecture.
//
// Architecture:
//   Policy Router → Rules Engine (T0/$0) → Fact Store / Evidence Graph
//   → Content Moderation → Answer Composer → [Model only if needed]
//   → Review Queue → Response with 3-lane output + AI disclosure
//
// Databases (physically separate):
//   1. counselor.db  — operational (audit, baselines, snapshots, usage)
//   2. pii-vault.db  — encrypted PII (name, email, documents, consent)
//   3. vectors.db    — embeddings (no student PII)
//
// CORE ENDPOINTS:
//   POST /api/anthropic              — Tiered model proxy (rules-first)
//   POST /api/audit                  — Safety audit event logging
//   GET  /api/audit/dashboard        — Counselor review (auth req)
//   GET  /api/audit/export           — CSV export (auth req)
//   POST /api/notify-parent          — Parental crisis notification
//   GET  /api/health                 — Health check
//
// STUDENT ENDPOINTS:
//   POST /api/students/register      — Create student + consent flow
//   POST /api/students/auth          — Get session token
//   POST /api/students/sync          — Sync profile + detect changes
//   GET  /api/students/profile       — Latest profile + metrics
//   GET  /api/students/timeline      — Capability trends
//   GET  /api/students/milestones    — Achievement history
//   GET  /api/students/export        — FERPA/GDPR data export
//   DELETE /api/students             — Right to erasure
//
// BYOK:
//   PUT    /api/students/apikey      — Store personal key (age-gated)
//   DELETE /api/students/apikey      — Remove personal key
//   GET    /api/students/apikey      — Key status
//   GET    /api/students/usage       — Per-student usage stats
//
// INTELLIGENCE:
//   POST /api/agents/orchestrate     — Full rules-first pipeline
//   POST /api/rag/context            — Small-context RAG assembly
//   POST /api/rag/college-match      — Multi-dimensional college fit
//   POST /api/mcp/admissions/query   — Admissions MCP query
//   GET  /api/baselines/status       — Baseline data freshness
//
// COLLEGE DATA (Scorecard):
//   POST /api/colleges/search        — Search 4,000+ institutions
//   GET  /api/colleges/:id           — Single college details
//   GET  /api/colleges/:id/financial-aid — Financial aid profile
//   POST /api/colleges/compare       — Head-to-head comparison
//
// COMPLIANCE:
//   GET  /api/consent/requirements   — Consent requirements for onboarding
//   POST /api/consent/grant          — Grant consent
//   GET  /api/review/stats           — Review queue stats (counselor)
//
// DASHBOARD:
//   GET  /dashboard                  — Counselor audit UI (auth req)
// ═══════════════════════════════════════════════════════════════════════

import dotenv from "dotenv";
// Override empty-string OS env vars (e.g. ANTHROPIC_API_KEY="" inherited
// from a parent shell) with values from .env so the live target refresh
// and other config-driven features actually fire.
dotenv.config({ override: true });
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import nodemailer from "nodemailer";
import Database from "better-sqlite3";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// ── New architecture modules ──
import { routeRequest, classifyTopic, TOPIC_TYPES, MODEL_TIERS } from "./policy-router.js";
import { runFAFSAEligibilityCheck, calculateDeadlineStatus, runDocumentCompletenessCheck, computePercentile, computeAPRigorIndex, estimateNetPrice, evaluateComplianceGate, buildCrisisResponse } from "./rules-engine.js";
import { initFactStore, prepareFactStatements, seedCollegeFacts, lookupFact, searchFacts, expireOldFacts, getFactStoreStats } from "./fact-store.js";
import { initEvidenceGraph, prepareEvidenceStatements, getEvidenceProfile, buildStudentDimensionProfile, seedECBenchmarkEvidence, seedCollegeEvidence, seedCompetitiveActivityEvidence } from "./evidence-graph.js";
import { composeAnswer, composeDeterministicAnswer } from "./answer-composer.js";
import { initReviewQueue, prepareReviewStatements, submitForReview, shouldTriggerReview, getQueueStats } from "./review-queue.js";
import { initPIIVault, preparePIIStatements, storeStudentPII, retrieveStudentPII, deleteAllStudentPII, cleanExpiredDocuments, hashStudentIdForProvider, isBYOKAllowed, lookupStudentBYOK } from "./pii-vault.js";
import { migrateAllStudentClaudeModels, migrateOneStudentClaudeModels, ensureBudgetColumn, getStudentBudget, setStudentBudget, getMonthlySpendUsd, checkBudget, CURRENT_TARGETS, loadCachedTargetsIntoMemory, refreshClaudeTargetsAndMigrate } from "./claude-model-migration.js";
import { OPENROUTER_TARGETS, OPENROUTER_STATUS, refreshOpenRouterTargets } from "./openrouter-model-refresh.js";
import { buildMethodology } from "./methodology.js";
import * as chatHistory from "./chat-history.js";
import { makeWebSearchTool, makeWebFetchTool, buildAllowedDomains, DEFAULT_ALLOWED_DOMAINS } from "./credible-sources.js";
import { extractCollegeValues, computeFit } from "./college-values.js";
import { callLLM as adapterCallLLM, detectProvider, validateKey as adapterValidateKey, listProviders, isReasonableModelId as adapterIsReasonableModelId, resolveTierDefault, TIER_DEFAULTS, PROVIDERS } from "./llm-adapters/index.js";
import { screenInput, screenOutput, restorePII } from "./content-moderation.js";
import { grantConsent, hasActiveConsent, validateRequiredConsents, getOnboardingConsentRequirements } from "./consent.js";
import { initDomainMonitor, prepareMonitorStatements } from "./domain-monitor.js";
import { runRetentionCleanup, getRetentionReport } from "./retention.js";
import { registerStandardJobs, registerJob, startAllJobs, stopAllJobs, getJobStatus } from "./batch-jobs.js";
import { initVectorStore, prepareVectorStatements, keywordSearch, getVectorStoreStats } from "./vector-store.js";
import { validateEvidenceSources } from "./source-registry.js";
import { initRAGTables, seedBaselines, prepareRAGStatements, syncStudentData, assembleRAGContext, getDirectStructuredStudentData, getStudentTrends, enhancedCollegeMatch, fetchAndPersistCollegeHistory, buildCollegeHistoryContext, extractGoalUnitIds } from "./rag-engine.js";
import {
  scoreAcademicStrength,
  buildNextStepPlan,
  recomputeStudentDirectionality,
  EC_FACTORS,
  WELLBEING_LIMITS,
} from "./ec-vectorizer.js";
import {
  seedAPConceptCatalog,
  processStudentInputForConcepts,
  recomputeSubjectVector,
  recomputeAllSubjectVectors,
  overrideStudentConcept,
  classifyInputToAPConcepts,
} from "./ap-concept-vectorizer.js";
import {
  AP_CONCEPT_CATALOG,
  getConceptsForSubject,
  getAllAPSubjects,
} from "./ap-concept-catalog.js";
import multer from "multer";
import {
  vectorizeECStrength,
  recomputeStudentECStrengthVectors,
  applyStrengthOverride,
  buildDefaultLLMClient,
  toPublicShape as toStrengthPublicShape,
  projectStrengthToLegacyVector,
  STRENGTH_FACTORS,
  TIERS,
} from "./ec-strength-vectorizer.js";
import {
  researchCompetitionPrestige,
  searchCompetitionCatalog,
  computePrestigeCacheKey,
  normalizeActivityName,
  PRESTIGE_TTL_DAYS,
  REPUTABLE_DOMAINS,
  OFFICIAL_COMPETITION_SOURCES,
} from "./competition-research.js";
import {
  enrichECVectorWithFriendly,
  getPrestigeExplanation,
  renderFriendlyTier,
  renderFriendlyPrestigeSource,
  renderFriendlyFactor,
  renderFriendlyDirectionalityFactor,
  renderFriendlyDirectionalityLabel,
  FACTOR_FRIENDLY,
  TIER_FRIENDLY,
  PRESTIGE_SOURCE_FRIENDLY,
} from "./friendly-labels.js";
// F6 uses the same major-bucket matcher as the EC vectorizer to score
// candidate EC ideas against the student's active narrative.
import { matchMajorBucket as matchMajorBucketFn } from "./ec-vectorizer.js";
import {
  saveNarrative,
  getActiveNarrative,
  softDeleteNarrative,
  computeProfileFingerprint,
  NarrativeValidationError,
  NARRATIVE_MIN_CHARS,
  NARRATIVE_MAX_CHARS,
} from "./narrative-store.js";
import {
  extractText,
  isSupportedMime,
  SUPPORTED_MIME_TYPES,
  MAX_FILE_BYTES,
  ExtractionError,
} from "./file-extractors.js";
import { GPA_BASELINES, SAT_BASELINES, ACT_BASELINES, EC_BENCHMARKS, COLLEGE_PROFILES, COMPETITIVE_ACTIVITY_BENCHMARKS } from "./baseline-data.js";
import { searchScorecard, getCollegeById, compareColleges, getFinancialAidProfile, getCollegeHistory } from "./college-scorecard.js";
import {
  computeCdsQueryCacheKey,
  extractTargetSchoolNames,
  parseCdsDocument,
  resolveAndParseCdsTargets,
} from "./cds-search.js";
import {
  ensureCdsStoreSeeded,
  resolveStoredCdsRecord,
  cdsRecordToPositioningResult,
  slugifySchoolName,
  isCdsRecordValidated,
  strictSchoolKey,
  schoolNamesCompatible,
  extractCdsViaWeb,
  extractAdmitRateViaWeb,
} from "./cds-store.js";
import {
  initAdmissionsIntelligenceTables,
  prepareAdmissionsIntelStatements,
  resolveIpedsGrowthForMajor,
  resolveMajorPolicyForSchool,
  resolveStrategicFocusForSchool,
  seedOfficialCipMappings,
  upsertIpedsGrowth,
  upsertMajorPolicy,
  upsertStrategicFocus,
} from "./admissions-intelligence.js";
import { loadIpedsGrowthFile } from "./admissions-intelligence-loader.js";
import {
  buildStudentModel,
  buildPositioningForTarget,
} from "./positioning-engine.js";
import {
  getCourseSequence,
  diffCoursesAgainstSequence,
} from "./course-sequence-catalog.js";
import { loadOrchestrationCatalog, buildOrchestration, isReasonableModelId, redactPayloadForModel, detectSubscriptionTier } from "./orchestration-engine.js";
import { t, resolveLocale, localizeFriendlyLabels } from "./i18n.js";
import { readEnvLines, getValue, setValue, writeEnvAtomic, resolveFirstRunEncryptionKey, defaultPaths, HEX64, PLACEHOLDER } from "./env-file.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ═══════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════
const PORT = parseInt(process.env.PORT || "3001", 10);
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:3000,http://localhost:5173").split(",").map(s => s.trim());
const NODE_ENV = process.env.NODE_ENV || "development";
// Treat an unfilled `.env.example` placeholder (REPLACE_WITH…) as unset, so a
// freshly-copied .env doesn't make the server think a bogus key is live data.
const SCORECARD_API_KEY = /^REPLACE_WITH/i.test(process.env.SCORECARD_API_KEY || "")
  ? ""
  : (process.env.SCORECARD_API_KEY || "");
// ── First-run setup (guarded operator endpoint, see /api/setup/*) ──
// A one-time token, regenerated every boot, gates the setup endpoint together
// with a loopback-only check. We only consider setup "available" (and only
// print the token) when something still needs configuring — a real
// ENCRYPTION_KEY from the environment, or a live Scorecard key. This keeps a
// fully-configured production boot quiet and the token out of its logs.
const ENCRYPTION_KEY_FROM_ENV = !!process.env.ENCRYPTION_KEY;
const SETUP_AVAILABLE = !ENCRYPTION_KEY_FROM_ENV || !SCORECARD_API_KEY;
const SETUP_TOKEN = crypto.randomBytes(24).toString("hex");
const FAFSA_GUIDANCE_PATH = process.env.FAFSA_GUIDANCE_PATH || path.join(__dirname, "data", "fafsa", "2026-2027.txt");
const ADMISSIONS_DEADLINES_PATH = process.env.ADMISSIONS_DEADLINES_PATH || path.join(__dirname, "data", "admissions-deadlines.json");
const RETENTION_MODE = process.env.RETENTION_MODE || "consumer"; // "consumer" or "institutional"
const SIM_URL = (process.env.SIM_URL || `http://127.0.0.1:${process.env.SIM_PORT || "3002"}`).replace(/\/$/, "");
const SIM_INTERNAL_TOKEN = process.env.SIM_INTERNAL_TOKEN || "local-simulation-sidecar";

// Email config
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587", 10);
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || "College Counselor Safety <safety@yourcounselorapp.com>";

// Counselor dashboard credentials
const COUNSELOR_USER = process.env.COUNSELOR_USER || "counselor";
const COUNSELOR_PASS = process.env.COUNSELOR_PASS || "";

// Encryption key.
//   - Production: MUST come from the environment (enforced below).
//   - Development: prefer the env var; otherwise generate ONCE and
//     persist to a gitignored file so the SAME key is reused across
//     every backend restart. Previously the dev fallback generated a
//     fresh random key on every boot, which silently made all stored
//     PII (including the encrypted BYOK key) undecryptable after a
//     restart — forcing students to re-enter everything. Persisting
//     the key fixes that "re-login on every restart" problem at its
//     root.
function resolveEncryptionKey() {
  if (process.env.ENCRYPTION_KEY) return process.env.ENCRYPTION_KEY;
  if (NODE_ENV === "production") {
    // Validated/fatal below — return a placeholder so this function
    // doesn't throw before that explicit check runs.
    return crypto.randomBytes(32).toString("hex");
  }
  // Dev: load-or-create a stable key on disk.
  const keyPath = path.join(__dirname, ".dev-encryption-key");
  try {
    if (fs.existsSync(keyPath)) {
      const existing = fs.readFileSync(keyPath, "utf8").trim();
      if (/^[0-9a-fA-F]{64}$/.test(existing)) {
        console.log("[BOOT] Loaded persistent dev encryption key (.dev-encryption-key).");
        return existing;
      }
      console.warn("[BOOT] .dev-encryption-key is malformed — regenerating.");
    }
    const fresh = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(keyPath, fresh, { mode: 0o600 });
    console.log("[BOOT] Generated + persisted a new dev encryption key (.dev-encryption-key). Account data will now survive restarts.");
    return fresh;
  } catch (e) {
    console.warn("[BOOT] Could not persist dev encryption key — falling back to ephemeral key (data will NOT survive restart):", e.message);
    return crypto.randomBytes(32).toString("hex");
  }
}
const ENCRYPTION_KEY = resolveEncryptionKey();

// ═══════════════════════════════════════════════════════════
// STARTUP VALIDATION
// ═══════════════════════════════════════════════════════════
if (!ANTHROPIC_API_KEY) {
  console.warn("[BOOT] WARNING: ANTHROPIC_API_KEY not set — AI features disabled until configured.");
} else {
  console.log("[BOOT] Anthropic API key configured.");
}
if (!COUNSELOR_PASS && NODE_ENV === "production") {
  console.error("FATAL: COUNSELOR_PASS is required in production for audit dashboard access.");
  process.exit(1);
}
if (!process.env.ENCRYPTION_KEY && NODE_ENV === "production") {
  console.error("FATAL: ENCRYPTION_KEY required in production.");
  process.exit(1);
}
if (!process.env.SIM_INTERNAL_TOKEN && NODE_ENV === "production") {
  console.error("FATAL: SIM_INTERNAL_TOKEN required in production for simulation sidecar proxying.");
  process.exit(1);
}
if (!SMTP_HOST) {
  console.warn("[WARN] SMTP not configured — parental notifications will be queued but not delivered.");
}

console.log(`[BOOT] Environment: ${NODE_ENV}`);
console.log(`[BOOT] Allowed origins: ${ALLOWED_ORIGINS.join(", ")}`);
console.log(`[BOOT] Retention mode: ${RETENTION_MODE}`);
console.log(`[BOOT] College Scorecard API: ${SCORECARD_API_KEY ? "CONFIGURED" : "NOT CONFIGURED (offline mode)"}`);
if (SETUP_AVAILABLE) {
  console.log("[SETUP] First-run setup available. One-time token (localhost only):");
  console.log(`[SETUP]   ${SETUP_TOKEN}`);
  console.log("[SETUP] Open the Setup screen (web: /setup.html · macOS app) on THIS host and paste the token.");
}

// ═══════════════════════════════════════════════════════════
// DATABASE INITIALIZATION — 3 physically separate databases
// ═══════════════════════════════════════════════════════════
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

// 1. Operational DB (audit, baselines, snapshots, usage)
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "counselor.db");
const db = new Database(DB_PATH, { verbose: NODE_ENV === "development" ? console.log : undefined });
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    type TEXT NOT NULL,
    user_hint TEXT,
    details TEXT,
    ip_hash TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_audit_type ON audit_events(type);
  CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_events(timestamp);

  CREATE TABLE IF NOT EXISTS notification_queue (
    id TEXT PRIMARY KEY,
    recipient_email_hash TEXT NOT NULL,
    recipient_email_encrypted TEXT NOT NULL,
    student_hint TEXT,
    notification_type TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    sent_at TEXT,
    error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_notif_status ON notification_queue(status);
`);

// 2. PII Vault (separate encrypted DB)
const piiVault = initPIIVault(DATA_DIR, ENCRYPTION_KEY, NODE_ENV);
const piiStmts = preparePIIStatements(piiVault);

// 2a. Ensure the per-student budget cap column exists, load the cached
//     Claude targets from disk (fast), then sweep every Anthropic BYOK row
//     and rewrite retired/older Claude model IDs to the current targets.
//     Source of truth: claude-model-migration.js.
ensureBudgetColumn(piiVault);
loadCachedTargetsIntoMemory();
try {
  const m = migrateAllStudentClaudeModels(piiVault);
  if (m.migrated > 0) {
    console.log(`[CLAUDE-MIGRATE] Boot sweep: ${m.migrated}/${m.scanned} students migrated`);
    for (const c of m.changes.slice(0, 20)) {
      console.log(`[CLAUDE-MIGRATE]   ${c.studentId.slice(0,8)}… ${c.tier}: ${c.from} → ${c.to}`);
    }
    if (m.changes.length > 20) console.log(`[CLAUDE-MIGRATE]   …and ${m.changes.length - 20} more`);
  } else {
    console.log(`[CLAUDE-MIGRATE] Boot sweep: ${m.scanned} students scanned, all up to date (targets: opus=${CURRENT_TARGETS.opus}, sonnet=${CURRENT_TARGETS.sonnet}, haiku=${CURRENT_TARGETS.haiku})`);
  }
} catch (err) {
  console.error("[CLAUDE-MIGRATE] Boot sweep failed:", err.message);
}

// 2b. Live refresh from Anthropic's /v1/models — fire async at boot and
//     repeat every 24h. The operator's ANTHROPIC_API_KEY pays for this
//     single tiny call per day. If the API is unreachable, we keep using
//     the cached/default targets and try again next cycle.
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
let claudeTargetsLastRefresh = null; // ISO string, surfaced via /api/methodology
async function refreshClaudeTargetsNow(reason = "scheduled") {
  if (!process.env.ANTHROPIC_API_KEY) return;
  const r = await refreshClaudeTargetsAndMigrate(piiVault, process.env.ANTHROPIC_API_KEY);
  claudeTargetsLastRefresh = new Date().toISOString();
  if (r.refreshed && r.changes.length > 0) {
    console.log(`[CLAUDE-MIGRATE] Live refresh (${reason}): ${r.changes.length} target(s) updated; ${r.migrated}/${r.scanned} students migrated`);
  } else if (r.refreshed) {
    console.log(`[CLAUDE-MIGRATE] Live refresh (${reason}): targets already current`);
  }
}
refreshClaudeTargetsNow("boot").catch(err => console.warn("[CLAUDE-MIGRATE] Boot refresh threw:", err.message));
setInterval(() => {
  refreshClaudeTargetsNow("daily").catch(err => console.warn("[CLAUDE-MIGRATE] Daily refresh threw:", err.message));
}, REFRESH_INTERVAL_MS).unref();

// 2c. OpenRouter recommended-model refresh — same 24h cadence, but migration
//     is PROPOSE-ONLY (human approval via the BYOK "Update models" prompt). No
//     student row is rewritten automatically for BYOK providers.
refreshOpenRouterTargets({ reason: "boot" }).catch(err => console.warn("[OR-MIGRATE] Boot refresh threw:", err.message));
setInterval(() => {
  refreshOpenRouterTargets({ reason: "daily" }).catch(err => console.warn("[OR-MIGRATE] Daily refresh threw:", err.message));
}, REFRESH_INTERVAL_MS).unref();

// 3. Vector Store (separate DB, no PII)
const vectorStore = initVectorStore(DATA_DIR, NODE_ENV);
const vectorStmts = prepareVectorStatements(vectorStore);

// ── Operational DB modules ──
initRAGTables(db);
initAdmissionsIntelligenceTables(db);
initFactStore(db);
initEvidenceGraph(db);
initReviewQueue(db);
initDomainMonitor(db);

seedBaselines(db, { GPA_BASELINES, SAT_BASELINES, ACT_BASELINES, EC_BENCHMARKS, COLLEGE_PROFILES, COMPETITIVE_ACTIVITY_BENCHMARKS });
seedOfficialCipMappings(db);

const ragStmts = prepareRAGStatements(db);
const admissionsIntelStmts = prepareAdmissionsIntelStatements(db);

// Seed the cds_records table from the on-disk parsed/validated CDS cache so
// College Fit can ground its calculation in real C7 weights + admit rates
// instead of failing live fetches. Idempotent; only ingests when empty.
ensureCdsStoreSeeded(ragStmts)
  .then((r) => { if (r.seeded) console.log(`[cds-store] seeded ${r.ingested} CDS records (${r.errors?.length || 0} errors)`); })
  .catch((err) => console.warn("[cds-store] seed failed:", err.message));
const factStmts = prepareFactStatements(db);
const evidenceStmts = prepareEvidenceStatements(db);
const reviewStmts = prepareReviewStatements(db);
const monitorStmts = prepareMonitorStatements(db);

// Seed fact store and evidence graph from baseline data
seedCollegeFacts(factStmts, COLLEGE_PROFILES, db);
seedECBenchmarkEvidence(evidenceStmts, EC_BENCHMARKS, db);
seedCollegeEvidence(evidenceStmts, COLLEGE_PROFILES, db);
seedCompetitiveActivityEvidence(evidenceStmts, COMPETITIVE_ACTIVITY_BENCHMARKS, db);

// Seed AP concept catalog mirror (idempotent). Per-student concept rows
// remain lazy — they are only created when the student's own prompts/files
// reference the subject.
try {
  const seeded = seedAPConceptCatalog(ragStmts.apConcepts);
  console.log(`[RAG] AP concept catalog seeded: ${seeded} concepts`);
} catch (err) {
  console.error("[RAG] AP concept catalog seeding failed:", err);
}

const orchestrationCatalog = loadOrchestrationCatalog({
  fafsaPath: FAFSA_GUIDANCE_PATH,
  deadlinesPath: ADMISSIONS_DEADLINES_PATH,
});

// ── Prepared statements for audit/notification ──
const stmts = {
  insertAudit: db.prepare(`INSERT INTO audit_events (id, timestamp, type, user_hint, details, ip_hash) VALUES (?, ?, ?, ?, ?, ?)`),
  insertNotification: db.prepare(`INSERT INTO notification_queue (id, recipient_email_hash, recipient_email_encrypted, student_hint, notification_type, message, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')`),
  updateNotificationStatus: db.prepare(`UPDATE notification_queue SET status = ?, sent_at = datetime('now'), error = ? WHERE id = ?`),
  getPendingNotifications: db.prepare(`SELECT * FROM notification_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT 10`),
  getAuditEvents: db.prepare(`SELECT id, timestamp, type, user_hint, details FROM audit_events ORDER BY timestamp DESC LIMIT ? OFFSET ?`),
  getAuditByType: db.prepare(`SELECT id, timestamp, type, user_hint, details FROM audit_events WHERE type = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?`),
  getCrisisCount24h: db.prepare(`SELECT COUNT(*) as count FROM audit_events WHERE type = 'crisis_detected' AND timestamp >= datetime('now', '-24 hours')`),
  getAuditStats: db.prepare(`SELECT type, COUNT(*) as count FROM audit_events WHERE timestamp >= datetime('now', '-7 days') GROUP BY type ORDER BY count DESC`),
  cleanOldAudit: db.prepare(`DELETE FROM audit_events WHERE timestamp < datetime('now', '-90 days')`),
  cleanOldNotifications: db.prepare(`DELETE FROM notification_queue WHERE created_at < datetime('now', '-90 days')`),
};

// ═══════════════════════════════════════════════════════════
// BATCH JOBS — scheduled background tasks
// ═══════════════════════════════════════════════════════════
registerStandardJobs({
  db,
  piiVault,
  factStmts,
  piiStmts,
  monitorStmts,
  retentionMode: RETENTION_MODE,
});

// Opt-in auto-refresh of Common Data Set records (the daily domain_monitor
// already watches official pages; this re-ingests the newest registered CDS
// cycle). OFF by default because it does network I/O across many schools —
// enable with AUTO_REFRESH_CDS=1, tune cycle via CDS_REFRESH_CYCLE. Only
// data from operator-registered authoritative CDS links is ingested; nothing
// is fabricated. AP concept data is a curated catalog (no live source).
if (process.env.AUTO_REFRESH_CDS === "1") {
  const CDS_CYCLE = process.env.CDS_REFRESH_CYCLE || "2024-25";
  registerJob("cds_refresh", async () => {
    const { ingestBulk, getRepositoryIndex } = await import("./cds-ingest-pipeline.js");
    const index = await getRepositoryIndex();
    const targets = index.map((e) => e.name).filter(Boolean);
    if (!targets.length) return;
    console.log(`[CDS-REFRESH] Auto-refreshing ${targets.length} school(s) to cycle ${CDS_CYCLE}…`);
    const results = await ingestBulk(ragStmts, targets, { concurrency: 2, year: CDS_CYCLE });
    const ok = results.filter((r) => r.status === "ok" || r.status === "ok_with_overrides").length;
    console.log(`[CDS-REFRESH] Done: ${ok}/${results.length} ingested.`);
  }, 7 * 24 * 60 * 60 * 1000, { runOnStartup: false }); // weekly
  console.log(`[BOOT] AUTO_REFRESH_CDS enabled — weekly CDS re-ingest for cycle ${process.env.CDS_REFRESH_CYCLE || "2024-25"}.`);
}

startAllJobs();

// ═══════════════════════════════════════════════════════════
// SESSION MANAGEMENT
// ═══════════════════════════════════════════════════════════
// In-memory hot cache backed by a persistent SQLite table. Tokens
// used to live ONLY in this Map, which meant every backend restart
// (deploy, crash, `node --watch` reload) silently invalidated every
// active session — the browser still held a token the server no
// longer recognized, surfacing as "Invalid or expired session token"
// on the next call. Persisting to SQLite makes sessions survive
// restarts; the Map stays as a fast read path.
const sessionTokens = new Map();
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (was 1 hour)

// Persistent store. Token is hashed before storage so a DB leak
// doesn't hand out live bearer tokens.
db.exec(`
  CREATE TABLE IF NOT EXISTS session_tokens (
    token_hash   TEXT PRIMARY KEY,
    email_hash   TEXT NOT NULL,
    student_id   TEXT NOT NULL,
    expires_at   INTEGER NOT NULL,
    created_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_session_expires ON session_tokens(expires_at);
`);
const sessionStmts = {
  insert: db.prepare(`INSERT OR REPLACE INTO session_tokens (token_hash, email_hash, student_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`),
  get:    db.prepare(`SELECT email_hash, student_id, expires_at FROM session_tokens WHERE token_hash = ?`),
  touch:  db.prepare(`UPDATE session_tokens SET expires_at = ? WHERE token_hash = ?`),
  del:    db.prepare(`DELETE FROM session_tokens WHERE token_hash = ?`),
  cleanup:db.prepare(`DELETE FROM session_tokens WHERE expires_at < ?`),
};

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function createSessionToken(emailHash, studentId) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  sessionTokens.set(token, { emailHash, studentId, expiresAt });
  try {
    sessionStmts.insert.run(hashToken(token), emailHash, studentId, expiresAt, Date.now());
  } catch (e) {
    console.warn("[SESSION] persist failed (non-fatal):", e.message);
  }
  return token;
}

function validateToken(token) {
  if (!token) return null;
  const now = Date.now();
  // 1) Fast path — in-memory hot cache.
  let session = sessionTokens.get(token);
  if (session) {
    if (now > session.expiresAt) { sessionTokens.delete(token); try { sessionStmts.del.run(hashToken(token)); } catch {} return null; }
    session.expiresAt = now + TOKEN_TTL_MS;
    try { sessionStmts.touch.run(session.expiresAt, hashToken(token)); } catch {}
    return session;
  }
  // 2) Cold path — survived a restart, look it up in SQLite and
  //    re-hydrate the Map. This is what fixes "Invalid or expired
  //    session token" after a backend restart.
  try {
    const row = sessionStmts.get.get(hashToken(token));
    if (!row) return null;
    if (now > row.expires_at) { sessionStmts.del.run(hashToken(token)); return null; }
    const rehydrated = { emailHash: row.email_hash, studentId: row.student_id, expiresAt: now + TOKEN_TTL_MS };
    sessionTokens.set(token, rehydrated);
    sessionStmts.touch.run(rehydrated.expiresAt, hashToken(token));
    return rehydrated;
  } catch (e) {
    console.warn("[SESSION] DB lookup failed:", e.message);
    return null;
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessionTokens) {
    if (now > session.expiresAt) sessionTokens.delete(token);
  }
  try { sessionStmts.cleanup.run(now); } catch {}
}, 10 * 60 * 1000);

// ═══════════════════════════════════════════════════════════
// CRYPTO HELPERS
// ═══════════════════════════════════════════════════════════
function hashIP(ip) {
  return crypto.createHash("sha256").update(`ip_salt_cc:${ip}`).digest("hex").slice(0, 16);
}

function hashEmail(email) {
  return crypto.createHash("sha256").update(`email_salt_cc:${email.toLowerCase().trim()}`).digest("hex");
}

function encryptValue(plaintext) {
  const key = Buffer.from(ENCRYPTION_KEY, "hex");
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${tag}:${encrypted}`;
}

function decryptValue(blob) {
  try {
    const [ivHex, tagHex, encrypted] = blob.split(":");
    const key = Buffer.from(ENCRYPTION_KEY, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return null;
  }
}

function safeJSON(str, fallback) {
  try { return str ? JSON.parse(str) : fallback; }
  catch { return fallback; }
}

// ═══════════════════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════════════════
function requireStudentAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Student session token required. Include Authorization: Bearer <token>" });
  }
  const session = validateToken(auth.split(" ")[1]);
  if (!session) return res.status(401).json({ error: "Invalid or expired session token." });
  req.studentEmailHash = session.emailHash;
  req.studentId = session.studentId;
  next();
}

function requireCounselorAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Counselor Dashboard"');
    return res.status(401).json({ error: "Authentication required" });
  }
  const [user, pass] = Buffer.from(auth.split(" ")[1], "base64").toString().split(":");
  if (user !== COUNSELOR_USER || pass !== COUNSELOR_PASS) {
    return res.status(403).json({ error: "Invalid credentials" });
  }
  next();
}

// ─── Prestige adapter resolver ──────────────────────────────
// Prestige research requires Anthropic's native web_search tool. Prefer
// the student's Anthropic BYOK (so the student pays for their own research);
// fall back to the server's ANTHROPIC_API_KEY. Returns null when no
// Anthropic credentials are available — callers pass null through and the
// vectorizer records source:"unavailable" rather than throwing.
function snapshotToStudentProfile(snapshot, narrative = null) {
  return {
    gpa: { unweighted: snapshot.gpa_unweighted, weighted: snapshot.gpa_weighted },
    courses: safeJSON(snapshot.courses_json, []),
    apScores: safeJSON(snapshot.ap_scores_json, []),
    testScores: safeJSON(snapshot.test_scores_json, []),
    activities: safeJSON(snapshot.activities_json, []),
    goals: safeJSON(snapshot.goals_json, []),
    majorInterest: snapshot.major_interest,
    narrative: narrative?.narrativeText || null,
  };
}

async function callSimulationSidecar(pathname, options = {}) {
  const response = await fetch(`${SIM_URL}${pathname}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      "x-simulation-internal-token": SIM_INTERNAL_TOKEN,
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const err = new Error(data?.error || `Simulation sidecar returned ${response.status}`);
    err.status = response.status;
    throw err;
  }
  return data;
}

function resolvePrestigeAdapter(studentId) {
  try {
    if (studentId) {
      const byok = lookupStudentBYOK(piiStmts, piiVault, studentId);
      if (byok && byok.provider === "anthropic" && byok.apiKey) {
        return {
          provider: "anthropic",
          apiKey: byok.apiKey,
          baseUrl: byok.baseUrl || null,
          model: byok.models?.medium || resolveTierDefault("anthropic", "medium"),
        };
      }
    }
  } catch {
    // Non-fatal — fall through to server key.
  }
  if (ANTHROPIC_API_KEY) {
    return {
      provider: "anthropic",
      apiKey: ANTHROPIC_API_KEY,
      baseUrl: null,
      model: process.env.LLM_MEDIUM_MODEL || resolveTierDefault("anthropic", "medium"),
    };
  }
  return null;
}

// ───────────────────────────────────────────────────────────
// Shared per-student LLM closure (BYOK). Mirrors the inlined
// closure in /api/colleges/values so the generation endpoints
// (EC ideas, narrative draft) bill the student's own key and
// route web correctly per provider. Returns null byok when the
// student has no key on file so callers can 400 cleanly.
// ───────────────────────────────────────────────────────────
function buildStudentCallLLM(studentId) {
  const byok = lookupStudentBYOK(piiStmts, piiVault, studentId);
  if (!byok) return { byok: null, callLLM: null };
  const callLLM = async (args) => {
    const provIsAnthropic = byok.provider === "anthropic";
    const provIsOR = byok.provider === "openrouter";
    const rawTools = Array.isArray(args.tools) ? args.tools : [];
    const ANTHROPIC_ONLY_TOOL_RE = /^(web_search|web_fetch|text_editor|bash|computer|code_execution|str_replace_based_edit_tool)/;
    const passThruTools = provIsAnthropic
      ? rawTools
      : rawTools.filter(t => !ANTHROPIC_ONLY_TOOL_RE.test(t?.type || ""));
    const orModelIsAnthropic = provIsOR && /^anthropic\//.test(args.model || byok.models.large || "");
    const useORWebPlugin = provIsOR && args.wantsWeb && !orModelIsAnthropic;
    const orAllowedDomains = buildAllowedDomains(args.extraDomains);
    const result = await adapterCallLLM({
      provider: byok.provider,
      apiKey: byok.apiKey,
      baseUrl: byok.baseUrl,
      model: args.model || byok.models.medium || byok.models.large || CURRENT_TARGETS.sonnet,
      maxTokens: args.max_tokens,
      system: args.system,
      messages: args.messages,
      tools: passThruTools.length ? passThruTools : undefined,
      webPlugin: useORWebPlugin ? { enabled: true, allowedDomains: orAllowedDomains } : null,
    });
    try {
      ragStmts.insertUsage.run(studentId, `${byok.provider}:${args.model || byok.models.medium || byok.models.large}`, result?.usage?.input_tokens || 0, result?.usage?.output_tokens || 0, "personal");
    } catch { /* ignore */ }
    return result;
  };
  return { byok, callLLM };
}

// Parse the latest profile snapshot into a clean object for LLM prompts.
// PII-light: names/descriptions of the student's OWN activities/courses are
// their own data (no third-party PII), and BYOK calls bill the student.
function assembleProfileForGeneration(studentId) {
  const snap = ragStmts.getLatestSnapshot.get(studentId);
  if (!snap) return null;
  const profile = snap.profile_json ? safeParseJSON(snap.profile_json, {}) : {};
  return {
    gpaUnweighted: snap.gpa_unweighted ?? profile?.gpa?.unweighted ?? null,
    gpaWeighted: snap.gpa_weighted ?? profile?.gpa?.weighted ?? null,
    courses: safeParseJSON(snap.courses_json, []),
    apScores: safeParseJSON(snap.ap_scores_json, []),
    testScores: safeParseJSON(snap.test_scores_json, []),
    activities: safeParseJSON(snap.activities_json, []),
    majorInterest: snap.major_interest || profile?.majorInterest || null,
    goals: safeParseJSON(snap.goals_json, []),
  };
}

// Defensive JSON extraction from an LLM text response (mirrors
// college-values.js): strip ```json fences, else grab the first {...} or
// [...] block. Returns null on failure so callers never crash on bad output.
function parseLLMJson(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const m = cleaned.match(/[[{][\s\S]*[}\]]/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// Map a BYOK/adapter LLM error to an informative HTTP response instead of an
// opaque 500. Adapter errors carry { status, code, message, provider }
// (see llm-adapters). Passes through the upstream status (e.g. 429 rate limit,
// 401 bad key) so the UI can tell the student WHAT went wrong and what to do.
function respondLLMError(res, err, label) {
  const up = Number.isInteger(err?.status) ? err.status : null;
  const httpStatus = up === 499 ? 504 : (up && up >= 400 && up < 600 ? up : 502);
  console.error(`[${label}] LLM error${up ? ` (upstream ${up})` : ""}:`, err?.message);
  let friendly;
  if (up === 429) friendly = "Your AI provider is rate-limiting requests (HTTP 429). Wait a moment and retry, or switch to a paid web-capable model like deepseek/deepseek-v4-pro in your API-key settings.";
  else if (up === 401 || up === 403) friendly = "Your API key was rejected. Re-check or rotate it in the API-key settings.";
  else if (up === 402) friendly = "Your AI provider reports insufficient credit/quota for this request.";
  else friendly = "The AI request failed. Please try again; if it persists, try a different model in your API-key settings.";
  return res.status(httpStatus).json({
    error: friendly,
    detail: err?.message || null,
    code: err?.code || "llm_error",
    provider: err?.provider || null,
    upstreamStatus: up,
  });
}

// Shared narrative-draft generator — single home for the prompt so the
// manual /api/narrative/draft endpoint and the auto-regenerator produce
// identical, SKILL.md-grounded output. Returns the cleaned draft string
// (caller validates/saves). `existing` is the current active narrative (or
// null) so the model can refine rather than discard the student's voice.
async function generateNarrativeDraftText({ profile, existing, callLLM, byok, schoolBlock = "" }) {
  const summary = profileSummaryForPrompt(profile, existing);
  const prompt = `STUDENT PROFILE (their real data — the ONLY basis for the draft):
${summary}
${existing?.narrativeText ? `\nThe student's CURRENT narrative (refine, don't discard their voice):\n"${existing.narrativeText}"` : ""}${schoolBlock}

TASK: Write a DRAFT "narrative" — a ${NARRATIVE_MIN_CHARS}-${NARRATIVE_MAX_CHARS} character first-person self-presentation that captures who this student is academically and what intellectual thread connects their work (a "spike"). This is a starting point the student will edit — NOT an application essay.

RULES:
- First person ("I ..."). ${NARRATIVE_MIN_CHARS}-${NARRATIVE_MAX_CHARS} characters.
- Use ONLY evidence from the profile. Never invent awards, titles, or experiences.
- Name the intended major/field and 1-2 concrete activities or courses that show the thread.
- If the profile shows service, mentorship, inclusivity, or community impact, you may surface it as part of who this student is — but reflect ONLY what the evidence actually supports. Never manufacture empathy, motives, or character qualities the student did not state.
- Plain, authentic, specific — not flowery. One short paragraph.

This is editable scaffolding in the student's OWN voice — a starting point they will rewrite, not a finished essay and not words handed to them. Leave room for the student to add the lived detail and reflection only they can write; do not over-polish it into something that no longer sounds like them.

Return ONLY the draft text, no quotes, no preamble.`;

  const resp = await callLLM({
    model: byok.models?.medium || byok.models?.large,
    max_tokens: 700,
    system: "You draft a short first-person self-presentation grounded ONLY in the student's real profile. Never invent accomplishments. Return only the draft text.",
    messages: [{ role: "user", content: prompt }],
  });
  let draft = (resp?.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
  draft = draft.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/i, "").trim();
  if ((draft.startsWith('"') && draft.endsWith('"')) || (draft.startsWith("“") && draft.endsWith("”"))) {
    draft = draft.slice(1, -1).trim();
  }
  if (draft.length > NARRATIVE_MAX_CHARS) draft = draft.slice(0, NARRATIVE_MAX_CHARS);
  return draft;
}

// Auto-update the narrative when ECs/courses/major change. Fire-and-forget
// from the sync route — NEVER throws into the request path. Guarantees:
//   • Only auto-saves over a narrative that is itself source:'auto' (or when
//     none exists). A student-written narrative is NEVER overwritten.
//   • No-ops when the profile fingerprint is unchanged (no redundant LLM).
//   • Skips silently when there's no BYOK key or budget is exhausted.
const AUTO_NARRATIVE_TRIGGERS = new Set([
  "ec_added", "ec_leadership", "course_added", "course_updated", "major_changed",
]);
async function maybeAutoRegenerateNarrative(studentId, changes) {
  try {
    const relevant = Array.isArray(changes) && changes.some(c => AUTO_NARRATIVE_TRIGGERS.has(c?.type));
    if (!relevant) return { skipped: "no_relevant_change" };

    const profile = assembleProfileForGeneration(studentId);
    if (!profile) return { skipped: "no_profile" };
    const fp = computeProfileFingerprint(profile);
    const existing = getActiveNarrative(ragStmts.narrative, studentId);

    // Protect the student's voice: never overwrite a hand-written narrative.
    if (existing && existing.source === "student") return { skipped: "student_written" };
    // Nothing material changed since the last auto-narrative.
    if (existing && existing.source === "auto" && existing.profileFingerprint === fp) {
      return { skipped: "fingerprint_unchanged" };
    }

    const gate = checkBudget(piiVault, ragStmts, studentId);
    if (!gate.allowed) return { skipped: "budget" };
    const { byok, callLLM } = buildStudentCallLLM(studentId);
    if (!byok) return { skipped: "no_byok" };

    // Tailor the auto-narrative toward the student's saved target schools.
    let schoolBlock = "";
    try {
      const priorities = await getSchoolPriorities(resolveTargetSchools(studentId, null));
      schoolBlock = schoolPrioritiesPromptBlock(priorities);
    } catch { /* non-fatal */ }
    const draft = await generateNarrativeDraftText({ profile, existing, callLLM, byok, schoolBlock });
    try {
      const saved = saveNarrative(ragStmts.narrative, studentId, draft, { source: "auto", profileFingerprint: fp });
      console.log(`[AUTO-NARRATIVE] regenerated for ${String(studentId).slice(0, 8)} (${saved.id.slice(0, 8)})`);
      return { regenerated: true, id: saved.id };
    } catch (e) {
      // Draft failed validation (too short/long) — leave prior narrative intact.
      console.warn("[AUTO-NARRATIVE] draft rejected:", e.message);
      return { skipped: "invalid_draft" };
    }
  } catch (err) {
    console.warn("[AUTO-NARRATIVE] failed:", err.message);
    return { skipped: "error" };
  }
}

// ───────────────────────────────────────────────────────────
// Target-school tailoring — shared by the EC-idea / narrative /
// course tools so their output is oriented toward the specific
// universities the student wants. Source priority: explicit request
// override → the student's saved goal schools.
// ───────────────────────────────────────────────────────────
function resolveTargetSchools(studentId, requested) {
  if (Array.isArray(requested) && requested.length) {
    return requested
      .map((s) => String(s?.schoolName || s?.name || s || "").trim())
      .filter(Boolean)
      .slice(0, 6);
  }
  try {
    const snap = ragStmts.getLatestSnapshot.get(studentId);
    const goals = safeParseJSON(snap?.goals_json, []);
    const goalUnitIds = extractGoalUnitIds(goals);
    const fallbackRows = goalUnitIds
      .map((u) => db.prepare("SELECT unit_id, name FROM baseline_colleges WHERE unit_id = ?").get(u))
      .filter(Boolean);
    return extractTargetSchoolNames(goals, fallbackRows).slice(0, 6);
  } catch {
    return [];
  }
}

// For each target school, pull its REAL, citeable priorities from the
// validated Common Data Set (C7 factor weights + admit context). Name-only
// fallback when there's no validated record. Async (dynamic CDS import,
// matching the bundle's pattern).
const C7_PRIORITY_WEIGHTS = Object.freeze({ very_important: 1.0, important: 0.7, considered: 0.35, not_considered: 0.0 });
async function getSchoolPriorities(schoolNames) {
  if (!Array.isArray(schoolNames) || !schoolNames.length) return [];
  let loadValidatedRecord;
  try { ({ loadValidatedRecord } = await import("./cds-validator.js")); }
  catch { return schoolNames.map((s) => ({ school: s, hasData: false })); }
  const slugify = (n) => String(n).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const out = [];
  for (const name of schoolNames) {
    let rec = null;
    try { rec = loadValidatedRecord(ragStmts, slugify(name)); } catch { /* ignore */ }
    if (!rec) { out.push({ school: name, hasData: false }); continue; }
    const factors = Object.entries(rec.c7 || {})
      .map(([k, label]) => ({ factor: k, label, weight: C7_PRIORITY_WEIGHTS[label] ?? null }))
      .filter((f) => f.weight != null)
      .sort((a, b) => (b.weight || 0) - (a.weight || 0));
    out.push({
      school: rec.school || name,
      hasData: true,
      admitRate: rec.overallAdmitRate ?? null,
      topFactors: factors.filter((f) => f.weight >= 0.7).map((f) => f.factor),
      rigorWeight: C7_PRIORITY_WEIGHTS[rec.c7?.rigor] ?? null,
      c7: rec.c7 || null,
      sourceUrl: rec.sourceUrl || null,
    });
  }
  return out;
}

// Promptable block describing what the target schools value. Empty when no
// targets, so callers can append unconditionally.
function schoolPrioritiesPromptBlock(priorities) {
  if (!Array.isArray(priorities) || !priorities.length) return "";
  const lines = priorities.map((p) => {
    if (!p.hasData) return `  • ${p.school} (no Common Data Set on file — use general knowledge cautiously, don't invent)`;
    const fac = (p.topFactors || []).map((f) => String(f).replace(/_/g, " ")).join(", ");
    return `  • ${p.school}${p.admitRate != null ? ` (admit ~${p.admitRate}%)` : ""}${fac ? ` — most-valued factors: ${fac}` : ""}`;
  });
  return `\n\nTARGET SCHOOLS the student is aiming for — tailor toward what THESE schools value (from their Common Data Set where available; do NOT name the schools in the output text, just let their priorities shape emphasis):\n${lines.join("\n")}`;
}

// ───────────────────────────────────────────────────────────
// Admissions calendar awareness — the consultant agent needs to know
// today's date, the current application-cycle phase, typical US deadlines,
// and approximate high-school breaks. Deterministic from the server clock
// (always fresh), so the agent is never date-blind even without web access.
// ───────────────────────────────────────────────────────────
function buildAdmissionsCalendar(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1; // 1..12
  // A senior applying in the fall of `cycleStartYear` matriculates the next
  // fall (`cycleEntryYear`). The cycle rolls forward to the NEXT season once
  // RD season is over (February onward): from Feb–Jul the just-finished
  // cycle's EA/ED/RD/deposit dates are all in the past, so the relevant
  // deadlines to outline are the UPCOMING fall's. January is the one month
  // still inside the active RD window, so it stays on that cycle.
  const cycleStartYear = m >= 2 ? y : y - 1;
  const cycleEntryYear = cycleStartYear + 1;
  let phase;
  if (m >= 8 && m <= 10) phase = "early-application season — EA/ED apps due ~Nov 1";
  else if (m === 11) phase = "EA/ED deadlines now; RD apps being finalized";
  else if (m === 12) phase = "early decisions releasing; RD apps due ~Jan 1";
  else if (m === 1) phase = "regular-decision deadlines (~Jan 1-15)";
  else phase = "planning the upcoming cycle — research, essays, and target list for applications this fall";
  return {
    today: now.toISOString().slice(0, 10),
    cycleStartYear,
    cycleEntryYear,
    schoolYear: `${cycleStartYear}–${cycleEntryYear}`,
    applicationCycle: `Class entering Fall ${cycleEntryYear}`,
    phase,
    typicalDeadlines: {
      earlyEaEd: `~Nov 1 ${cycleStartYear} (some Nov 15)`,
      regularDecision: `~Jan 1–15 ${cycleEntryYear}`,
      eaEdDecisionsRelease: `mid–late Dec ${cycleStartYear}`,
      rdDecisionsRelease: `mid-Mar–early-Apr ${cycleEntryYear}`,
      fafsaOpens: `Oct 1 ${cycleStartYear}`,
      cssProfilePriority: `Nov ${cycleStartYear}–Feb ${cycleEntryYear} (varies)`,
      financialAidPriority: `often the ED/EA date, else ~Feb 1 ${cycleEntryYear}`,
      nationalDepositDeadline: `May 1 ${cycleEntryYear}`,
    },
    typicalHsBreaks: {
      summer: `early-June–late-Aug ${cycleStartYear}`,
      thanksgiving: `late Nov ${cycleStartYear}`,
      winter: `~Dec 20 ${cycleStartYear}–early Jan ${cycleEntryYear}`,
      spring: `~Mar–Apr ${cycleEntryYear}`,
    },
    // Concrete ISO fallbacks (parseable) so the UI can always create dated
    // deadline entries even when no per-school web data is available.
    typicalISO: {
      earlyEaEd: `${cycleStartYear}-11-01`,
      regularDecision: `${cycleEntryYear}-01-01`,
      financialAidPriority: `${cycleEntryYear}-02-01`,
      fafsaOpens: `${cycleStartYear}-10-01`,
      nationalDepositDeadline: `${cycleEntryYear}-05-01`,
    },
    note: "Approximate US norms — exact dates vary by school and year; verify on each school's admissions/financial-aid site.",
  };
}

// Best-effort per-school deadline lookup via the student's BYOK web LLM
// (large/reasoning tier for web grounding). Returns one row per school with
// the current-cycle EA/ED/RD/financial-aid/decision/deposit dates. Throws on
// hard failure (caller falls back to the typical calendar).
async function fetchSchoolDeadlinesViaWeb(callLLM, byok, schoolNames, cycleEntryYear) {
  const list = schoolNames.slice(0, 8).map((s, i) => `${i + 1}. ${s}`).join("\n");
  const extraDomains = [];
  const tools = [makeWebSearchTool(extraDomains), makeWebFetchTool(extraDomains)];
  const prompt = `Find the admissions & financial-aid deadlines for the CURRENT cycle (students entering Fall ${cycleEntryYear}) for these universities. Use web search of each school's official admissions/financial-aid pages.

SCHOOLS:
${list}

For each school report (ISO format YYYY-MM-DD; use null if it genuinely doesn't offer that round or you can't verify):
- ea: Early Action deadline
- ed: Early Decision deadline (and ED II if any)
- rd: Regular Decision deadline
- financialAid: CSS Profile / FAFSA / institutional aid priority deadline
- decisionRelease: when admission decisions are released
- commitBy: enrollment deposit / reply-by date

Return ONLY a JSON array, one object per school, no prose:
[
  { "school": "<name>", "ea": "<date or null>", "ed": "<date or null>", "rd": "<date or null>", "financialAid": "<date or null>", "decisionRelease": "<date or null>", "commitBy": "<date or null>", "source": "<url>" }
]`;
  // Deadline lookup is a web-grounded research task — pin it to DeepSeek V4
  // Pro on OpenRouter (web-capable, robust, not a rate-limited free model
  // that 429s). For non-OpenRouter providers, use the student's large tier.
  const deadlineModel = byok.provider === "openrouter"
    ? "deepseek/deepseek-v4-pro"
    : (byok.models?.large || byok.models?.medium);
  const resp = await callLLM({
    model: deadlineModel,
    max_tokens: 8192,
    system: "You are a meticulous admissions-deadline researcher. Report real dates from official sources only; use null when unsure. Output ONLY the requested JSON array.",
    messages: [{ role: "user", content: prompt }],
    tools,
    wantsWeb: true,
    extraDomains,
  });
  const text = (resp?.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  const parsed = parseLLMJson(text);
  const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.schools) ? parsed.schools : []);
  const clean = (v) => (v == null || v === "" ? null : String(v).slice(0, 80));
  return arr
    .map((it) => ({
      school: String(it?.school || "").slice(0, 120),
      deadlines: {
        ea: clean(it?.ea), ed: clean(it?.ed), rd: clean(it?.rd),
        financialAid: clean(it?.financialAid), decisionRelease: clean(it?.decisionRelease), commitBy: clean(it?.commitBy),
      },
      source: it?.source ? String(it.source).slice(0, 400) : null,
    }))
    .filter((x) => x.school);
}

// Cooldown so a school whose CDS the web can't find isn't re-queried (and
// re-billed) on every request. Shares the live-fetch cooldown window.
const cdsWebAttemptAt = new Map(); // slug -> epoch ms of last web attempt

async function searchCdsViaWebAndPersist(schoolName, callLLM, byok) {
  if (!schoolName || !callLLM || !byok) return null;
  const slug = slugifySchoolName(schoolName);
  if (!slug) return null;
  const last = cdsWebAttemptAt.get(slug) || 0;
  if (Date.now() - last < CDS_LIVE_COOLDOWN_MS) return null;
  cdsWebAttemptAt.set(slug, Date.now());
  try {
    const rec = await extractCdsViaWeb({ callLLM, byok, schoolName });
    if (!rec) { console.log(`[cds/web] no CDS found for ${schoolName}`); return null; }
    const { persistAndValidate } = await import("./cds-validator.js");
    await persistAndValidate(ragStmts, rec, { sourceKind: "web_llm", sourceUrl: rec.sourceUrl });
    console.log(`[cds/web] AI web-read CDS for ${schoolName} → ${slug}`);
    return resolveStoredCdsRecord(ragStmts, { schoolName, slug });
  } catch (e) {
    console.warn(`[cds/web] failed for ${schoolName}:`, String(e.message).slice(0, 160));
    return null;
  }
}

// Light web fallback for JUST the latest-season admit rate, when there's no
// CDS and no IPEDS baseline number. Persistently cached (so it never re-bills
// for the same school) and cooldown-guarded against repeated misses. Returns
// { admitRatePercent, season, sourceUrl } or null.
const admitRateWebAttemptAt = new Map(); // slug -> epoch ms of last attempt

async function fetchAdmitRateViaWebCached(schoolName, callLLM, byok) {
  if (!schoolName || !callLLM || !byok) return null;
  const slug = slugifySchoolName(schoolName);
  if (!slug) return null;

  const cached = getScorecardQueryCache("web_admit_rate", { slug });
  if (cached?.data) return cached.data.admitRatePercent != null ? cached.data : null;

  const last = admitRateWebAttemptAt.get(slug) || 0;
  if (Date.now() - last < CDS_LIVE_COOLDOWN_MS) return null;
  admitRateWebAttemptAt.set(slug, Date.now());
  try {
    const r = await extractAdmitRateViaWeb({ callLLM, byok, schoolName });
    if (r?.admitRatePercent != null) {
      putScorecardQueryCache("web_admit_rate", { slug }, r); // cache so we don't re-bill
      console.log(`[admit/web] ${schoolName} → ${r.admitRatePercent}% (${r.season || "season n/a"})`);
      return r;
    }
    console.log(`[admit/web] no admit rate found for ${schoolName}`);
  } catch (e) {
    console.warn(`[admit/web] failed for ${schoolName}:`, String(e.message).slice(0, 160));
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
// EMAIL TRANSPORT
// ═══════════════════════════════════════════════════════════
let mailTransport = null;
if (SMTP_HOST) {
  mailTransport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { minVersion: "TLSv1.2" },
  });
  mailTransport.verify()
    .then(() => console.log("[SMTP] Connection verified"))
    .catch(err => console.error("[SMTP] Verification failed:", err.message));
}

async function sendCrisisEmail(to, studentHint, notificationId) {
  if (!mailTransport) {
    console.warn(`[EMAIL] SMTP not configured — notification ${notificationId} queued but not sent.`);
    return { sent: false, error: "SMTP not configured" };
  }
  try {
    const info = await mailTransport.sendMail({
      from: SMTP_FROM,
      to,
      subject: "College Counselor — Safety Alert",
      text: [
        `Dear Parent/Guardian,`,
        ``,
        `This is an automated notification from the College Counselor app.`,
        ``,
        `A message from ${studentHint || "your student"} was flagged by our safety system `,
        `as potentially indicating distress. For privacy, no message content is shared — `,
        `this is simply an alert so you can check in with them.`,
        ``,
        `If you believe this is an emergency:`,
        `  • Call 911 for immediate danger`,
        `  • Call 988 (Suicide & Crisis Lifeline) for mental health emergencies`,
        `  • Text HOME to 741741 (Crisis Text Line)`,
        ``,
        `This alert was generated at ${new Date().toISOString()}.`,
        ``,
        `— College Counselor Safety System`,
      ].join("\n"),
    });
    console.log(`[EMAIL] Crisis notification sent: ${info.messageId}`);
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[EMAIL] Failed to send notification ${notificationId}:`, err.message);
    return { sent: false, error: err.message };
  }
}

async function processNotificationQueue() {
  const pending = stmts.getPendingNotifications.all();
  for (const notif of pending) {
    const email = decryptValue(notif.recipient_email_encrypted);
    if (!email) {
      stmts.updateNotificationStatus.run("failed", "Decryption failed", notif.id);
      continue;
    }
    const result = await sendCrisisEmail(email, notif.student_hint, notif.id);
    stmts.updateNotificationStatus.run(result.sent ? "sent" : "failed", result.error || null, notif.id);
  }
}

setInterval(processNotificationQueue, 30_000);
setTimeout(processNotificationQueue, 5_000);

// ═══════════════════════════════════════════════════════════
// EXPRESS APP
// ═══════════════════════════════════════════════════════════
const app = express();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:"],
    },
  },
  strictTransportSecurity: NODE_ENV === "production" ? { maxAge: 31536000, includeSubDomains: true } : false,
}));

app.use(cors({
  origin: (origin, cb) => {
    if (!origin && NODE_ENV !== "production") return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error("CORS: Origin not allowed"));
  },
  credentials: true,
}));

app.use(express.json({ limit: "20mb" }));

app.use((req, _res, next) => {
  req.requestId = crypto.randomUUID();
  next();
});

// ── Rate limiters ──
const apiLimiter = rateLimit({ windowMs: 60_000, max: 30, keyGenerator: (req) => hashIP(req.ip), message: { error: "Too many requests." } });
const auditLimiter = rateLimit({ windowMs: 60_000, max: 60, keyGenerator: (req) => hashIP(req.ip) });
const notifyLimiter = rateLimit({ windowMs: 300_000, max: 3, keyGenerator: (req) => hashIP(req.ip), skipFailedRequests: true, message: { error: "Notification rate limit exceeded." } });
const studentLimiter = rateLimit({ windowMs: 60_000, max: 30, keyGenerator: (req) => hashIP(req.ip) });
const scorecardLimiter = rateLimit({ windowMs: 60_000, max: 40, keyGenerator: (req) => hashIP(req.ip), message: { error: "Too many college search requests." } });


// ═══════════════════════════════════════════════════════════
// LLM — provider-neutral proxy + provider metadata
// ═══════════════════════════════════════════════════════════

const MAX_TOKENS_LIMIT = 4096;
const LLM_TIMEOUT_MS = 60_000;

// GET /api/llm/providers — frontend-facing provider catalog
// Returns the list of supported LLM providers with their key prefix hints,
// default base URLs (where applicable), known models, and tier defaults.
// No auth required — this is a read-only registry.
app.get("/api/llm/providers", apiLimiter, (_req, res) => {
  try {
    // Overlay Anthropic's "current recommended" defaults with the values
    // from claude-model-migration.js so the BYOK prerequisite UI and the
    // boot/on-access migration agree on what "current" means. When the
    // /claude-api skill ships a new Opus / Sonnet / Haiku, bumping
    // CURRENT_TARGETS is the only edit needed — both the migration and
    // the providers endpoint pick it up.
    const providers = listProviders().map(p => {
      if (p.id === "anthropic") {
        return {
          ...p,
          defaults: {
            ...(p.defaults || {}),
            small: CURRENT_TARGETS.haiku,
            medium: CURRENT_TARGETS.sonnet,
            large: CURRENT_TARGETS.opus,
          },
        };
      }
      // OpenRouter's recommended defaults are refreshed live (propose-only) so
      // the BYOK "Update models" prompt can offer newer models for approval.
      if (p.id === "openrouter") {
        return {
          ...p,
          defaults: { ...(p.defaults || {}), ...OPENROUTER_TARGETS },
        };
      }
      return p;
    });
    res.json({
      version: "1.1",
      providers,
      tierLabels: {
        small: "small — routing, classification, OCR validation",
        medium: "medium — synthesis, coaching, trend analysis",
        large: "large — essay critique, cross-source conflict resolution",
      },
    });
  } catch (err) {
    console.error("[LLM providers] error:", err.message);
    res.status(500).json({ error: "Failed to list providers" });
  }
});

// GET /api/methodology — full transparency surface: EC factor weights, scoring
// logic, narrative-quality policy, data sources + freshness, and model-
// migration status. Read-only, no auth — the whole point is openness.
app.get("/api/methodology", apiLimiter, (_req, res) => {
  try {
    res.json(buildMethodology({
      claudeTargets: { haiku: CURRENT_TARGETS.haiku, sonnet: CURRENT_TARGETS.sonnet, opus: CURRENT_TARGETS.opus },
      claudeLastRefresh: claudeTargetsLastRefresh,
      providerMigration: { openrouter: OPENROUTER_STATUS },
      scorecardConfigured: !!SCORECARD_API_KEY,
      baselineYear: 2024,
      domainMonitorDaily: true,
    }));
  } catch (err) {
    console.error("[methodology] error:", err.message);
    res.status(500).json({ error: "Failed to build methodology" });
  }
});

// POST /api/llm — provider-neutral chat completion
// Body: {
//   provider?, baseUrl?, apiKey?, model?, tier?,  // BYOK overrides
//   system?, messages, max_tokens?, temperature?,
//   anthropic_beta?  // Anthropic PDF passthrough
// }
// Flow mirrors /api/anthropic but routes through the adapter layer.
app.post("/api/llm", apiLimiter, async (req, res) => {
  try {
    const payload = req.body;
    if (!payload || typeof payload !== "object") {
      return res.status(400).json({ error: "Invalid request body" });
    }
    if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
      return res.status(400).json({ error: "Messages array is required" });
    }
    if (payload.messages.length > 50) {
      return res.status(400).json({ error: "Too many messages" });
    }
    if (payload.model != null && !isReasonableModelId(payload.model)) {
      return res.status(400).json({ error: "Invalid model id. Must be 3-120 chars, no whitespace or control characters." });
    }
    const maxTokens = Math.min(Number(payload.max_tokens) || 1024, MAX_TOKENS_LIMIT);

    // ── Identify student ──
    let studentId = null;
    const auth = req.headers.authorization;
    if (auth && auth.startsWith("Bearer ")) {
      const session = validateToken(auth.split(" ")[1]);
      if (session) studentId = session.studentId;
    }

    // ── Budget cap enforcement ──
    // Refuse the call if month-to-date spend has hit the user-defined cap.
    if (studentId) {
      const gate = checkBudget(piiVault, ragStmts, studentId);
      if (!gate.allowed) {
        return res.status(402).json({
          error: gate.reason,
          code: "budget_exceeded",
          monthSpendUsd: gate.spend,
          monthlyBudgetUsd: gate.cap,
        });
      }
    }

    // ── Input screening ──
    const lastMessage = payload.messages[payload.messages.length - 1];
    const userText = typeof lastMessage?.content === "string"
      ? lastMessage.content
      : Array.isArray(lastMessage?.content)
          ? lastMessage.content.filter((b) => b?.type === "text").map((b) => b.text).join("\n")
          : "";
    const inputScreen = screenInput(userText);
    if (inputScreen.blocked) {
      stmts.insertAudit.run(crypto.randomUUID(), new Date().toISOString(), "input_blocked", studentId?.slice(0, 12) || "", inputScreen.reason.slice(0, 200), hashIP(req.ip));
      return res.status(400).json({ error: inputScreen.reason, blocked: true });
    }

    // ── Topic classification + crisis gate ──
    const classification = classifyTopic(userText);
    if (classification.topicType === TOPIC_TYPES.CRISIS) {
      const crisisResponse = buildCrisisResponse(req.headers["accept-language"]?.startsWith("ko") ? "ko" : "en-US");
      stmts.insertAudit.run(crypto.randomUUID(), new Date().toISOString(), "crisis_detected", studentId?.slice(0, 12) || "", userText.slice(0, 100), hashIP(req.ip));
      return res.json({
        content: [{ type: "text", text: crisisResponse.message }],
        _meta: { deterministic: true, topicType: "CRISIS", modelTier: "NONE", crisisResources: crisisResponse.resources },
      });
    }

    // ── Korea PIPA cross-border consent for student-identified sessions ──
    if (studentId) {
      const crossBorder = hasActiveConsent(piiStmts, studentId, "cross_border_transfer");
      if (!crossBorder.hasConsent) {
        return res.status(403).json({
          error: "Cross-border data transfer consent required before AI features can be used.",
          consentRequired: "cross_border_transfer",
          blocked: true,
        });
      }
    }

    // ── Resolve adapter config ──
    // Priority: request body → student BYOK → server env.
    const byok = studentId ? lookupStudentBYOK(piiStmts, piiVault, studentId) : null;
    const provider =
      payload.provider ||
      (byok && byok.provider) ||
      detectProvider({ apiKey: payload.apiKey, baseUrl: payload.baseUrl }) ||
      (process.env.ANTHROPIC_API_KEY ? PROVIDERS.ANTHROPIC : null) ||
      (process.env.OPENAI_API_KEY ? (process.env.OPENAI_BASE_URL ? PROVIDERS.OPENAI_COMPAT : PROVIDERS.OPENAI) : null) ||
      (process.env.GOOGLE_API_KEY ? PROVIDERS.GOOGLE : null);
    if (!provider) {
      return res.status(503).json({ error: "No LLM provider configured." });
    }

    const apiKey =
      payload.apiKey ||
      (byok && byok.apiKey) ||
      (provider === "anthropic"   ? process.env.ANTHROPIC_API_KEY :
       provider === "openai"      ? process.env.OPENAI_API_KEY    :
       provider === "google"      ? process.env.GOOGLE_API_KEY    :
       provider === "openai_compat" ? process.env.OPENAI_API_KEY : null);
    const baseUrl = payload.baseUrl || (byok && byok.baseUrl) ||
                    (provider === "openai_compat" ? process.env.OPENAI_BASE_URL : null);

    const keySource =
      payload.apiKey ? "request" :
      byok ? "byok" :
      "server";

    // Resolve the model: explicit override > byok tier default > env > registry
    const tier = payload.tier || "small";
    const byokModel = byok ? byok.models?.[tier] : null;
    const envModel =
      tier === "small"  ? process.env.LLM_SMALL_MODEL  :
      tier === "medium" ? process.env.LLM_MEDIUM_MODEL :
      tier === "large"  ? process.env.LLM_LARGE_MODEL  : null;
    const model = payload.model || byokModel || envModel || resolveTierDefault(provider, tier);
    if (!model) {
      return res.status(400).json({ error: `No model configured for provider "${provider}" at tier "${tier}".` });
    }
    if (!isReasonableModelId(model)) {
      return res.status(400).json({ error: "Resolved model id failed shape check." });
    }

    if (!apiKey && provider !== "ollama" && provider !== "lmstudio") {
      return res.status(503).json({ error: `No API key available for provider "${provider}".` });
    }

    // ── AP-concept lazy update (non-fatal, background) ──
    if (studentId && ragStmts.apConcepts && userText) {
      try {
        processStudentInputForConcepts(ragStmts.apConcepts, studentId, userText, { source: "prompt" });
      } catch (conceptErr) {
        console.error("[AP concepts] classification on prompt failed:", conceptErr);
      }
    }

    // ── Credible-sources web tools ──
    // For Anthropic providers, append web_search + web_fetch tools restricted
    // to the .edu / .gov / common-application allowlist (see
    // credible-sources.js). The student can pass `extraDomains: [...]` in
    // the request body when they want to research a specific school whose
    // domain isn't on the default list — only .edu/.gov/.org TLDs are
    // accepted as runtime additions. The model decides whether to invoke
    // the tools; callers don't have to manage that.
    const inheritedTools = Array.isArray(payload.tools) ? payload.tools : [];
    const wantsWeb = payload.web !== false; // opt-out via {web:false}
    let toolset = inheritedTools;
    if (wantsWeb && provider === "anthropic") {
      toolset = [
        ...inheritedTools.filter(t => !/^web_(search|fetch)_/.test(t?.type || "")),
        makeWebSearchTool(payload.extraDomains),
        makeWebFetchTool(payload.extraDomains),
      ];
    }

    // ── Call adapter ──
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
    let resp;
    try {
      resp = await adapterCallLLM({
        provider,
        apiKey,
        baseUrl,
        model,
        messages: payload.messages,
        system: payload.system,
        maxTokens,
        tools: toolset.length ? toolset : undefined,
        temperature: typeof payload.temperature === "number" ? payload.temperature : undefined,
        anthropicBeta: payload.anthropic_beta || req.headers["anthropic-beta"] || undefined,
        signal: controller.signal,
      });
    } catch (llmErr) {
      clearTimeout(timer);
      const status = llmErr?.status && Number.isFinite(llmErr.status) ? llmErr.status : 502;
      const keyRejected = llmErr?.code === "auth_rejected";
      console.error(`[LLM] ${provider}/${model} ${status}: ${llmErr?.message || "unknown"}`);
      return res.status(status).json({
        error: { message: llmErr?.message || "LLM error", keyError: keyRejected, code: llmErr?.code || "unknown", provider },
      });
    }
    clearTimeout(timer);

    // ── Output screening ──
    if (Array.isArray(resp.content)) {
      for (const block of resp.content) {
        if (block?.type === "text" && block.text) {
          const outputScreen = screenOutput(block.text);
          if (outputScreen.modified) block.text = outputScreen.text;
          block.text = restorePII(block.text, resp._tokenMap);
        }
      }
    }

    // ── Review queue ──
    try {
      if (shouldTriggerReview(classification, { content: resp.content })) {
        submitForReview(reviewStmts, {
          reviewType: "model_output",
          studentId: studentId || "anonymous",
          topicType: classification.topicType,
          evidence: JSON.stringify({ query: userText.slice(0, 200), response: JSON.stringify(resp.content).slice(0, 500) }),
          confidenceScore: classification.confidence,
        });
      }
    } catch (reviewErr) {
      console.warn("[LLM] Review queue insert failed (non-fatal):", reviewErr.message);
    }

    // ── Usage logging — key_source includes provider:model for audit trails ──
    if (studentId) {
      try {
        ragStmts.insertUsage.run(
          studentId,
          `${provider}:${model}`,
          resp.usage?.input_tokens || 0,
          resp.usage?.output_tokens || 0,
          keySource,
        );
      } catch (usageErr) {
        console.warn("[LLM] Usage logging failed:", usageErr.message);
      }
    }

    res.json({
      content: resp.content,
      usage: resp.usage,
      model: resp.model,
      stop_reason: resp.stop_reason,
      _meta: {
        provider,
        keySource,
        topicType: classification.topicType,
        modelTier: classification.modelTier,
        inputScreened: inputScreen.redacted,
        redaction: resp._redaction || null,
        ai_disclosure: {
          system: "College Counselor AI",
          advisory_only: true,
          provider,
          model: resp.model,
        },
      },
    });
  } catch (err) {
    console.error("[LLM] Internal error:", err.message);
    res.status(500).json({ error: { message: "Internal proxy error" } });
  }
});


// ═══════════════════════════════════════════════════════════
// GET /api/context/bundle — SKILL-FACING CONTEXT HARNESS
// ═══════════════════════════════════════════════════════════
// Collapses the four granular endpoints (/api/rag/context,
// /api/ec/strength, /api/directionality, /api/ap-concepts/vectors) into a
// single round-trip designed for the `collegeapp-ai` Claude Code skill.
//
// The returned shape is declared stable at `version: "1.1"` — consumers
// should consult the SKILL.md in skills/collegeapp-ai/ for the contract.
// Bumped from 1.0 when the EC strength vector gained a 5th factor ("prestige")
// backed by competition-research.js.
//
// Every field is PII-screened: names → [STUDENT], emails → [EMAIL], raw
// activity JSON is never included.
app.get("/api/context/bundle", studentLimiter, requireStudentAuth, async (req, res) => {
  try {
    const studentId = req.studentId;
    const locale = resolveLocale(req);

    // ── RAG context (numeric/categorical, [STUDENT]-placeheld) ──
    const focus = typeof req.query.focus === "string" ? req.query.focus : "holistic";
    const rag = assembleRAGContext(ragStmts, studentId, focus);
    if (rag?.error) return res.status(404).json({ version: "1.1", error: rag.error, locale });

    // ── EC strength vectors ──
    // Friendly labels default ON — Jiyeon UX audit F11 feedback was that
    // an opt-in flag meant every forgotten caller leaked engineer strings
    // to the student. Callers that want the lean raw shape (the skill's
    // tokens-matter path) can pass ?raw=1 to opt out.
    const wantRaw =
      req.query.raw === "1" || req.query.raw === "true" || req.query.friendly === "0";
    const wantFriendly = !wantRaw;
    let ecStrength = null;
    try {
      const rows = ragStmts.strength?.getByStudent?.all(studentId) || [];
      const vectors = rows
        .map(toStrengthPublicShape)
        .filter(Boolean)
        .map((v) => {
          if (!wantFriendly) return v;
          const explanation = getPrestigeExplanation(ragStmts, v.ecName);
          return enrichECVectorWithFriendly(v, explanation);
        });
      ecStrength = {
        count: rows.length,
        factors: STRENGTH_FACTORS,
        tiers: Object.values(TIERS),
        vectors,
        ...(wantFriendly
          ? {
              friendlyLegend: {
                tiers: TIER_FRIENDLY,
                prestigeSources: PRESTIGE_SOURCE_FRIENDLY,
                factors: FACTOR_FRIENDLY,
              },
            }
          : {}),
      };
    } catch (err) {
      console.warn("[context/bundle] EC strength fetch failed:", err.message);
      ecStrength = { count: 0, factors: STRENGTH_FACTORS, tiers: Object.values(TIERS), vectors: [], _warning: "fetch_failed" };
    }

    // ── AP concept vectors ──
    let apConcepts = null;
    try {
      const subjectVectors = ragStmts.apConcepts?.getAllSubjectVectors?.all(studentId) || [];
      const studentConcepts = ragStmts.apConcepts?.getAllStudentConcepts?.all(studentId) || [];
      const conceptsBySubject = new Map();
      for (const row of studentConcepts) {
        if (!conceptsBySubject.has(row.subject_id)) conceptsBySubject.set(row.subject_id, []);
        conceptsBySubject.get(row.subject_id).push({
          concept_id: row.concept_id,
          mastery: row.mastery,
          last_signal: row.last_signal,
          evidence_count: row.evidence_count,
          is_overridden: Boolean(row.is_overridden),
        });
      }
      apConcepts = {
        subjects: subjectVectors.map((v) => ({
          subject_id: v.subject_id,
          subject_vector: v.subject_vector,
          weighted_total: v.weighted_total,
          concept_count: v.concept_count,
          concepts: conceptsBySubject.get(v.subject_id) || [],
        })),
      };
    } catch (err) {
      console.warn("[context/bundle] AP concepts fetch failed:", err.message);
      apConcepts = { subjects: [], _warning: "fetch_failed" };
    }

    // ── Directionality vector ──
    let directionality = null;
    try {
      const dv = ragStmts.directionality?.getByStudent?.get(studentId);
      if (dv) {
        directionality = {
          factors: {
            academic_momentum: dv.academic_momentum,
            test_score_strength: dv.test_score_strength,
            major_academic_fit: dv.major_academic_fit,
            rigor_and_challenge: dv.rigor_and_challenge,
            overall_academic_standing: dv.overall_academic_standing,
          },
          label: dv.directionality_label,
          computedAt: dv.computed_at,
          isOverridden: Boolean(dv.is_overridden),
          ...(wantFriendly
            ? {
                friendly: {
                  label: renderFriendlyDirectionalityLabel(dv.directionality_label),
                  factors: {
                    academic_momentum: renderFriendlyDirectionalityFactor("academic_momentum"),
                    test_score_strength: renderFriendlyDirectionalityFactor("test_score_strength"),
                    major_academic_fit: renderFriendlyDirectionalityFactor("major_academic_fit"),
                    rigor_and_challenge: renderFriendlyDirectionalityFactor("rigor_and_challenge"),
                    overall_academic_standing: renderFriendlyDirectionalityFactor("overall_academic_standing"),
                  },
                },
              }
            : {}),
        };
      }
    } catch (err) {
      console.warn("[context/bundle] directionality fetch failed:", err.message);
      directionality = { _warning: "fetch_failed" };
    }

    // ── Active narrative ─────────────────────────────────────────
    // By default we return themes + hash only (the skill can reason
    // symbolically). When the client opts in with ?narrativeText=1 AND the
    // request is from the student's own session, we include the full text
    // so the skill can quote it verbatim in coaching replies. The narrative
    // is the organizing primitive of the whole app — F2 from the Jiyeon UX
    // audit — so the student should be able to surface it on demand.
    let narrative = null;
    try {
      const includeText =
        req.query.narrativeText === "1" ||
        req.query.narrativeText === "true" ||
        req.query.include_narrative_text === "1";
      const active = getActiveNarrative(ragStmts.narrative, studentId);
      if (active) {
        // Drift preview: is every ec_strength_vectors row tied to the current
        // narrative id? If not, flag it so the frontend can show a banner.
        // Cheap — no extra query beyond what we already read above.
        let staleCount = 0;
        try {
          const rows = ragStmts.strength?.getByStudent?.all(studentId) || [];
          for (const row of rows) {
            if (!row.narrative_version_id || row.narrative_version_id !== active.id) staleCount += 1;
          }
        } catch { staleCount = 0; }
        // Profile staleness: does the narrative predate newly-added
        // ECs/courses? (EC-add ties new vectors to the CURRENT narrative id,
        // so narrative_version_id drift won't catch this — the fingerprint
        // does.) source tells the skill/UI whether it's auto-maintained.
        let profileStale = false;
        try {
          const prof = assembleProfileForGeneration(studentId);
          if (prof && active.profileFingerprint) {
            profileStale = active.profileFingerprint !== computeProfileFingerprint(prof);
          }
        } catch { /* non-fatal */ }
        narrative = {
          active: {
            id: active.id,
            themes: active.themes || [],
            majorBuckets: active.majorBuckets || [],
            hash: active.hash || null,
            source: active.source || "student",
            updatedAt: active.updatedAt || null,
            ...(includeText && active.narrativeText
              ? { narrativeText: active.narrativeText }
              : {}),
            narrativeTextAvailable: Boolean(active.narrativeText),
            drift: { staleCount, hasStale: staleCount > 0 },
            profileStale,
          },
        };
      } else {
        narrative = { active: null };
      }
    } catch (err) {
      console.warn("[context/bundle] narrative fetch failed:", err.message);
      narrative = { active: null, _warning: "fetch_failed" };
    }

    // ── College history context (from cached Scorecard data) ──────────────
    // Read-only pull from scorecard_history. The background fetch (triggered
    // on sync) will have populated rows by the time the skill calls this.
    let collegeContext = null;
    try {
      // assembleRAGContext already embeds collegeContext — pull it from there
      // so we don't double-compute.
      if (rag?.collegeContext) {
        collegeContext = rag.collegeContext;
      }
    } catch (err) {
      console.warn("[context/bundle] college context fetch failed:", err.message);
    }

    // ── CDS positioning context — for each goal/target school the student
    // mentioned, surface the validated CDS record + freshness so the skill
    // can ground school-specific advice in real numbers and cite when the
    // validator overrode a parsed value. Only includes schools we have in
    // cds_records (others fall back to the existing collegeContext path).
    let cdsContext = null;
    try {
      const goalNames = (rag?.goalSchoolNames || rag?.targetSchools || []).slice(0, 12);
      if (goalNames.length > 0) {
        const { loadValidatedRecord, loadLatestValidation } = await import("./cds-validator.js");
        const slugify = (n) => String(n).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
        const matches = [];
        for (const name of goalNames) {
          const slug = slugify(name);
          const rec = loadValidatedRecord(ragStmts, slug);
          if (!rec) continue;
          const v = loadLatestValidation(ragStmts, slug);
          // c7Weighted: for each labeled rating, surface the numeric weight
          // (1.0 / 0.7 / 0.35 / 0.0) so the AI doesn't have to re-derive it.
          // Lets the skill produce sentences like "Stanford weights essays
          // very_important (1.0) which is why your strong narrative matters
          // more here than at <other school>."
          const C7_WEIGHTS = { very_important: 1.00, important: 0.70, considered: 0.35, not_considered: 0.00 };
          const c7Weighted = {};
          for (const [k, label] of Object.entries(rec.c7 || {})) {
            c7Weighted[k] = { rating: label, weight: C7_WEIGHTS[label] ?? null };
          }

          matches.push({
            slug: rec.slug,
            school: rec.school,
            year: rec.year,
            tier: rec.tier,
            overallAdmitRate: rec.overallAdmitRate,
            yieldRate: rec.yieldRate,
            enrolledSAT: rec.enrolledSAT,
            enrolledACT: rec.enrolledACT,
            enrolledGPA: rec.enrolledGPA,
            testPolicy: rec.testPolicy,
            c7: rec.c7,
            c7Weighted,
            c1Breakdown: rec.c1Breakdown || null,
            sourceUrl: rec.sourceUrl,
            // Validation freshness — the skill uses this to caveat numbers.
            validation: v ? {
              status: v.status,
              corrections: Object.keys(v.overrides || {}),
              sources: v.sources || [],
              validatedAt: v.validatedAt,
            } : null,
          });
        }
        if (matches.length > 0) {
          cdsContext = {
            schoolsMatched: matches.length,
            requested: goalNames.length,
            schools: matches,
          };
        }
      }
    } catch (err) {
      console.warn("[context/bundle] cds context fetch failed:", err.message);
    }

    // Locale-aware legend — Korean skill sessions read a Korean legend so
    // the chat never has to translate "tier_3_developing" for the student.
    const friendlyLegendI18n = wantFriendly ? localizeFriendlyLabels(locale) : null;

    res.json({
      version: "1.2",  // bumped: cdsContext block added
      studentPlaceholder: "[STUDENT]",
      generatedAt: new Date().toISOString(),
      locale,
      rag,
      ecStrength,
      apConcepts,
      directionality,
      narrative,
      collegeContext,
      cdsContext,
      ...(friendlyLegendI18n ? { friendlyLegendI18n } : {}),
      tierHints: {
        small:  "OCR, extraction, validation, classification, narrative-fit scoring",
        medium: "synthesis, coaching, college list building, trend analysis",
        large:  "essay critique, cross-source conflict resolution, nuanced strategy",
      },
    });
  } catch (err) {
    console.error("[context/bundle] error:", err.message);
    res.status(500).json({ version: "1.1", error: "Context bundle assembly failed" });
  }
});


// ═══════════════════════════════════════════════════════════
// POST /api/anthropic — legacy Anthropic-only proxy (kept for backward compat)
// ═══════════════════════════════════════════════════════════
// Flow: Input screening → Policy router → Rules engine (T0) →
//       [Model only if needed] → Output screening → 3-lane answer
//
// New code should hit POST /api/llm, which speaks every supported provider.

app.post("/api/anthropic", apiLimiter, async (req, res) => {
  try {
    let payload = req.body;
    if (!payload || typeof payload !== "object") return res.status(400).json({ error: "Invalid request body" });
    if (!payload.model || !isReasonableModelId(payload.model)) {
      return res.status(400).json({ error: "Invalid model id. Must be 3-120 chars, no whitespace or control characters." });
    }
    if (payload.max_tokens && payload.max_tokens > MAX_TOKENS_LIMIT) payload.max_tokens = MAX_TOKENS_LIMIT;
    if (!Array.isArray(payload.messages) || payload.messages.length === 0) return res.status(400).json({ error: "Messages array is required" });
    if (payload.messages.length > 50) return res.status(400).json({ error: "Too many messages" });

    // ── Identify student ──
    let studentId = null;
    const auth = req.headers.authorization;
    if (auth && auth.startsWith("Bearer ")) {
      const session = validateToken(auth.split(" ")[1]);
      if (session) studentId = session.studentId;
    }

    // ── Budget cap enforcement (same gate as /api/llm) ──
    if (studentId) {
      const gate = checkBudget(piiVault, ragStmts, studentId);
      if (!gate.allowed) {
        return res.status(402).json({
          error: gate.reason,
          code: "budget_exceeded",
          monthSpendUsd: gate.spend,
          monthlyBudgetUsd: gate.cap,
        });
      }
    }

    // ── Step 1: Input screening (credential detection, PII redaction) ──
    const lastMessage = payload.messages[payload.messages.length - 1];
    const userText = typeof lastMessage?.content === "string" ? lastMessage.content : "";
    const inputScreen = screenInput(userText);

    if (inputScreen.blocked) {
      stmts.insertAudit.run(crypto.randomUUID(), new Date().toISOString(), "input_blocked", studentId?.slice(0, 12) || "", inputScreen.reason.slice(0, 200), hashIP(req.ip));
      return res.status(400).json({ error: inputScreen.reason, blocked: true });
    }

    // ── Step 2: Policy router — classify topic ──
    const classification = classifyTopic(userText);

    // ── Step 3: Check if crisis ──
    if (classification.topicType === TOPIC_TYPES.CRISIS) {
      const crisisResponse = buildCrisisResponse(req.headers["accept-language"]?.startsWith("ko") ? "ko" : "en-US");
      stmts.insertAudit.run(crypto.randomUUID(), new Date().toISOString(), "crisis_detected", studentId?.slice(0, 12) || "", userText.slice(0, 100), hashIP(req.ip));
      return res.json({
        content: [{ type: "text", text: crisisResponse.message }],
        _meta: { deterministic: true, topicType: "CRISIS", modelTier: "NONE", crisisResources: crisisResponse.resources },
      });
    }

    // ── Step 3b: AP concept classification (rules-first, no model) ──
    // Update per-concept mastery components for any AP subject mentioned in
    // the student's prompt. This is LAZY: rows are created only when their
    // own evidence references the subject. Errors are non-fatal — concept
    // updates must never block the primary prompt flow.
    if (studentId && ragStmts.apConcepts && userText) {
      try {
        processStudentInputForConcepts(
          ragStmts.apConcepts, studentId, userText,
          { source: "prompt" }
        );
      } catch (conceptErr) {
        console.error("[AP concepts] classification on prompt failed:", conceptErr);
      }
    }

    // ── Step 4: Redact PII from payload before sending to model ──
    const redacted = redactPayloadForModel(payload, studentId);
    payload = redacted.payload;

    // ── Step 4b: Korea PIPA cross-border consent check ──
    if (studentId) {
      const crossBorder = hasActiveConsent(piiStmts, studentId, "cross_border_transfer");
      if (!crossBorder.hasConsent) {
        return res.status(403).json({
          error: "Cross-border data transfer consent required before AI features can be used.",
          consentRequired: "cross_border_transfer",
          blocked: true,
        });
      }
    }

    // ── Step 5: Forward to Anthropic ──
    if (!ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: { message: "AI service not configured." } });
    }

    const hasPdfDoc = JSON.stringify(payload).includes('"type":"document"');
    const betaFeatures = [];
    if (hasPdfDoc) betaFeatures.push("pdfs-2024-09-25");
    const clientBeta = req.headers["anthropic-beta"];
    if (clientBeta) {
      for (const b of clientBeta.split(",").map(s => s.trim())) {
        if (b && !betaFeatures.includes(b)) betaFeatures.push(b);
      }
    }

    // ── Provider-aware dispatch ──
    // If the student stored a personal BYOK key, route through the adapter
    // layer using their provider (Anthropic / OpenAI / Google / OpenRouter /
    // DeepSeek / Together / Zhipu / Ollama / LM Studio). The adapter
    // normalizes every provider's response into Anthropic-shape, so the
    // rest of this handler (output screening, restorePII, review-queue)
    // stays unchanged. Falls back to the operator's ANTHROPIC_API_KEY
    // only when no BYOK is on file — useful for the rare case of an
    // unauthenticated utility call.
    const byok = studentId ? lookupStudentBYOK(piiStmts, piiVault, studentId) : null;

    // Append credible-sources web tools for Anthropic. We do this for
    // BOTH the BYOK and operator paths so the model has the right
    // research tools available either way.
    // Tools sent by the frontend ride along in payload.tools. The adapter
    // layer only knows how to translate "custom" tools across providers —
    // Anthropic-native tool types (web_search_*, web_fetch_*, text_editor_*,
    // bash_*, computer_*, code_execution_*) only work on Anthropic-wire
    // providers. Strip them when dispatching to OpenRouter / OpenAI /
    // Google / Ollama / etc. so the adapter doesn't reject the whole call.
    const ANTHROPIC_ONLY_TOOL_RE = /^(web_search|web_fetch|text_editor|bash|computer|code_execution|str_replace_based_edit_tool)/;
    const provIsAnthropic = !byok || byok.provider === "anthropic";
    const rawTools = Array.isArray(payload.tools) ? payload.tools : [];
    const inheritedTools = provIsAnthropic
      ? rawTools
      : rawTools.filter(t => !ANTHROPIC_ONLY_TOOL_RE.test(t?.type || ""));
    const wantsWeb = payload.web !== false; // opt-out via {web:false}

    // ── System-prompt rewrite for tool-less providers ─────────────────
    // Non-Anthropic providers can't execute the custom RAG tools the
    // frontend's specialist agents instruct the model to "always call"
    // (search_colleges, fetch_rag_context, fetch_college_match, etc.).
    // Without rewriting the prompt, Gemma/GLM emit hallucinated
    // <|tool_call|>...<tool_call|> markup from their training data
    // instead of answering. Replace the tool-call directives with web-
    // plugin-aware instructions so the model uses OpenRouter's
    // injected search results instead.
    const TOOL_INSTRUCTION_LINES = [
      /^\s*[-•*]?\s*ALWAYS\s+(?:call|use)\s+\w+.*$/gim,
      /^\s*IMPORTANT:\s*ALWAYS\s+call\s+[\w_]+.*$/gim,
      /(?:via|using|call|use)\s+(?:the\s+)?[\w_]+\s+tool/gi,
      /(?:via|using|call|use)\s+(?:the\s+)?(?:search_colleges|fetch_rag_context|fetch_college_match|get_student_profile|get_extracurriculars|web_search|web_fetch)\b/gi,
      /\bfrom\s+(?:search_colleges|fetch_rag_context|fetch_college_match)\s+tool\s+output\b/gi,
    ];
    const rewriteSystemForNoTools = (sys) => {
      if (typeof sys !== "string" || !sys) return sys;
      let out = sys;
      for (const re of TOOL_INSTRUCTION_LINES) out = out.replace(re, "");
      // Collapse double-blank lines created by the strip.
      out = out.replace(/\n{3,}/g, "\n\n").trim();

      // Provider-specific addendum. DeepSeek V3/V4 models in
      // particular have a strong training-data prior toward emitting
      // <｜tool▁call▁begin｜>...<｜tool▁call▁end｜> markup whenever
      // they see "search" or "fetch" verbs in the system prompt, so
      // we call it out explicitly. OpenRouter's web plugin injects
      // search results BEFORE the model runs — the model doesn't
      // need to "call" anything; it just reads context.
      const provModelStr = byok && byok.models ? String(byok.models.large || byok.models.medium || "") : "";
      const isDeepSeek = byok && (byok.provider === "deepseek" || /deepseek/i.test(provModelStr));
      const suffix = byok && byok.provider === "openrouter"
        ? "\n\nNOTE: You have automatic web search through OpenRouter's plugin — relevant search results from credible admissions sources are INJECTED INTO YOUR CONTEXT BEFORE YOU ANSWER. You DO NOT need to call any tool — just read the context and cite URLs directly." +
          (isDeepSeek
            ? " IMPORTANT for DeepSeek models: do NOT emit `<｜tool▁call▁begin｜>` or `<|tool_call|>` markup of any kind. Those tokens have no effect — write your answer as normal prose with markdown citations."
            : " Do NOT emit `<|tool_call|>` syntax, function-call markup, or pseudo-XML — those have no effect here.") +
          " If a fact requires a source you don't have, say so plainly."
        : "\n\nNOTE: Tool calls are not available in this conversation. Answer from your training knowledge and the conversation context only. Do NOT emit `<|tool_call|>` or `<｜tool▁call▁begin｜>` syntax. If a fact requires a source you don't have, say so plainly.";
      return out + suffix;
    };
    // ── Profile auto-injection for tool-less providers ────────────────
    // Anthropic users get profile data via tool calls (get_student_profile,
    // get_extracurriculars). Non-Anthropic providers have no way to invoke
    // those tools, so the model would otherwise ask the student to retype
    // their GPA / courses / ECs. Build a structured profile summary and
    // append it to the system prompt — that way Gemma/GLM/etc. answer
    // from the student's actual record without a round-trip.
    const buildProfileContext = (sid) => {
      if (!sid) return "";
      try {
        const snap = ragStmts.getLatestSnapshot.get(sid);
        if (!snap) return "";
        const profile = snapshotToStudentProfile(snap);
        const fmtCourse = (c) => `  - ${c.name || "?"} [${c.type || "regular"}]${c.grade ? ` grade ${c.grade}` : ""}${c.year ? ` (${c.year})` : ""}`;
        const fmtEC = (e) => `  - ${e.name || "?"} (${e.category || "other"})${e.role ? ` — ${e.role}` : ""}${e.weeksPerYear ? `, ${e.weeksPerYear} wk/yr` : ""}${e.description ? `\n      ${String(e.description).slice(0, 180)}` : ""}`;
        const fmtAP = (a) => `  - ${a.subject || "?"}: ${a.score ?? "—"}`;
        const fmtTest = (t) => `  - ${t.type || "?"}: ${t.score ?? "—"}${t.date ? ` (${t.date})` : ""}`;
        const sections = [];
        if (profile.gpa?.unweighted || profile.gpa?.weighted) {
          sections.push(`GPA: unweighted ${profile.gpa.unweighted ?? "—"}, weighted ${profile.gpa.weighted ?? "—"}`);
        }
        if (profile.majorInterest) sections.push(`Intended major: ${profile.majorInterest}`);
        if (Array.isArray(profile.testScores) && profile.testScores.length) {
          sections.push(`Test scores:\n${profile.testScores.map(fmtTest).join("\n")}`);
        }
        if (Array.isArray(profile.apScores) && profile.apScores.length) {
          sections.push(`AP scores:\n${profile.apScores.map(fmtAP).join("\n")}`);
        }
        if (Array.isArray(profile.courses) && profile.courses.length) {
          sections.push(`Courses (${profile.courses.length}):\n${profile.courses.slice(0, 40).map(fmtCourse).join("\n")}`);
        }
        if (Array.isArray(profile.activities) && profile.activities.length) {
          sections.push(`Activities / ECs (${profile.activities.length}):\n${profile.activities.slice(0, 30).map(fmtEC).join("\n")}`);
        }
        if (Array.isArray(profile.goals) && profile.goals.length) {
          sections.push(`Goals: ${profile.goals.slice(0, 10).map(g => g.text || g).join("; ")}`);
        }
        if (sections.length === 0) return "";
        return [
          "\n\n─── STUDENT PROFILE (auto-injected — already in your context, do NOT ask the student to retype this) ───",
          ...sections,
          "─── end profile ───",
        ].join("\n");
      } catch (err) {
        console.warn("[PROXY] profile auto-inject failed (non-fatal):", err.message);
        return "";
      }
    };

    const effectiveSystem = provIsAnthropic
      ? payload.system
      : (rewriteSystemForNoTools(payload.system) + buildProfileContext(studentId));

    let data;
    let dispatchStatus = 200;

    if (byok) {
      // Route through the adapter using the student's own key.
      // ── Model-tier selection ──
      // The policy router classified this turn into a tier (small / medium /
      // large) via classification.modelTier. Translate that into the
      // student's per-tier model choice. EC strategy, essay review, and
      // college-list reasoning are now pinned to LARGE by the router, so
      // they automatically get the student's "large" model (Opus on
      // Anthropic). Other topic types stay on their assigned tier.
      const tierToSlot = {
        opus: "large",   small: "small",
        sonnet: "medium", medium: "medium",
        haiku: "small",  large: "large",
      };
      const tierSlot = tierToSlot[classification.modelTier] || "large";
      const tierModel = byok.models?.[tierSlot];
      const provModel = (
        byok.provider === "anthropic"
          ? (tierModel || payload.model || byok.models.large || CURRENT_TARGETS.opus)
          : (tierModel || byok.models.large || payload.model)
      );

      const toolset = provIsAnthropic && wantsWeb
        ? [
            ...inheritedTools.filter(t => !/^web_(search|fetch)_/.test(t?.type || "")),
            makeWebSearchTool(payload.extraDomains),
            makeWebFetchTool(payload.extraDomains),
          ]
        : inheritedTools;

      // ── OpenRouter web access (non-Anthropic models) ──────────────
      // Anthropic models on OpenRouter still use native tool blocks
      // (passthrough). Every OTHER OpenRouter model — Gemma, GLM,
      // DeepSeek, Llama, etc. — relies on OpenRouter's `web` plugin
      // for internet access. Without this branch, non-Anthropic
      // students get zero web search after the Anthropic-only tool
      // filter strips the native tools above.
      const orModelIsAnthropic = byok.provider === "openrouter" && /^anthropic\//.test(provModel || "");
      const useORWebPlugin = byok.provider === "openrouter" && wantsWeb && !orModelIsAnthropic;
      const orAllowedDomains = buildAllowedDomains(payload.extraDomains);

      // ── Tier-walk fallback chain ─────────────────────────────────
      // Try the policy-router's chosen model first. If it returns a
      // retryable error (model unavailable on the provider, or the
      // provider rejects the tool config), walk DOWN the tier ladder
      // — large → medium → small — until something answers or we run
      // out. This handles three real-world failure modes:
      //
      //   1. Top-tier model is temporarily off (OpenRouter providers
      //      rotate quota; Anthropic Opus occasionally returns 529
      //      overloaded). We don't want students stuck — drop a tier.
      //   2. The student's saved BYOK still has a `:free` model ID
      //      that's been pulled. We auto-pick the next one.
      //   3. tools_unsupported on a non-Anthropic provider — we strip
      //      tools and retry against the next model.
      //
      // We do NOT fall back on auth_rejected / credit_exhausted —
      // those are user-fixable errors that need to surface, not be
      // swallowed by retries.
      const isRetryableCode = (status, code, msg) => {
        const modelMissing = status === 404 || /no endpoints found|model_not_found|does not exist/i.test(msg);
        const overloaded = status === 529 || code === "overloaded";
        const transient = status === 503 || status === 502 || code === "tools_unsupported";
        const empty = code === "empty_response";
        return modelMissing || overloaded || transient || empty;
      };

      // Treat an OK response with zero visible text content as a
      // soft failure — reasoning models (DeepSeek V4 Pro, R1, o1)
      // sometimes burn their entire max_tokens budget on internal
      // thinking and emit no actual answer. Walk the fallback chain
      // to a non-reasoning tier instead of returning a blank reply.
      const isEmptyResponse = (resp) => {
        if (!resp || !Array.isArray(resp.content)) return false;
        const text = resp.content
          .filter(b => b && b.type === "text" && typeof b.text === "string")
          .map(b => b.text).join("").trim();
        return text.length === 0;
      };

      // Build the tier-walk chain. Start from the router's chosen
      // tier and walk through large → medium → small. Dedupe so we
      // don't retry the same model id twice when tiers overlap (e.g.
      // a student pinned all three tiers to the same model).
      const tierChain = [];
      const seen = new Set();
      const pushModel = (m) => { if (m && !seen.has(m)) { seen.add(m); tierChain.push(m); } };
      pushModel(provModel);
      pushModel(byok.models?.large);
      pushModel(byok.models?.medium);
      pushModel(byok.models?.small);

      let lastErr = null;
      let succeeded = false;
      for (let attempt = 0; attempt < tierChain.length; attempt++) {
        const candidate = tierChain[attempt];
        const isFirstAttempt = attempt === 0;
        // Drop tools on tools_unsupported retries — sending the same
        // toolset would fail the same way.
        const dropTools = lastErr && lastErr.code === "tools_unsupported";
        const attemptTools = dropTools ? undefined : (toolset.length ? toolset : undefined);
        // Re-evaluate the OpenRouter web-plugin gating per candidate.
        const candIsAnthropicOR = byok.provider === "openrouter" && /^anthropic\//.test(candidate || "");
        const candUseORWebPlugin = byok.provider === "openrouter" && wantsWeb && !candIsAnthropicOR;

        if (!isFirstAttempt) {
          console.log(`[PROXY] Falling back ${tierChain[attempt - 1]} → ${candidate} (reason: ${lastErr?.code || "unknown"})`);
        }

        try {
          const resp = await adapterCallLLM({
            provider: byok.provider,
            apiKey: byok.apiKey,
            baseUrl: byok.baseUrl,
            model: candidate,
            messages: payload.messages,
            system: effectiveSystem,
            maxTokens: payload.max_tokens || 1024,
            temperature: typeof payload.temperature === "number" ? payload.temperature : undefined,
            tools: attemptTools,
            anthropicBeta: betaFeatures.length ? betaFeatures.join(",") : undefined,
            webPlugin: candUseORWebPlugin ? { enabled: true, allowedDomains: orAllowedDomains } : null,
          });
          // Reasoning-model empty-response guard. If the model used
          // its entire max_tokens budget on internal thinking and
          // emitted no visible answer, treat it like a retryable
          // failure and fall through to the next tier.
          if (isEmptyResponse(resp)) {
            console.warn(`[PROXY] ${byok.provider}/${candidate} returned empty content (in:${resp.usage?.input_tokens||0} out:${resp.usage?.output_tokens||0}) — treating as retryable`);
            lastErr = { status: 200, code: "empty_response", msg: "Model returned no visible text", model: candidate, err: new Error("empty_response") };
            continue;
          }
          data = {
            content: resp.content || [],
            usage: resp.usage || {},
            model: resp.model || candidate,
            stop_reason: resp.stop_reason || null,
            _fallback: !isFirstAttempt ? {
              from: tierChain[0],
              to: candidate,
              reason: lastErr?.code || "unknown",
            } : undefined,
          };
          succeeded = true;
          break;
        } catch (llmErr) {
          const status = (llmErr?.status && Number.isFinite(llmErr.status)) ? llmErr.status : 502;
          const code = llmErr?.code || "llm_error";
          const msg = String(llmErr?.message || "");
          console.error(`[PROXY] ${byok.provider}/${candidate} ${status} ${code}: ${msg}`);
          lastErr = { status, code, msg, model: candidate, err: llmErr };

          // Non-retryable: bail immediately with the real user-facing
          // error. Walking the chain on auth/credit/billing would
          // just exhaust tiers without helping.
          if (!isRetryableCode(status, code, msg)) break;
          // Otherwise continue to the next candidate.
        }
      }

      if (!succeeded) {
        const { status = 502, code = "llm_error", msg = "", model: failedModel } = lastErr || {};
        const modelMissing = status === 404 || /no endpoints found|model_not_found|does not exist/i.test(msg);
        const triedList = tierChain.join(", ");
        const userMsg = code === "credit_exhausted"
          ? (byok.provider === "anthropic"
              ? "Your Anthropic account is out of credits. Top up at console.anthropic.com/settings/billing — or switch providers via Edit profile → API key."
              : `Your ${byok.provider} account is out of credits.`)
          : code === "auth_rejected"
            ? `Your ${byok.provider} API key was rejected. Re-enter it via Edit profile → API key.`
            : modelMissing
              ? `None of your configured models are available on ${byok.provider} right now (tried: ${triedList}). Pick different ones via Edit profile → API key.`
              : (lastErr?.err?.message || `LLM call failed (${code}) — tried ${triedList}`);
        return res.status(status).json({ error: { message: userMsg, code, provider: byok.provider, triedModels: tierChain } });
      }
    } else {
      // Fallback to operator's Anthropic key. This path is only hit when
      // the student has no BYOK on file — the prerequisite screen enforces
      // having one, so this is mainly an edge-case safety net.
      const anthropicHeaders = {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      };
      if (betaFeatures.length) anthropicHeaders["anthropic-beta"] = betaFeatures.join(",");
      // Attach credible-sources tools if not already provided.
      const bodyWithTools = (wantsWeb && !inheritedTools.some(t => /^web_(search|fetch)_/.test(t?.type || "")))
        ? { ...payload, tools: [...inheritedTools, makeWebSearchTool(payload.extraDomains), makeWebFetchTool(payload.extraDomains)] }
        : payload;

      const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: anthropicHeaders,
        body: JSON.stringify(bodyWithTools),
      });
      dispatchStatus = anthropicRes.status;
      data = await anthropicRes.json();

      if (!anthropicRes.ok) {
        console.error(`[PROXY] Anthropic API error ${anthropicRes.status}:`, data?.error?.message);
        if (anthropicRes.status === 401 || anthropicRes.status === 403) {
          return res.status(anthropicRes.status).json({ error: { message: "API key rejected by Anthropic.", keyError: true } });
        }
        return res.status(anthropicRes.status).json({ error: { message: data?.error?.message || `Anthropic API returned ${anthropicRes.status}` } });
      }
    }

    // ── Step 6: Output screening ──
    // Strip hallucinated tool-call markup. Open-weight models (Gemma,
    // GLM, Qwen, Llama) often emit pseudo-XML / pseudo-JSON tool-call
    // syntax from their training data when the system prompt mentions
    // tools they can't actually invoke. Filter that out before the
    // text reaches the student — they should never see leaked
    // `<|tool_call|>call:fetch_rag_context{...}<tool_call|>` or
    // `<function=...>...</function>` framing.
    const stripHallucinatedToolCalls = (text) => {
      if (typeof text !== "string" || !text) return text;
      return text
        // Mistral / Gemma / GLM training-data tool framings.
        .replace(/<\|tool[_ ]?call\|>[\s\S]*?<\/?\|?tool[_ ]?call\|?>/gi, "")
        .replace(/<\|tool[_ ]?call\|>[\s\S]*?<tool[_ ]?call\|>/gi, "")
        // DeepSeek V3 / V4 fullwidth-pipe framings:
        //   <｜tool▁calls▁begin｜>...<｜tool▁calls▁end｜>
        //   <｜tool▁call▁begin｜>function<｜tool▁sep｜>name\n```json
        //   {...}```<｜tool▁call▁end｜>
        // The fullwidth pipe is U+FF5C; the triangle is U+2581. Some
        // tokenizer variants emit U+E000-area private-use bytes too, so
        // match a broad class for the separator runs.
        .replace(/<｜[\s\S]*?｜>[\s\S]*?<｜[\s\S]*?｜>/g, "")
        .replace(/<｜tool[_▁\s]*calls?[_▁\s]*(begin|start)?[_▁\s]*｜>[\s\S]*?<｜tool[_▁\s]*calls?[_▁\s]*end[_▁\s]*｜>/gi, "")
        .replace(/<｜tool[_▁\s]*call[_▁\s]*(begin|start)?[_▁\s]*｜>[\s\S]*?<｜tool[_▁\s]*call[_▁\s]*end[_▁\s]*｜>/gi, "")
        // Llama-style <function=name>{...}</function>
        .replace(/<function=[\w_]+>[\s\S]*?<\/function>/gi, "")
        .replace(/<\|FunctionCall\|>[\s\S]*?<\/?\|?\/?FunctionCall\|?>/gi, "")
        // Qwen-style <tool_call>{...}</tool_call>
        .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
        .replace(/<tool_use>[\s\S]*?<\/tool_use>/gi, "")
        // Bare leading "call:name{...}" line (only if first line).
        .replace(/^\s*call:[\w_]+\s*\{[^}]*\}\s*\n?/i, "")
        // OpenAI-style ```json {"name": "...", "arguments": ...}``` blocks
        // that some models emit when they think they're invoking a function.
        .replace(/```(?:json|tool[_ ]?call)?\s*\{\s*"name"\s*:\s*"(?:search_colleges|fetch_rag_context|fetch_college_match|get_student_profile|get_extracurriculars|web_search|web_fetch)"[\s\S]*?```/gi, "")
        // Collapse whitespace gaps left by removals.
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    };
    if (data.content) {
      for (const block of data.content) {
        if (block.type === "text" && block.text) {
          block.text = stripHallucinatedToolCalls(block.text);
          if (!block.text) {
            // The entire turn was tool-call markup — replace with a
            // graceful fallback so the chat bubble isn't empty.
            block.text = "_I tried to call an external tool that isn't available on this provider. Try rephrasing your question — I'll answer from what I know._";
          }
          const outputScreen = screenOutput(block.text);
          if (outputScreen.modified) block.text = outputScreen.text;
          block.text = restorePII(block.text, redacted.tokenMap);
        }
      }
    }

    // ── Step 7: Check if review needed ──
    try {
      if (shouldTriggerReview(classification, data)) {
        submitForReview(reviewStmts, {
          reviewType: "model_output",
          studentId: studentId || "anonymous",
          topicType: classification.topicType,
          evidence: JSON.stringify({ query: userText.slice(0, 200), response: JSON.stringify(data.content).slice(0, 500) }),
          confidenceScore: classification.confidence,
        });
      }
    } catch (reviewErr) {
      console.warn("[PROXY] Review queue insert failed (non-fatal):", reviewErr.message);
    }

    // ── Log usage ──
    if (studentId) {
      try {
        ragStmts.insertUsage.run(studentId, payload.model, data?.usage?.input_tokens || 0, data?.usage?.output_tokens || 0, "server");
      } catch (usageErr) {
        console.warn("[PROXY] Usage logging failed:", usageErr.message);
      }
    }

    // ── Rate limit info ──
    // Only present on the operator-key fallback path (no BYOK on file).
    // BYOK calls go through the adapter layer which doesn't surface
    // per-provider rate-limit headers in a normalized way — we emit
    // empty values rather than crash on the missing variable.
    const rateLimitHeaders = byok ? null : (typeof anthropicRes !== "undefined" ? anthropicRes.headers : null);
    const rateLimits = rateLimitHeaders ? {
      requestsLimit: parseInt(rateLimitHeaders.get("anthropic-ratelimit-requests-limit") || "0", 10),
      requestsRemaining: parseInt(rateLimitHeaders.get("anthropic-ratelimit-requests-remaining") || "0", 10),
      tokensLimit: parseInt(rateLimitHeaders.get("anthropic-ratelimit-tokens-limit") || "0", 10),
      tokensRemaining: parseInt(rateLimitHeaders.get("anthropic-ratelimit-tokens-remaining") || "0", 10),
    } : { requestsLimit: 0, requestsRemaining: 0, tokensLimit: 0, tokensRemaining: 0 };

    res.json({
      ...data,
      _meta: {
        keySource: "server",
        rateLimits,
        topicType: classification.topicType,
        modelTier: classification.modelTier,
        inputScreened: inputScreen.redacted,
        redaction: redacted.redactionReport || null,
        ai_disclosure: {
          system: "College Counselor AI",
          advisory_only: true,
          model: payload.model,
        },
      },
    });

  } catch (err) {
    console.error("[PROXY] Internal error:", err.message);
    res.status(500).json({ error: { message: "Internal proxy error" } });
  }
});


// ═══════════════════════════════════════════════════════════
// POST /api/agents/orchestrate — FULL RULES-FIRST PIPELINE
// ═══════════════════════════════════════════════════════════

app.post("/api/agents/orchestrate", apiLimiter, requireStudentAuth, (req, res) => {
  try {
    const { query, topK } = req.body;
    if (!query || typeof query !== "string") return res.status(400).json({ error: "query is required" });
    if (query.length > 4000) return res.status(400).json({ error: "query is too long" });

    // Step 1: Input screening
    const inputScreen = screenInput(query);
    if (inputScreen.blocked) {
      return res.status(400).json({ error: inputScreen.reason, blocked: true });
    }

    // Step 2: Policy routing
    const routing = routeRequest(query);

    // Step 3: Check if deterministic
    if (routing.canHandleDeterministically) {
      let deterministicResult = null;

      if (routing.subIntent === "fafsa_eligibility") {
        deterministicResult = runFAFSAEligibilityCheck(req.body.studentData || {});
      } else if (routing.subIntent === "deadline_status") {
        deterministicResult = calculateDeadlineStatus(req.body.deadlineDate);
      } else if (routing.subIntent === "document_check") {
        deterministicResult = runDocumentCompletenessCheck(req.body.applicationType, req.body.submittedItems);
      }

      if (deterministicResult) {
        const answer = composeDeterministicAnswer({
          classification: { topicType: routing.topicType, subIntent: routing.subIntent },
          result: deterministicResult,
          locale: req.headers["accept-language"]?.startsWith("ko") ? "ko" : "en-US",
        });
        return res.json({
          ...answer,
          _meta: { deterministic: true, modelTier: "NONE", cost: "$0.00", topicType: routing.topicType },
        });
      }
    }

    // Step 4: Assemble RAG context (small-context)
    const context = assembleRAGContext(ragStmts, req.studentId, routing.subIntent || "holistic");
    if (context.error) return res.status(404).json(context);

    // Step 5: Gather evidence + validate sources for regulated topics
    const evidence = getEvidenceProfile(evidenceStmts, "student", req.studentId);
    const facts = searchFacts(factStmts, query, 10);
    if (routing.topicType === "regulated" || routing.topicType === "high_stakes") {
      const sourceCheck = validateEvidenceSources([...facts, ...(evidence.items || [])], routing.topicType);
      if (!sourceCheck.allTrusted && sourceCheck.untrustedItems?.length > 0) {
        console.warn(`[ORCH] Untrusted sources filtered for ${routing.topicType}: ${sourceCheck.untrustedItems.length}`);
      }
    }

    // Step 6: Build orchestration
    const orchestration = buildOrchestration({
      query: inputScreen.redacted ? inputScreen.redactedText : query,
      studentContext: context.studentContext,
      ragStmts,
      catalog: orchestrationCatalog,
      topK: Math.min(Math.max(parseInt(topK || "3", 10) || 3, 1), 5),
    });

    res.json({
      ...orchestration,
      evidence: evidence.items?.slice(0, 10) || [],
      verifiedFacts: facts.slice(0, 5),
      _meta: {
        topicType: routing.topicType,
        modelTier: routing.modelTier,
        gates: routing.gates,
        deterministic: false,
      },
    });

  } catch (err) {
    console.error("[ORCH] Error:", err.message);
    res.status(500).json({ error: "Agent orchestration failed" });
  }
});


// ═══════════════════════════════════════════════════════════
// POST /api/audit — SAFETY AUDIT EVENT LOGGING
// ═══════════════════════════════════════════════════════════

const VALID_AUDIT_TYPES = [
  "crisis_detected", "essay_blocked", "off_topic_blocked",
  "upload_rejected", "upload_accepted",
  "validation_cleaned", "validation_failed", "validation_error",
  "parental_notify_sent", "parental_notify_skipped", "parental_notify_failed",
  "pii_masking_applied", "pii_restoration_applied", "financial_context_sanitized",
  "input_blocked", "review_submitted", "consent_granted", "consent_revoked",
  "student_data_deleted", "student_data_exported",
];

app.post("/api/audit", auditLimiter, (req, res) => {
  try {
    const { id, timestamp, type, userHint, details } = req.body;
    if (!type || !VALID_AUDIT_TYPES.includes(type)) {
      return res.status(400).json({ error: `Invalid audit type. Valid: ${VALID_AUDIT_TYPES.join(", ")}` });
    }
    const eventId = id || crypto.randomUUID();
    const eventTimestamp = timestamp || new Date().toISOString();
    stmts.insertAudit.run(eventId, eventTimestamp, type, (userHint || "").slice(0, 20), (typeof details === "string" ? details : JSON.stringify(details)).slice(0, 500), hashIP(req.ip));
    if (type === "crisis_detected") console.warn(`[AUDIT:CRISIS] ${eventTimestamp} | hint=${userHint} | ${details}`);
    res.json({ stored: true, id: eventId });
  } catch (err) {
    console.error("[AUDIT] Storage error:", err.message);
    res.status(500).json({ error: "Failed to store audit event" });
  }
});


// ═══════════════════════════════════════════════════════════
// AUDIT DASHBOARD + EXPORT
// ═══════════════════════════════════════════════════════════

app.get("/api/audit/dashboard", requireCounselorAuth, (req, res) => {
  try {
    const type = req.query.type || null;
    const limit = Math.min(parseInt(req.query.limit || "100", 10), 500);
    const offset = parseInt(req.query.offset || "0", 10);
    const events = type ? stmts.getAuditByType.all(type, limit, offset) : stmts.getAuditEvents.all(limit, offset);
    const crisisCount24h = stmts.getCrisisCount24h.get();
    const weeklyStats = stmts.getAuditStats.all();
    res.json({ events, summary: { crisisLast24h: crisisCount24h.count, weeklyBreakdown: weeklyStats, totalReturned: events.length, limit, offset } });
  } catch (err) {
    console.error("[DASHBOARD] Query error:", err.message);
    res.status(500).json({ error: "Dashboard query failed" });
  }
});

app.get("/api/audit/export", requireCounselorAuth, (_req, res) => {
  try {
    const events = stmts.getAuditEvents.all(10000, 0);
    const csv = [
      "id,timestamp,type,user_hint,details",
      ...events.map(e => `"${e.id}","${e.timestamp}","${e.type}","${e.user_hint || ""}","${(e.details || "").replace(/"/g, '""')}"`)
    ].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="audit_export_${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error("[EXPORT] Error:", err.message);
    res.status(500).json({ error: "Export failed" });
  }
});


// ═══════════════════════════════════════════════════════════
// CDS REPOSITORY ENDPOINTS — common-data-set ingest/validate/lookup
// ═══════════════════════════════════════════════════════════
// The CDS ingest pipeline (cds-ingest-pipeline.js) downloads, parses,
// and validates Common Data Set PDFs from the College Transitions
// repository, persisting them via the rag-engine `cds_records` table.
// Validation overrides are sourced from cds-validator.js's CORRECTIONS
// registry (web-validated ground truth).
//
// Auth model:
//   - GET /api/cds/school/:slug          → student-auth   (read-only)
//   - GET /api/cds/schools                → student-auth   (list)
//   - GET /api/cds/validation/:slug      → student-auth   (latest report)
//   - POST /api/cds/ingest                → counselor-auth (admin)
//   - POST /api/cds/revalidate            → counselor-auth (admin)
// Validation reports are surfaced to students because they materially
// affect how the AI presents school numbers ("we corrected this admit
// rate from <parsed> to <truth> based on <source>").

app.get("/api/cds/schools", studentLimiter, requireStudentAuth, (_req, res) => {
  try {
    const rows = ragStmts.cds.listAll.all();
    res.json({
      total: rows.length,
      schools: rows.map((r) => ({
        slug: r.slug,
        school: r.school_name,
        tier: r.tier,
        year: r.year,
        admitRate: r.overall_admit_rate,
        sat: r.enrolled_sat_p25 != null
          ? { p25: r.enrolled_sat_p25, p75: r.enrolled_sat_p75 }
          : null,
        testPolicy: r.test_policy,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: "cds_list_failed", message: String(e.message).slice(0, 200) });
  }
});

app.get("/api/cds/school/:slug", studentLimiter, requireStudentAuth, async (req, res) => {
  try {
    const { loadValidatedRecord, loadLatestValidation } = await import("./cds-validator.js");
    const slug = String(req.params.slug).slice(0, 100);
    const record = loadValidatedRecord(ragStmts, slug);
    if (!record) return res.status(404).json({ error: "school_not_in_cache", slug });
    const validation = loadLatestValidation(ragStmts, slug);
    res.json({ record, validation });
  } catch (e) {
    res.status(500).json({ error: "cds_lookup_failed", message: String(e.message).slice(0, 200) });
  }
});

app.get("/api/cds/validation/:slug", studentLimiter, requireStudentAuth, async (req, res) => {
  try {
    const { loadLatestValidation } = await import("./cds-validator.js");
    const slug = String(req.params.slug).slice(0, 100);
    const v = loadLatestValidation(ragStmts, slug);
    if (!v) return res.status(404).json({ error: "no_validation", slug });
    res.json(v);
  } catch (e) {
    res.status(500).json({ error: "cds_validation_lookup_failed", message: String(e.message).slice(0, 200) });
  }
});

// ─── Counselor-auth admin endpoints ──────────────────────────────────
app.post("/api/cds/ingest", requireCounselorAuth, async (req, res) => {
  try {
    const { ingestOne, ingestBulk } = await import("./cds-ingest-pipeline.js");
    const body = req.body || {};
    if (Array.isArray(body.schools)) {
      const concurrency = Math.min(8, Math.max(1, Number(body.concurrency) || 3));
      const year = body.year || "2023-24";
      const results = await ingestBulk(ragStmts, body.schools, { concurrency, year, force: !!body.force });
      const ok = results.filter((r) => r.status === "ok" || r.status === "discrepancies" || r.status === "scope_mismatch").length;
      stmts.insertAudit.run(crypto.randomUUID(), new Date().toISOString(), "cds_ingest_bulk",
        "counselor", `${ok}/${results.length} ingested`, hashIP(req.ip));
      return res.json({ ok, total: results.length, results });
    }
    const schoolName = body.school || body.name;
    if (!schoolName) return res.status(400).json({ error: "school_or_schools_required" });
    const result = await ingestOne(ragStmts, schoolName, {
      year: body.year, force: !!body.force, tier: body.tier,
    });
    stmts.insertAudit.run(crypto.randomUUID(), new Date().toISOString(), "cds_ingest_one",
      "counselor", `${schoolName}:${result.status}`, hashIP(req.ip));
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: "cds_ingest_failed", message: String(e.message).slice(0, 300) });
  }
});

// ─── Canonical xlsx export ───────────────────────────────────────────
// Streams a six-sheet workbook (Cover / C1 / C7 / C9 / C12 / Validation)
// for human auditing of a parsed CDS record. Counselor-auth because the
// validation report includes override sources + discrepancy detail that
// shouldn't leak to students.
app.get("/api/cds/canonical/:slug.xlsx", requireCounselorAuth, async (req, res) => {
  try {
    const { exportCanonicalXLSX } = await import("./cds-canonical-export.js");
    const slug = String(req.params.slug).slice(0, 100);
    const result = await exportCanonicalXLSX(ragStmts, slug);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="cds-${slug}.xlsx"`);
    res.end(Buffer.from(result.buffer));
    stmts.insertAudit.run(crypto.randomUUID(), new Date().toISOString(), "cds_canonical_export",
      "counselor", slug, hashIP(req.ip));
  } catch (e) {
    res.status(404).json({ error: "canonical_export_failed", message: String(e.message).slice(0, 200) });
  }
});

app.post("/api/cds/canonical/export-all", requireCounselorAuth, async (req, res) => {
  try {
    const { exportAllCanonicalXLSX } = await import("./cds-canonical-export.js");
    const results = await exportAllCanonicalXLSX(ragStmts);
    stmts.insertAudit.run(crypto.randomUUID(), new Date().toISOString(), "cds_canonical_export_all",
      "counselor", `${results.length} schools`, hashIP(req.ip));
    res.json({ total: results.length, ok: results.filter((r) => r.status === "ok").length, results });
  } catch (e) {
    res.status(500).json({ error: "canonical_export_all_failed", message: String(e.message).slice(0, 200) });
  }
});

app.post("/api/cds/revalidate", requireCounselorAuth, async (req, res) => {
  try {
    const { revalidateAll } = await import("./cds-ingest-pipeline.js");
    const results = await revalidateAll(ragStmts);
    stmts.insertAudit.run(crypto.randomUUID(), new Date().toISOString(), "cds_revalidate",
      "counselor", `${results.length} schools`, hashIP(req.ip));
    res.json({ total: results.length, results });
  } catch (e) {
    res.status(500).json({ error: "cds_revalidate_failed", message: String(e.message).slice(0, 200) });
  }
});


// ═══════════════════════════════════════════════════════════
// POST /api/notify-parent — PARENTAL CRISIS NOTIFICATION
// ═══════════════════════════════════════════════════════════

app.post("/api/notify-parent", notifyLimiter, (req, res) => {
  try {
    const { to, studentHint, type, message, timestamp } = req.body;
    if (!to || typeof to !== "string" || !to.includes("@")) return res.status(400).json({ error: "Valid recipient email required" });
    if (type !== "crisis_alert") return res.status(400).json({ error: "Only crisis_alert notifications are supported" });
    if (message && message.length > 500) return res.status(400).json({ error: "Notification message too long" });

    const notifId = crypto.randomUUID();
    const emailHash = hashEmail(to);
    const emailEncrypted = encryptValue(to);

    stmts.insertNotification.run(notifId, emailHash, emailEncrypted, (studentHint || "Your student").slice(0, 50), "crisis_alert", (message || "Crisis safety alert triggered").slice(0, 500));
    stmts.insertAudit.run(crypto.randomUUID(), timestamp || new Date().toISOString(), "parental_notify_sent", (studentHint || "").slice(0, 20), `Notification queued: ${notifId}`, hashIP(req.ip));

    processNotificationQueue().catch(err => console.error("[NOTIFY] Processing failed:", err.message));
    res.json({ queued: true, id: notifId });
  } catch (err) {
    console.error("[NOTIFY] Queue error:", err.message);
    res.status(500).json({ error: "Failed to queue notification" });
  }
});


// ═══════════════════════════════════════════════════════════
// STUDENT REGISTRATION + AUTH
// ═══════════════════════════════════════════════════════════

app.post("/api/students/register", studentLimiter, (req, res) => {
  try {
    const { email, name, grade, state, schoolDomain, majorInterest, isMinor, locale } = req.body;
    if (!email) return res.status(400).json({ error: "email is required" });

    const emailHash = hashEmail(email);

    // Check existing
    const existing = piiStmts.getStudentByEmailHash?.get(emailHash);
    if (existing) {
      const token = createSessionToken(emailHash, existing.student_id);
      return res.json({ registered: false, existing: true, studentId: existing.student_id, token });
    }

    const studentId = crypto.randomUUID();

    // Store PII in vault (separate DB)
    storeStudentPII(piiStmts, piiVault, studentId, {
      name: name || "",
      email,
      isMinor: isMinor !== false,
    });

    // Create initial snapshot in operational DB (no PII)
    ragStmts.insertSnapshot.run(
      crypto.randomUUID(), studentId, "initial",
      null, null, "[]", "[]", "[]", "[]",
      majorInterest || null, "[]", "registration"
    );

    const token = createSessionToken(emailHash, studentId);
    console.log(`[STUDENT] Registered: ${emailHash.slice(0, 12)}... → ${studentId.slice(0, 8)}`);

    // Return consent requirements
    const consentReqs = getOnboardingConsentRequirements(isMinor !== false, locale || "en-US");

    res.json({ registered: true, studentId, token, consentRequirements: consentReqs });
  } catch (err) {
    console.error("[STUDENT] Registration error:", err.message);
    res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/api/students/auth", studentLimiter, (req, res) => {
  try {
    const { email, emailHash: rawHash, isMinor } = req.body;
    // PREFER the plaintext email when provided — the frontend and backend
    // use different salts (`session_hint:` vs `email_salt_cc:`) so trusting
    // the client's pre-computed hash silently 404s every login. Only fall
    // back to the raw hash when no email is supplied (e.g. legacy callers).
    const emailHash = email ? hashEmail(email) : rawHash;
    if (!emailHash) return res.status(400).json({ error: "email or emailHash is required" });

    const existing = piiStmts.getStudentByEmailHash?.get(emailHash);
    if (!existing) return res.status(404).json({ error: "Student not found. Register first." });

    // Carry forward the parental-consent attestation from the frontend's
    // login payload — clears the is_minor flag for accounts that were
    // registered before the consent boxed mapped to it. This unblocks BYOK
    // for returning users without forcing them to re-register.
    if (isMinor === false && existing.is_minor === 1) {
      try {
        piiVault.db.prepare(`UPDATE students_pii SET is_minor = 0, updated_at = datetime('now') WHERE student_id = ?`).run(existing.student_id);
      } catch (updErr) {
        console.warn("[STUDENT] is_minor downgrade failed (non-fatal):", updErr.message);
      }
    }

    const token = createSessionToken(emailHash, existing.student_id);
    res.json({ authenticated: true, studentId: existing.student_id, token });
  } catch (err) {
    console.error("[STUDENT] Auth error:", err.message);
    res.status(500).json({ error: "Authentication failed" });
  }
});


// ═══════════════════════════════════════════════════════════
// STUDENT SYNC + PROFILE + TIMELINE + MILESTONES
// ═══════════════════════════════════════════════════════════

app.post("/api/students/sync", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const { profile, activities, goals, majorInterest, trigger } = req.body;
    const result = syncStudentData(ragStmts, req.studentId, profile, activities, goals, majorInterest, trigger || "user_update");

    for (const change of result.changes || []) {
      if (change.significant) {
        stmts.insertAudit.run(crypto.randomUUID(), new Date().toISOString(), `profile_${change.type}`, (req.studentEmailHash || "").slice(0, 12), change.title.slice(0, 200), hashIP(req.ip));
      }
    }

    // ── Background: auto-refresh the narrative when ECs/courses/major change.
    // Fire-and-forget — never blocks/fails the sync response. The helper
    // itself gates on relevant changes, fingerprint no-ops, BYOK presence,
    // and (critically) never overwrites a student-written narrative.
    Promise.resolve()
      .then(() => maybeAutoRegenerateNarrative(req.studentId, result.changes))
      .catch((err) => console.warn("[AUTO-NARRATIVE] sync hook error:", err?.message));

    // ── Background: fetch Scorecard history for goal schools ──────────────
    // Fire-and-forget — never blocks the sync response. Skips schools whose
    // cached history is still fresh (< 7 days old).
    if (SCORECARD_API_KEY && Array.isArray(goals) && goals.length > 0) {
      const goalUnitIds = extractGoalUnitIds(goals);
      if (goalUnitIds.length > 0) {
        fetchAndPersistCollegeHistory(db, ragStmts, SCORECARD_API_KEY, goalUnitIds)
          .then(r => { if (r.fetched > 0) console.log(`[SCORECARD] Background history: ${r.fetched} fetched, ${r.skipped} skipped, ${r.errors} errors`); })
          .catch(err => console.warn("[SCORECARD] Background history error:", err.message));
      }
    }

    res.json(result);
  } catch (err) {
    console.error("[SYNC] Error:", err.message);
    res.status(500).json({ error: "Sync failed" });
  }
});

app.get("/api/students/profile", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const snap = ragStmts.getLatestSnapshot.get(req.studentId);
    const capabilities = ragStmts.getLatestCapabilities.all(req.studentId);
    const milestoneCount = ragStmts.getMilestones.all(req.studentId, 100).length;
    if (!snap) return res.json({ profile: null, metrics: [], milestoneCount: 0 });
    const structuredMetrics = getDirectStructuredStudentData(ragStmts, req.studentId, {
      snapshot: snap,
      capabilities,
    });

    res.json({
      retrieval: "direct_db",
      profile: {
        gpa: { unweighted: snap.gpa_unweighted, weighted: snap.gpa_weighted },
        courses: safeJSON(snap.courses_json, []),
        apScores: safeJSON(snap.ap_scores_json, []),
        testScores: safeJSON(snap.test_scores_json, []),
        activities: safeJSON(snap.activities_json, []),
        majorInterest: snap.major_interest,
        goals: safeJSON(snap.goals_json, []),
        lastUpdated: snap.created_at,
      },
      metrics: capabilities.map(c => ({ metric: c.metric, value: c.value, percentileNational: c.percentile_national, percentileCohort: c.percentile_cohort })),
      structuredMetrics,
      milestoneCount,
    });
  } catch (err) {
    console.error("[PROFILE] Error:", err.message);
    res.status(500).json({ error: "Profile retrieval failed" });
  }
});

// Direct DB path for GPA / SAT / ACT / AP / activity counts. This endpoint
// intentionally bypasses the RAG assembly layer so structured stats can be
// consumed without any retrieval pipeline.
app.get("/api/students/structured-metrics", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const data = getDirectStructuredStudentData(ragStmts, req.studentId);
    if (!data) {
      return res.status(404).json({ error: "No profile data" });
    }
    res.json({ ok: true, ...data });
  } catch (err) {
    console.error("[PROFILE structured-metrics] Error:", err.message);
    res.status(500).json({ error: "Structured metrics retrieval failed" });
  }
});

app.get("/api/students/timeline", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const trends = getStudentTrends(ragStmts, req.studentId);
    res.json(trends);
  } catch (err) {
    console.error("[TIMELINE] Error:", err.message);
    res.status(500).json({ error: "Timeline retrieval failed" });
  }
});

app.get("/api/students/milestones", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || "30", 10), 100);
    const type = req.query.type || null;
    const milestones = type ? ragStmts.getMilestonesByType.all(req.studentId, type, limit) : ragStmts.getMilestones.all(req.studentId, limit);
    res.json({
      milestones: milestones.map(m => ({ id: m.id, type: m.type, title: m.title, data: safeJSON(m.data_json, {}), academicYear: m.academic_year, date: m.created_at })),
    });
  } catch (err) {
    console.error("[MILESTONES] Error:", err.message);
    res.status(500).json({ error: "Milestones retrieval failed" });
  }
});


// ═══════════════════════════════════════════════════════════
// DELETE /api/students — RIGHT TO ERASURE (FERPA/GDPR/COPPA)
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// CHAT HISTORY — per-student, multi-thread
// ═══════════════════════════════════════════════════════════

app.get("/api/students/threads", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    res.json({ threads: chatHistory.listThreads(ragStmts, req.studentId, limit) });
  } catch (err) {
    console.error("[CHAT] List threads error:", err.message);
    res.status(500).json({ error: "Failed to list threads" });
  }
});

app.post("/api/students/threads", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const { title } = req.body || {};
    const result = chatHistory.createThread(ragStmts, req.studentId, title);
    res.json(result);
  } catch (err) {
    console.error("[CHAT] Create thread error:", err.message);
    res.status(500).json({ error: "Failed to create thread" });
  }
});

app.get("/api/students/threads/:id", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const result = chatHistory.getThreadWithMessages(ragStmts, req.studentId, req.params.id);
    if (!result) return res.status(404).json({ error: "Thread not found" });
    res.json(result);
  } catch (err) {
    console.error("[CHAT] Get thread error:", err.message);
    res.status(500).json({ error: "Failed to fetch thread" });
  }
});

// POST /api/students/threads/:id/messages — append a message turn.
// The frontend calls this once per user turn AND once per assistant turn
// so history survives reloads / cross-device.
app.post("/api/students/threads/:id/messages", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const { role, content, attachmentName } = req.body || {};
    const r = chatHistory.appendMessage(ragStmts, req.studentId, req.params.id, role, content, attachmentName);
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ appended: true });
  } catch (err) {
    console.error("[CHAT] Append message error:", err.message);
    res.status(500).json({ error: "Failed to append message" });
  }
});

app.patch("/api/students/threads/:id", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const { title } = req.body || {};
    const ok = chatHistory.renameThread(ragStmts, req.studentId, req.params.id, title);
    if (!ok) return res.status(404).json({ error: "Thread not found" });
    res.json({ renamed: true });
  } catch (err) {
    console.error("[CHAT] Rename thread error:", err.message);
    res.status(500).json({ error: "Failed to rename thread" });
  }
});

app.delete("/api/students/threads/:id", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const hard = req.query.hard === "1";
    const ok = hard
      ? chatHistory.deleteThread(ragStmts, req.studentId, req.params.id)
      : chatHistory.archiveThread(ragStmts, req.studentId, req.params.id);
    if (!ok) return res.status(404).json({ error: "Thread not found" });
    res.json({ deleted: true, hard });
  } catch (err) {
    console.error("[CHAT] Delete thread error:", err.message);
    res.status(500).json({ error: "Failed to delete thread" });
  }
});

app.get("/api/students/threads-search", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const q = String(req.query.q || "");
    res.json({ results: chatHistory.searchMessages(ragStmts, req.studentId, q) });
  } catch (err) {
    console.error("[CHAT] Search error:", err.message);
    res.status(500).json({ error: "Search failed" });
  }
});

// ═══════════════════════════════════════════════════════════
// CREDIBLE WEB SOURCES — exposed so the frontend can show the allowlist
// ═══════════════════════════════════════════════════════════

app.get("/api/credible-sources", apiLimiter, (_req, res) => {
  res.json({
    domains: DEFAULT_ALLOWED_DOMAINS,
    description: "Web search and fetch tools are restricted to .edu / .gov / common application platforms. Forum, ranking, and essay-mill sites are excluded.",
  });
});

// ═══════════════════════════════════════════════════════════
// COLLEGE VALUES + FIT
// ═══════════════════════════════════════════════════════════
// Extract a college's stated values (cached 90d) and compute how the
// student's courses + ECs map onto them. Uses the student's BYOK so the
// LLM call is billed to their key, not the operator's.

app.post("/api/colleges/values", studentLimiter, requireStudentAuth, async (req, res) => {
  try {
    const { collegeName, hintUrl } = req.body || {};
    if (!collegeName || typeof collegeName !== "string" || collegeName.length > 120) {
      return res.status(400).json({ error: "collegeName required (≤ 120 chars)" });
    }

    // Budget gate (same as /api/llm)
    const gate = checkBudget(piiVault, ragStmts, req.studentId);
    if (!gate.allowed) {
      return res.status(402).json({ error: gate.reason, code: "budget_exceeded" });
    }

    // Build a provider-neutral callLLM closure bound to this student's key
    const byok = lookupStudentBYOK(piiStmts, piiVault, req.studentId);
    if (!byok) {
      return res.status(400).json({ error: "No personal API key on file. Set one at /api/students/apikey first." });
    }

    // Provider-aware web routing: Anthropic-shape providers use the
    // native web_search/web_fetch tools the caller passed in.
    // OpenRouter routes through its `plugins:[{id:"web"}]`; all other
    // providers get web stripped (they have no internet path), and the
    // model is asked to do its best with the structured data alone.
    const callLLM = async (args) => {
      const provIsAnthropic = byok.provider === "anthropic";
      const provIsOR = byok.provider === "openrouter";
      const rawTools = Array.isArray(args.tools) ? args.tools : [];
      const ANTHROPIC_ONLY_TOOL_RE = /^(web_search|web_fetch|text_editor|bash|computer|code_execution|str_replace_based_edit_tool)/;
      const passThruTools = provIsAnthropic
        ? rawTools
        : rawTools.filter(t => !ANTHROPIC_ONLY_TOOL_RE.test(t?.type || ""));

      // OpenRouter web plugin gating — skip for Anthropic passthroughs
      // (those still use native tool blocks).
      const orModelIsAnthropic = provIsOR && /^anthropic\//.test(args.model || byok.models.large || "");
      const useORWebPlugin = provIsOR && args.wantsWeb && !orModelIsAnthropic;
      const orAllowedDomains = buildAllowedDomains(args.extraDomains);

      const result = await adapterCallLLM({
        provider: byok.provider,
        apiKey: byok.apiKey,
        baseUrl: byok.baseUrl,
        model: args.model || byok.models.large || CURRENT_TARGETS.opus,
        maxTokens: args.max_tokens,
        system: args.system,
        messages: args.messages,
        tools: passThruTools.length ? passThruTools : undefined,
        webPlugin: useORWebPlugin ? { enabled: true, allowedDomains: orAllowedDomains } : null,
      });
      // Record usage for budget tracking
      try {
        ragStmts.insertUsage.run(req.studentId, `${byok.provider}:${args.model || byok.models.large}`, result?.usage?.input_tokens || 0, result?.usage?.output_tokens || 0, "personal");
      } catch { /* ignore */ }
      return result;
    };

    // Values extraction is synthesis work (web search → read → pull
    // value themes), not hard reasoning. Pin it to the MEDIUM tier
    // (e.g. Gemma 4 31B) rather than the large reasoning model
    // (DeepSeek V4 Pro), which is far slower because it burns its
    // budget on internal thinking. This is the single biggest
    // latency win for the College Fit panel.
    const extracted = await extractCollegeValues(ragStmts, callLLM, {
      studentId: req.studentId,
      collegeName,
      hintUrl,
      model: byok.models?.medium || byok.models?.large,
    });

    // Deterministic rule-based fit against the student's current snapshot.
    const snap = ragStmts.getLatestSnapshot.get(req.studentId);
    const profile = snap?.profile_json ? JSON.parse(snap.profile_json) : {};
    const activities = snap?.activities_json ? JSON.parse(snap.activities_json) : [];
    const fit = computeFit(extracted.values, { ...profile, activities });

    // NOTE: the previous `computeLLMFitNarrative` pass was removed —
    // it ran a SECOND web-search + reasoning LLM call on every
    // uncached lookup but its output (`narrative`) was never rendered
    // by the frontend. Deleting it ~halves the College Fit latency
    // and the per-lookup token cost. If a qualitative narrative is
    // wanted later, add a dedicated lazy endpoint the UI calls only
    // when the student expands a "deep fit analysis" panel.

    res.json({ ...extracted, fit });
  } catch (err) {
    console.error("[COLLEGE-VALUES] error:", err.message);
    res.status(500).json({ error: err.message || "Failed to extract college values" });
  }
});

// DELETE /api/colleges/values — clears this student's college-values
// cache so the next /api/colleges/values lookup is a fresh extraction.
// Useful when the student's previously cached extraction was wrong
// (branch confusion, stale values, or the school updated its page).
// Scope is per-student so one student's clear doesn't nuke another's
// cache entries — but if `?all=1` is set and the student has the
// extracted-by row, all rows they created are removed.
app.delete("/api/colleges/values", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const sid = req.studentId;
    if (!sid) return res.status(401).json({ error: "auth required" });
    const before = ragStmts.db
      ? null
      : null;
    // better-sqlite3: run an ad-hoc DELETE bound to this student.
    const deleted = ragStmts.deleteCollegeValuesByStudent
      ? ragStmts.deleteCollegeValuesByStudent.run(sid)
      : null;
    if (!deleted) {
      // Fall-through prepared statement (older boot) — exec inline.
      const stmt = piiStmts._db && piiStmts._db.prepare
        ? piiStmts._db.prepare("DELETE FROM college_values WHERE extracted_by_student_id = ?")
        : null;
      if (stmt) {
        const info = stmt.run(sid);
        return res.json({ ok: true, deleted: info.changes });
      }
      return res.status(500).json({ error: "delete statement unavailable" });
    }
    return res.json({ ok: true, deleted: deleted.changes });
  } catch (err) {
    console.error("[COLLEGE-VALUES] clear cache failed:", err.message);
    return res.status(500).json({ error: err.message || "clear failed" });
  }
});

// Quick cached-only lookup (no LLM call) — used by the frontend to render
// cached values without re-billing. Returns 404 if not cached.
app.get("/api/colleges/values/:slug", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const cached = ragStmts.getCollegeValues.get(req.params.slug);
    if (!cached) return res.status(404).json({ error: "not_cached" });
    res.json({
      slug: cached.slug,
      displayName: cached.display_name,
      sourceUrl: cached.source_url,
      values: JSON.parse(cached.values_json),
      extractedAt: cached.extracted_at,
      cached: true,
    });
  } catch (err) {
    res.status(500).json({ error: "lookup_failed" });
  }
});

app.delete("/api/students", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    // Delete from PII vault
    deleteAllStudentPII(piiStmts, req.studentId);

    // Delete operational data (snapshots, milestones, timeline)
    db.prepare("DELETE FROM profile_snapshots WHERE student_id = ?").run(req.studentId);
    db.prepare("DELETE FROM milestones WHERE student_id = ?").run(req.studentId);
    db.prepare("DELETE FROM capability_timeline WHERE student_id = ?").run(req.studentId);
    db.prepare("DELETE FROM api_usage_log WHERE student_id = ?").run(req.studentId);
    // Chat history: wipe every message in every thread the student owns,
    // then the thread rows themselves. Right-to-erasure includes chats.
    db.prepare("DELETE FROM chat_messages WHERE thread_id IN (SELECT id FROM chat_threads WHERE student_id = ?)").run(req.studentId);
    db.prepare("DELETE FROM chat_threads WHERE student_id = ?").run(req.studentId);

    // Clear session
    for (const [token, session] of sessionTokens) {
      if (session.studentId === req.studentId) sessionTokens.delete(token);
    }

    stmts.insertAudit.run(crypto.randomUUID(), new Date().toISOString(), "student_data_deleted", "", "Student exercised right to erasure", hashIP(req.ip));
    res.json({ deleted: true });
  } catch (err) {
    console.error("[DELETE] Error:", err.message);
    res.status(500).json({ error: "Deletion failed" });
  }
});


// ═══════════════════════════════════════════════════════════
// GET /api/students/export — FERPA/GDPR DATA PORTABILITY
// ═══════════════════════════════════════════════════════════

app.get("/api/students/export", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const sid = req.studentId;
    const snapshots = ragStmts.getSnapshotHistory.all(sid, 1000);
    const milestones = ragStmts.getMilestones.all(sid, 1000);
    const capabilities = db.prepare(`SELECT metric, value, percentile_national, percentile_cohort, computed_at FROM capability_timeline WHERE student_id = ? ORDER BY computed_at ASC`).all(sid);

    const exportData = {
      exportMeta: {
        exportedAt: new Date().toISOString(),
        format: "College Counselor Student Data Export v2",
        studentId: sid,
        note: "This file contains all data stored about you. Request deletion via DELETE /api/students.",
      },
      profileSnapshots: snapshots.map(s => ({
        id: s.id, type: s.snapshot_type,
        gpa: { unweighted: s.gpa_unweighted, weighted: s.gpa_weighted },
        majorInterest: s.major_interest, trigger: s.trigger, createdAt: s.created_at,
      })),
      milestones: milestones.map(m => ({
        id: m.id, type: m.type, title: m.title, data: safeJSON(m.data_json, {}),
        academicYear: m.academic_year, createdAt: m.created_at,
      })),
      capabilityTimeline: capabilities.map(c => ({
        metric: c.metric, value: c.value,
        percentileNational: c.percentile_national, percentileCohort: c.percentile_cohort,
        computedAt: c.computed_at,
      })),
      summary: { totalSnapshots: snapshots.length, totalMilestones: milestones.length, totalCapabilityDataPoints: capabilities.length },
    };

    const filename = `student-data-export-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.json(exportData);

    stmts.insertAudit.run(crypto.randomUUID(), new Date().toISOString(), "student_data_exported", (req.studentEmailHash || "").slice(0, 12), `Exported ${snapshots.length} snapshots, ${milestones.length} milestones`, hashIP(req.ip));
  } catch (err) {
    console.error("[EXPORT] Student data export error:", err.message);
    res.status(500).json({ error: "Data export failed" });
  }
});


// ═══════════════════════════════════════════════════════════
// BYOK — AGE-GATED API KEY MANAGEMENT
// ═══════════════════════════════════════════════════════════

app.put("/api/students/apikey", studentLimiter, requireStudentAuth, async (req, res) => {
  try {
    // Age gate: BYOK not allowed for minors
    const byokCheck = isBYOKAllowed(piiStmts, req.studentId);
    if (!byokCheck.allowed) {
      return res.status(403).json({ error: byokCheck.reason, byokBlocked: true });
    }

    const { apiKey, provider: providerIn, baseUrl: baseUrlIn, defaultModels } = req.body || {};
    if (!apiKey || typeof apiKey !== "string" || apiKey.length < 12 || apiKey.length > 512) {
      return res.status(400).json({ error: "Invalid API key." });
    }

    // Resolve provider. Explicit param > auto-detection from key/baseUrl.
    const baseUrl = typeof baseUrlIn === "string" && baseUrlIn.trim() ? baseUrlIn.trim() : null;
    const provider = (typeof providerIn === "string" && providerIn.trim()) ||
                     detectProvider({ apiKey, baseUrl });
    if (!provider) {
      return res.status(400).json({
        error: "Cannot detect LLM provider from API key. Pass an explicit `provider` " +
               "(anthropic, openai, google, openrouter, deepseek, together, zhipu, ollama, lmstudio, openai_compat).",
      });
    }

    // Validate per-tier default model ids (if provided) before we hit the
    // provider — catches injection attacks without a network round trip.
    const tierModels = defaultModels && typeof defaultModels === "object" ? defaultModels : {};
    for (const tier of ["small", "medium", "large"]) {
      const m = tierModels[tier];
      if (m != null && !adapterIsReasonableModelId(String(m))) {
        return res.status(400).json({ error: `Invalid defaultModels.${tier}` });
      }
    }

    // Ping the adapter to make sure the key actually works.
    // STRICT: refuse to save unless the validator explicitly confirms the
    // key works. Anthropic returns {valid:true} only on a real 200 from
    // /v1/messages; OpenAI/Google flag {unverified:true} for ambiguous
    // responses and we treat those as failures too — better a louder
    // error here than a silent 401 on every downstream call.
    let verification = { valid: false, code: "validator_threw", message: "Validator did not return a result" };
    try {
      verification = await adapterValidateKey({ provider, apiKey, baseUrl });
    } catch (verifyErr) {
      verification = { valid: false, code: "validator_threw", message: verifyErr?.message || "Validator error" };
      console.warn("[BYOK] Key verification threw:", verifyErr.message);
    }
    if (verification.valid !== true) {
      // Hard rejection only on definitive failures (auth, credit, network,
      // unknown provider). `unverified: true` means the validator reached
      // the provider successfully but couldn't complete the smoke test
      // (e.g. test model unavailable on this account) — that's actually a
      // *positive* signal about the key.
      const reasonByCode = {
        auth_rejected:   `API key rejected by ${provider}. Double-check you pasted the full key.`,
        credit_exhausted: provider === "anthropic"
          ? "Your Anthropic organization has no usage credits. Top up at https://console.anthropic.com/settings/billing — or switch providers (OpenRouter pools credit across providers; Google Gemini has a free tier; Ollama / LM Studio run locally for free)."
          : `${provider} reports your account is out of credits. Top up with that provider, or try a different one.`,
        rate_limited:    `${provider} is rate-limiting key validation right now. Try again in a minute.`,
        network_error:   `Couldn't reach ${provider} to validate the key. Check your network and retry.`,
        unknown_provider: `Could not detect the provider from this key.`,
        validator_threw: `Key validation failed (${verification.message || "unknown error"}).`,
      };
      return res.status(400).json({
        error: reasonByCode[verification.code]
            || `Key did not verify against ${provider}: ${verification.message || verification.code || "unknown"}`,
        code: verification.code || "validation_failed",
        status: verification.status || 0,
      });
    }
    // verification.valid === true here, including the unverified case
    // ("key reached the provider but the test model wasn't available").
    // Log unverified so it's visible without being user-facing-blocking.
    if (verification.unverified) {
      console.log(`[BYOK] ${provider} key accepted as unverified (${verification.code}): ${verification.message || ""}`);
    }

    // Subscription-tier detection is Anthropic-specific; other providers
    // don't expose usage tiers via headers. We still capture it for Anthropic.
    let subInfo = { tier: "unknown", reqLimit: 0, tokLimit: 0 };
    if (provider === "anthropic") {
      try {
        const testRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
        });
        subInfo = detectSubscriptionTier(testRes.headers);
      } catch {
        // Non-fatal — tier info is advisory.
      }
    }

    // Store encrypted in PII vault (upsertApiKey now takes the full tuple).
    const encrypted = encryptValue(apiKey);
    const hint = `${apiKey.slice(0, Math.min(10, Math.max(4, apiKey.length - 4)))}...${apiKey.slice(-4)}`;
    const tiers = {
      small: tierModels.small || resolveTierDefault(provider, "small"),
      medium: tierModels.medium || resolveTierDefault(provider, "medium"),
      large: tierModels.large || resolveTierDefault(provider, "large"),
    };
    piiStmts.upsertApiKey?.run(
      req.studentId,
      encrypted,
      hint,
      provider,
      baseUrl,
      tiers.small || null,
      tiers.medium || null,
      tiers.large || null,
    );

    stmts.insertAudit.run(
      crypto.randomUUID(), new Date().toISOString(), "byok_key_set",
      (req.studentEmailHash || "").slice(0, 12),
      `provider: ${provider}, tier: ${subInfo.tier}, hint: ${hint}`,
      hashIP(req.ip),
    );

    // ── DEV-ONLY: promote validated Anthropic BYOK to operator key ──
    // When NODE_ENV=development AND the saved key passed live validation
    // AND the provider is Anthropic, write it to process.env in memory.
    // This unblocks operator-side paths (orchestrate proxy, daily Claude
    // target refresh, audit-side LLM calls) for solo developers without
    // requiring them to also edit .env. Safety guarantees:
    //   • In-memory only — never persisted to .env on disk.
    //   • Production (`NODE_ENV=production`) is a strict no-op — checked
    //     below; no path leaks one student's key to other students.
    //   • Gated on verification.valid === true so we don't promote a
    //     key the validator threw on.
    //   • Re-triggers the live target refresh so the operator's cached
    //     model targets pick up the new key immediately.
    if (
      process.env.NODE_ENV === "development" &&
      provider === "anthropic" &&
      verification.valid === true &&
      apiKey &&
      apiKey !== process.env.ANTHROPIC_API_KEY
    ) {
      const oldHintSrc = process.env.ANTHROPIC_API_KEY || "";
      const oldHint = oldHintSrc ? `${oldHintSrc.slice(0, 10)}…${oldHintSrc.slice(-4)}` : "(unset)";
      process.env.ANTHROPIC_API_KEY = apiKey;
      console.log(`[BYOK-DEV] Promoted student BYOK to operator key in memory (was: ${oldHint}, now: ${hint}). Production is unaffected — this only fires when NODE_ENV=development.`);
      // Fire-and-forget refresh so the Claude-targets cache picks up
      // the new key immediately. Errors are non-fatal.
      refreshClaudeTargetsNow?.("byok_promoted")?.catch(err =>
        console.warn("[BYOK-DEV] Post-promotion target refresh failed:", err.message)
      );
    }

    res.json({
      stored: true,
      hint,
      provider,
      baseUrl,
      defaults: tiers,
      subscription: { tier: subInfo.tier, requestLimit: subInfo.reqLimit, tokenLimit: subInfo.tokLimit },
      verified: verification.valid === true,
      // True only if dev-mode promotion just fired. Frontend can surface
      // this as an info banner so the dev knows their key is now also
      // serving operator-side paths.
      promotedToOperatorKey:
        process.env.NODE_ENV === "development" &&
        provider === "anthropic" &&
        verification.valid === true &&
        apiKey === process.env.ANTHROPIC_API_KEY,
    });
  } catch (err) {
    console.error("[BYOK] Store key error:", err.message);
    res.status(500).json({ error: "Failed to store API key" });
  }
});

app.delete("/api/students/apikey", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    piiStmts.deleteApiKey?.run(req.studentId);
    stmts.insertAudit.run(crypto.randomUUID(), new Date().toISOString(), "byok_key_removed", (req.studentEmailHash || "").slice(0, 12), "Student removed API key", hashIP(req.ip));
    res.json({ deleted: true });
  } catch (err) {
    console.error("[BYOK] Delete key error:", err.message);
    res.status(500).json({ error: "Failed to delete API key" });
  }
});

app.get("/api/students/apikey", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    // Per-student migration: if this Anthropic student's stored model IDs
    // were left behind by a model release, upgrade them silently before
    // we return the row. The frontend then reflects the new defaults
    // without prompting the user.
    let autoMigrated = [];
    try {
      const m = migrateOneStudentClaudeModels(piiVault, req.studentId);
      if (m.migrated) {
        autoMigrated = m.changes;
        console.log(`[CLAUDE-MIGRATE] On-access ${req.studentId.slice(0,8)}…: ${m.changes.map(c => `${c.tier} ${c.from}→${c.to}`).join(", ")}`);
      }
    } catch (mErr) {
      console.warn("[CLAUDE-MIGRATE] On-access failed:", mErr.message);
    }

    const row = piiStmts.getApiKey?.get(req.studentId);
    if (!row) return res.json({ hasPersonalKey: false, keySource: "none" });

    // Spend / budget snapshot
    const monthlyBudgetUsd = Number(row.monthly_budget_usd ?? 0);
    const monthSpendUsd = getMonthlySpendUsd(ragStmts, req.studentId);

    res.json({
      hasPersonalKey: true,
      keySource: "personal",
      hint: row.key_hint,
      setAt: row.updated_at,
      provider: row.provider || "anthropic",
      baseUrl: row.base_url || null,
      defaults: {
        small:  row.default_small_model  || null,
        medium: row.default_medium_model || null,
        large:  row.default_large_model  || null,
      },
      autoMigrated, // [] if nothing changed, otherwise [{tier, from, to}]
      budget: {
        monthlyBudgetUsd,
        monthSpendUsd,
        capReached: monthlyBudgetUsd > 0 && monthSpendUsd >= monthlyBudgetUsd,
      },
    });
  } catch (err) {
    console.error("[BYOK] Get key status error:", err.message);
    res.status(500).json({ error: "Failed to check key status" });
  }
});

// ─── Per-student monthly budget cap ────────────────────────────────────
// Set to 0 (or omit) for unlimited. Once month-to-date spend hits the cap
// the LLM proxy returns 402 until the user raises the cap or rolls over.
app.get("/api/students/budget", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const cap = getStudentBudget(piiVault, req.studentId);
    const spend = getMonthlySpendUsd(ragStmts, req.studentId);
    res.json({
      monthlyBudgetUsd: cap,
      monthSpendUsd: spend,
      remainingUsd: cap > 0 ? Math.max(0, cap - spend) : null,
      capReached: cap > 0 && spend >= cap,
    });
  } catch (err) {
    console.error("[BUDGET] Get error:", err.message);
    res.status(500).json({ error: "Failed to read budget" });
  }
});

app.put("/api/students/budget", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const { monthlyBudgetUsd } = req.body || {};
    const n = Number(monthlyBudgetUsd);
    if (!Number.isFinite(n) || n < 0 || n > 100000) {
      return res.status(400).json({ error: "monthlyBudgetUsd must be a number between 0 and 100000 (0 = unlimited)" });
    }
    const ok = setStudentBudget(piiVault, req.studentId, n);
    if (!ok) return res.status(404).json({ error: "No API key on file — store a key before setting a budget." });
    res.json({ monthlyBudgetUsd: n, monthSpendUsd: getMonthlySpendUsd(ragStmts, req.studentId) });
  } catch (err) {
    console.error("[BUDGET] Set error:", err.message);
    res.status(500).json({ error: "Failed to set budget" });
  }
});


// ═══════════════════════════════════════════════════════════
// USAGE TRACKING
// ═══════════════════════════════════════════════════════════

app.get("/api/students/usage", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const sid = req.studentId;
    const days = Math.min(parseInt(req.query.days || "30", 10), 90);
    const today = ragStmts.getUsageToday.get(sid);
    const month = ragStmts.getUsageMonth.get(sid);
    const history = ragStmts.getUsageHistory.all(sid, days);

    res.json({
      today: { inputTokens: today?.input_total || 0, outputTokens: today?.output_total || 0, calls: today?.call_count || 0 },
      last30Days: { inputTokens: month?.input_total || 0, outputTokens: month?.output_total || 0, calls: month?.call_count || 0 },
      dailyBreakdown: history.map(h => ({ date: h.day, inputTokens: h.input_total, outputTokens: h.output_total, calls: h.call_count, keySource: h.key_source })),
    });
  } catch (err) {
    console.error("[USAGE] Error:", err.message);
    res.status(500).json({ error: "Failed to retrieve usage stats" });
  }
});


// ═══════════════════════════════════════════════════════════
// RAG ENDPOINTS
// ═══════════════════════════════════════════════════════════

app.post("/api/rag/context", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const { queryFocus } = req.body;
    const context = assembleRAGContext(ragStmts, req.studentId, queryFocus || "holistic");
    if (context.error) return res.status(404).json(context);
    res.json(context);
  } catch (err) {
    console.error("[RAG] Context assembly error:", err.message);
    res.status(500).json({ error: "RAG context assembly failed" });
  }
});

app.post("/api/rag/college-match", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const filters = req.body;
    const result = enhancedCollegeMatch(ragStmts, req.studentId, filters);
    if (result.error) return res.status(404).json(result);
    res.json(result);
  } catch (err) {
    console.error("[RAG] College match error:", err.message);
    res.status(500).json({ error: "College match failed" });
  }
});

// Opportunistic live CDS search: when a searched school is not already in the
// validated store, fetch + parse + persist its Common Data Set via the live
// repository pipeline so College Fit can ground in real numbers next time.
// Best-effort and time-boxed; a per-slug cooldown prevents re-fetching schools
// that aren't in the repository (or whose PDFs won't parse) on every request.
const cdsLiveAttemptAt = new Map(); // slug -> epoch ms of last attempt
const CDS_LIVE_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours

async function searchAndPersistCdsRecord(schoolName) {
  if (!schoolName) return null;
  const slug = slugifySchoolName(schoolName);
  if (!slug) return null;
  const last = cdsLiveAttemptAt.get(slug) || 0;
  if (Date.now() - last < CDS_LIVE_COOLDOWN_MS) return null; // recently tried; don't hammer
  cdsLiveAttemptAt.set(slug, Date.now());
  try {
    const { ingestOne } = await import("./cds-ingest-pipeline.js");
    const r = await ingestOne(ragStmts, schoolName);
    const persisted = r && ["ok", "discrepancies", "scope_mismatch", "no_truth"].includes(r.status);
    if (persisted) {
      // Guard against the repository's fuzzy index binding the wrong school
      // (e.g. "Boston University" → "Boston College"). If the matched name is
      // not the same institution, discard and fall back to IPEDS baseline.
      if (!schoolNamesCompatible(schoolName, r.school)) {
        console.warn(`[cds/live-search] repository returned "${r.school}" for "${schoolName}" — rejecting mismatch`);
        return null;
      }
      console.log(`[cds/live-search] ingested ${schoolName} → ${r.slug} (${r.status})`);
      return resolveStoredCdsRecord(ragStmts, { schoolName, slug: r.slug });
    }
    console.log(`[cds/live-search] no CDS for ${schoolName} (${r?.status || "unknown"})`);
  } catch (e) {
    console.warn(`[cds/live-search] failed for ${schoolName}:`, String(e.message).slice(0, 160));
  }
  return null;
}

app.post("/api/positioning/targets", studentLimiter, requireStudentAuth, async (req, res) => {
  try {
    const snap = ragStmts.getLatestSnapshot.get(req.studentId);
    if (!snap) return res.status(404).json({ error: "No profile data" });

    const goals = safeParseJSON(snap.goals_json, []);
    const goalUnitIds = extractGoalUnitIds(goals);
    const fallbackRows = goalUnitIds
      .map((unitId) => db.prepare("SELECT unit_id, name, state, sat_25, sat_75, act_25, act_75, acceptance_rate, avg_gpa_admitted, top_majors_json, source FROM baseline_colleges WHERE unit_id = ?").get(unitId))
      .filter(Boolean);

    const requestedTargets = Array.isArray(req.body?.targets) ? req.body.targets : null;
    const rawTargets = requestedTargets || extractTargetSchoolNames(goals, fallbackRows);
    if (!rawTargets.length) {
      return res.status(400).json({ error: "No target universities found" });
    }

    const requestedMajor = req.body?.major || snap.major_interest || null;
    const refreshCds = Boolean(req.body?.refreshCds);
    const cacheKey = computeCdsQueryCacheKey(rawTargets);
    let cdsResults = null;
    if (!refreshCds) {
      const cachedCds = getScorecardQueryCache("cds_targets", { cacheKey, targets: rawTargets });
      cdsResults = cachedCds?.data?.results || null;
      const cachedPositioning = getScorecardQueryCache("positioning_targets", { cacheKey, targets: rawTargets, major: requestedMajor });
      if (cachedPositioning?.data) {
        return res.json(withScorecardMeta(cachedPositioning.data, {
          cached: true,
          cacheKind: "positioning_targets",
          dataFreshness: "current",
        }));
      }
    }

    if (!cdsResults) {
      cdsResults = (await resolveAndParseCdsTargets(rawTargets));
      putScorecardQueryCache("cds_targets", { cacheKey, targets: rawTargets }, {
        targets: rawTargets,
        results: cdsResults,
        source: "College Transitions CDS repository",
      });
    }

    const strengthRows = ragStmts.strength.getByStudent.all(req.studentId);
    const narrative = getActiveNarrative(ragStmts.narrative, req.studentId);
    const studentModel = buildStudentModel({
      gpa_unweighted: snap.gpa_unweighted,
      gpa_weighted: snap.gpa_weighted,
      courses_json: snap.courses_json,
      test_scores_json: snap.test_scores_json,
      activities_json: snap.activities_json,
      major_interest: requestedMajor,
    }, strengthRows, narrative);

    const majorPolicies = req.body?.majorPolicies || {};
    const ipedsGrowthByBucket = req.body?.ipedsGrowthByBucket || {};
    // Live CDS search: when a searched school isn't already in the store,
    // fetch + parse + persist its CDS (Drive-hosted PDFs are supported; the
    // ~10% Google-Sheets/Docs sources are skipped and fall back to IPEDS
    // baseline). On by default; live-parsed records are tagged unvalidated
    // (lower confidence) so a mis-parse can't masquerade as ground truth.
    const searchCds = req.body?.searchCds !== false;

    // Web fallback: when neither the store nor the live PDF pipeline yields a
    // CDS, use the student's highest web-capable model to search + read the
    // school's CDS. On by default; budget-gated, BYOK-required, capped per
    // request, and cooldown-deduped so it can't run away on cost. Results are
    // tagged unvalidated (web-read) with lower confidence.
    const webCdsEnabled = req.body?.webCds !== false;
    let webLlm = null;
    if (webCdsEnabled) {
      const gate = checkBudget(piiVault, ragStmts, req.studentId);
      if (gate.allowed) {
        const built = buildStudentCallLLM(req.studentId);
        if (built.byok && built.callLLM) webLlm = built;
      }
    }
    let webLookupsRemaining = webLlm ? 4 : 0; // bound cost per request

    const scoredTargets = await Promise.all(cdsResults.map(async (cdsResult) => {
      const requested = rawTargets.find((target) =>
        (cdsResult.unitId && normalizeUnitId(target.unitId) === normalizeUnitId(cdsResult.unitId)) ||
        String(target.schoolName || "").toLowerCase() === String(cdsResult.schoolName || "").toLowerCase()
      ) || null;

      const resolvedUnitId = normalizeUnitId(cdsResult.unitId || requested?.unitId);
      const collegeRow = resolveBaselineCollegeRow(db, {
        unitId: resolvedUnitId,
        schoolName: cdsResult.schoolName || requested?.schoolName,
      });

      // ── Prefer the on-disk validated CDS record over the live fetch ──
      // The stored record carries real C7 weights, a validated admit rate,
      // and enrolled test-score ranges, so the calculation grounds in real
      // data (and evidence confidence stops reading "Very Low") whenever we
      // have a CDS record for this school.
      const lookupName = cdsResult.schoolName || requested?.schoolName || collegeRow?.name;
      let storedCds = resolveStoredCdsRecord(ragStmts, { schoolName: lookupName });
      // Not in the store yet? Search this university's CDS live, parse, and
      // persist it — so searching a school in College Fit also pulls its CDS.
      if (!storedCds && searchCds) {
        storedCds = await searchAndPersistCdsRecord(lookupName);
      }
      // Still nothing (Sheets/Docs source, parse failure, or not in repo)?
      // Fall back to reading the CDS off the web with the highest model.
      if (!storedCds && webLlm && webLookupsRemaining > 0) {
        webLookupsRemaining -= 1;
        storedCds = await searchCdsViaWebAndPersist(lookupName, webLlm.callLLM, webLlm.byok);
      }
      const cdsValidated = storedCds ? isCdsRecordValidated(ragStmts, storedCds.slug) : false;
      const effectiveCds = storedCds
        ? cdsRecordToPositioningResult(storedCds, { liveFallback: cdsResult, unitId: resolvedUnitId, validated: cdsValidated })
        : cdsResult;

      // Validated CDS admit rate takes precedence over the IPEDS baseline.
      const cdsAdmitPercent = storedCds?.overallAdmitRate != null
        ? Math.round(storedCds.overallAdmitRate * 1000) / 10
        : null;
      const baselineAdmitPercent = collegeRow?.acceptance_rate != null
        ? Math.round(Number(collegeRow.acceptance_rate) * 1000) / 10
        : null;

      const collegeContext = {
        unitId: collegeRow?.unit_id || resolvedUnitId || null,
        name: collegeRow?.name || storedCds?.school || cdsResult.schoolName,
        state: collegeRow?.state || null,
        sat25: collegeRow?.sat_25 ?? storedCds?.enrolledSAT?.p25 ?? null,
        sat75: collegeRow?.sat_75 ?? storedCds?.enrolledSAT?.p75 ?? null,
        act25: collegeRow?.act_25 ?? storedCds?.enrolledACT?.p25 ?? null,
        act75: collegeRow?.act_75 ?? storedCds?.enrolledACT?.p75 ?? null,
        acceptanceRate: cdsAdmitPercent ?? baselineAdmitPercent ?? effectiveCds?.parsed?.admitRatePercent ?? null,
        avgGpaAdmitted: collegeRow?.avg_gpa_admitted ?? storedCds?.enrolledGPA?.avg ?? effectiveCds?.parsed?.gpaAverage ?? null,
        topMajors: safeParseJSON(collegeRow?.top_majors_json, []),
        source: collegeRow?.source || (storedCds ? "cds_store" : "baseline_colleges"),
      };

      // Last-resort admit rate: no CDS and no IPEDS baseline number, but we
      // can still search the latest-season acceptance rate online. Without it,
      // selectivity/competitiveness would default to neutral for this school.
      let webAdmit = null;
      if (collegeContext.acceptanceRate == null && webLlm && webLookupsRemaining > 0) {
        webLookupsRemaining -= 1;
        webAdmit = await fetchAdmitRateViaWebCached(collegeContext.name, webLlm.callLLM, webLlm.byok);
        if (webAdmit?.admitRatePercent != null) {
          collegeContext.acceptanceRate = webAdmit.admitRatePercent;
          collegeContext.acceptanceRateSource = "web";
        }
      }

      const majorPolicy =
        resolveMajorPolicyForSchool(admissionsIntelStmts, {
          unitId: collegeContext.unitId,
          schoolName: collegeContext.name,
          major: requestedMajor,
        }) ||
        majorPolicies?.[collegeContext.unitId] ||
        majorPolicies?.[collegeContext.name] ||
        null;
      const ipedsGrowthSignal = resolveIpedsGrowthForMajor(admissionsIntelStmts, {
        unitId: collegeContext.unitId,
        major: requestedMajor,
      });
      const strategicSignals = resolveStrategicFocusForSchool(admissionsIntelStmts, {
        unitId: collegeContext.unitId,
        major: requestedMajor,
        limit: 5,
      });
      const positioning = buildPositioningForTarget(studentModel, collegeContext, effectiveCds, {
        major: requestedMajor,
        majorPolicy,
        ipedsGrowthByBucket: {
          ...(ipedsGrowthByBucket || {}),
          [studentModel.majorBucket]: ipedsGrowthSignal?.growthRate ?? ipedsGrowthByBucket?.[studentModel.majorBucket] ?? null,
        },
        strategicSignals,
      });
      // Surface where the numbers came from so the card can link to the CDS
      // source and show the reporting year.
      positioning.dataProvenance = effectiveCds?.provenance || {
        kind: storedCds ? "cds_store" : (cdsResult?.fetchStatus === "ok" ? "cds_live" : "baseline_only"),
        validated: Boolean(storedCds),
        sourceUrl: effectiveCds?.sourceUrl || null,
      };
      // Note when the admit rate specifically came from a web lookup (the
      // school had no CDS and no IPEDS baseline number).
      if (webAdmit?.admitRatePercent != null) {
        positioning.dataProvenance = {
          ...positioning.dataProvenance,
          admitRate: {
            source: "web",
            admitRatePercent: webAdmit.admitRatePercent,
            season: webAdmit.season || null,
            sourceUrl: webAdmit.sourceUrl || null,
          },
        };
      }
      return positioning;
    }));

    const payload = {
      major: requestedMajor,
      modelVersion: "positioning_mvp_v1",
      separation: {
        admissibility: "academic preparation for the target school-major pair",
        competitiveness: "crowding and selectivity pressure in the target applicant pool",
        fit: "alignment with institutional and departmental priorities",
        confidence: "strength and directness of the supporting evidence",
      },
      source: "College Transitions CDS repository + NCES/IPEDS baseline + unified EC strength",
      targets: scoredTargets,
    };

    putScorecardQueryCache("positioning_targets", { cacheKey, targets: rawTargets, major: requestedMajor }, payload);
    res.json(withScorecardMeta(payload, {
      cached: false,
      cacheKind: "positioning_targets",
      dataFreshness: "current",
    }));
  } catch (err) {
    console.error("[POSITIONING] Error:", err.message);
    res.status(500).json({ error: "Target positioning failed" });
  }
});

app.post("/api/simulations", studentLimiter, requireStudentAuth, async (req, res) => {
  try {
    const snap = ragStmts.getLatestSnapshot.get(req.studentId);
    if (!snap) return res.status(404).json({ error: "No profile data" });
    const narrative = getActiveNarrative(ragStmts.narrative, req.studentId);
    const body = req.body || {};
    const result = await callSimulationSidecar("/simulations", {
      method: "POST",
      body: {
        studentId: req.studentId,
        scenarioName: body.scenarioName || body.scenario?.name || null,
        scenario: body.scenario || {},
        profilePatch: body.profilePatch || body.patch || body.scenario?.profilePatch || {},
        baseProfile: snapshotToStudentProfile(snap, narrative),
        targets: Array.isArray(body.targets) ? body.targets : [],
      },
    });
    res.status(201).json(result);
  } catch (err) {
    console.error("[SIMULATION] Create error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Simulation creation failed" });
  }
});

app.get("/api/simulations/:id", studentLimiter, requireStudentAuth, async (req, res) => {
  try {
    const result = await callSimulationSidecar(`/simulations/${encodeURIComponent(req.params.id)}?studentId=${encodeURIComponent(req.studentId)}`);
    res.json(result);
  } catch (err) {
    console.error("[SIMULATION] Get error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Simulation lookup failed" });
  }
});

app.delete("/api/simulations/:id", studentLimiter, requireStudentAuth, async (req, res) => {
  try {
    const result = await callSimulationSidecar(`/simulations/${encodeURIComponent(req.params.id)}?studentId=${encodeURIComponent(req.studentId)}`, {
      method: "DELETE",
    });
    res.json(result);
  } catch (err) {
    console.error("[SIMULATION] Delete error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Simulation deletion failed" });
  }
});

// Tiny local helper for server-side JSON parsing
function safeParseJSON(str, fallback) {
  try { return str ? JSON.parse(str) : fallback; } catch { return fallback; }
}

// ═══════════════════════════════════════════════════════════
// EC VECTORIZER — 5-factor EC strength + well-being-first planner
// ═══════════════════════════════════════════════════════════
// Factors: impact_and_scope, leadership_and_initiative,
//          passion_and_consistency, talents_and_awards,
//          relevance_to_intended_major
// Legacy-compatible EC vector surface projected from the unified strength system.
// Academics interpreted ONLY via GPA and APs per policy.

// GET legacy-compatible EC vectors for the current student
app.get("/api/ec/vectors", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const rows = ragStmts.strength.getByStudent.all(req.studentId);
    res.json({
      studentId: req.studentId,
      factors: EC_FACTORS,
      vectors: rows.map(shapeLegacyECVectorFromStrengthRow).filter(Boolean),
      count: rows.length,
      sourceSystem: "ec_strength_vectors",
      disclaimer: "These are projected compatibility views from the unified EC strength system, open to correction.",
    });
  } catch (err) {
    console.error("[EC] Get vectors error:", err.message);
    res.status(500).json({ error: "Failed to fetch EC vectors" });
  }
});

// POST: vectorize ad-hoc (no persist) — useful for preview
app.post("/api/ec/vectorize", studentLimiter, requireStudentAuth, async (req, res) => {
  try {
    const { ec, majorInterest } = req.body || {};
    if (!ec || !ec.name) {
      return res.status(400).json({ error: "ec.name is required" });
    }
    const result = await vectorizeECStrength({
      ec,
      description: ec.description,
      majorInterest: majorInterest || null,
    });
    const projected = projectStrengthToLegacyVector(result.factors);
    res.json({
      ecName: ec.name,
      vector: projected.vector,
      composite: projected.composite,
      label: projected.label,
      strength: result,
      factors: EC_FACTORS,
      sourceSystem: "ec_strength_vectors",
      disclaimer: "Automated estimate projected from the unified EC strength system. Open to correction.",
    });
  } catch (err) {
    console.error("[EC] Vectorize error:", err.message);
    res.status(500).json({ error: "Vectorization failed" });
  }
});

// POST: force a full recompute of all unified EC vectors for this student
// (normally happens automatically via syncStudentData)
app.post("/api/ec/recompute", studentLimiter, requireStudentAuth, async (req, res) => {
  try {
    const snap = ragStmts.getLatestSnapshot.get(req.studentId);
    if (!snap) return res.status(404).json({ error: "No profile data" });
    const activities = safeParseJSON(snap.activities_json, []);
    const active = getActiveNarrative(ragStmts.narrative, req.studentId);
    const prestigeAdapter = resolvePrestigeAdapter(req.studentId);
    const result = await recomputeStudentECStrengthVectors(
      ragStmts.strength, req.studentId,
      {
        activities,
        narrative: active?.narrativeText || null,
        narrativeThemes: active?.themes || [],
        narrativeHash: active?.hash || null,
        narrativeId: active?.id || null,
        majorInterest: snap.major_interest || null,
        llmClient: buildDefaultLLMClient(ragStmts.narrativeFitCache),
        prestigeAdapter,
        ragStmts,
      },
    );
    res.json({
      ok: true,
      count: result.count,
      vectors: result.vectors.map((row) => ({
        ecName: row.ecName,
        ...projectStrengthToLegacyVector(row.factors),
        sourceSystem: "ec_strength_vectors",
      })),
      recomputedAt: new Date().toISOString(),
      sourceSystem: "ec_strength_vectors",
    });
  } catch (err) {
    console.error("[EC] Recompute error:", err.message);
    res.status(500).json({ error: "Recompute failed" });
  }
});

// POST: student overrides one or more factor values for a specific EC
app.post("/api/ec/override", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const { ecName, overrides, reason } = req.body || {};
    if (!ecName || !overrides || typeof overrides !== "object") {
      return res.status(400).json({ error: "ecName and overrides object required" });
    }
    // Validate and clamp each factor
    const clamp = (v) => {
      if (v == null) return null;
      const n = Number(v);
      if (!Number.isFinite(n)) return null;
      return Math.max(0, Math.min(1, n));
    };
    const existing = ragStmts.strength.getByStudentAndName.get(req.studentId, ecName);
    if (!existing) {
      return res.status(404).json({ error: "EC not found. Sync your profile first." });
    }
    const mappedOverrides = {};
    if (overrides.impact_and_scope !== undefined) {
      mappedOverrides.achievement = clamp(overrides.impact_and_scope);
    }
    if (overrides.leadership_and_initiative !== undefined) {
      mappedOverrides.leadership = clamp(overrides.leadership_and_initiative);
    }
    if (overrides.passion_and_consistency !== undefined) {
      mappedOverrides.dedication = clamp(overrides.passion_and_consistency);
    }
    if (overrides.talents_and_awards !== undefined) {
      const n = clamp(overrides.talents_and_awards);
      mappedOverrides.achievement = n;
      mappedOverrides.prestige = n;
    }
    if (overrides.relevance_to_intended_major !== undefined) {
      mappedOverrides.major_spike = clamp(overrides.relevance_to_intended_major);
    }
    const result = applyStrengthOverride(ragStmts.strength, req.studentId, ecName, mappedOverrides);
    const projected = projectStrengthToLegacyVector(result.factors);
    res.json({
      ok: true,
      ecName,
      vector: projected.vector,
      composite: projected.composite,
      label: projected.label,
      mappedToStrengthOverrides: mappedOverrides,
      isOverridden: true,
      sourceSystem: "ec_strength_vectors",
    });
  } catch (err) {
    console.error("[EC] Override error:", err.message);
    res.status(500).json({ error: "Override failed" });
  }
});

// POST: build a well-being-first next-step plan for this student
app.post("/api/ec/plan", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const { targetColleges, locale } = req.body || {};
    const snap = ragStmts.getLatestSnapshot.get(req.studentId);
    if (!snap) return res.status(404).json({ error: "No profile data" });

    const activities = safeParseJSON(snap.activities_json, []);
    const courses = safeParseJSON(snap.courses_json, []);
    const apScores = safeParseJSON(snap.ap_scores_json, []);
    const ecStrengthRows = ecStrengthStmts.getByStudent.all(req.studentId);

    // Resolve target colleges: accept unitId list, else fall back to top college match
    let colleges = [];
    if (Array.isArray(targetColleges) && targetColleges.length > 0) {
      for (const id of targetColleges) {
        const row = ragStmts.getCollegeProfile.get(String(id));
        if (row) colleges.push(row);
      }
    }
    if (colleges.length === 0) {
      const match = enhancedCollegeMatch(ragStmts, req.studentId, {});
      // Look up full rows for the top 5 matched colleges
      for (const r of (match.results || []).slice(0, 5)) {
        const row = ragStmts.getCollegeProfile.get(r.unitId);
        if (row) colleges.push(row);
      }
    }

    const academicScore = scoreAcademicStrength(
      {
        gpaUnweighted: snap.gpa_unweighted,
        gpaWeighted: snap.gpa_weighted,
        apCourses: courses.filter(c => c.type === "ap" || c.level === "AP"),
        apScores,
      },
      colleges,
    );

    const plan = buildNextStepPlan({
      ecVectors: ecStrengthRows.map((r) => shapeLegacyECVectorFromStrengthRow(r)?.vector).filter(Boolean),
      strengthVectors: ecStrengthRows.map((r) => ({
        ecName: r.ec_name,
        dedication: r.dedication,
        achievement: r.achievement,
        leadership: r.leadership,
        prestige: r.prestige,
        major_spike: r.major_spike,
        narrative_fit: r.narrative_fit,
      })),
      academicScore,
      activities,
      majorInterest: snap.major_interest,
      locale: locale || "en-US",
    });

    res.json({
      ok: true,
      studentId: req.studentId,
      majorInterest: snap.major_interest,
      plan,
      academicScore,
      targetsUsed: colleges.map(c => ({ unitId: c.unit_id, name: c.name })),
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[EC] Plan error:", err.message);
    res.status(500).json({ error: "Plan generation failed" });
  }
});


// ═══════════════════════════════════════════════════════════
// EC STRENGTH (4-factor) + NARRATIVE + FILE UPLOAD ENDPOINTS
// ═══════════════════════════════════════════════════════════
// Parallel surface for the 4-factor strength vectorizer (dedication,
// achievement, leadership, narrative_fit) plus its supporting narrative
// store and attachment uploads. The 5-factor endpoints above stay
// unchanged — these are additive.

const EC_ATTACHMENTS_DIR = path.join(DATA_DIR, "ec-attachments");
fs.mkdirSync(EC_ATTACHMENTS_DIR, { recursive: true });

// Multer disk storage — pinning to disk (not memory) avoids holding a
// second 10 MB buffer in RAM while OCR runs.
const ecUploadStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const studentDir = path.join(EC_ATTACHMENTS_DIR, String(req.studentId || "anon"));
    fs.mkdirSync(studentDir, { recursive: true });
    cb(null, studentDir);
  },
  filename: (_req, file, cb) => {
    // Intermediate name; we rename to `{contentHash}.{ext}` after extraction
    const ext = (file.originalname.match(/\.[A-Za-z0-9]+$/) || [""])[0].toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}.tmp`);
  },
});

const ecUpload = multer({
  storage: ecUploadStorage,
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (isSupportedMime(file.mimetype)) return cb(null, true);
    const err = new Error(`Unsupported MIME type: ${file.mimetype}`);
    err.code = "UNSUPPORTED_MIME";
    cb(err, false);
  },
});

// POST /api/ec/upload — upload a single supporting file (PDF/DOCX/text/image)
// tied to an EC. Runs text extraction synchronously so the client sees a
// preview on return. If extraction fails we still persist the row with
// status="failed" so retries are possible without re-uploading.
// ═══════════════════════════════════════════════════════════
// CHAT FILE TEXT EXTRACTION
// ═══════════════════════════════════════════════════════════
// Used by the chat-attachment flow when the student uploads a
// Word document (.docx / .doc) or another non-plain-text format
// the browser can't read as UTF-8. Frontend sends base64; we run
// it through file-extractors.js (mammoth for docx, pdf-parse for
// pdf, plain reader for text) and return the extracted text so
// the frontend can paste it into the next prompt.
//
// Auth-gated + rate-limited via studentLimiter. Body size capped
// at MAX_SCHOOL_FILE_SIZE_BYTES (4 MB) on the frontend; this
// endpoint adds a second cap server-side as defense-in-depth.
const CHAT_EXTRACT_MAX_BYTES = 6 * 1024 * 1024; // 6 MB ceiling
app.post("/api/files/extract-text", studentLimiter, requireStudentAuth, async (req, res) => {
  try {
    const { base64, mimeType, filename } = req.body || {};
    if (typeof base64 !== "string" || !base64) {
      return res.status(400).json({ error: "base64 required" });
    }
    // Defense-in-depth size check (base64 length × 0.75 ≈ raw bytes).
    if (base64.length * 0.75 > CHAT_EXTRACT_MAX_BYTES) {
      return res.status(413).json({ error: `File exceeds ${CHAT_EXTRACT_MAX_BYTES} bytes` });
    }
    // Resolve effective mime from name when caller didn't supply one
    // (browser sometimes leaves File.type empty for .docx).
    let mime = String(mimeType || "").toLowerCase();
    if (!mime || !isSupportedMime(mime)) {
      const ext = String(filename || "").split(".").pop()?.toLowerCase() || "";
      if (ext === "docx") mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      else if (ext === "pdf") mime = "application/pdf";
      else if (ext === "txt" || ext === "md") mime = "text/plain";
    }
    if (!isSupportedMime(mime)) {
      return res.status(415).json({
        error: `Unsupported mime type: ${mime || "(unknown)"}`,
        supported: Object.keys(SUPPORTED_MIME_TYPES),
      });
    }
    let buf;
    try { buf = Buffer.from(base64, "base64"); }
    catch { return res.status(400).json({ error: "Invalid base64" }); }
    if (buf.length > CHAT_EXTRACT_MAX_BYTES) {
      return res.status(413).json({ error: `Decoded file exceeds ${CHAT_EXTRACT_MAX_BYTES} bytes` });
    }
    try {
      const result = await extractText(buf, mime);
      const text = String(result?.text || "");
      // Truncate so a single Word doc can't blow past the LLM
      // context budget. 60k chars ≈ 15k tokens — plenty for an
      // essay or resume.
      const MAX_CHARS = 60_000;
      const truncated = text.length > MAX_CHARS;
      return res.json({
        text: truncated ? text.slice(0, MAX_CHARS) : text,
        truncated,
        warning: result?.warning || null,
        bytes: buf.length,
        mime,
      });
    } catch (e) {
      const msg = e instanceof ExtractionError
        ? `${e.code}: ${e.message}`
        : (e?.message || "Extraction failed");
      return res.status(422).json({ error: msg });
    }
  } catch (err) {
    console.error("[FILE-EXTRACT] error:", err.message);
    return res.status(500).json({ error: "Extraction endpoint failed" });
  }
});

app.post("/api/ec/upload", studentLimiter, requireStudentAuth, (req, res) => {
  ecUpload.single("file")(req, res, async (mErr) => {
    if (mErr) {
      if (mErr.code === "UNSUPPORTED_MIME") {
        return res.status(415).json({
          error: mErr.message,
          supported: Array.from(SUPPORTED_MIME_TYPES),
        });
      }
      if (mErr.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: `File exceeds ${MAX_FILE_BYTES} bytes` });
      }
      console.error("[EC upload] multer error:", mErr.message);
      return res.status(400).json({ error: "Upload failed" });
    }
    if (!req.file) return res.status(400).json({ error: "file required" });

    const studentId = req.studentId;
    const ecName = (req.body?.ec_name || "").toString().trim() || null;
    const description = (req.body?.description || "").toString().trim() || null;
    const tmpPath = req.file.path;

    let extractedText = "";
    let extractionStatus = "ok";
    let extractionError = null;
    let warning = null;
    try {
      const buf = fs.readFileSync(tmpPath);
      const result = await extractText(buf, req.file.mimetype);
      extractedText = (result?.text || "").slice(0, 20_000);
      warning = result?.warning || null;
    } catch (e) {
      extractionStatus = "failed";
      extractionError = e instanceof ExtractionError
        ? `${e.code}: ${e.message}`
        : String(e?.message || e).slice(0, 240);
    }

    // Hash the raw file bytes → dedupes re-uploads of the same certificate.
    let contentHash;
    try {
      contentHash = crypto.createHash("sha256").update(fs.readFileSync(tmpPath)).digest("hex");
    } catch {
      contentHash = crypto.randomUUID().replace(/-/g, "");
    }

    const ext = (req.file.originalname.match(/\.[A-Za-z0-9]+$/) || [""])[0].toLowerCase() || "";
    const finalPath = path.join(path.dirname(tmpPath), `${contentHash}${ext}`);
    try {
      if (!fs.existsSync(finalPath)) fs.renameSync(tmpPath, finalPath);
      else fs.unlinkSync(tmpPath); // duplicate content — keep existing
    } catch (e) {
      console.error("[EC upload] rename failed:", e.message);
    }

    const attachmentId = crypto.randomUUID();
    const extractedHash = extractedText
      ? crypto.createHash("sha256").update(extractedText).digest("hex")
      : null;

    try {
      ragStmts.strength.insertAttachment.run(
        attachmentId, studentId, ecName,
        req.file.originalname, req.file.mimetype, req.file.size,
        finalPath, extractedText, extractedHash, extractedText.length,
        extractionStatus, extractionError,
      );
    } catch (e) {
      console.error("[EC upload] insert failed:", e.message);
      return res.status(500).json({ error: "Persist failed" });
    }

    // If an EC is named, kick off a single-student recompute so the new
    // evidence is immediately visible in /api/ec/strength. Fire-and-log;
    // client doesn't wait.
    if (ecName && extractionStatus === "ok") {
      const snap = ragStmts.getLatestSnapshot.get(studentId);
      const activities = snap ? safeParseJSON(snap.activities_json, []) : [];
      const active = getActiveNarrative(ragStmts.narrative, studentId);
      const prestigeAdapter = resolvePrestigeAdapter(studentId);
      recomputeStudentECStrengthVectors(
        ragStmts.strength, studentId,
        {
          activities,
          narrative: active?.narrativeText || null,
          narrativeThemes: active?.themes || [],
          narrativeHash: active?.hash || null,
          narrativeId: active?.id || null,
          majorInterest: snap?.major_interest || null,
          llmClient: buildDefaultLLMClient(ragStmts.narrativeFitCache),
          prestigeAdapter,
          ragStmts,
        },
      ).catch((err) => console.error("[EC upload] post-recompute failed:", err.message));
    }

    res.json({
      ok: true,
      attachment_id: attachmentId,
      ec_name: ecName,
      description,
      mime_type: req.file.mimetype,
      size_bytes: req.file.size,
      extracted_chars: extractedText.length,
      preview: extractedText.slice(0, 400),
      status: extractionStatus,
      warning,
      error: extractionError,
    });
  });
});

// (POST /api/students/transcript-text removed — the survey-side
//  AP/standardized-test/transcript score-report readers and the chat
//  PDF score-report fast-path were retired. Generic file extraction
//  for chat attachments lives at /api/files/extract-text.)

// POST /api/ec/narrative — save a new narrative (deactivates prior active)
app.post("/api/ec/narrative", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const { narrative_text } = req.body || {};
    const result = saveNarrative(ragStmts.narrative, req.studentId, narrative_text);
    res.json({
      ok: true,
      id: result.id,
      hash: result.hash,
      themes: result.themes,
      major_buckets: result.majorBuckets,
      active: true,
      min_chars: NARRATIVE_MIN_CHARS,
      max_chars: NARRATIVE_MAX_CHARS,
    });
  } catch (err) {
    if (err instanceof NarrativeValidationError) {
      return res.status(400).json({ error: err.message, code: err.code });
    }
    console.error("[EC narrative] save error:", err.message);
    res.status(500).json({ error: "Save failed" });
  }
});

// GET /api/ec/narrative — fetch the currently-active narrative
app.get("/api/ec/narrative", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const active = getActiveNarrative(ragStmts.narrative, req.studentId);
    res.json({ active: active || null });
  } catch (err) {
    console.error("[EC narrative] get error:", err.message);
    res.status(500).json({ error: "Fetch failed" });
  }
});

// GET /api/ec/narrative/active — the active narrative flattened to the shape
// the NarrativeEditor reads (narrative_text/id/created_at), plus `source`
// ('student' | 'auto') and `profileStale` (true when the story predates
// newly-added ECs/courses, by fingerprint). Returns null when none exists.
app.get("/api/ec/narrative/active", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const active = getActiveNarrative(ragStmts.narrative, req.studentId);
    if (!active) return res.json(null);
    let profileStale = false;
    try {
      const profile = assembleProfileForGeneration(req.studentId);
      if (profile && active.profileFingerprint) {
        profileStale = active.profileFingerprint !== computeProfileFingerprint(profile);
      }
    } catch { /* non-fatal */ }
    res.json({
      id: active.id,
      narrative_text: active.narrativeText,
      text: active.narrativeText,
      themes: active.themes,
      major_buckets: active.majorBuckets,
      hash: active.hash,
      source: active.source,
      profile_fingerprint: active.profileFingerprint,
      profileStale,
      created_at: active.createdAt,
    });
  } catch (err) {
    console.error("[EC narrative active] get error:", err.message);
    res.status(500).json({ error: "Fetch failed" });
  }
});

// DELETE /api/ec/narrative — soft-delete (sets is_active=0, preserves history)
app.delete("/api/ec/narrative", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const info = softDeleteNarrative(ragStmts.narrative, req.studentId);
    res.status(204).set("X-Deactivated", String(info.deactivated)).end();
  } catch (err) {
    console.error("[EC narrative] delete error:", err.message);
    res.status(500).json({ error: "Delete failed" });
  }
});

// GET /api/narrative/drift — detect stale EC vectors after a narrative edit.
// Jiyeon UX audit F10: when the student rewrites their narrative (e.g. she
// pivots from "pre-med" to "computational biology"), every EC strength
// vector that was computed against the old narrative is now stale — the
// narrative_fit score might be wildly off. This endpoint surfaces which
// ECs need recompute so the UI can show a "N activities need to be rescored"
// banner and offer a one-click recompute.
app.get("/api/narrative/drift", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const locale = resolveLocale(req);
    const active = getActiveNarrative(ragStmts.narrative, req.studentId);
    if (!active) {
      return res.json({
        ok: true,
        hasActive: false,
        activeNarrativeId: null,
        activeHash: null,
        staleCount: 0,
        freshCount: 0,
        stale: [],
        fresh: [],
        locale,
        friendlyMessage: t("drift.no_active_narrative", locale),
      });
    }
    const rows = ragStmts.strength?.getByStudent?.all(req.studentId) || [];
    const stale = [];
    const fresh = [];
    for (const row of rows) {
      const entry = {
        ecName: row.ec_name,
        narrativeVersionId: row.narrative_version_id || null,
        narrativeFit: row.narrative_fit,
        updatedAt: row.updated_at,
      };
      if (!row.narrative_version_id || row.narrative_version_id !== active.id) {
        stale.push({ ...entry, reason: !row.narrative_version_id ? "never_tied_to_narrative" : "narrative_changed" });
      } else {
        fresh.push(entry);
      }
    }
    const staleCount = stale.length;
    const friendlyMessage =
      staleCount === 0
        ? t("drift.all_fresh", locale)
        : staleCount === 1
        ? t("drift.one_stale", locale)
        : t("drift.many_stale", locale, { count: staleCount });
    res.json({
      ok: true,
      hasActive: true,
      activeNarrativeId: active.id,
      activeHash: active.hash,
      activeUpdatedAt: active.createdAt || null,
      totalEC: rows.length,
      staleCount,
      freshCount: fresh.length,
      stale,
      fresh,
      recomputeUrl: staleCount > 0 ? `/api/ec/strength/recompute` : null,
      locale,
      friendlyMessage,
    });
  } catch (err) {
    console.error("[narrative drift] error:", err.message);
    res.status(500).json({ error: "Drift detection failed" });
  }
});

// POST /api/ec/candidates/rank — narrative-aware ranking of candidate ECs.
// Jiyeon UX audit F6. The student types a shortlist of ideas she's debating
// ("Start a bioinformatics club", "Translate at a patient foundation"); we
// score each one against her ACTIVE narrative's themes + major buckets.
// A fast deterministic keyword/bucket pass produces a baseline; when the
// student has a BYOK key we then run an LLM + web-search SEMANTIC re-rank
// (so "BBB Nanoparticle Review Paper" is recognized as strong bio research
// even with zero literal keyword overlap) and merge it over the baseline.
app.post("/api/ec/candidates/rank", studentLimiter, requireStudentAuth, async (req, res) => {
  try {
    const locale = resolveLocale(req);
    const { candidates, majorInterest } = req.body || {};
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return res.status(400).json({ error: "candidates must be a non-empty array of {name, description?}" });
    }
    if (candidates.length > 25) {
      return res.status(400).json({ error: "max 25 candidates per request" });
    }

    const active = getActiveNarrative(ragStmts.narrative, req.studentId);
    if (!active) {
      return res.status(409).json({
        error: "no_active_narrative",
        locale,
        friendlyMessage: t("candidates.no_active_narrative", locale),
      });
    }

    const narrativeThemes = (active.themes || [])
      .map((t) => (typeof t === "string" ? t : t?.theme))
      .filter(Boolean)
      .map((t) => String(t).toLowerCase());
    const narrativeBuckets = new Set((active.majorBuckets || []).map(String));
    const declaredMajorBucket = majorInterest ? matchMajorBucketFn(majorInterest) : null;
    if (declaredMajorBucket) narrativeBuckets.add(declaredMajorBucket);

    const ranked = candidates.map((raw, idx) => {
      const name = String(raw?.name || "").trim();
      const description = String(raw?.description || "").trim();
      const combined = `${name} ${description}`.toLowerCase();
      if (!name) {
        return { ok: false, index: idx, error: t("candidates.name_required", locale) };
      }

      // 1. Major bucket match — did the candidate's text land in one of
      //    the narrative's detected buckets?
      const candidateBucket = matchMajorBucketFn(combined);
      const bucketHit = candidateBucket && narrativeBuckets.has(candidateBucket);

      // 2. Theme co-occurrence — count how many narrative themes appear in
      //    the candidate's text. Weight unigrams at 1, bigrams at 2.
      let themeHits = 0;
      const matchedThemes = [];
      for (const theme of narrativeThemes) {
        if (theme.length < 4) continue;
        if (combined.includes(theme)) {
          themeHits += theme.includes(" ") ? 2 : 1;
          matchedThemes.push(theme);
          if (matchedThemes.length >= 8) break;
        }
      }

      // 3. Predicted narrative_fit in [0, 1] — a friendly linear model.
      const predictedNarrativeFit = Math.min(
        1,
        (bucketHit ? 0.5 : 0) + Math.min(0.5, themeHits * 0.08),
      );

      // 4. Predicted tier — an EC that would land tier_2+ needs at least
      //    both a bucket match and some theme overlap.
      let predictedTier = "tier_4_foundational";
      if (bucketHit && themeHits >= 3) predictedTier = "tier_2_strong";
      else if (bucketHit || themeHits >= 4) predictedTier = "tier_3_developing";

      // Friendly summary — route through i18n so Korean students read Korean.
      const prettyBucket = (candidateBucket || "").replace(/_/g, " ");
      const themesList = matchedThemes.slice(0, 3).join(", ");
      let summaryKey;
      let summaryParams = {};
      if (bucketHit && themeHits >= 2) {
        summaryKey = "candidates.summary_strong";
        summaryParams = { bucket: prettyBucket, themes: themesList, fit: predictedNarrativeFit.toFixed(2) };
      } else if (bucketHit) {
        summaryKey = "candidates.summary_major_hit";
        summaryParams = { bucket: prettyBucket };
      } else if (themeHits > 0) {
        summaryKey = "candidates.summary_partial";
        summaryParams = { themes: themesList };
      } else {
        summaryKey = "candidates.summary_weak";
      }

      return {
        ok: true,
        index: idx,
        name,
        description: description || null,
        candidateBucket: candidateBucket || null,
        bucketHit,
        matchedThemes,
        themeHits,
        predictedNarrativeFit: Math.round(predictedNarrativeFit * 100) / 100,
        predictedTier,
        friendly: {
          tier: renderFriendlyTier(predictedTier),
          narrativeFit: renderFriendlyFactor("narrative_fit"),
          summary: t(summaryKey, locale, summaryParams),
          summaryKey,
        },
      };
    });

    // Sort descending by predicted fit so the student can see the top picks first.
    ranked.sort((a, b) => (b.predictedNarrativeFit ?? 0) - (a.predictedNarrativeFit ?? 0));

    // ── LLM + web-search semantic re-rank (best-effort, BYOK-gated) ──
    // The deterministic pass above is brittle (literal keyword overlap). When
    // the student has a personal key, ask the LLM to judge each idea's true
    // fit to the narrative/profile/target schools and web-research prestige,
    // then merge those scores + rationales over the baseline. Any failure
    // silently keeps the deterministic result.
    let engine = "deterministic";
    const targetSchools = resolveTargetSchools(req.studentId, req.body?.targetSchools);
    try {
      const gate = checkBudget(piiVault, ragStmts, req.studentId);
      const { byok, callLLM } = gate.allowed ? buildStudentCallLLM(req.studentId) : { byok: null, callLLM: null };
      if (byok && callLLM) {
        const llm = await llmRankCandidates({ callLLM, byok, studentId: req.studentId, active, candidates, targetSchools });
        if (Array.isArray(llm) && llm.length) {
          const byName = new Map(llm.map((x) => [x.name.toLowerCase(), x]));
          for (const row of ranked) {
            if (!row.ok) continue;
            const m = byName.get(String(row.name).toLowerCase());
            if (!m) continue;
            row.predictedNarrativeFit = Math.round(m.fit * 100) / 100;
            if (m.tier) row.predictedTier = m.tier;
            row.friendly = {
              ...row.friendly,
              tier: renderFriendlyTier(row.predictedTier),
              summary: m.prestigeNote ? `${m.rationale} ${m.prestigeNote}`.trim() : (m.rationale || row.friendly?.summary),
            };
            if (m.sources?.length) row.sources = m.sources;
            row.engine = "llm";
          }
          ranked.sort((a, b) => (b.predictedNarrativeFit ?? 0) - (a.predictedNarrativeFit ?? 0));
          engine = "llm";
        }
      }
    } catch (e) {
      console.warn("[EC candidates rank] LLM re-rank failed, using deterministic:", e.message);
    }

    res.json({
      ok: true,
      engine,
      narrativeId: active.id,
      narrativeHash: active.hash,
      narrativeBuckets: [...narrativeBuckets],
      targetSchools,
      candidates: ranked,
      count: ranked.length,
      locale,
    });
  } catch (err) {
    console.error("[EC candidates rank] error:", err.message);
    res.status(500).json({ error: "Candidate ranking failed" });
  }
});

// LLM + web-search semantic ranker for candidate EC ideas. Judges each
// idea's genuine fit to the student's narrative/profile/target schools and
// web-researches real prestige/selectivity. Returns a normalized array; the
// caller merges it over the deterministic baseline. Throws on hard failure
// (caller catches and falls back).
const RANK_TIERS = ["tier_1_distinctive", "tier_2_strong", "tier_3_developing", "tier_4_foundational"];
async function llmRankCandidates({ callLLM, byok, studentId, active, candidates, targetSchools }) {
  const profile = assembleProfileForGeneration(studentId) || {};
  const summary = profileSummaryForPrompt(profile, active);
  const priorities = await getSchoolPriorities(targetSchools || []);
  const schoolBlock = schoolPrioritiesPromptBlock(priorities);
  const themes = (active?.themes || []).map((th) => (typeof th === "string" ? th : th?.theme)).filter(Boolean).slice(0, 12).join(", ");
  const list = candidates.slice(0, 25)
    .map((c, i) => `${i + 1}. ${String(c?.name || "").trim()}${c?.description ? ` — ${String(c.description).trim()}` : ""}`)
    .join("\n");
  const extraDomains = [];
  const tools = [makeWebSearchTool(extraDomains), makeWebFetchTool(extraDomains)];
  const prompt = `You are ranking candidate extracurricular IDEAS a student is weighing, by how much each would strengthen THIS student's application.

STUDENT NARRATIVE (the story everything should reinforce):
"${active?.narrativeText || ""}"
Narrative themes: ${themes || "(none yet)"}

STUDENT PROFILE:
${summary}${schoolBlock}

CANDIDATE IDEAS:
${list}

Judge each idea SEMANTICALLY — do NOT rely on literal keyword overlap. Weigh: how strongly it reinforces the student's narrative and intended major, how distinctive/competitive it is, and how well it fits the target schools' priorities above. Use web search to check the REAL selectivity/prestige/feasibility of any named program, competition, journal, or activity, and let that inform the score and tier. Never invent facts about the student.

Return ONLY a JSON array, exactly one object per candidate, no prose, no markdown:
[
  {
    "name": "<exact candidate name from the list>",
    "fit": <number 0..1 — how much it strengthens THIS application>,
    "tier": "tier_1_distinctive|tier_2_strong|tier_3_developing|tier_4_foundational",
    "rationale": "<1-2 sentences, specific to this student and their story>",
    "prestigeNote": "<optional one line on real selectivity/prestige if researched>",
    "sources": ["<url you used>", "..."]
  }
]`;
  const resp = await callLLM({
    // Web-grounded ranking uses the LARGE/reasoning tier (OpenRouter default:
    // deepseek/deepseek-v4-pro), which gets web search via the OR web plugin.
    // Reasoning models burn output budget on internal thinking before the
    // visible JSON, so allow a generous max_tokens floor.
    model: byok.models?.large || byok.models?.medium,
    max_tokens: 8192,
    system: "You are a precise, honest college admissions analyst. Rank candidate ECs by genuine fit to the student, grounded in real evidence. Output ONLY the requested JSON array.",
    messages: [{ role: "user", content: prompt }],
    tools,
    wantsWeb: true,
    extraDomains,
  });
  const text = (resp?.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  const parsed = parseLLMJson(text);
  const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.candidates) ? parsed.candidates : []);
  return arr
    .map((it) => ({
      name: String(it?.name || "").trim(),
      fit: Math.max(0, Math.min(1, Number(it?.fit))),
      tier: RANK_TIERS.includes(it?.tier) ? it.tier : null,
      rationale: String(it?.rationale || "").slice(0, 400),
      prestigeNote: it?.prestigeNote ? String(it.prestigeNote).slice(0, 300) : null,
      sources: Array.isArray(it?.sources) ? it.sources.slice(0, 5).map((u) => String(u).slice(0, 400)) : [],
    }))
    .filter((x) => x.name && Number.isFinite(x.fit));
}

// LLM + web-search re-rank for the Spike Finder: decide which of the
// student's EXISTING activities should LEAD the application, considering the
// narrative, target-school priorities, and web-researched prestige — not
// just the deterministic factor composite. Returns normalized lead decisions;
// caller merges over the composite ordering. Throws on hard failure.
async function llmRankSpike({ callLLM, byok, studentId, active, vectors, targetSchools }) {
  const profile = assembleProfileForGeneration(studentId) || {};
  const summary = profileSummaryForPrompt(profile, active);
  const priorities = await getSchoolPriorities(targetSchools || []);
  const schoolBlock = schoolPrioritiesPromptBlock(priorities);
  const list = vectors.slice(0, 25).map((v, i) => {
    const f = v.factors || {};
    return `${i + 1}. ${v.ecName} [tier=${v.tierLabel || "?"}; major_spike=${(f.major_spike ?? 0).toFixed?.(2) ?? f.major_spike}; narrative_fit=${(f.narrative_fit ?? 0).toFixed?.(2) ?? f.narrative_fit}; prestige=${(f.prestige ?? 0).toFixed?.(2) ?? f.prestige}]`;
  }).join("\n");
  const extraDomains = [];
  const tools = [makeWebSearchTool(extraDomains), makeWebFetchTool(extraDomains)];
  const prompt = `Decide which of this student's EXISTING activities should LEAD their application (the 2-3 that define their "spike"), and which are supporting.

STUDENT NARRATIVE:
"${active?.narrativeText || "(none yet)"}"

STUDENT PROFILE:
${summary}${schoolBlock}

ACTIVITIES (with current factor scores):
${list}

Judge holistically: which activities most define a coherent, distinctive story aligned to the intended major and the target schools' priorities. Use web search to verify the REAL selectivity/prestige of named programs/competitions and let it inform the decision. Never invent achievements.

Return ONLY a JSON array, one object per activity, no prose:
[
  { "name": "<exact activity name>", "lead": <true|false>, "leadScore": <0..1>, "rationale": "<1 sentence why it leads or supports>", "sources": ["<url>"] }
]`;
  const resp = await callLLM({
    // LARGE/reasoning tier (OpenRouter default: deepseek/deepseek-v4-pro) for
    // web-grounded spike selection. Generous max_tokens for the thinking phase.
    model: byok.models?.large || byok.models?.medium,
    max_tokens: 8192,
    system: "You are a precise college admissions analyst selecting a student's leading activities. Output ONLY the requested JSON array.",
    messages: [{ role: "user", content: prompt }],
    tools,
    wantsWeb: true,
    extraDomains,
  });
  const text = (resp?.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  const parsed = parseLLMJson(text);
  const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.activities) ? parsed.activities : []);
  return arr
    .map((it) => ({
      name: String(it?.name || "").trim(),
      lead: Boolean(it?.lead),
      leadScore: Math.max(0, Math.min(1, Number(it?.leadScore))),
      rationale: String(it?.rationale || "").slice(0, 300),
      sources: Array.isArray(it?.sources) ? it.sources.slice(0, 4).map((u) => String(u).slice(0, 400)) : [],
    }))
    .filter((x) => x.name);
}

// Compact deterministic narrative-fit tagger — same model as the candidate
// ranker (bucket hit + theme overlap → predicted tier). Used to annotate
// LLM-generated EC ideas so the student sees how each lands against their
// story without a second LLM call.
function tagIdeaWithNarrative(text, active) {
  if (!active) return { bucketHit: false, themeHits: 0, predictedNarrativeFit: null, predictedTier: null };
  const combined = String(text || "").toLowerCase();
  const narrativeThemes = (active.themes || [])
    .map((th) => (typeof th === "string" ? th : th?.theme))
    .filter(Boolean)
    .map((th) => String(th).toLowerCase());
  const narrativeBuckets = new Set((active.majorBuckets || []).map(String));
  const candidateBucket = matchMajorBucketFn(combined);
  const bucketHit = Boolean(candidateBucket && narrativeBuckets.has(candidateBucket));
  let themeHits = 0;
  for (const theme of narrativeThemes) {
    if (theme.length < 4) continue;
    if (combined.includes(theme)) themeHits += theme.includes(" ") ? 2 : 1;
  }
  const predictedNarrativeFit = Math.round(Math.min(1, (bucketHit ? 0.5 : 0) + Math.min(0.5, themeHits * 0.08)) * 100) / 100;
  let predictedTier = "tier_4_foundational";
  if (bucketHit && themeHits >= 3) predictedTier = "tier_2_strong";
  else if (bucketHit || themeHits >= 4) predictedTier = "tier_3_developing";
  return { bucketHit, themeHits, predictedNarrativeFit, predictedTier };
}

// Build a compact, PII-light profile summary string for generation prompts.
function profileSummaryForPrompt(profile, active) {
  const lines = [];
  if (profile.majorInterest) lines.push(`Intended major: ${profile.majorInterest}`);
  if (profile.gpaUnweighted != null) lines.push(`GPA: ${profile.gpaUnweighted}${profile.gpaWeighted != null ? ` (weighted ${profile.gpaWeighted})` : ""}`);
  const tests = (profile.testScores || []).map(t => `${String(t.test || "").toUpperCase()} ${t.totalScore ?? t.total ?? ""}`.trim()).filter(Boolean);
  if (tests.length) lines.push(`Test scores: ${tests.join(", ")}`);
  const aps = (profile.apScores || []).map(a => `${a.name || a.exam || "AP"}${a.score ? ` (${a.score})` : ""}`).filter(Boolean);
  if (aps.length) lines.push(`AP exams: ${aps.slice(0, 12).join(", ")}`);
  const courses = (profile.courses || []).slice(0, 30).map(c => `${c.name || "?"}${c.type ? ` [${c.type}]` : ""}`);
  if (courses.length) lines.push(`Courses (${(profile.courses || []).length}):\n  ${courses.join("\n  ")}`);
  const acts = (profile.activities || []).slice(0, 20).map(a => `${a.name || "?"} (${a.category || "other"}${a.role ? `, ${a.role}` : ""}) — ${(a.description || "").slice(0, 140)}`);
  if (acts.length) lines.push(`Current activities (${(profile.activities || []).length}):\n  ${acts.join("\n  ")}`);
  const goals = (profile.goals || []).map(g => g.school || g.name).filter(Boolean);
  if (goals.length) lines.push(`Target schools: ${goals.slice(0, 12).join(", ")}`);
  if (active?.themes?.length) {
    const themes = active.themes.map(th => (typeof th === "string" ? th : th?.theme)).filter(Boolean);
    if (themes.length) lines.push(`Narrative themes: ${themes.slice(0, 10).join(", ")}`);
  }
  return lines.join("\n");
}

// POST /api/ec/ideas/generate — brainstorm NEW EC ideas grounded ONLY in the
// student's real profile (courses, ECs, scores, major, goals, narrative).
// Honors SKILL.md: suggestions framed as "you might consider", never invents
// awards/prestige. Each idea is tagged with deterministic narrative fit.
app.post("/api/ec/ideas/generate", studentLimiter, requireStudentAuth, async (req, res) => {
  try {
    const locale = resolveLocale(req);
    const gate = checkBudget(piiVault, ragStmts, req.studentId);
    if (!gate.allowed) return res.status(402).json({ error: gate.reason, code: "budget_exceeded" });
    const { byok, callLLM } = buildStudentCallLLM(req.studentId);
    if (!byok) return res.status(400).json({ error: "No personal API key on file. Set one at /api/students/apikey first." });
    const profile = assembleProfileForGeneration(req.studentId);
    if (!profile) return res.status(404).json({ error: "No profile data. Complete your profile first." });
    const active = getActiveNarrative(ragStmts.narrative, req.studentId);
    const count = Math.min(8, Math.max(3, parseInt(req.body?.count, 10) || 5));
    const targetSchools = resolveTargetSchools(req.studentId, req.body?.targetSchools);
    const priorities = await getSchoolPriorities(targetSchools);
    const schoolBlock = schoolPrioritiesPromptBlock(priorities);

    const summary = profileSummaryForPrompt(profile, active);
    const prompt = `STUDENT PROFILE (their real data — the ONLY basis for your ideas):
${summary}${schoolBlock}

TASK: Suggest ${count} extracurricular activity IDEAS this student could realistically pursue to strengthen their application${targetSchools.length ? " for the target schools above" : ""}. Ground EVERY idea in the profile above — connect each to a course, an existing activity, a test/AP strength, the intended major, or a stated goal.

RULES:
- Build on what the student already does (depth over breadth). Prefer deepening or extending existing activities and a coherent "spike" over scattered new clubs.${targetSchools.length ? "\n- Favor ideas that strengthen fit for what the target schools value above, but only where it fits the student's genuine direction." : ""}
- Include at least one idea that builds community & character (service, mentorship, inclusivity, or authentic community impact) where it grows naturally out of something the student already cares about — never as résumé-padding.
- NEVER claim the student has won an award, held a title, or done something not in the profile.
- Each idea must be something the student does themselves; frame as a suggestion to consider. These are activity ideas the student carries out and later writes about in their OWN words — never draft the essay or the story for them.

Return ONLY a JSON array of exactly ${count} objects, no prose, no markdown:
[
  {
    "name": "<short activity name>",
    "category": "<research|service|leadership|competition|creative|work|club|project|community|other>",
    "rationale": "<1-2 sentences tying this to the student's specific evidence above>",
    "dimension": "<which strength it builds: leadership|achievement|dedication|major_spike|prestige|narrative_fit|community_and_character>",
    "hoursPerWeekEstimate": <integer>
  }
]`;

    const resp = await callLLM({
      model: byok.models?.medium || byok.models?.large,
      max_tokens: 2000,
      system: "You are a college counselor brainstorming extracurricular ideas grounded ONLY in the student's real profile. Never invent awards or accomplishments. Output ONLY the requested JSON.",
      messages: [{ role: "user", content: prompt }],
    });
    const text = (resp?.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
    const parsed = parseLLMJson(text);
    const rawIdeas = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.ideas) ? parsed.ideas : []);
    const ideas = rawIdeas.slice(0, count).map((it) => {
      const name = String(it?.name || "").slice(0, 120);
      const category = String(it?.category || "other").slice(0, 40);
      const rationale = String(it?.rationale || "").slice(0, 400);
      const dimension = String(it?.dimension || "").slice(0, 40);
      const hours = Number.isFinite(Number(it?.hoursPerWeekEstimate)) ? Math.max(0, Math.min(40, Math.round(Number(it.hoursPerWeekEstimate)))) : null;
      const tag = tagIdeaWithNarrative(`${name} ${rationale}`, active);
      return {
        name, category, rationale, dimension,
        hoursPerWeekEstimate: hours,
        ...tag,
        friendly: tag.predictedTier ? { tier: renderFriendlyTier(tag.predictedTier) } : null,
      };
    }).filter(it => it.name);

    res.json({ ok: true, ideas, count: ideas.length, hasNarrative: Boolean(active), targetSchools, locale });
  } catch (err) {
    if (Number.isInteger(err?.status) || err?.code) return respondLLMError(res, err, "EC ideas generate");
    console.error("[EC ideas generate] error:", err.message);
    res.status(500).json({ error: "Idea generation failed" });
  }
});

// POST /api/narrative/draft — generate a DRAFT 100-1500 char self-presentation
// from the student's profile. NOT an essay (SKILL.md permits drafting short
// self-presentation statements). NOT saved — the student edits and saves via
// POST /api/ec/narrative.
app.post("/api/narrative/draft", studentLimiter, requireStudentAuth, async (req, res) => {
  try {
    const locale = resolveLocale(req);
    const gate = checkBudget(piiVault, ragStmts, req.studentId);
    if (!gate.allowed) return res.status(402).json({ error: gate.reason, code: "budget_exceeded" });
    const { byok, callLLM } = buildStudentCallLLM(req.studentId);
    if (!byok) return res.status(400).json({ error: "No personal API key on file. Set one at /api/students/apikey first." });
    const profile = assembleProfileForGeneration(req.studentId);
    if (!profile) return res.status(404).json({ error: "No profile data. Complete your profile first." });
    const existing = getActiveNarrative(ragStmts.narrative, req.studentId);
    const targetSchools = resolveTargetSchools(req.studentId, req.body?.targetSchools);
    const priorities = await getSchoolPriorities(targetSchools);
    const schoolBlock = schoolPrioritiesPromptBlock(priorities);
    const draft = await generateNarrativeDraftText({ profile, existing, callLLM, byok, schoolBlock });
    res.json({ ok: true, draft, chars: draft.length, targetSchools, locale });
  } catch (err) {
    if (Number.isInteger(err?.status) || err?.code) return respondLLMError(res, err, "narrative draft");
    console.error("[narrative draft] error:", err.message);
    res.status(500).json({ error: "Narrative draft generation failed" });
  }
});

// POST /api/students/deadlines — create a personal deadline.
// F7 from Jiyeon UX audit: the app tracks admissions rounds centrally but
// a scared 11th grader also tracks "finish MIT essay draft", "mail paper
// certificate to dad for re-upload", "AP BioChem registration".
app.post("/api/students/deadlines", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const { title, dueAt, category, notes, collegeIds } = req.body || {};
    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return res.status(400).json({ error: "title required" });
    }
    if (!dueAt || typeof dueAt !== "string") {
      return res.status(400).json({ error: "dueAt (ISO-8601) required" });
    }
    const parsed = Date.parse(dueAt);
    if (!Number.isFinite(parsed)) {
      return res.status(400).json({ error: "dueAt must be a parseable ISO-8601 date", friendlyMessage: t("deadlines.due_at_invalid", resolveLocale(req)) });
    }
    const allowedCategories = ["personal", "admissions", "financial_aid", "test", "other"];
    const cat = allowedCategories.includes(category) ? category : "personal";
    const id = crypto.randomUUID();
    ragStmts.deadlines.insert.run(
      id,
      req.studentId,
      title.trim(),
      new Date(parsed).toISOString(),
      cat,
      notes ? String(notes).slice(0, 2000) : null,
      Array.isArray(collegeIds) ? JSON.stringify(collegeIds.slice(0, 20).map(String)) : null,
      "open",
    );
    const row = ragStmts.deadlines.getById.get(id, req.studentId);
    res.status(201).json({ ok: true, deadline: shapeDeadline(row) });
  } catch (err) {
    console.error("[deadlines] create error:", err.message);
    res.status(500).json({ error: "Create failed" });
  }
});

// POST /api/students/deadlines/bulk — create several deadlines in ONE request.
// Used when a target school is added (Early/RD/financial-aid/commit at once)
// so we don't fire 4+ separate POSTs and trip the rate limiter (HTTP 429).
// De-dupes against the student's existing deadline titles (case-insensitive).
app.post("/api/students/deadlines/bulk", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 20) : null;
    if (!items || items.length === 0) return res.status(400).json({ error: "items (non-empty array) required" });
    const allowed = ["personal", "admissions", "financial_aid", "test", "other"];
    const existing = ragStmts.deadlines.listByStudent.all(req.studentId) || [];
    const existingTitles = new Set(existing.map((d) => String(d.title || "").trim().toLowerCase()));
    const created = [];
    let skipped = 0;
    for (const it of items) {
      const title = String(it?.title || "").trim();
      const due = Date.parse(it?.dueAt);
      if (!title || !Number.isFinite(due)) { skipped += 1; continue; }
      if (existingTitles.has(title.toLowerCase())) { skipped += 1; continue; }
      const cat = allowed.includes(it?.category) ? it.category : "admissions";
      const id = crypto.randomUUID();
      ragStmts.deadlines.insert.run(
        id, req.studentId, title, new Date(due).toISOString(), cat,
        it?.notes ? String(it.notes).slice(0, 2000) : null, null, "open",
      );
      existingTitles.add(title.toLowerCase());
      const row = ragStmts.deadlines.getById.get(id, req.studentId);
      if (row) created.push(shapeDeadline(row));
    }
    res.status(201).json({ ok: true, created, createdCount: created.length, skipped });
  } catch (err) {
    console.error("[deadlines] bulk create error:", err.message);
    res.status(500).json({ error: "Bulk create failed" });
  }
});

// GET /api/students/deadlines — list all deadlines for the current student.
app.get("/api/students/deadlines", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const locale = resolveLocale(req);
    const rows = ragStmts.deadlines.listByStudent.all(req.studentId) || [];
    const now = Date.now();
    const shaped = rows.map((r) => shapeDeadline(r, now));
    const upcoming = shaped.filter((d) => d.status === "open" && d.daysUntil >= 0);
    const overdue = shaped.filter((d) => d.status === "open" && d.daysUntil < 0);
    const done = shaped.filter((d) => d.status === "done");
    let friendlyMessage;
    if (overdue.length > 0) {
      friendlyMessage = t(
        overdue.length === 1 ? "deadlines.overdue_one" : "deadlines.overdue_many",
        locale,
        { count: overdue.length },
      );
    } else if (upcoming.length === 0) {
      friendlyMessage = t("deadlines.no_upcoming", locale);
    } else {
      const next = upcoming[0];
      friendlyMessage = t(
        next?.daysUntil === 1 ? "deadlines.upcoming_next_one" : "deadlines.upcoming_next_many",
        locale,
        { count: upcoming.length, title: next?.title, days: next?.daysUntil },
      );
    }
    res.json({
      ok: true,
      count: shaped.length,
      upcomingCount: upcoming.length,
      overdueCount: overdue.length,
      doneCount: done.length,
      deadlines: shaped,
      locale,
      friendlyMessage,
    });
  } catch (err) {
    console.error("[deadlines] list error:", err.message);
    res.status(500).json({ error: "List failed" });
  }
});

// PATCH /api/students/deadlines/:id — update status or fields.
app.patch("/api/students/deadlines/:id", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const { id } = req.params;
    const existing = ragStmts.deadlines.getById.get(id, req.studentId);
    if (!existing) return res.status(404).json({ error: "deadline not found" });
    const { title, dueAt, category, notes, collegeIds, status } = req.body || {};
    const locale = resolveLocale(req);
    // Status-only convenience path.
    if (status && !title && !dueAt && !category && notes === undefined && !collegeIds) {
      if (!["open", "done", "snoozed"].includes(status)) {
        return res.status(400).json({ error: "status must be open|done|snoozed", friendlyMessage: t("deadlines.status_invalid", locale) });
      }
      ragStmts.deadlines.updateStatus.run(status, id, req.studentId);
    } else {
      if (dueAt && !Number.isFinite(Date.parse(dueAt))) {
        return res.status(400).json({ error: "dueAt must be a parseable ISO-8601 date", friendlyMessage: t("deadlines.due_at_invalid", locale) });
      }
      if (status && !["open", "done", "snoozed"].includes(status)) {
        return res.status(400).json({ error: "status must be open|done|snoozed", friendlyMessage: t("deadlines.status_invalid", locale) });
      }
      ragStmts.deadlines.updateFields.run(
        title ? title.trim() : null,
        dueAt ? new Date(Date.parse(dueAt)).toISOString() : null,
        category || null,
        notes !== undefined ? (notes ? String(notes).slice(0, 2000) : null) : null,
        Array.isArray(collegeIds) ? JSON.stringify(collegeIds.slice(0, 20).map(String)) : null,
        id,
        req.studentId,
      );
      if (status) ragStmts.deadlines.updateStatus.run(status, id, req.studentId);
    }
    const updated = ragStmts.deadlines.getById.get(id, req.studentId);
    res.json({ ok: true, deadline: shapeDeadline(updated) });
  } catch (err) {
    console.error("[deadlines] update error:", err.message);
    res.status(500).json({ error: "Update failed" });
  }
});

// DELETE /api/students/deadlines/:id — remove a deadline.
app.delete("/api/students/deadlines/:id", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const { id } = req.params;
    const existing = ragStmts.deadlines.getById.get(id, req.studentId);
    if (!existing) return res.status(404).json({ error: "deadline not found" });
    ragStmts.deadlines.delete.run(id, req.studentId);
    res.status(204).end();
  } catch (err) {
    console.error("[deadlines] delete error:", err.message);
    res.status(500).json({ error: "Delete failed" });
  }
});

function shapeDeadline(row, nowMs) {
  if (!row) return null;
  const due = row.due_at ? new Date(row.due_at).getTime() : null;
  const n = nowMs || Date.now();
  const daysUntil = due != null ? Math.round((due - n) / 86400000) : null;
  let collegeIds = [];
  try { if (row.college_ids_json) collegeIds = JSON.parse(row.college_ids_json); } catch {}
  return {
    id: row.id,
    title: row.title,
    dueAt: row.due_at,
    category: row.category,
    notes: row.notes,
    status: row.status,
    collegeIds,
    daysUntil,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/ec/strength — list 5-factor strength vectors for this student
// When ?friendly=1, each vector is decorated with human-readable labels
// (tier, prestige source, factors). Jiyeon UX audit F11.
app.get("/api/ec/strength", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const locale = resolveLocale(req);
    const rows = ragStmts.strength.getByStudent.all(req.studentId) || [];
    const wantFriendly = req.query.friendly === "1" || req.query.friendly === "true";
    const vectors = rows
      .map(toStrengthPublicShape)
      .filter(Boolean)
      .map((v) => {
        if (!wantFriendly) return v;
        const explanation = getPrestigeExplanation(ragStmts, v.ecName);
        return enrichECVectorWithFriendly(v, explanation);
      });
    // When the caller wants friendly labels, also ship a locale-aware legend
    // so the frontend can key off `friendlyLegendI18n[tier]` without
    // maintaining its own Korean copy.
    const localizedLegend = wantFriendly ? localizeFriendlyLabels(locale) : null;
    res.json({
      count: rows.length,
      factors: STRENGTH_FACTORS,
      tiers: Object.values(TIERS),
      vectors,
      locale,
      ...(wantFriendly
        ? {
            friendlyLegend: {
              tiers: TIER_FRIENDLY,
              prestigeSources: PRESTIGE_SOURCE_FRIENDLY,
              factors: FACTOR_FRIENDLY,
            },
            friendlyLegendI18n: localizedLegend,
          }
        : {}),
    });
  } catch (err) {
    console.error("[EC strength] list error:", err.message);
    res.status(500).json({ error: "Fetch failed" });
  }
});

// GET /api/ec/strength/:ecName — single EC with reasoning + file refs.
// Always includes the friendly label block and (when cached) the prestige
// explanation — this is the page the student will actually stare at while
// deciding whether to keep, deepen, or drop an EC.
app.get("/api/ec/strength/:ecName", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const row = ragStmts.strength.getByStudentAndName.get(req.studentId, req.params.ecName);
    if (!row) return res.status(404).json({ error: "No strength vector for this EC" });
    const fileRefIds = safeParseJSON(row.file_refs_json, []);
    const attachments = fileRefIds
      .map((id) => ragStmts.strength.getAttachmentById.get(id))
      .filter(Boolean)
      .map((a) => ({
        id: a.id,
        ec_name: a.ec_name,
        filename: a.filename,
        mime_type: a.mime_type,
        extracted_chars: a.extracted_chars,
        status: a.extraction_status,
        uploaded_at: a.uploaded_at,
      }));
    const baseVector = toStrengthPublicShape(row);
    const explanation = getPrestigeExplanation(ragStmts, req.params.ecName);
    const enriched = enrichECVectorWithFriendly(baseVector, explanation);
    res.json({
      ok: true,
      vector: enriched,
      reasoning: safeParseJSON(row.reasoning_json, null),
      attachments,
    });
  } catch (err) {
    console.error("[EC strength] get error:", err.message);
    res.status(500).json({ error: "Fetch failed" });
  }
});

// GET /api/ec/strength/:ecName/prestige — student-facing prestige rationale.
// Returns {score, source, rationale, sourcesCited, friendly, fetchedAt}. This
// is the UX-audit F5 surface — the student can see WHY their EC scored what
// it did, which reputable sources grounded the score, and when the backend
// last looked. 404 if the EC doesn't belong to this student or hasn't been
// researched yet.
app.get("/api/ec/strength/:ecName/prestige", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const locale = resolveLocale(req);
    const row = ragStmts.strength.getByStudentAndName.get(req.studentId, req.params.ecName);
    if (!row) {
      return res.status(404).json({
        error: "ec_not_found",
        ecName: req.params.ecName,
        locale,
        friendlyMessage: t("prestige.ec_not_found", locale),
        recomputeUrl: null,
      });
    }
    const explanation = getPrestigeExplanation(ragStmts, req.params.ecName);
    if (!explanation) {
      const currentSource = row.prestige_source || "legacy";
      // Pull locale-specific short/summary from i18n when available, else
      // fall back to the engineer-shape renderer.
      const localizedSource = {
        short: t(`friendly.prestige.${currentSource}.short`, locale),
        summary: t(`friendly.prestige.${currentSource}.summary`, locale),
      };
      const friendly = localizedSource.short && localizedSource.summary
        ? localizedSource
        : renderFriendlyPrestigeSource(currentSource);
      return res.status(404).json({
        error: "no_cached_rationale",
        ecName: req.params.ecName,
        currentScore: row.prestige ?? 0,
        currentSource,
        friendly,
        locale,
        friendlyMessage: t("prestige.no_cached_rationale", locale, {
          short: friendly.short,
          summary: friendly.summary,
        }),
        recomputeUrl: `/api/ec/strength/recompute`,
        recomputeBody: { ec_name: req.params.ecName },
      });
    }
    const friendly = {
      short: t(`friendly.prestige.${explanation.source}.short`, locale) || renderFriendlyPrestigeSource(explanation.source).short,
      summary: t(`friendly.prestige.${explanation.source}.summary`, locale) || renderFriendlyPrestigeSource(explanation.source).summary,
    };
    res.json({
      ok: true,
      ecName: req.params.ecName,
      ...explanation,
      friendly,
      locale,
      recomputeUrl: `/api/ec/strength/recompute`,
      recomputeBody: { ec_name: req.params.ecName },
    });
  } catch (err) {
    console.error("[EC prestige] get rationale error:", err.message);
    res.status(500).json({ error: "Fetch failed" });
  }
});

// POST /api/ec/strength/recompute — force a refresh of 4-factor vectors.
// Body `{ ec_name?: string }` runs only a single EC if provided; else
// recomputes every EC for the student.
app.post("/api/ec/strength/recompute", studentLimiter, requireStudentAuth, async (req, res) => {
  try {
    const snap = ragStmts.getLatestSnapshot.get(req.studentId);
    if (!snap) return res.status(404).json({ error: "No profile data" });
    let activities = safeParseJSON(snap.activities_json, []);
    const { ec_name } = req.body || {};
    if (ec_name) {
      activities = activities.filter((a) => a?.name === ec_name);
      if (activities.length === 0) {
        return res.status(404).json({ error: `No EC named ${ec_name}` });
      }
    }
    const active = getActiveNarrative(ragStmts.narrative, req.studentId);
    const prestigeAdapter = resolvePrestigeAdapter(req.studentId);
    const result = await recomputeStudentECStrengthVectors(
      ragStmts.strength, req.studentId,
      {
        activities,
        narrative: active?.narrativeText || null,
        narrativeThemes: active?.themes || [],
        narrativeHash: active?.hash || null,
        narrativeId: active?.id || null,
        majorInterest: snap.major_interest || null,
        llmClient: buildDefaultLLMClient(ragStmts.narrativeFitCache),
        prestigeAdapter,
        ragStmts,
      },
    );
    res.json({ ok: true, ...result, recomputedAt: new Date().toISOString() });
  } catch (err) {
    console.error("[EC strength] recompute error:", err.message);
    res.status(500).json({ error: "Recompute failed" });
  }
});

// POST /api/ec/strength/override — pin one or more factor values for an EC.
// Overrides survive subsequent recomputes; tier is recalculated from the
// merged vector.
app.post("/api/ec/strength/override", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const { ec_name, factor, value, overrides } = req.body || {};
    if (!ec_name) return res.status(400).json({ error: "ec_name required" });

    // Support either single {factor,value} or batched {overrides: {...}}
    let payload = {};
    if (overrides && typeof overrides === "object") {
      for (const k of STRENGTH_FACTORS) {
        if (overrides[k] !== undefined) payload[k] = Number(overrides[k]);
      }
    } else if (factor && value !== undefined) {
      if (!STRENGTH_FACTORS.includes(factor)) {
        return res.status(400).json({ error: `factor must be one of: ${STRENGTH_FACTORS.join(", ")}` });
      }
      payload[factor] = Number(value);
    } else {
      return res.status(400).json({ error: "Provide either {factor,value} or {overrides:{...}}" });
    }

    for (const [k, v] of Object.entries(payload)) {
      if (!Number.isFinite(v) || v < 0 || v > 1) {
        return res.status(400).json({ error: `${k} must be a number in [0,1]` });
      }
    }

    const result = applyStrengthOverride(ragStmts.strength, req.studentId, ec_name, payload);
    res.json({
      ok: true,
      ec_name,
      factors: result.factors,
      tier_label: result.tier_label,
      overrides: result.overrideJson,
    });
  } catch (err) {
    if (/No strength vector/i.test(err.message)) {
      return res.status(404).json({ error: err.message });
    }
    console.error("[EC strength] override error:", err.message);
    res.status(500).json({ error: "Override failed" });
  }
});

// GET /api/ec/spike — "Spike Finder": which 2-3 ECs should LEAD the
// application, and which are supporting. Reuses the already-computed EC
// strength vectors (tier_label + major_spike + narrative_fit) — no new
// scoring, just a ranking + a wellbeing read. This is the consultant's
// "depth over breadth" reframing the differentiation strategy calls the
// single highest-leverage EC feature.
const SPIKE_TIER_WEIGHT = Object.freeze({
  tier_1_distinctive: 4,
  tier_2_strong: 3,
  tier_3_developing: 2,
  tier_4_foundational: 1,
});
app.get("/api/ec/spike", studentLimiter, requireStudentAuth, async (req, res) => {
  try {
    const locale = resolveLocale(req);
    const rows = ragStmts.strength.getByStudent.all(req.studentId) || [];
    const vectors = rows
      .map(toStrengthPublicShape)
      .filter(Boolean)
      .map((v) => {
        const explanation = getPrestigeExplanation(ragStmts, v.ecName);
        const enriched = enrichECVectorWithFriendly(v, explanation);
        // Composite ranking score from fields already on the row. Tier is the
        // dominant signal (it already folds in dedication/achievement/
        // leadership/prestige); major_spike and narrative_fit break ties
        // toward activities that actually lead the student's story.
        const tierWeight = SPIKE_TIER_WEIGHT[v.tierLabel] ?? 1;
        const spike = Number(v.factors?.major_spike ?? 0);
        const fit = Number(v.factors?.narrative_fit ?? 0);
        const rankScore = tierWeight * 0.5 + spike * 0.35 + fit * 0.15;
        return { ...enriched, rankScore: Math.round(rankScore * 1000) / 1000 };
      })
      .sort((a, b) => b.rankScore - a.rankScore);

    // Leading = top 2-3 (cap at 3, but only those that clear foundational).
    const leadingPool = vectors.filter((v) => v.tierLabel !== "tier_4_foundational");
    let leading = (leadingPool.length >= 2 ? leadingPool : vectors).slice(0, 3);
    let leadingNames = new Set(leading.map((v) => v.ecName));
    let supporting = vectors.filter((v) => !leadingNames.has(v.ecName));

    // ── LLM + web-search re-rank (best-effort, BYOK-gated) ──
    // Reorder lead vs supporting by genuine narrative/major/target-school fit
    // and web-verified prestige, attaching a one-line rationale. Falls back to
    // the deterministic composite on any failure.
    let engine = "deterministic";
    const targetSchools = resolveTargetSchools(req.studentId, (() => {
      const q = req.query.targetSchools;
      if (!q) return null;
      return Array.isArray(q) ? q : String(q).split(",").map((s) => s.trim()).filter(Boolean);
    })());
    if (vectors.length > 0) {
      try {
        const gate = checkBudget(piiVault, ragStmts, req.studentId);
        const { byok, callLLM } = gate.allowed ? buildStudentCallLLM(req.studentId) : { byok: null, callLLM: null };
        if (byok && callLLM) {
          const active = getActiveNarrative(ragStmts.narrative, req.studentId);
          const llm = await llmRankSpike({ callLLM, byok, studentId: req.studentId, active, vectors, targetSchools });
          if (Array.isArray(llm) && llm.length) {
            const byName = new Map(llm.map((x) => [x.name.toLowerCase(), x]));
            for (const v of vectors) {
              const m = byName.get(String(v.ecName).toLowerCase());
              if (m) { v.leadRationale = m.rationale; if (m.sources?.length) v.sources = m.sources; v.leadScore = m.leadScore; }
            }
            // Leaders = LLM-flagged leads (cap 3), highest leadScore first;
            // top up from composite order if the LLM flagged fewer than 2.
            const flagged = vectors
              .filter((v) => byName.get(String(v.ecName).toLowerCase())?.lead)
              .sort((a, b) => (b.leadScore ?? 0) - (a.leadScore ?? 0));
            let newLeading = flagged.slice(0, 3);
            if (newLeading.length < 2) {
              for (const v of vectors) {
                if (newLeading.length >= 2) break;
                if (!newLeading.includes(v)) newLeading.push(v);
              }
            }
            leading = newLeading;
            leadingNames = new Set(leading.map((v) => v.ecName));
            supporting = vectors.filter((v) => !leadingNames.has(v.ecName));
            engine = "llm";
          }
        }
      } catch (e) {
        console.warn("[EC spike] LLM re-rank failed, using deterministic:", e.message);
      }
    }

    // Wellbeing guardrail: sum weekly hours across ECs against the
    // sustainable ceiling encoded in ec-vectorizer.js. Duty-of-care AND
    // differentiator — we optimize for the student, not a longer list.
    const totalWeeklyHours = rows.reduce(
      (sum, r) => sum + (Number(r.hours_per_week) || 0),
      0,
    );
    const overCommitted = totalWeeklyHours >= WELLBEING_LIMITS.caution_weekly_hours;
    const wellbeing = {
      totalWeeklyHours: Math.round(totalWeeklyHours * 10) / 10,
      sustainableCap: WELLBEING_LIMITS.sustainable_weekly_hours,
      cautionLine: WELLBEING_LIMITS.caution_weekly_hours,
      hardCeiling: WELLBEING_LIMITS.hard_ceiling_weekly_hours,
      overCommitted,
      message: overCommitted
        ? `You're at ${Math.round(totalWeeklyHours)} hrs/week across your activities — above the ${WELLBEING_LIMITS.caution_weekly_hours}-hr caution line. Before adding anything, consider deepening your leading activities and easing off the supporting ones.`
        : `You're at ${Math.round(totalWeeklyHours)} hrs/week across your activities, within a sustainable range (up to ${WELLBEING_LIMITS.sustainable_weekly_hours} hrs/week).`,
    };

    const localizedLegend = localizeFriendlyLabels(locale);
    res.json({
      ok: true,
      count: rows.length,
      engine,
      targetSchools,
      leading,
      supporting,
      wellbeing,
      factors: STRENGTH_FACTORS,
      tiers: Object.values(TIERS),
      locale,
      friendlyLegend: {
        tiers: TIER_FRIENDLY,
        prestigeSources: PRESTIGE_SOURCE_FRIENDLY,
        factors: FACTOR_FRIENDLY,
      },
      friendlyLegendI18n: localizedLegend,
    });
  } catch (err) {
    console.error("[EC spike] error:", err.message);
    res.status(500).json({ error: "Spike analysis failed" });
  }
});


// ═══════════════════════════════════════════════════════════
// EC PRESTIGE ENDPOINTS (counselor-gated)
// ═══════════════════════════════════════════════════════════

// GET /api/ec/prestige/:activityName — debug read of the cached prestige
// row for a named activity. Does NOT trigger a web_search; returns 404 if
// the activity has never been researched. Counselor-auth-gated because
// the cache is shared across all students and so is not PII-scoped.
// POST /api/ec/competitions/search - official-source prestige lookup tool.
// Body accepts either `{ query, levelHint? }` or `{ activities: [{ name,
// levelHint? }] }`. With cacheResults=true (default), each item is written
// into the shared RAG prestige cache via researchCompetitionPrestige().
app.post("/api/ec/competitions/search", requireCounselorAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const cacheResults = body.cacheResults !== false;
    const levelHint = typeof body.levelHint === "string" ? body.levelHint.trim() : null;
    const studentId = typeof body.studentId === "string" ? body.studentId.trim() : null;

    let items = [];
    if (Array.isArray(body.activities)) {
      items = body.activities
        .map((a) => ({
          name: String(a?.name || a?.activityName || "").trim(),
          levelHint: String(a?.levelHint || levelHint || "").trim() || null,
        }))
        .filter((a) => a.name);
    } else if (Array.isArray(body.activityNames)) {
      items = body.activityNames
        .map((name) => ({ name: String(name || "").trim(), levelHint }))
        .filter((a) => a.name);
    } else if (body.query) {
      items = [{ name: String(body.query || "").trim(), levelHint }];
    }

    if (items.length === 0) {
      return res.status(400).json({
        error: "Provide query, activityNames[], or activities[].",
      });
    }
    if (items.length > 50) {
      return res.status(400).json({ error: "At most 50 activities per request." });
    }

    const prestigeAdapter = studentId ? resolvePrestigeAdapter(studentId) : null;
    const results = [];
    for (const item of items) {
      const matches = searchCompetitionCatalog(item.name, {
        levelHint: item.levelHint,
        limit: Number(body.limit || 5),
      });
      let cachedResult = null;
      if (cacheResults) {
        cachedResult = await researchCompetitionPrestige({
          activityName: item.name,
          levelHint: item.levelHint || matches[0]?.level || null,
          stmts: ragStmts,
          adapter: prestigeAdapter,
        });
      }
      results.push({
        query: item.name,
        levelHint: item.levelHint,
        matches,
        cachedResult,
      });
    }

    res.json({
      ok: true,
      count: results.length,
      cacheResults,
      catalogCount: OFFICIAL_COMPETITION_SOURCES.length,
      reputableDomains: REPUTABLE_DOMAINS,
      results,
    });
  } catch (err) {
    console.error("[EC competitions] search error:", err.message);
    res.status(500).json({ error: "Competition search failed" });
  }
});

// GET /api/ec/cache-memory — bulk read of the shared EC prestige cache plus
// the five-factor component cache, so EC agents can consume cache memory
// "all at once" without retriggering research or recompute.
app.get("/api/ec/cache-memory", requireCounselorAuth, (req, res) => {
  try {
    const limit = Math.max(1, Math.min(250, Number(req.query.limit || 25)));
    const factorQuery = typeof req.query.factor === "string" ? req.query.factor.trim() : "";
    const factor = factorQuery || null;
    const includeFailed = String(req.query.includeFailed || "").toLowerCase() === "true";

    if (factor && !STRENGTH_FACTORS.includes(factor)) {
      return res.status(400).json({
        error: `factor must be one of: ${STRENGTH_FACTORS.join(", ")}`,
      });
    }

    const prestigeTotal = Number(ragStmts.countPrestigeCache?.get()?.total || 0);
    const componentTotal = Number(ragStmts.countComponentCache?.get()?.total || 0);
    let prestigeRows = ragStmts.listPrestigeCacheRecent?.all(limit * 4) || [];
    if (!includeFailed) {
      prestigeRows = prestigeRows.filter((row) => row?.source !== "research_failed");
    }
    prestigeRows = prestigeRows.slice(0, limit);

    const selectedFactors = factor ? [factor] : STRENGTH_FACTORS;
    const rowsByFactor = {};
    for (const factorName of selectedFactors) {
      const rows = ragStmts.listComponentCacheRecentByFactor?.all(factorName, limit) || [];
      rowsByFactor[factorName] = rows.map((row) => ({
        cacheKey: row.cache_key,
        factor: row.factor,
        score: Number(row.score) || 0,
        source: row.source || null,
        provider: row.provider || null,
        model: row.model || null,
        reasoning: safeJSON(row.reasoning_json, null),
        computedAt: row.created_at || null,
      }));
    }

    res.json({
      ok: true,
      limit,
      includeFailed,
      prestige: {
        ttlDays: PRESTIGE_TTL_DAYS,
        totalRows: prestigeTotal,
        returnedRows: prestigeRows.length,
        rows: prestigeRows.map((row) => {
          const ageMs = Date.now() - Date.parse(row.created_at || 0);
          const ageDays = Number.isFinite(ageMs) ? Math.floor(ageMs / 86_400_000) : null;
          return {
            cacheKey: row.cache_key,
            activityName: row.activity_name,
            normalizedName: normalizeActivityName(row.activity_name),
            levelHint: row.level_hint,
            score: Number(row.score) || 0,
            source: row.source || null,
            rationale: row.rationale || null,
            sourcesCited: safeJSON(row.sources_json, []) || [],
            provider: row.provider || null,
            model: row.model || null,
            fetchedAt: row.created_at || null,
            ageDays,
            expired: ageDays != null && ageDays > PRESTIGE_TTL_DAYS,
          };
        }),
      },
      components: {
        factors: selectedFactors,
        totalRows: componentTotal,
        perFactorLimit: limit,
        rowsByFactor,
        countsByFactor: Object.fromEntries(
          selectedFactors.map((factorName) => [
            factorName,
            Number(ragStmts.countComponentCacheByFactor?.get(factorName)?.total || 0),
          ]),
        ),
      },
    });
  } catch (err) {
    console.error("[EC cache-memory] get error:", err.message);
    res.status(500).json({ error: "EC cache memory lookup failed" });
  }
});

app.get("/api/ec/prestige/:activityName", requireCounselorAuth, (req, res) => {
  try {
    const activityName = String(req.params.activityName || "").trim();
    if (!activityName) {
      return res.status(400).json({ error: "activityName path param required" });
    }
    const levelHint = typeof req.query.level === "string" ? req.query.level.trim() : null;

    // Prefer the exact (name, level) cache key; fall back to the latest
    // row for the name.
    const key = computePrestigeCacheKey(activityName, levelHint);
    let row = ragStmts.getPrestigeCache.get(key);
    if (!row && !levelHint) {
      row = ragStmts.getPrestigeCacheByName.get(activityName);
    }

    if (!row) {
      return res.status(404).json({
        error: "No cached prestige row for this activity.",
        activityName,
        normalizedName: normalizeActivityName(activityName),
        ttlDays: PRESTIGE_TTL_DAYS,
      });
    }

    const ageMs = Date.now() - Date.parse(row.created_at || 0);
    const ageDays = Number.isFinite(ageMs) ? Math.floor(ageMs / 86_400_000) : null;
    const expired = ageDays != null && ageDays > PRESTIGE_TTL_DAYS;

    res.json({
      ok: true,
      activityName: row.activity_name,
      levelHint: row.level_hint,
      score: Number(row.score) || 0,
      source: row.source || null,
      rationale: row.rationale || null,
      sourcesCited: safeJSON(row.sources_json, []) || [],
      provider: row.provider || null,
      model: row.model || null,
      fetchedAt: row.created_at,
      ageDays,
      expired,
      ttlDays: PRESTIGE_TTL_DAYS,
    });
  } catch (err) {
    console.error("[EC prestige] get error:", err.message);
    res.status(500).json({ error: "Prestige lookup failed" });
  }
});

// POST /api/ec/prestige/recompute — force a fresh prestige research call.
// Body `{ studentId: string, ecName?: string }`:
//   • studentId required — identifies whose BYOK (if any) pays for the
//     web_search call.
//   • ecName optional — if provided, invalidates just that EC's prestige
//     cache row(s); otherwise clears every EC's prestige cache for the
//     student and re-runs.
// After invalidation, re-invokes recomputeStudentECStrengthVectors so the
// ec_strength_vectors table is rewritten with the fresh prestige.
app.post("/api/ec/prestige/recompute", requireCounselorAuth, async (req, res) => {
  try {
    const { studentId, ecName } = req.body || {};
    if (!studentId || typeof studentId !== "string") {
      return res.status(400).json({ error: "studentId required" });
    }

    const snap = ragStmts.getLatestSnapshot.get(studentId);
    if (!snap) return res.status(404).json({ error: "No profile snapshot for student" });

    let activities = safeParseJSON(snap.activities_json, []);
    if (!Array.isArray(activities)) activities = [];

    if (ecName) {
      activities = activities.filter((a) => a?.name === ecName);
      if (activities.length === 0) {
        return res.status(404).json({ error: `No EC named "${ecName}" for this student` });
      }
    }

    // Invalidate prestige cache rows for the affected activities. We delete
    // by activity_name so every (name, level_hint) variant gets cleared.
    let invalidated = 0;
    for (const ec of activities) {
      if (!ec?.name) continue;
      try {
        const r = ragStmts.deletePrestigeByName.run(ec.name);
        invalidated += r?.changes || 0;
      } catch {
        // Non-fatal.
      }
    }

    const active = getActiveNarrative(ragStmts.narrative, studentId);
    const prestigeAdapter = resolvePrestigeAdapter(studentId);
    const result = await recomputeStudentECStrengthVectors(
      ragStmts.strength, studentId,
      {
        activities,
        narrative: active?.narrativeText || null,
        narrativeThemes: active?.themes || [],
        narrativeHash: active?.hash || null,
        narrativeId: active?.id || null,
        majorInterest: snap.major_interest || null,
        llmClient: buildDefaultLLMClient(ragStmts.narrativeFitCache),
        prestigeAdapter,
        ragStmts,
      },
    );

    res.json({
      ok: true,
      studentId,
      ecName: ecName || null,
      invalidatedRows: invalidated,
      prestigeAvailable: !!prestigeAdapter,
      ...result,
      recomputedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[EC prestige] recompute error:", err.message);
    res.status(500).json({ error: "Prestige recompute failed" });
  }
});

// DELETE /api/ec/component-cache — admin reset for the five-factor
// component cache. Body `{ factor: string, olderThanDays?: number }`.
//   • factor required; one of STRENGTH_FACTORS.
//   • olderThanDays optional — when provided, only rows older than that
//     age are deleted (used for manual TTL enforcement); otherwise every
//     row for the factor is cleared.
app.delete("/api/ec/component-cache", requireCounselorAuth, (req, res) => {
  try {
    const { factor, olderThanDays } = req.body || {};
    if (!factor || !STRENGTH_FACTORS.includes(factor)) {
      return res.status(400).json({
        error: `factor required; must be one of: ${STRENGTH_FACTORS.join(", ")}`,
      });
    }

    let changes = 0;
    if (olderThanDays !== undefined && olderThanDays !== null) {
      const days = Number(olderThanDays);
      if (!Number.isFinite(days) || days < 0) {
        return res.status(400).json({ error: "olderThanDays must be a non-negative number" });
      }
      // SQLite modifier: negative → subtract from 'now' in deleteComponentCacheOlderThan
      const modifier = `-${Math.floor(days)} days`;
      const r = ragStmts.deleteComponentCacheOlderThan.run(factor, modifier);
      changes = r?.changes || 0;
    } else {
      const r = ragStmts.deleteComponentCacheByFactor.run(factor);
      changes = r?.changes || 0;
    }

    res.json({
      ok: true,
      factor,
      olderThanDays: olderThanDays ?? null,
      deleted: changes,
    });
  } catch (err) {
    console.error("[EC component-cache] delete error:", err.message);
    res.status(500).json({ error: "Component cache delete failed" });
  }
});


// ═══════════════════════════════════════════════════════════
// STUDENT DIRECTIONALITY ENDPOINTS
// ═══════════════════════════════════════════════════════════

// GET: retrieve latest directionality vector for the student
app.get("/api/directionality", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const dirVector = ragStmts.directionality.getByStudent.get(req.studentId);
    if (!dirVector) {
      return res.status(404).json({ error: "No directionality vector computed yet" });
    }

    res.json({
      ok: true,
      studentId: req.studentId,
      directionality: {
        id: dirVector.id,
        factors: {
          academic_momentum: dirVector.academic_momentum,
          test_score_strength: dirVector.test_score_strength,
          major_academic_fit: dirVector.major_academic_fit,
          rigor_and_challenge: dirVector.rigor_and_challenge,
          overall_academic_standing: dirVector.overall_academic_standing,
        },
        label: dirVector.directionality_label,
        metrics: {
          gpaUnweighted: dirVector.gpa_unweighted,
          gpaPercentileT20: dirVector.gpa_percentile_t20,
          apCount: dirVector.ap_count,
          satTotal: dirVector.sat_total,
          satPercentileT20: dirVector.sat_percentile_t20,
          actTotal: dirVector.act_total,
          actPercentileT20: dirVector.act_percentile_t20,
          majorInterest: dirVector.major_interest,
        },
        reasoning: safeParseJSON(dirVector.reasoning_json, []),
        isOverridden: Boolean(dirVector.is_overridden),
        computedAt: dirVector.computed_at,
        updatedAt: dirVector.updated_at,
      },
    });
  } catch (err) {
    console.error("[DIR] Retrieval error:", err.message);
    res.status(500).json({ error: "Directionality retrieval failed" });
  }
});

// POST: student manually overrides directionality factors
app.post("/api/directionality/override", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const { academic_momentum, test_score_strength, major_academic_fit, rigor_and_challenge, overall_academic_standing } = req.body || {};

    // Validate factor values are in [0, 1]
    const overrides = {};
    if (academic_momentum !== undefined) {
      if (typeof academic_momentum !== "number" || academic_momentum < 0 || academic_momentum > 1) {
        return res.status(400).json({ error: "academic_momentum must be a number in [0, 1]" });
      }
      overrides.academic_momentum = academic_momentum;
    }
    if (test_score_strength !== undefined) {
      if (typeof test_score_strength !== "number" || test_score_strength < 0 || test_score_strength > 1) {
        return res.status(400).json({ error: "test_score_strength must be a number in [0, 1]" });
      }
      overrides.test_score_strength = test_score_strength;
    }
    if (major_academic_fit !== undefined) {
      if (typeof major_academic_fit !== "number" || major_academic_fit < 0 || major_academic_fit > 1) {
        return res.status(400).json({ error: "major_academic_fit must be a number in [0, 1]" });
      }
      overrides.major_academic_fit = major_academic_fit;
    }
    if (rigor_and_challenge !== undefined) {
      if (typeof rigor_and_challenge !== "number" || rigor_and_challenge < 0 || rigor_and_challenge > 1) {
        return res.status(400).json({ error: "rigor_and_challenge must be a number in [0, 1]" });
      }
      overrides.rigor_and_challenge = rigor_and_challenge;
    }
    if (overall_academic_standing !== undefined) {
      if (typeof overall_academic_standing !== "number" || overall_academic_standing < 0 || overall_academic_standing > 1) {
        return res.status(400).json({ error: "overall_academic_standing must be a number in [0, 1]" });
      }
      overrides.overall_academic_standing = overall_academic_standing;
    }

    if (Object.keys(overrides).length === 0) {
      return res.status(400).json({ error: "At least one factor must be provided" });
    }

    ragStmts.directionality.applyOverride.run(
      overrides.academic_momentum ?? null,
      overrides.test_score_strength ?? null,
      overrides.major_academic_fit ?? null,
      overrides.rigor_and_challenge ?? null,
      overrides.overall_academic_standing ?? null,
      JSON.stringify(overrides),
      req.studentId
    );

    res.json({
      ok: true,
      studentId: req.studentId,
      overridden: Object.keys(overrides),
      appliedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[DIR] Override error:", err.message);
    res.status(500).json({ error: "Directionality override failed" });
  }
});

// POST: force full recomputation of directionality vector
app.post("/api/directionality/recompute", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const snap = ragStmts.getLatestSnapshot.get(req.studentId);
    if (!snap) return res.status(404).json({ error: "No profile data" });

    const snapshotHistory = ragStmts.getSnapshotHistory.all(req.studentId, 2) || [];
    const priorSnapshot = snapshotHistory.length > 1 ? snapshotHistory[1] : null;
    const allSnapshots = ragStmts.getSnapshotHistory.all(req.studentId, 10) || [];
    const gpaBaselines = ragStmts.getGPABaseline.all("t20_admitted") || [];
    const satBaselines = ragStmts.getSATBaseline.all("t20_admitted") || [];
    const actBaselines = ragStmts.getACTBaseline.all("t20_admitted") || [];
    const collegeProfiles = ragStmts.searchColleges.all() || [];

    const result = recomputeStudentDirectionality(
      ragStmts.directionality, req.studentId, snap, priorSnapshot,
      allSnapshots, gpaBaselines, satBaselines, actBaselines, collegeProfiles
    );

    res.json({
      ok: true,
      studentId: req.studentId,
      directionality: {
        id: result.id,
        factors: result.factors,
        label: result.label,
        reasoning: result.reasoning,
        isOverridden: result.isOverridden,
        computedAt: result.computedAt,
      },
    });
  } catch (err) {
    console.error("[DIR] Recompute error:", err.message);
    res.status(500).json({ error: "Directionality recomputation failed" });
  }
});

// ═════════════════════════════════════════════════════════════════════
// AP CONCEPT COMPONENTS
// ─────────────────────────────────────────────────────────────────────
// Each AP subject vector is the weighted sum of its concept components.
// Concept rows are LAZY: created only when the student's own evidence
// (prompt or file) references the subject. Updates propagate immediately.
// ═════════════════════════════════════════════════════════════════════

// GET: full catalog of AP subjects and their concept definitions.
// Safe to call without auth — this is public reference data.
app.get("/api/ap-concepts/catalog", studentLimiter, (req, res) => {
  try {
    const { subject } = req.query;
    if (subject) {
      const concepts = getConceptsForSubject(subject);
      if (!concepts.length) return res.status(404).json({ error: "Unknown subject" });
      const weightSum = concepts.reduce((s, c) => s + (Number(c.weight) || 0), 0);
      return res.json({ ok: true, subject, concepts, weightSum: Math.round(weightSum * 1000) / 1000 });
    }
    const allSubjects = getAllAPSubjects().map((sid) => {
      const concepts = getConceptsForSubject(sid);
      return {
        subject_id: sid,
        concept_count: concepts.length,
        weight_sum: Math.round(concepts.reduce((s, c) => s + (Number(c.weight) || 0), 0) * 1000) / 1000,
      };
    });
    res.json({ ok: true, subjects: allSubjects });
  } catch (err) {
    console.error("[AP-CONCEPTS] catalog error:", err.message);
    res.status(500).json({ error: "Catalog retrieval failed" });
  }
});

// GET: student's current AP subject vectors + concept components.
// Returns only subjects the student has evidence for (lazy init contract).
app.get("/api/ap-concepts/vectors", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const subjectVectors = ragStmts.apConcepts.getAllSubjectVectors.all(req.studentId) || [];
    const studentConcepts = ragStmts.apConcepts.getAllStudentConcepts.all(req.studentId) || [];

    // Group concepts by subject for the response.
    const conceptsBySubject = new Map();
    for (const row of studentConcepts) {
      if (!conceptsBySubject.has(row.subject_id)) conceptsBySubject.set(row.subject_id, []);
      conceptsBySubject.get(row.subject_id).push({
        concept_id: row.concept_id,
        mastery: row.mastery,
        last_signal: row.last_signal,
        evidence_count: row.evidence_count,
        is_overridden: Boolean(row.is_overridden),
        override_mastery: row.override_mastery,
        first_seen_at: row.first_seen_at,
        updated_at: row.updated_at,
      });
    }

    res.json({
      ok: true,
      studentId: req.studentId,
      subjects: subjectVectors.map((v) => ({
        subject_id: v.subject_id,
        subject_vector: v.subject_vector,
        weighted_total: v.weighted_total,
        concept_count: v.concept_count,
        components: safeParse(v.components_json) || [],
        computed_at: v.computed_at,
        concepts: conceptsBySubject.get(v.subject_id) || [],
      })),
      count: subjectVectors.length,
    });
  } catch (err) {
    console.error("[AP-CONCEPTS] vectors error:", err.message);
    res.status(500).json({ error: "Vector retrieval failed" });
  }
});

// GET: per-subject detail (components + per-concept evidence).
app.get("/api/ap-concepts/vectors/:subject", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const subjectId = req.params.subject;
    const catalog = getConceptsForSubject(subjectId);
    if (!catalog.length) return res.status(404).json({ error: "Unknown subject" });

    const vec = ragStmts.apConcepts.getSubjectVector.get(req.studentId, subjectId);
    const conceptRows = ragStmts.apConcepts.getStudentConceptsForSubject.all(req.studentId, subjectId) || [];

    res.json({
      ok: true,
      studentId: req.studentId,
      subject_id: subjectId,
      subject_vector: vec?.subject_vector ?? null,
      weighted_total: vec?.weighted_total ?? null,
      components: safeParse(vec?.components_json) || [],
      reasoning: safeParse(vec?.reasoning_json) || [],
      concepts: catalog.map((c) => {
        const row = conceptRows.find((r) => r.concept_id === c.concept_id);
        return {
          concept_id: c.concept_id,
          concept_name: c.concept_name,
          description: c.description,
          weight: c.weight,
          mastery: row?.mastery ?? null,          // null = not yet seen (lazy)
          evidence_count: row?.evidence_count ?? 0,
          is_overridden: Boolean(row?.is_overridden),
          override_mastery: row?.override_mastery ?? null,
          evidence: safeParse(row?.evidence_json) || [],
          first_seen_at: row?.first_seen_at ?? null,
          updated_at: row?.updated_at ?? null,
        };
      }),
      computed_at: vec?.computed_at ?? null,
    });
  } catch (err) {
    console.error("[AP-CONCEPTS] subject-detail error:", err.message);
    res.status(500).json({ error: "Subject detail retrieval failed" });
  }
});

// POST: classify a piece of student text/file content and update concepts.
// Body: { text: string, hintSubject?: string, source?: "prompt"|"file"|... }
app.post("/api/ap-concepts/input", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const { text, hintSubject, source } = req.body || {};
    if (typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "text (non-empty string) is required" });
    }
    if (text.length > 50_000) {
      return res.status(413).json({ error: "text too large (max 50k chars)" });
    }
    const result = processStudentInputForConcepts(
      ragStmts.apConcepts, req.studentId, text,
      { hintSubject, source: source || "input" }
    );
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[AP-CONCEPTS] input error:", err.message);
    res.status(500).json({ error: "Concept classification failed" });
  }
});

// POST: dry-run classification (no DB writes) — useful for frontend preview.
app.post("/api/ap-concepts/classify", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const { text, hintSubject } = req.body || {};
    if (typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "text (non-empty string) is required" });
    }
    const classifications = classifyInputToAPConcepts(text, { hintSubject });
    res.json({ ok: true, classifications });
  } catch (err) {
    console.error("[AP-CONCEPTS] classify error:", err.message);
    res.status(500).json({ error: "Classification failed" });
  }
});

// POST: student overrides a single concept mastery.
// Body: { subject_id, concept_id, mastery (0-1) }
app.post("/api/ap-concepts/override", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const { subject_id, concept_id, mastery } = req.body || {};
    if (!subject_id || !concept_id) {
      return res.status(400).json({ error: "subject_id and concept_id are required" });
    }
    if (!AP_CONCEPT_CATALOG[subject_id]) {
      return res.status(400).json({ error: "Unknown subject_id" });
    }
    const inCatalog = getConceptsForSubject(subject_id).some((c) => c.concept_id === concept_id);
    if (!inCatalog) return res.status(400).json({ error: "Unknown concept_id for subject" });

    const m = Number(mastery);
    if (!Number.isFinite(m) || m < 0 || m > 1) {
      return res.status(400).json({ error: "mastery must be a number in [0, 1]" });
    }
    const result = overrideStudentConcept(
      ragStmts.apConcepts,
      { studentId: req.studentId, subjectId: subject_id, conceptId: concept_id, mastery: m }
    );
    res.json({ ok: true, override: result });
  } catch (err) {
    console.error("[AP-CONCEPTS] override error:", err.message);
    res.status(500).json({ error: "Override failed" });
  }
});

// POST: clear a previous override (re-enables automatic recomputation).
app.post("/api/ap-concepts/override/clear", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const { subject_id, concept_id } = req.body || {};
    if (!subject_id || !concept_id) {
      return res.status(400).json({ error: "subject_id and concept_id are required" });
    }
    ragStmts.apConcepts.clearStudentConceptOverride.run(req.studentId, subject_id, concept_id);
    const vec = recomputeSubjectVector(ragStmts.apConcepts, req.studentId, subject_id);
    res.json({ ok: true, subject_vector: vec });
  } catch (err) {
    console.error("[AP-CONCEPTS] override-clear error:", err.message);
    res.status(500).json({ error: "Override clear failed" });
  }
});

// POST: force full recomputation of every cached subject vector.
app.post("/api/ap-concepts/recompute", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const vectors = recomputeAllSubjectVectors(ragStmts.apConcepts, req.studentId);
    res.json({ ok: true, count: vectors.length, vectors });
  } catch (err) {
    console.error("[AP-CONCEPTS] recompute error:", err.message);
    res.status(500).json({ error: "Recompute failed" });
  }
});

// GET /api/courses/recommendations — major-aligned course-sequence
// recommender. Diffs the student's transcript against the reference ladder
// for their major bucket, cross-references AP concept-mastery gaps, and
// returns the result in the three trust lanes (verified / inference /
// coaching). This is the differentiation strategy's deepest moat: no
// consumer competitor reasons about academics at course + concept
// resolution.
const COURSE_CONCEPT_GAP_THRESHOLD = 0.45;
app.get("/api/courses/recommendations", studentLimiter, requireStudentAuth, async (req, res) => {
  try {
    const locale = resolveLocale(req);
    const snap = ragStmts.getLatestSnapshot.get(req.studentId);
    if (!snap) return res.status(404).json({ error: "No profile data", locale });

    const requestedMajor = (typeof req.query.major === "string" && req.query.major.trim())
      ? req.query.major.trim()
      : (snap.major_interest || null);
    const strengthRows = ragStmts.strength.getByStudent.all(req.studentId) || [];
    const narrative = getActiveNarrative(ragStmts.narrative, req.studentId);
    const studentModel = buildStudentModel({
      gpa_unweighted: snap.gpa_unweighted,
      gpa_weighted: snap.gpa_weighted,
      courses_json: snap.courses_json,
      test_scores_json: snap.test_scores_json,
      activities_json: snap.activities_json,
      major_interest: requestedMajor,
    }, strengthRows, narrative);

    const bucket = studentModel.majorBucket;
    const diff = diffCoursesAgainstSequence(studentModel.courses, bucket);

    // Pull current AP subject vectors so we can attach concept-level mastery
    // / gap signals to each recommended course. A "thin" subject vector on a
    // course the major leans on is exactly the early-warning a multi-year
    // counseling package would surface.
    let subjectVectorById = new Map();
    try {
      const subjectVectors = ragStmts.apConcepts?.getAllSubjectVectors?.all(req.studentId) || [];
      subjectVectorById = new Map(subjectVectors.map((v) => [v.subject_id, v]));
    } catch (err) {
      console.warn("[courses/recommendations] AP vectors fetch failed:", err.message);
    }

    const attachConceptSignal = (ref) => {
      if (!ref.apSubject) return { ...ref };
      const vec = subjectVectorById.get(ref.apSubject);
      if (!vec || vec.subject_vector == null) {
        return { ...ref, conceptSignal: { apSubject: ref.apSubject, status: "not_yet_demonstrated" } };
      }
      const mastery = Number(vec.subject_vector);
      return {
        ...ref,
        conceptSignal: {
          apSubject: ref.apSubject,
          subjectVector: Math.round(mastery * 100) / 100,
          status: mastery < COURSE_CONCEPT_GAP_THRESHOLD ? "developing" : "solid",
        },
      };
    };

    // ── Three trust lanes ──
    // VERIFIED: target schools' real, cited academic priorities from their
    // Common Data Set — rigor of secondary record + test policy. These are
    // the closest thing to "stated course expectations" we can cite, never
    // invented. Tailors the recommender to the specific schools the student
    // wants (request override → saved goals).
    const targetSchools = resolveTargetSchools(req.studentId, (() => {
      const q = req.query.targetSchools;
      if (!q) return null;
      return Array.isArray(q) ? q : String(q).split(",").map(s => s.trim()).filter(Boolean);
    })());
    const priorities = await getSchoolPriorities(targetSchools);
    const verified = priorities.filter(p => p.hasData).map((p) => {
      const rigor = p.c7?.rigor ? String(p.c7.rigor).replace(/_/g, " ") : null;
      return {
        school: p.school,
        statement: rigor
          ? `${p.school} rates rigor of secondary record "${rigor}" in its Common Data Set${p.admitRate != null ? ` (admit ~${p.admitRate}%)` : ""} — a demanding, coherent course load matters here.`
          : `${p.school} Common Data Set on file${p.admitRate != null ? ` (admit ~${p.admitRate}%)` : ""}.`,
        source: p.sourceUrl ? { url: p.sourceUrl } : null,
      };
    });
    // INFERENCE: what the major's structure implies — the reference ladder
    // and the student's standing against it. Labeled as inference, not fact.
    const inference = {
      label: "Inferred from the typical structure of this major — not a school requirement.",
      bucket,
      majorLabel: diff.label,
      isGenericLadder: diff.isGeneric,
      have: diff.have.map(attachConceptSignal),
      missing: diff.missing.map(attachConceptSignal),
      majorRelevantCourseCount: studentModel.relevantCourses.length,
      majorRelevantGpa: studentModel.majorRelevantGpa,
    };
    // COACHING: concrete, non-binding "you might consider" next steps.
    const coaching = {
      label: "Non-binding coaching suggestions — discuss with your counselor before changing your schedule.",
      next: diff.next.map((ref) => {
        const withSignal = attachConceptSignal(ref);
        const gap = withSignal.conceptSignal?.status === "developing";
        return {
          ...withSignal,
          suggestion: gap
            ? `You might consider ${ref.name}. ${ref.why} Your current work in this area reads as still developing, so this would both fill a course gap and deepen mastery.`
            : `You might consider ${ref.name}. ${ref.why}`,
        };
      }),
      wellbeingNote: "Add depth before breadth — a coherent sequence beats a longer list of unrelated courses.",
    };

    res.json({
      ok: true,
      locale,
      major: requestedMajor,
      bucket,
      targetSchools,
      lanes: { verified, inference, coaching },
    });
  } catch (err) {
    console.error("[courses/recommendations] error:", err.message);
    res.status(500).json({ error: "Course recommendation failed" });
  }
});

// Small helper used by the endpoints above.
function safeParse(json) {
  if (!json) return null;
  if (typeof json !== "string") return json;
  try { return JSON.parse(json); } catch { return null; }
}

// POST /api/calendar/context — date awareness for the consultant agent.
// Returns today + the current application-cycle calendar (phase, typical
// deadlines, approximate HS breaks) ALWAYS, plus per-target-school
// deadlines (EA/ED/RD/financial-aid/decision/commit) web-researched
// best-effort and cached. Recomputed per call so it reflects the latest
// target-schools list and today's date.
app.post("/api/calendar/context", studentLimiter, requireStudentAuth, async (req, res) => {
  try {
    const locale = resolveLocale(req);
    const calendar = buildAdmissionsCalendar(new Date());
    const targetSchools = resolveTargetSchools(req.studentId, req.body?.targetSchools);

    let schools = targetSchools.map((s) => ({ school: s, deadlines: null, source: "typical" }));
    let deadlinesSource = targetSchools.length ? "typical" : "none";

    if (targetSchools.length) {
      const cacheKey = { schools: [...targetSchools].map((s) => s.toLowerCase()).sort(), cycle: calendar.cycleEntryYear };
      const cached = getScorecardQueryCache("calendar_deadlines", cacheKey);
      if (cached?.data?.schools?.length) {
        schools = cached.data.schools;
        deadlinesSource = "web_cached";
      } else {
        try {
          const gate = checkBudget(piiVault, ragStmts, req.studentId);
          const { byok, callLLM } = gate.allowed ? buildStudentCallLLM(req.studentId) : { byok: null, callLLM: null };
          if (byok && callLLM) {
            const fetched = await fetchSchoolDeadlinesViaWeb(callLLM, byok, targetSchools, calendar.cycleEntryYear);
            if (Array.isArray(fetched) && fetched.length) {
              schools = fetched;
              deadlinesSource = "web";
              putScorecardQueryCache("calendar_deadlines", cacheKey, { schools });
            }
          }
        } catch (e) {
          console.warn("[calendar] web deadline lookup failed, using typical:", e.message);
        }
      }
    }

    res.json({ ok: true, today: calendar.today, calendar, schools, deadlinesSource, targetSchools, locale });
  } catch (err) {
    console.error("[calendar context] error:", err.message);
    res.status(500).json({ error: "Calendar context failed" });
  }
});

// GET: retrieve historical directionality vectors (trend analysis)
app.get("/api/directionality/trend", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const history = ragStmts.directionality.getByStudentHistory.all(req.studentId) || [];

    res.json({
      ok: true,
      studentId: req.studentId,
      history: history.map(row => ({
        id: row.id,
        factors: {
          academic_momentum: row.academic_momentum,
          test_score_strength: row.test_score_strength,
          major_academic_fit: row.major_academic_fit,
          rigor_and_challenge: row.rigor_and_challenge,
          overall_academic_standing: row.overall_academic_standing,
        },
        label: row.directionality_label,
        computedAt: row.computed_at,
      })),
      count: history.length,
    });
  } catch (err) {
    console.error("[DIR] Trend error:", err.message);
    res.status(500).json({ error: "Directionality trend retrieval failed" });
  }
});


app.post("/api/mcp/admissions/query", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const { operation, college, unitId, query } = req.body;
    const context = assembleRAGContext(ragStmts, req.studentId, "holistic");
    if (context.error) return res.status(404).json(context);

    // Use evidence graph for enriched context
    const evidence = getEvidenceProfile(evidenceStmts, "student", req.studentId);

    res.json({
      operation,
      college,
      studentContext: context.studentContext,
      evidence: evidence.items?.slice(0, 10) || [],
      source: "evidence_graph + fact_store",
    });
  } catch (err) {
    console.error("[MCP] Admissions query error:", err.message);
    res.status(500).json({ error: "Admissions MCP query failed" });
  }
});


// ═══════════════════════════════════════════════════════════
// BASELINES STATUS
// ═══════════════════════════════════════════════════════════

app.get("/api/baselines/status", (_req, res) => {
  try {
    const gpaCount = db.prepare("SELECT COUNT(*) as c FROM baseline_gpa").get().c;
    const satCount = db.prepare("SELECT COUNT(*) as c FROM baseline_sat").get().c;
    const actCount = db.prepare("SELECT COUNT(*) as c FROM baseline_act").get().c;
    const ecCount = db.prepare("SELECT COUNT(*) as c FROM baseline_ec").get().c;
    const collegeCount = db.prepare("SELECT COUNT(*) as c FROM baseline_colleges").get().c;
    const snapshotCount = db.prepare("SELECT COUNT(*) as c FROM profile_snapshots").get().c;

    const factStats = getFactStoreStats(factStmts);
    const vectorStats = getVectorStoreStats(vectorStmts);
    const reviewStats = getQueueStats(reviewStmts);
    const jobStatus = getJobStatus();

    const gpaYear = db.prepare("SELECT MAX(year) as y FROM baseline_gpa").get()?.y || null;
    const collegeYear = db.prepare("SELECT MAX(data_year) as y FROM baseline_colleges").get()?.y || null;
    const currentYear = new Date().getFullYear();

    function checkFreshness(label, dataYear, count) {
      if (!dataYear || count === 0) return { label, count, dataYear: null, status: "missing", stale: true };
      const isStale = currentYear - dataYear > 1;
      return { label, count, dataYear, status: isStale ? "stale" : "current", stale: isStale };
    }

    const datasets = [
      checkFreshness("GPA distributions", gpaYear, gpaCount),
      checkFreshness("SAT distributions", db.prepare("SELECT MAX(year) as y FROM baseline_sat").get()?.y, satCount),
      checkFreshness("ACT distributions", db.prepare("SELECT MAX(year) as y FROM baseline_act").get()?.y, actCount),
      checkFreshness("EC benchmarks", db.prepare("SELECT MAX(data_year) as y FROM baseline_ec").get()?.y, ecCount),
      checkFreshness("College profiles", collegeYear, collegeCount),
    ];

    res.json({
      baselines: { gpa: gpaCount, sat: satCount, act: actCount, ec: ecCount, colleges: collegeCount },
      snapshots: snapshotCount,
      factStore: factStats,
      vectorStore: vectorStats,
      reviewQueue: reviewStats,
      batchJobs: jobStatus,
      orchestration: {
        fafsaCorpusReady: !!orchestrationCatalog.fafsa?.ready,
        fafsaCycle: orchestrationCatalog.fafsa?.cycle || null,
        admissionsDeadlinesLoaded: orchestrationCatalog.deadlines?.entries?.length || 0,
      },
      status: gpaCount > 0 && satCount > 0 && collegeCount > 0 ? "ready" : "needs_seeding",
      freshness: { datasets, staleCount: datasets.filter(d => d.stale).length, lastChecked: new Date().toISOString() },
      retentionMode: RETENTION_MODE,
    });
  } catch (err) {
    res.status(500).json({ error: "Status check failed" });
  }
});


// ═══════════════════════════════════════════════════════════
// CONSENT ENDPOINTS
// ═══════════════════════════════════════════════════════════

app.get("/api/consent/requirements", (req, res) => {
  const isMinor = req.query.isMinor !== "false";
  const locale = req.query.locale || "en-US";
  res.json(getOnboardingConsentRequirements(isMinor, locale));
});

app.post("/api/consent/grant", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const { consentType, grantedBy, locale } = req.body;
    if (!consentType) return res.status(400).json({ error: "consentType is required" });
    grantConsent(piiStmts, req.studentId, consentType, { grantedBy, locale });
    stmts.insertAudit.run(crypto.randomUUID(), new Date().toISOString(), "consent_granted", req.studentId.slice(0, 12), `${consentType} by ${grantedBy || "student"}`, hashIP(req.ip));
    res.json({ granted: true, consentType });
  } catch (err) {
    console.error("[CONSENT] Error:", err.message);
    res.status(500).json({ error: "Consent operation failed" });
  }
});


// ═══════════════════════════════════════════════════════════
// FIRST-RUN OPERATOR SETUP (localhost + boot console token)
// ═══════════════════════════════════════════════════════════
// Lets an operator finish deployment config from the Setup UI (web /setup.html
// or the macOS app) instead of hand-editing .env:
//   • generate the PII-vault ENCRYPTION_KEY (server-side — the secret is NEVER
//     sent from the client; the client only triggers generation),
//   • save the College Scorecard (IPEDS) data API key.
// Guards: the request must originate from loopback AND carry the one-time
// SETUP_TOKEN printed to the server console at boot. ENCRYPTION_KEY is only
// ever WRITTEN on first run (when not already provided via env) and is NEVER
// rotated here — rotation would orphan all stored PII. Writes go through the
// atomic, backup-taking env-file helpers. Changes require a server restart to
// take effect (secrets are read at boot).

function isLoopbackRequest(req) {
  const candidates = [req.ip, req.socket?.remoteAddress, req.connection?.remoteAddress];
  return candidates.some((a) => {
    if (!a) return false;
    return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1" || a.startsWith("127.");
  });
}

function setupTokenValid(req) {
  const provided = req.get("X-Setup-Token") || req.body?.setupToken || "";
  if (!provided || typeof provided !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(SETUP_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Status is loopback-gated but token-free: it reveals only booleans so the
// Setup UI can decide what to show. It never returns any secret value.
app.get("/api/setup/status", (req, res) => {
  if (!isLoopbackRequest(req)) return res.status(403).json({ error: "Setup is only available on the server host (localhost)." });
  res.json({
    setupAvailable: SETUP_AVAILABLE,
    encryptionKeyConfigured: ENCRYPTION_KEY_FROM_ENV,   // true ⇒ already set via env; cannot generate
    scorecardConfigured: !!SCORECARD_API_KEY,
    nodeEnv: NODE_ENV,
    needsRestartToApply: true,
  });
});

const SCORECARD_KEY_RE = /^[A-Za-z0-9]{20,64}$/;

// Verify a College Scorecard / IPEDS key against the LIVE api.data.gov API so
// we never persist a dead key. Requires outbound internet. `DEMO_KEY` is
// api.data.gov's public, rate-limited test key (no signup needed).
async function verifyScorecardKeyLive(apiKey) {
  try {
    const url = `https://api.data.gov/ed/collegescorecard/v1/schools?api_key=${encodeURIComponent(apiKey)}&per_page=1&fields=id`;
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (r.status === 200) return { ok: true, status: 200 };
    if (r.status === 401 || r.status === 403) return { ok: false, status: r.status, message: "api.data.gov rejected that key. Double-check it, or use DEMO_KEY for testing." };
    if (r.status === 429) return { ok: false, status: 429, message: "api.data.gov is rate-limiting right now (429). Try again shortly." };
    return { ok: false, status: r.status, message: `Scorecard API returned HTTP ${r.status}.` };
  } catch {
    return { ok: false, status: 0, message: "Couldn't reach api.data.gov to verify the key (network error). Is the server online?" };
  }
}

app.post("/api/setup/initialize", async (req, res) => {
  try {
    if (!isLoopbackRequest(req)) return res.status(403).json({ error: "Setup is only available on the server host (localhost)." });
    if (!setupTokenValid(req)) return res.status(401).json({ error: "Invalid or missing setup token. Use the one-time token printed in the server console at boot." });

    const { generateEncryptionKey, scorecardApiKey, verifyScorecardKey } = req.body || {};
    const { envPath, examplePath, devKeyPath } = defaultPaths(__dirname);
    const lines = readEnvLines(envPath, examplePath);
    const wrote = [];
    let promotedDevKey = false;

    // ── ENCRYPTION_KEY — first-run generation only ──
    if (generateEncryptionKey === true) {
      if (ENCRYPTION_KEY_FROM_ENV) {
        return res.status(409).json({
          error: "ENCRYPTION_KEY is already configured via the environment. Refusing to rotate it (that would orphan all stored PII). To rotate intentionally, use the CLI: `npm run setup -- --force-encryption`.",
        });
      }
      const cur = getValue(lines, "ENCRYPTION_KEY");
      if (cur && HEX64.test(cur)) {
        return res.status(409).json({ error: "A valid ENCRYPTION_KEY already exists in .env. Refusing to overwrite it." });
      }
      const { key, promotedDevKey: promoted } = resolveFirstRunEncryptionKey(devKeyPath);
      promotedDevKey = promoted;
      setValue(lines, "ENCRYPTION_KEY", key);
      wrote.push("ENCRYPTION_KEY");
      // Generate JWT_SECRET too if it's still a placeholder.
      const jwt = getValue(lines, "JWT_SECRET");
      if (!jwt || PLACEHOLDER.test(jwt) || jwt.length < 32) {
        setValue(lines, "JWT_SECRET", crypto.randomBytes(32).toString("hex"));
        wrote.push("JWT_SECRET");
      }
    }

    // ── SCORECARD_API_KEY (IPEDS data) — live-verified over the internet ──
    let scorecardVerified = false;
    if (typeof scorecardApiKey === "string" && scorecardApiKey.trim()) {
      const k = scorecardApiKey.trim();
      if (k !== "DEMO_KEY" && !SCORECARD_KEY_RE.test(k)) {
        return res.status(400).json({ error: "That doesn't look like an api.data.gov key (DEMO_KEY, or 20–64 alphanumeric characters)." });
      }
      if (verifyScorecardKey !== false) {
        const check = await verifyScorecardKeyLive(k);
        if (!check.ok) return res.status(400).json({ error: check.message, scorecardVerify: check });
        scorecardVerified = true;
      }
      setValue(lines, "SCORECARD_API_KEY", k);
      wrote.push("SCORECARD_API_KEY");
    }

    if (wrote.length === 0) {
      return res.status(400).json({ error: "Nothing to do. Pass generateEncryptionKey:true and/or a scorecardApiKey." });
    }

    const backup = writeEnvAtomic(envPath, lines);
    stmts.insertAudit.run(crypto.randomUUID(), new Date().toISOString(), "setup_initialize", "operator", `wrote ${wrote.join(",")}`, hashIP(req.ip));
    console.log(`[SETUP] Wrote ${wrote.join(", ")} to .env via setup endpoint (restart required).`);

    res.json({
      ok: true,
      wrote,
      promotedDevKey,
      scorecardVerified,
      backup: backup ? path.basename(backup) : null,
      restartRequired: true,
      message: "Saved to .env. Restart the backend for the changes to take effect.",
    });
  } catch (err) {
    console.error("[SETUP] initialize error:", err.message);
    res.status(500).json({ error: "Setup failed: " + err.message });
  }
});


// ═══════════════════════════════════════════════════════════
// REVIEW QUEUE (counselor)
// ═══════════════════════════════════════════════════════════

app.get("/api/review/stats", requireCounselorAuth, (_req, res) => {
  try {
    res.json(getQueueStats(reviewStmts));
  } catch (err) {
    res.status(500).json({ error: "Review stats failed" });
  }
});


// ═══════════════════════════════════════════════════════════
// COLLEGE DATA (College Scorecard)
// ═══════════════════════════════════════════════════════════

function mapBaselineCollegeSummary(college) {
  return {
    unitId: college.unit_id, name: college.name, state: college.state,
    sat25: college.sat_25, sat75: college.sat_75, act25: college.act_25, act75: college.act_75,
    acceptanceRate: college.acceptance_rate != null ? Math.round(college.acceptance_rate * 1000) / 10 : null,
    enrollment: college.enrollment, tuitionIn: college.tuition_in, tuitionOut: college.tuition_out,
    gradRate: college.grad_rate_6yr, medianEarnings10yr: college.median_earnings_10yr,
    source: "Baseline data (offline mode)",
  };
}

const SCORECARD_QUERY_TTL_DAYS = 7;

function shapeLegacyECVectorFromStrengthRow(row) {
  if (!row) return null;
  const projected = projectStrengthToLegacyVector({
    dedication: row.dedication,
    achievement: row.achievement,
    leadership: row.leadership,
    prestige: row.prestige,
    major_spike: row.major_spike,
    narrative_fit: row.narrative_fit,
  });
  return {
    id: row.id,
    ecName: row.ec_name,
    description: row.description,
    majorContext: null,
    vector: projected.vector,
    composite: projected.composite,
    label: projected.label,
    hoursPerWeek: row.hours_per_week,
    weeksPerYear: row.weeks_per_year,
    yearsActive: row.years_active,
    reasoning: safeParseJSON(row.reasoning_json, {}),
    isOverridden: Boolean(row.is_overridden),
    computedAt: row.computed_at,
    updatedAt: row.updated_at,
    sourceSystem: "ec_strength_vectors",
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeCacheString(value) {
  const s = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return s || null;
}

function normalizeStateList(states) {
  if (!Array.isArray(states)) return null;
  const normalized = states
    .map((s) => normalizeCacheString(s)?.toUpperCase() || null)
    .filter(Boolean)
    .sort();
  return normalized.length > 0 ? normalized : null;
}

function normalizeScorecardSearchPayload(payload = {}) {
  return {
    name: normalizeCacheString(payload.name),
    state: normalizeCacheString(payload.state)?.toUpperCase() || null,
    states: normalizeStateList(payload.states),
    minSAT: payload.minSAT != null ? Number(payload.minSAT) : null,
    maxTuition: payload.maxTuition != null ? Number(payload.maxTuition) : null,
    maxAcceptanceRate: payload.maxAcceptanceRate != null ? Number(payload.maxAcceptanceRate) : null,
    sizePreference: normalizeCacheString(payload.sizePreference),
    limit: Math.min(Math.max(Number(payload.limit || 20), 1), 100),
    page: Math.max(Number(payload.page || 0), 0),
  };
}

function normalizeUnitId(value) {
  const s = String(value || "").trim();
  return s || null;
}

// Resolve a target school to its baseline_colleges row. Tries, in order:
//   1. exact unit_id
//   2. exact (case-insensitive) name
//   3. conservative fuzzy match on the normalized name
//
// Without (3), a target named "Columbia University" never matches the row
// stored as "Columbia University in the City of New York", so the engine
// silently drops the school's real SAT range + admit rate and falls back to
// optimistic defaults — inflating admissibility. The fuzzy step uses a STRICT
// key (keeps the institution-type word) and only accepts a candidate whose key
// EQUALS the query or is a prefix-extension of it. That matches "Columbia
// University" → "Columbia University in the City of New York" but refuses
// "University of Missouri-Columbia" AND "Boston University" → "Boston College"
// (which would both match if "university"/"college" were stripped).
const BASELINE_PROBE_STOPWORDS = new Set(["university", "college", "of", "the", "and", "institute", "state", "school", "at", "in"]);

function resolveBaselineCollegeRow(database, { unitId, schoolName } = {}) {
  const resolvedUnitId = normalizeUnitId(unitId);
  if (resolvedUnitId) {
    const byId = database.prepare("SELECT * FROM baseline_colleges WHERE unit_id = ?").get(resolvedUnitId);
    if (byId) return byId;
  }
  if (!schoolName) return null;

  const exact = database.prepare("SELECT * FROM baseline_colleges WHERE lower(name) = lower(?) LIMIT 1").get(schoolName);
  if (exact) return exact;

  const query = strictSchoolKey(schoolName);
  if (!query) return null;
  // Narrow with a LIKE on the most distinctive token (longest non-stopword),
  // not "university"/"of" which match thousands of rows.
  const tokens = query.split(" ").filter(Boolean);
  const probe = tokens.filter((t) => !BASELINE_PROBE_STOPWORDS.has(t)).sort((a, b) => b.length - a.length)[0] || tokens[0];
  if (!probe) return null;

  const candidates = database
    .prepare("SELECT * FROM baseline_colleges WHERE lower(name) LIKE ? LIMIT 200")
    .all(`%${probe}%`);

  let best = null;
  let bestScore = -1;
  for (const row of candidates) {
    const cand = strictSchoolKey(row.name);
    if (!cand) continue;
    let score = -1;
    if (cand === query) {
      score = 100;
    } else if (cand.startsWith(`${query} `)) {
      // Prefix extension ("Columbia University" ⊂ "Columbia University in …").
      const extraTokens = cand.split(" ").length - query.split(" ").length;
      score = 80 - Math.min(40, extraTokens);
    } else {
      continue; // distinct school → refuse
    }
    // Tie-break toward rows that actually carry selectivity data.
    if (row.acceptance_rate != null) score += 2;
    if (score > bestScore) { bestScore = score; best = row; }
  }
  return best;
}

function normalizeComparePayload(unitIds) {
  return {
    unitIds: Array.isArray(unitIds)
      ? unitIds.map((id) => normalizeUnitId(id)).filter(Boolean).sort()
      : [],
  };
}

function buildScorecardQueryCacheKey(kind, payload) {
  return crypto
    .createHash("sha256")
    .update(`${kind}|${stableStringify(payload)}`)
    .digest("hex");
}

function pruneScorecardQueryCache() {
  try {
    ragStmts.deleteScorecardQueryCacheOlderThan?.run(`-${SCORECARD_QUERY_TTL_DAYS} days`);
  } catch {
    // Cache pruning is best-effort.
  }
}

function getScorecardQueryCache(kind, payload) {
  pruneScorecardQueryCache();
  const key = buildScorecardQueryCacheKey(kind, payload);
  const row = ragStmts.getScorecardQueryCache?.get(key);
  if (!row) return null;
  return {
    cacheKey: key,
    kind: row.cache_kind,
    fetchedAt: row.fetched_at,
    data: safeJSON(row.data_json, null),
  };
}

function putScorecardQueryCache(kind, payload, data) {
  pruneScorecardQueryCache();
  const key = buildScorecardQueryCacheKey(kind, payload);
  ragStmts.upsertScorecardQueryCache?.run(
    key,
    kind,
    JSON.stringify(payload),
    JSON.stringify(data),
  );
  return key;
}

function collegeMatchesKeyword(college, keyword) {
  const normalized = String(keyword || "").trim().toLowerCase();
  if (!normalized) return true;
  const byName = String(college.name || "").toLowerCase();
  if (byName.includes(normalized)) return true;
  const stopWords = new Set(["of", "the", "and", "at", "for"]);
  const acronym = String(college.name || "").replace(/[^A-Za-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean).filter(p => !stopWords.has(p.toLowerCase())).map(p => p[0]?.toUpperCase() || "").join("").toLowerCase();
  if (acronym && acronym === normalized.replace(/\./g, "")) return true;
  return byName.replace(/[^a-z0-9]+/g, " ").trim().includes(normalized);
}

function matchesBaselineSizePreference(enrollment, sizePreference) {
  if (enrollment == null || !sizePreference) return true;
  if (sizePreference === "small") return enrollment < 5000;
  if (sizePreference === "medium") return enrollment >= 5000 && enrollment < 20000;
  if (sizePreference === "large") return enrollment >= 20000;
  return true;
}

function buildBaselineCollegeSearchResponse(filters) {
  const safeLimit = Math.min(Math.max(parseInt(filters.limit || "20", 10) || 20, 1), 100);
  const safePage = Math.max(parseInt(filters.page || "0", 10) || 0, 0);
  let colleges = db.prepare("SELECT * FROM baseline_colleges").all();
  if (filters.name) colleges = colleges.filter(c => collegeMatchesKeyword(c, filters.name));
  if (filters.state) colleges = colleges.filter(c => c.state === filters.state);
  if (filters.states?.length) colleges = colleges.filter(c => filters.states.includes(c.state));
  if (filters.minSAT) colleges = colleges.filter(c => (c.sat_75 ?? c.sat_25 ?? null) != null && (c.sat_75 ?? c.sat_25) >= filters.minSAT);
  if (filters.maxTuition) colleges = colleges.filter(c => c.tuition_in != null && c.tuition_in <= filters.maxTuition);
  if (filters.maxAcceptanceRate) colleges = colleges.filter(c => c.acceptance_rate != null && c.acceptance_rate <= filters.maxAcceptanceRate / 100);
  if (filters.sizePreference) colleges = colleges.filter(c => matchesBaselineSizePreference(c.enrollment, filters.sizePreference));

  colleges.sort((a, b) => {
    if (a.acceptance_rate == null && b.acceptance_rate != null) return 1;
    if (a.acceptance_rate != null && b.acceptance_rate == null) return -1;
    if (a.acceptance_rate != null && b.acceptance_rate != null && a.acceptance_rate !== b.acceptance_rate) return a.acceptance_rate - b.acceptance_rate;
    return a.name.localeCompare(b.name);
  });

  const start = safePage * safeLimit;
  return { results: colleges.slice(start, start + safeLimit).map(mapBaselineCollegeSummary), total: colleges.length, page: safePage, source: "Baseline data" };
}

function withScorecardMeta(data, meta = {}) {
  return {
    ...data,
    cached: Boolean(meta.cached),
    stale: Boolean(meta.stale),
    fallback: Boolean(meta.fallback),
    fallbackReason: meta.fallbackReason || null,
    cacheKind: meta.cacheKind || null,
    cacheTtlDays: meta.cacheKind ? SCORECARD_QUERY_TTL_DAYS : null,
    dataFreshness: meta.dataFreshness || (meta.stale ? "stale" : "current"),
  };
}

app.post("/api/colleges/search", scorecardLimiter, async (req, res) => {
  try {
    const { name, state, states, minSAT, maxTuition, maxAcceptanceRate, sizePreference, limit, page } = req.body;
    const queryPayload = normalizeScorecardSearchPayload({
      name, state, states, minSAT, maxTuition, maxAcceptanceRate, sizePreference, limit, page,
    });
    if (!SCORECARD_API_KEY) {
      return res.json(withScorecardMeta(buildBaselineCollegeSearchResponse(queryPayload), {
        cached: false,
        stale: true,
        fallback: true,
        fallbackReason: "scorecard_not_configured",
        dataFreshness: "baseline",
      }));
    }
    const cached = getScorecardQueryCache("search", queryPayload);
    if (cached?.data) {
      return res.json(withScorecardMeta(cached.data, {
        cached: true,
        cacheKind: "search",
        dataFreshness: "current",
      }));
    }
    const result = await searchScorecard(SCORECARD_API_KEY, queryPayload);
    if (result.error) {
      console.warn("[SCORECARD] Search error:", result.error);
      return res.json(withScorecardMeta(buildBaselineCollegeSearchResponse(queryPayload), {
        cached: false,
        stale: true,
        fallback: true,
        fallbackReason: "scorecard_live_error",
        dataFreshness: "baseline",
      }));
    }
    putScorecardQueryCache("search", queryPayload, result);
    res.json(withScorecardMeta(result, {
      cached: false,
      cacheKind: "search",
      dataFreshness: "current",
    }));
  } catch (err) {
    console.error("[SCORECARD] Search error:", err.message);
    res.status(500).json({ error: "College search failed" });
  }
});

app.get("/api/colleges/:id", scorecardLimiter, async (req, res) => {
  try {
    const unitId = normalizeUnitId(req.params.id);
    if (!unitId || unitId.length > 10) return res.status(400).json({ error: "Valid unit ID required" });

    let college = null;
    if (SCORECARD_API_KEY) {
      const cached = getScorecardQueryCache("college_by_id", { unitId });
      if (cached?.data) {
        return res.json(withScorecardMeta(cached.data, {
          cached: true,
          cacheKind: "college_by_id",
          dataFreshness: "current",
        }));
      }
      college = await getCollegeById(SCORECARD_API_KEY, unitId);
      if (college) putScorecardQueryCache("college_by_id", { unitId }, college);
    }

    if (!college) {
      const baseline = db.prepare("SELECT * FROM baseline_colleges WHERE unit_id = ?").get(unitId);
      if (!baseline) return res.status(404).json({ error: "College not found" });
      college = {
        unitId: baseline.unit_id, name: baseline.name, state: baseline.state,
        sat25: baseline.sat_25, sat75: baseline.sat_75, act25: baseline.act_25, act75: baseline.act_75,
        acceptanceRate: baseline.acceptance_rate != null ? Math.round(baseline.acceptance_rate * 1000) / 10 : null,
        enrollment: baseline.enrollment, tuitionIn: baseline.tuition_in, tuitionOut: baseline.tuition_out,
        avgGpaAdmitted: baseline.avg_gpa_admitted, gradRate: baseline.grad_rate_6yr,
        retentionRate: baseline.retention_rate, medianEarnings10yr: baseline.median_earnings_10yr,
        topMajors: safeJSON(baseline.top_majors_json, []),
        apCoursesValued: safeJSON(baseline.ap_courses_valued_json, []),
        ecEmphasis: safeJSON(baseline.ec_emphasis_json, []),
        source: "Baseline data (NCES IPEDS)",
      };
      return res.json(withScorecardMeta(college, {
        cached: false,
        stale: true,
        fallback: true,
        fallbackReason: SCORECARD_API_KEY ? "scorecard_live_error_or_miss" : "scorecard_not_configured",
        dataFreshness: "baseline",
      }));
    }
    res.json(withScorecardMeta(college, {
      cached: false,
      cacheKind: "college_by_id",
      dataFreshness: "current",
    }));
  } catch (err) {
    console.error("[SCORECARD] College lookup error:", err.message);
    res.status(500).json({ error: "College lookup failed" });
  }
});

app.get("/api/colleges/:id/financial-aid", scorecardLimiter, async (req, res) => {
  try {
    const unitId = normalizeUnitId(req.params.id);
    if (!unitId || unitId.length > 10) return res.status(400).json({ error: "Valid unit ID required" });

    if (!SCORECARD_API_KEY) {
      const baseline = db.prepare("SELECT * FROM baseline_colleges WHERE unit_id = ?").get(unitId);
      if (!baseline) return res.status(404).json({ error: "College not found" });
      return res.json(withScorecardMeta({
        name: baseline.name, tuitionInState: baseline.tuition_in, tuitionOutState: baseline.tuition_out,
        medianEarnings10yr: baseline.median_earnings_10yr,
        interpretation: "Limited financial data in offline mode. Configure SCORECARD_API_KEY for full profiles.",
        source: "Baseline data (limited)",
      }, {
        cached: false,
        stale: true,
        fallback: true,
        fallbackReason: "scorecard_not_configured",
        dataFreshness: "baseline",
      }));
    }
    const cached = getScorecardQueryCache("financial_aid", { unitId });
    if (cached?.data) {
      return res.json(withScorecardMeta(cached.data, {
        cached: true,
        cacheKind: "financial_aid",
        dataFreshness: "current",
      }));
    }
    const profile = await getFinancialAidProfile(SCORECARD_API_KEY, unitId);
    if (profile.error) return res.status(404).json(profile);
    putScorecardQueryCache("financial_aid", { unitId }, profile);
    res.json(withScorecardMeta(profile, {
      cached: false,
      cacheKind: "financial_aid",
      dataFreshness: "current",
    }));
  } catch (err) {
    console.error("[SCORECARD] Financial aid error:", err.message);
    res.status(500).json({ error: "Financial aid lookup failed" });
  }
});

// ── GET /api/colleges/:id/history — 10-year Scorecard trend data ─────────
// Returns cached data instantly when available; fetches live on first call.
// Auth: any authenticated student (not limited to their own goal list so
// counselors can pull arbitrary schools from the audit dashboard too).
app.get("/api/colleges/:id/history", scorecardLimiter, requireStudentAuth, async (req, res) => {
  try {
    const unitId = normalizeUnitId(req.params.id);
    if (!unitId || !/^\d{5,8}$/.test(unitId)) {
      return res.status(400).json({ error: "Valid numeric unit ID required (5-8 digits)" });
    }

    const cachedRows = ragStmts.getScorecardHistory?.all(unitId) || [];
    const hasFreshCache = !!ragStmts.getScorecardCache?.get(unitId);

    if (cachedRows.length > 0 && hasFreshCache) {
      const [entry] = buildCollegeHistoryContext(ragStmts, [unitId]);
      return res.json(withScorecardMeta(entry, {
        cached: true,
        dataFreshness: "current",
      }));
    }

    if (!SCORECARD_API_KEY) {
      if (cachedRows.length > 0) {
        const [entry] = buildCollegeHistoryContext(ragStmts, [unitId]);
        return res.json(withScorecardMeta({
          ...entry,
          warning: "SCORECARD_API_KEY not configured; showing stale cached data",
        }, {
          cached: true,
          stale: true,
          fallback: true,
          fallbackReason: "scorecard_not_configured",
          dataFreshness: "stale",
        }));
      }
      return res.status(503).json({ error: "SCORECARD_API_KEY not configured. Add it to .env to enable historical data." });
    }

    const result = await getCollegeHistory(SCORECARD_API_KEY, unitId, 10);
    if (result.error) {
      if (cachedRows.length > 0) {
        const [entry] = buildCollegeHistoryContext(ragStmts, [unitId]);
        return res.json(withScorecardMeta({
          ...entry,
          warning: result.error,
        }, {
          cached: true,
          stale: true,
          fallback: true,
          fallbackReason: "scorecard_live_error",
          dataFreshness: "stale",
        }));
      }
      return res.status(404).json({ error: result.error });
    }

    try {
      db.transaction(() => {
        ragStmts.upsertScorecardCache.run(unitId, result.name, JSON.stringify(result));
        for (const yr of result.history) {
          ragStmts.upsertScorecardHistory.run(
            unitId, yr.year, result.name,
            yr.admissionRate, yr.sat25, yr.sat75,
            yr.act25, yr.act75,
            yr.tuitionIn, yr.tuitionOut, yr.avgNetPrice,
            yr.enrollment, yr.gradRate, yr.medianEarnings
          );
        }
      })();
    } catch (dbErr) {
      console.warn("[SCORECARD] History DB write error:", dbErr.message);
    }

    const [entry] = buildCollegeHistoryContext(ragStmts, [unitId]);
    res.json(withScorecardMeta(entry || { unitId, available: false }, {
      cached: false,
      dataFreshness: "current",
    }));
  } catch (err) {
    console.error("[SCORECARD] History endpoint error:", err.message);
    res.status(500).json({ error: "College history lookup failed" });
  }
});

app.get("/api/cds/targets", studentLimiter, requireStudentAuth, async (req, res) => {
  try {
    const snap = ragStmts.getLatestSnapshot.get(req.studentId);
    if (!snap) return res.status(404).json({ error: "No profile data" });

    const goals = safeJSON(snap.goals_json, []);
    const goalUnitIds = extractGoalUnitIds(goals);
    const fallbackRows = goalUnitIds.map((unitId) => db.prepare("SELECT unit_id, name FROM baseline_colleges WHERE unit_id = ?").get(unitId)).filter(Boolean);
    const targets = extractTargetSchoolNames(goals, fallbackRows);
    if (targets.length === 0) {
      return res.status(400).json({ error: "No target universities found in student goals" });
    }

    const forceRefresh = String(req.query.refresh || "").toLowerCase() === "true";
    const cachePayload = { cacheKey: computeCdsQueryCacheKey(targets), targets };
    if (!forceRefresh) {
      const cached = getScorecardQueryCache("cds_targets", cachePayload);
      if (cached?.data) {
        return res.json(withScorecardMeta({
          targets: cached.data.targets || targets,
          results: cached.data.results || [],
          source: "College Transitions CDS repository",
        }, {
          cached: true,
          cacheKind: "cds_targets",
          dataFreshness: "current",
        }));
      }
    }

    const results = await resolveAndParseCdsTargets(targets);
    const payload = {
      targets,
      results,
      source: "College Transitions CDS repository",
    };
    putScorecardQueryCache("cds_targets", cachePayload, payload);
    res.json(withScorecardMeta(payload, {
      cached: false,
      cacheKind: "cds_targets",
      dataFreshness: "current",
    }));
  } catch (err) {
    console.error("[CDS targets] Error:", err.message);
    res.status(500).json({ error: "CDS target lookup failed" });
  }
});

// POST /api/cds/parse - OCR/extract an uploaded CDS file, then parse the
// admissions fields needed by positioning. This does not persist the document.
app.post("/api/cds/parse", studentLimiter, requireStudentAuth, (req, res) => {
  ecUpload.single("file")(req, res, async (mErr) => {
    if (mErr) {
      if (mErr.code === "UNSUPPORTED_MIME") {
        return res.status(415).json({
          error: mErr.message,
          supported: Object.keys(SUPPORTED_MIME_TYPES),
        });
      }
      if (mErr.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: `File exceeds ${MAX_FILE_BYTES} bytes` });
      }
      console.error("[CDS parse] multer error:", mErr.message);
      return res.status(400).json({ error: "Upload failed" });
    }
    if (!req.file) return res.status(400).json({ error: "file required" });

    try {
      const buf = fs.readFileSync(req.file.path);
      const result = await parseCdsDocument(buf, {
        contentType: req.file.mimetype,
        url: req.file.originalname || "",
        imageOcrOptions: { languages: "eng", timeoutMs: 60_000 },
      });
      res.json({
        ok: true,
        filename: req.file.originalname,
        mimeType: req.file.mimetype,
        extraction: result.extraction,
        parsed: result.parsed,
        preview: result.text.slice(0, 800),
      });
    } catch (err) {
      const message = err instanceof ExtractionError
        ? `${err.code}: ${err.message}`
        : String(err?.message || err).slice(0, 240);
      console.error("[CDS parse] Error:", message);
      res.status(400).json({ error: "CDS parse failed", detail: message });
    } finally {
      try {
        if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      } catch (err) {
        console.error("[CDS parse] temp cleanup failed:", err.message);
      }
    }
  });
});

app.post("/api/colleges/compare", scorecardLimiter, async (req, res) => {
  try {
    const { unitIds } = req.body;
    if (!Array.isArray(unitIds) || unitIds.length < 2) return res.status(400).json({ error: "Provide at least 2 unit IDs" });
    if (unitIds.length > 8) return res.status(400).json({ error: "Maximum 8 colleges" });

    if (!SCORECARD_API_KEY) {
      const colleges = unitIds.map(id => {
        const b = db.prepare("SELECT * FROM baseline_colleges WHERE unit_id = ?").get(id);
        if (!b) return null;
        return {
          unitId: b.unit_id, name: b.name, state: b.state,
          sat25: b.sat_25, sat75: b.sat_75,
          acceptanceRate: b.acceptance_rate != null ? Math.round(b.acceptance_rate * 1000) / 10 : null,
          enrollment: b.enrollment, tuitionIn: b.tuition_in, tuitionOut: b.tuition_out,
          gradRate: b.grad_rate_6yr, retentionRate: b.retention_rate,
          medianEarnings10yr: b.median_earnings_10yr,
        };
      }).filter(Boolean);
      if (colleges.length < 2) return res.status(400).json({ error: "Need at least 2 valid colleges" });

      const dimensions = [
        { key: "acceptanceRate", label: "Acceptance Rate", format: "pct", lowerBetter: true },
        { key: "sat25", label: "SAT 25th", format: "num" },
        { key: "sat75", label: "SAT 75th", format: "num" },
        { key: "tuitionIn", label: "In-State Tuition", format: "usd", lowerBetter: true },
        { key: "tuitionOut", label: "Out-of-State Tuition", format: "usd", lowerBetter: true },
        { key: "enrollment", label: "Enrollment", format: "num" },
        { key: "gradRate", label: "Graduation Rate", format: "pct" },
        { key: "retentionRate", label: "Freshman Retention", format: "pct" },
        { key: "medianEarnings10yr", label: "Median Earnings (10yr)", format: "usd" },
      ];
      const fmtVal = (v, fmt) => { if (v == null) return "N/A"; if (fmt === "pct") return `${Math.round(v * 100)}%`; if (fmt === "usd") return `$${v.toLocaleString()}`; return v.toLocaleString(); };
      const matrix = dimensions.map(dim => {
        const values = colleges.map(c => ({ school: c.name, value: c[dim.key], formatted: fmtVal(c[dim.key], dim.format) }));
        const sorted = [...values].filter(v => v.value != null).sort((a, b) => dim.lowerBetter ? a.value - b.value : b.value - a.value);
        return { dimension: dim.label, values: values.map(v => ({ ...v, rank: sorted.findIndex(s => s.school === v.school) + 1 || null })) };
      });
      return res.json({ colleges: colleges.map(c => ({ unitId: c.unitId, name: c.name, state: c.state })), matrix, source: "Baseline data" });
    }

    const comparePayload = normalizeComparePayload(unitIds);
    const cached = getScorecardQueryCache("compare", comparePayload);
    if (cached?.data) {
      const requestedOrder = unitIds.map((id) => normalizeUnitId(id));
      const orderedColleges = Array.isArray(cached.data.colleges)
        ? [...cached.data.colleges].sort((a, b) =>
          requestedOrder.indexOf(normalizeUnitId(a.unitId)) - requestedOrder.indexOf(normalizeUnitId(b.unitId)))
        : [];
      const orderedNames = orderedColleges.map((c) => c.name);
      const orderedMatrix = Array.isArray(cached.data.matrix)
        ? cached.data.matrix.map((dimension) => ({
          ...dimension,
          values: Array.isArray(dimension.values)
            ? [...dimension.values].sort((a, b) => orderedNames.indexOf(a.school) - orderedNames.indexOf(b.school))
            : [],
        }))
        : [];
      return res.json(withScorecardMeta({
        ...cached.data,
        colleges: orderedColleges,
        matrix: orderedMatrix,
      }, {
        cached: true,
        cacheKind: "compare",
        dataFreshness: "current",
      }));
    }
    const result = await compareColleges(SCORECARD_API_KEY, unitIds);
    if (result.error) return res.status(400).json(result);
    putScorecardQueryCache("compare", comparePayload, result);
    res.json(withScorecardMeta(result, {
      cached: false,
      cacheKind: "compare",
      dataFreshness: "current",
    }));
  } catch (err) {
    console.error("[SCORECARD] Comparison error:", err.message);
    res.status(500).json({ error: "College comparison failed" });
  }
});


// ═══════════════════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════════════════

app.get("/api/admin/admissions-intel/summary", requireCounselorAuth, (_req, res) => {
  try {
    res.json({
      cipMappings: admissionsIntelStmts.listCipMajorMap.all(),
      note: "Official CIP mapping is seeded from NCES taxonomy. IPEDS growth, major policy, and strategic-focus rows live in dedicated admissions-intelligence tables.",
    });
  } catch (err) {
    console.error("[ADMISSIONS-INTEL summary] Error:", err.message);
    res.status(500).json({ error: "Admissions intelligence summary failed" });
  }
});

app.post("/api/admin/admissions-intel/ipeds-growth", requireCounselorAuth, (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ error: "rows[] required" });
    rows.forEach((row) => upsertIpedsGrowth(admissionsIntelStmts, row));
    res.json({ ok: true, inserted: rows.length });
  } catch (err) {
    console.error("[ADMISSIONS-INTEL ipeds] Error:", err.message);
    res.status(500).json({ error: "IPEDS growth ingest failed" });
  }
});

app.post("/api/admin/admissions-intel/ipeds-growth/load-file", requireCounselorAuth, (req, res) => {
  try {
    const inputPath = req.body?.path;
    if (!inputPath || typeof inputPath !== "string") {
      return res.status(400).json({ error: "path is required" });
    }
    const rows = loadIpedsGrowthFile(inputPath, {
      sourceUrl: "https://nces.ed.gov/ipeds/datacenter/DataFiles.aspx",
      sourceTitle: `NCES IPEDS completions import (${path.basename(inputPath)})`,
    });
    if (!rows.length) {
      return res.status(400).json({ error: "No usable IPEDS growth rows found in file" });
    }
    rows.forEach((row) => upsertIpedsGrowth(admissionsIntelStmts, row));
    res.json({ ok: true, inserted: rows.length, path: inputPath });
  } catch (err) {
    console.error("[ADMISSIONS-INTEL ipeds file-load] Error:", err.message);
    res.status(500).json({ error: "IPEDS growth file load failed" });
  }
});

app.post("/api/admin/admissions-intel/major-policy", requireCounselorAuth, (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ error: "rows[] required" });
    const results = rows.map((row) => upsertMajorPolicy(admissionsIntelStmts, row));
    res.json({ ok: true, inserted: rows.length, subjectKeys: results.map((r) => r.subjectKey) });
  } catch (err) {
    console.error("[ADMISSIONS-INTEL major-policy] Error:", err.message);
    res.status(500).json({ error: "Major policy ingest failed" });
  }
});

app.post("/api/admin/admissions-intel/strategic-focus", requireCounselorAuth, (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ error: "rows[] required" });
    const results = rows.map((row) => upsertStrategicFocus(admissionsIntelStmts, row));
    res.json({ ok: true, inserted: rows.length, subjectKeys: results.map((r) => r.subjectKey).filter(Boolean) });
  } catch (err) {
    console.error("[ADMISSIONS-INTEL strategic-focus] Error:", err.message);
    res.status(500).json({ error: "Strategic focus ingest failed" });
  }
});

app.get("/api/admissions-intel/ipeds-growth", studentLimiter, requireStudentAuth, (req, res) => {
  try {
    const unitId = normalizeUnitId(req.query.unitId);
    const major = String(req.query.major || "").trim();
    if (!major) return res.status(400).json({ error: "major is required" });
    const signal = resolveIpedsGrowthForMajor(admissionsIntelStmts, { unitId, major });
    res.json({
      ok: true,
      unitId: unitId || null,
      major,
      signal,
      source: "NCES IPEDS completions",
    });
  } catch (err) {
    console.error("[ADMISSIONS-INTEL ipeds read] Error:", err.message);
    res.status(500).json({ error: "IPEDS growth lookup failed" });
  }
});

app.get("/api/health", (_req, res) => {
  const crisisCount = stmts.getCrisisCount24h.get();
  res.json({
    status: "ok",
    uptime: process.uptime(),
    smtp: !!mailTransport,
    scorecard: !!SCORECARD_API_KEY,
    crisisLast24h: crisisCount.count,
    retentionMode: RETENTION_MODE,
    databases: { operational: "counselor.db", piiVault: "pii-vault.db", vectors: "vectors.db" },
    timestamp: new Date().toISOString(),
  });
});


// ═══════════════════════════════════════════════════════════
// COUNSELOR DASHBOARD (HTML UI)
// ═══════════════════════════════════════════════════════════

app.get("/dashboard", requireCounselorAuth, (_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(buildDashboardHTML());
});

function buildDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>College Counselor — Safety Dashboard</title>
<style>
  :root { --bg: #0f1117; --card: #1a1d27; --border: #2a2d3a; --text: #e1e4ed; --muted: #8b8fa3;
          --red: #ef4444; --orange: #f59e0b; --green: #22c55e; --blue: #3b82f6; --purple: #8b5cf6; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); padding: 24px; }
  h1 { font-size: 1.5rem; margin-bottom: 4px; }
  .subtitle { color: var(--muted); font-size: 0.85rem; margin-bottom: 24px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .stat-card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
  .stat-card .label { color: var(--muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .stat-card .value { font-size: 2rem; font-weight: 700; margin-top: 4px; }
  .stat-card.crisis .value { color: var(--red); }
  .stat-card.warn .value { color: var(--orange); }
  .stat-card.ok .value { color: var(--green); }
  .section { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; margin-bottom: 24px; }
  .section h2 { font-size: 1.1rem; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th { text-align: left; color: var(--muted); font-weight: 500; padding: 8px 12px; border-bottom: 1px solid var(--border); font-size: 0.75rem; text-transform: uppercase; }
  td { padding: 10px 12px; border-bottom: 1px solid var(--border); }
  tr:hover td { background: rgba(255,255,255,0.02); }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 0.7rem; font-weight: 600; }
  .badge-crisis { background: rgba(239,68,68,0.15); color: var(--red); }
  .badge-block { background: rgba(245,158,11,0.15); color: var(--orange); }
  .badge-notify { background: rgba(139,92,246,0.15); color: var(--purple); }
  .badge-info { background: rgba(59,130,246,0.15); color: var(--blue); }
  .badge-ok { background: rgba(34,197,94,0.15); color: var(--green); }
  .badge-stale { background: rgba(239,68,68,0.15); color: var(--red); }
  .badge-current { background: rgba(34,197,94,0.15); color: var(--green); }
  .empty { color: var(--muted); font-style: italic; padding: 20px; text-align: center; }
  .toolbar { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
  .toolbar select, .toolbar button { background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 6px 12px; font-size: 0.8rem; cursor: pointer; }
  .toolbar button:hover { background: var(--border); }
  .toolbar button.primary { background: var(--blue); border-color: var(--blue); }
  .notif-status { display: flex; gap: 16px; flex-wrap: wrap; }
  .notif-item { flex: 1; min-width: 150px; padding: 12px; border-radius: 8px; background: var(--bg); }
  .notif-item .num { font-size: 1.5rem; font-weight: 700; }
  .freshness-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border); }
  .freshness-item:last-child { border-bottom: none; }
  .loading { text-align: center; padding: 40px; color: var(--muted); }
  .refresh-time { color: var(--muted); font-size: 0.75rem; }
  @media (max-width: 600px) { body { padding: 12px; } .grid { grid-template-columns: 1fr 1fr; } }
</style>
</head>
<body>
<h1>Safety & Audit Dashboard</h1>
<p class="subtitle">College Counselor — Rules-First Architecture v2</p>

<div class="grid" id="stats"><div class="stat-card loading"><div class="label">Loading...</div></div></div>

<div class="section">
  <h2>Crisis & Safety Events</h2>
  <div class="toolbar">
    <select id="typeFilter">
      <option value="">All types</option>
      <option value="crisis_detected">Crisis Detected</option>
      <option value="essay_blocked">Essay Blocked</option>
      <option value="input_blocked">Input Blocked</option>
      <option value="off_topic_blocked">Off-Topic Blocked</option>
      <option value="review_submitted">Review Submitted</option>
      <option value="parental_notify_sent">Parental Notify</option>
    </select>
    <button onclick="loadEvents()">Refresh</button>
    <button onclick="exportCSV()" class="primary">Export CSV</button>
  </div>
  <div id="events"><div class="loading">Loading events...</div></div>
</div>

<div class="section">
  <h2>Review Queue</h2>
  <div id="reviewStats"><div class="loading">Loading...</div></div>
</div>

<div class="section">
  <h2>System Status</h2>
  <div id="systemStatus"><div class="loading">Loading...</div></div>
</div>

<p class="refresh-time">Last refresh: <span id="lastRefresh">--</span></p>

<script>
const AUTH = "${Buffer.from(COUNSELOR_USER + ":" + COUNSELOR_PASS).toString("base64")}";
const headers = { "Authorization": "Basic " + AUTH, "Content-Type": "application/json" };

function badgeFor(type) {
  if (type === "crisis_detected") return '<span class="badge badge-crisis">CRISIS</span>';
  if (type.includes("blocked") || type.includes("rejected")) return '<span class="badge badge-block">' + type.replace(/_/g, " ") + '</span>';
  if (type.includes("notify")) return '<span class="badge badge-notify">' + type.replace(/_/g, " ") + '</span>';
  if (type.includes("review")) return '<span class="badge badge-info">' + type.replace(/_/g, " ") + '</span>';
  if (type.includes("accepted") || type.includes("cleaned")) return '<span class="badge badge-ok">' + type.replace(/_/g, " ") + '</span>';
  return '<span class="badge badge-info">' + type.replace(/_/g, " ") + '</span>';
}

function timeAgo(ts) {
  const d = Date.now() - new Date(ts).getTime();
  if (d < 60000) return "just now";
  if (d < 3600000) return Math.floor(d/60000) + "m ago";
  if (d < 86400000) return Math.floor(d/3600000) + "h ago";
  return Math.floor(d/86400000) + "d ago";
}

async function loadDashboard() {
  try {
    const r = await fetch("/api/audit/dashboard?limit=200", { headers });
    const data = await r.json();
    const crisis24h = data.summary?.crisisLast24h || 0;
    const total = data.summary?.totalReturned || 0;
    const weekly = data.summary?.weeklyBreakdown || [];
    const blockedCount = weekly.filter(w => w.type.includes("blocked")).reduce((s,w) => s + w.count, 0);
    const notifyCount = weekly.filter(w => w.type.includes("notify")).reduce((s,w) => s + w.count, 0);
    const reviewCount = weekly.filter(w => w.type.includes("review")).reduce((s,w) => s + w.count, 0);

    document.getElementById("stats").innerHTML = \`
      <div class="stat-card \${crisis24h > 0 ? 'crisis' : 'ok'}"><div class="label">Crises (24h)</div><div class="value">\${crisis24h}</div></div>
      <div class="stat-card \${blockedCount > 10 ? 'warn' : 'ok'}"><div class="label">Blocked (7d)</div><div class="value">\${blockedCount}</div></div>
      <div class="stat-card"><div class="label">Reviews (7d)</div><div class="value">\${reviewCount}</div></div>
      <div class="stat-card"><div class="label">Total Events</div><div class="value">\${total}</div></div>
    \`;
    renderEvents(data.events || []);
  } catch (err) {
    document.getElementById("stats").innerHTML = '<div class="stat-card"><div class="label">Error</div><div class="value" style="font-size:1rem">' + err.message + '</div></div>';
  }

  // Review queue
  try {
    const r = await fetch("/api/review/stats", { headers });
    const data = await r.json();
    document.getElementById("reviewStats").innerHTML = \`
      <div class="grid">
        <div class="stat-card"><div class="label">Pending Reviews</div><div class="value">\${data.pending || 0}</div></div>
        <div class="stat-card"><div class="label">Resolved (30d)</div><div class="value">\${data.resolved_30d || 0}</div></div>
      </div>
    \`;
  } catch { document.getElementById("reviewStats").innerHTML = '<div class="empty">Unable to load</div>'; }

  // System status
  try {
    const r = await fetch("/api/baselines/status");
    const data = await r.json();
    document.getElementById("systemStatus").innerHTML = \`
      <div class="grid">
        <div class="stat-card"><div class="label">College Profiles</div><div class="value">\${data.baselines?.colleges || 0}</div></div>
        <div class="stat-card"><div class="label">Verified Facts</div><div class="value">\${data.factStore?.total || 0}</div></div>
        <div class="stat-card"><div class="label">Retention Mode</div><div class="value" style="font-size:1rem">\${data.retentionMode || "consumer"}</div></div>
        <div class="stat-card"><div class="label">Status</div><div class="value" style="font-size:1rem;color:var(--green)">\${data.status || "unknown"}</div></div>
      </div>
      \${data.freshness?.datasets ? '<h2 style="margin-top:18px">Baseline Data Freshness</h2>' : ""}
      \${data.freshness?.datasets ? data.freshness.datasets.map(d => \`
        <div class="freshness-item">
          <div><strong>\${d.label}</strong><div style="color:var(--muted);font-size:0.8rem">\${d.count.toLocaleString()} records</div></div>
          <span class="badge badge-\${d.stale ? 'stale' : 'current'}">\${d.status}</span>
        </div>
      \`).join("") : ""}
    \`;
  } catch { document.getElementById("systemStatus").innerHTML = '<div class="empty">Unable to load</div>'; }

  document.getElementById("lastRefresh").textContent = new Date().toLocaleTimeString();
}

function renderEvents(events) {
  if (!events.length) { document.getElementById("events").innerHTML = '<div class="empty">No events found</div>'; return; }
  document.getElementById("events").innerHTML = \`
    <table>
      <thead><tr><th>Time</th><th>Type</th><th>User</th><th>Details</th></tr></thead>
      <tbody>\${events.map(e => \`
        <tr>
          <td title="\${e.timestamp}">\${timeAgo(e.timestamp)}</td>
          <td>\${badgeFor(e.type)}</td>
          <td>\${e.user_hint || "--"}</td>
          <td style="max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\${(e.details || "").replace(/</g,"&lt;")}</td>
        </tr>
      \`).join("")}</tbody>
    </table>
  \`;
}

async function loadEvents() {
  const type = document.getElementById("typeFilter").value;
  try {
    const r = await fetch("/api/audit/dashboard?limit=200" + (type ? "&type=" + type : ""), { headers });
    const data = await r.json();
    renderEvents(data.events || []);
  } catch {}
}

function exportCSV() { window.open("/api/audit/export", "_blank"); }

document.getElementById("typeFilter").addEventListener("change", loadEvents);
loadDashboard();
setInterval(loadDashboard, 60000);
</script>
</body>
</html>`;
}


// ═══════════════════════════════════════════════════════════
// SERVE FRONTEND (production static files)
// ═══════════════════════════════════════════════════════════
const publicDir = path.join(__dirname, "public");
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
    res.sendFile(path.join(publicDir, "index.html"));
  });
} else {
  console.warn("[BOOT] No ./public directory — frontend not served.");
  app.get("/", (_req, res) => res.json({ status: "Backend running. Build frontend into ./public to serve it." }));
}


// ═══════════════════════════════════════════════════════════
// GLOBAL ERROR HANDLER
// ═══════════════════════════════════════════════════════════
app.use((err, _req, res, _next) => {
  console.error("[ERROR]", err.message);
  res.status(err.status || 500).json({
    error: NODE_ENV === "production" ? "Internal server error" : err.message,
  });
});


// ═══════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║  College Counselor Backend v2 (Rules-First Architecture)       ║
║  Port: ${String(PORT).padEnd(54)}║
║  Env:  ${NODE_ENV.padEnd(54)}║
║  Scorecard: ${(SCORECARD_API_KEY ? "LIVE" : "OFFLINE (baseline only)").padEnd(49)}║
║  Retention: ${RETENTION_MODE.padEnd(49)}║
║                                                                ║
║  Databases:                                                    ║
║    counselor.db  — operational (audit, baselines, snapshots)   ║
║    pii-vault.db  — encrypted PII (separate, AES-256-GCM)      ║
║    vectors.db    — embeddings (no student PII)                 ║
║                                                                ║
║  Architecture:                                                 ║
║    T0: Rules Engine (deterministic, $0)                        ║
║    T1: Haiku (low-stakes coaching)                             ║
║    T2: Sonnet (essay review, strategy)                         ║
║    T3: Opus (supervised escalation, <8% budget)                ║
║                                                                ║
║  New Modules:                                                  ║
║    policy-router, rules-engine, fact-store, evidence-graph,    ║
║    answer-composer, review-queue, pii-vault, content-mod,      ║
║    consent, domain-monitor, retention, batch-jobs, vector-store║
╚════════════════════════════════════════════════════════════════╝
  `);
});


// ═══════════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN
// ═══════════════════════════════════════════════════════════
function shutdown(signal) {
  console.log(`\n[SHUTDOWN] ${signal} received. Stopping jobs and closing databases...`);
  stopAllJobs();
  db.close();
  piiVault.close();
  vectorStore.close();
  console.log("[SHUTDOWN] All databases closed. Exiting.");
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

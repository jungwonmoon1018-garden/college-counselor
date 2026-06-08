// ═══════════════════════════════════════════════════════════════════════
// BATCH JOBS — Scheduled batch processing
// ═══════════════════════════════════════════════════════════════════════
// Handles scheduled operations:
//   - Nightly baseline normalization
//   - Daily college profile cache refresh
//   - Daily domain monitoring + diff indexing
//   - Hourly stale fact expiration
//   - Daily retention cleanup
//   - Document auto-deletion (72h)
// ═══════════════════════════════════════════════════════════════════════

import { expireOldFacts } from "./fact-store.js";
import { runRetentionCleanup } from "./retention.js";
import { cleanExpiredDocuments } from "./pii-vault.js";

// ─── Job registry ───
const jobs = new Map();
const intervals = new Map();

export function registerJob(name, fn, intervalMs, options = {}) {
  jobs.set(name, {
    name,
    fn,
    intervalMs,
    lastRun: null,
    lastResult: null,
    runCount: 0,
    enabled: options.enabled !== false,
    runOnStartup: options.runOnStartup || false,
  });
}

// ─── Start all registered jobs ───
export function startAllJobs() {
  for (const [name, job] of jobs) {
    if (!job.enabled) continue;

    if (job.runOnStartup) {
      runJob(name).catch((err) => console.error(`[BATCH] Startup run of ${name} failed:`, err.message));
    }

    const intervalId = setInterval(() => {
      runJob(name).catch((err) => console.error(`[BATCH] ${name} failed:`, err.message));
    }, job.intervalMs);

    intervals.set(name, intervalId);
    console.log(`[BATCH] Scheduled: ${name} (every ${formatInterval(job.intervalMs)})`);
  }
}

// ─── Stop all jobs ───
export function stopAllJobs() {
  for (const [name, intervalId] of intervals) {
    clearInterval(intervalId);
    console.log(`[BATCH] Stopped: ${name}`);
  }
  intervals.clear();
}

// ─── Run a single job ───
async function runJob(name) {
  const job = jobs.get(name);
  if (!job) return;

  const startTime = Date.now();
  try {
    const result = await job.fn();
    job.lastRun = new Date().toISOString();
    job.lastResult = { success: true, result, durationMs: Date.now() - startTime };
    job.runCount++;

    if (result && (result.deleted || result.expired || result.changed)) {
      console.log(`[BATCH] ${name}: completed in ${Date.now() - startTime}ms`, JSON.stringify(result));
    }
  } catch (err) {
    job.lastRun = new Date().toISOString();
    job.lastResult = { success: false, error: err.message, durationMs: Date.now() - startTime };
    job.runCount++;
    throw err;
  }
}

// ─── Register standard jobs ───
export function registerStandardJobs({ db, piiVault, factStmts, piiStmts, monitorStmts, retentionMode }) {
  // Hourly: expire old facts
  if (factStmts) {
    registerJob("expire_facts", () => expireOldFacts(factStmts), 60 * 60 * 1000, { runOnStartup: true });
  }

  // Every 6 hours: clean expired documents
  if (piiStmts) {
    registerJob("clean_documents", () => cleanExpiredDocuments(piiStmts), 6 * 60 * 60 * 1000, { runOnStartup: true });
  }

  // Daily: retention cleanup
  if (db) {
    registerJob("retention_cleanup", () => {
      const piiDb = piiVault?.db || null;
      return runRetentionCleanup(db, piiDb, retentionMode || "consumer");
    }, 24 * 60 * 60 * 1000, { runOnStartup: true });
  }

  // Daily: domain monitoring (02:00 UTC is handled by caller scheduling)
  if (monitorStmts) {
    registerJob("domain_monitor", async () => {
      const { runDailyMonitor } = await import("./domain-monitor.js");
      return runDailyMonitor(monitorStmts, { batchSize: 200, delayMs: 1000 });
    }, 24 * 60 * 60 * 1000, { enabled: false }); // Disabled by default; enable via config
  }
}

// ─── Get job status ───
export function getJobStatus() {
  const status = {};
  for (const [name, job] of jobs) {
    status[name] = {
      enabled: job.enabled,
      intervalMs: job.intervalMs,
      interval: formatInterval(job.intervalMs),
      lastRun: job.lastRun,
      lastResult: job.lastResult,
      runCount: job.runCount,
    };
  }
  return status;
}

function formatInterval(ms) {
  if (ms >= 24 * 60 * 60 * 1000) return `${ms / (24 * 60 * 60 * 1000)}d`;
  if (ms >= 60 * 60 * 1000) return `${ms / (60 * 60 * 1000)}h`;
  if (ms >= 60 * 1000) return `${ms / (60 * 1000)}m`;
  return `${ms / 1000}s`;
}

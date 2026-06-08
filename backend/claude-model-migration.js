// ═══════════════════════════════════════════════════════════════════════
// CLAUDE MODEL MIGRATION — auto-rewrite stored model IDs per student.
// ═══════════════════════════════════════════════════════════════════════
// When Anthropic ships a newer Opus / Sonnet / Haiku, retired model IDs
// stored against a student's BYOK row get silently upgraded to the current
// recommended target. Source of truth: the /claude-api skill model table.
//
// Current targets (per the /claude-api skill, cached 2026-04-29):
//   Opus   → claude-opus-4-7
//   Sonnet → claude-sonnet-4-6
//   Haiku  → claude-haiku-4-5
//
// When Anthropic releases a newer Claude model, update CURRENT_TARGETS
// below — every existing student row will migrate to the new ID on the
// next server boot and on the next /api/students/apikey GET.
//
// Other providers (OpenAI, Google, etc.) are untouched — the user owns
// those migrations.
// ═══════════════════════════════════════════════════════════════════════

// Mutable so the daily Anthropic Models API refresh can update it in place.
// Other modules that import this object see live changes (ES module bindings).
// Initial values are the latest known targets per the /claude-api skill
// (cached 2026-04-29); refreshClaudeTargetsFromAnthropic() overrides at boot
// and every 24h.
export const CURRENT_TARGETS = {
  opus:   "claude-opus-4-7",
  sonnet: "claude-sonnet-4-6",
  haiku:  "claude-haiku-4-5",
};

// Tier price (USD per 1M tokens) — used by the budget tracker.
// Mutable so the live refresh can mirror pricing for newly-discovered IDs.
// Manual updates here remain the right move when a new family changes
// pricing — the auto-mirror just copies from the closest same-family entry.
export const CLAUDE_PRICING_USD_PER_MTOK = ({
  "claude-opus-4-7":            { input: 5.00, output: 25.00 },
  "claude-opus-4-6":            { input: 5.00, output: 25.00 },
  "claude-sonnet-4-6":          { input: 3.00, output: 15.00 },
  "claude-haiku-4-5":           { input: 1.00, output:  5.00 },
  "claude-haiku-4-5-20251001":  { input: 1.00, output:  5.00 },
});  // intentionally NOT Object.freeze — see comment above

// Match retired / older Claude model IDs to a tier so we can map them
// to the current target. Conservative — only matches strings that we
// know to be Claude (avoids accidentally rewriting an OpenAI/Gemini ID
// that happens to be set on an `anthropic` row from a misconfigured key).
function classifyClaudeModel(id) {
  if (!id || typeof id !== "string") return null;
  const s = id.toLowerCase();
  if (!s.startsWith("claude-")) return null;
  if (/\bopus\b/.test(s))   return "opus";
  if (/\bsonnet\b/.test(s)) return "sonnet";
  if (/\bhaiku\b/.test(s))  return "haiku";
  return null;
}

// Decide what a given stored model ID should become.
//   - Returns null if the ID is already current (or not Claude).
//   - Returns the new ID if a migration applies.
export function resolveMigrationTarget(storedId, tier /* "small" | "medium" | "large" */) {
  // The student's three tiers map to Anthropic recommended models:
  //   small  → haiku    (routing / OCR / classification)
  //   medium → sonnet   (synthesis / coaching)
  //   large  → opus     (essay critique / hard reasoning)
  const tierTargetKey = tier === "small" ? "haiku" : tier === "large" ? "opus" : "sonnet";
  const tierTarget = CURRENT_TARGETS[tierTargetKey];

  // If the stored ID isn't Claude, leave it (could be an OpenAI-compat
  // key incorrectly tagged provider=anthropic; safer to skip).
  const cls = classifyClaudeModel(storedId);
  if (!cls) return null;

  // If it's already the current target for that tier, no change.
  if (storedId === tierTarget) return null;

  // If the stored ID's family matches the tier, upgrade to the tier
  // target (e.g. "claude-3-5-haiku-20241022" on small → "claude-haiku-4-5").
  if (cls === tierTargetKey) return tierTarget;

  // Mismatched family (e.g. someone pinned Opus 4.1 to the "small" tier).
  // We respect the user's family choice and just upgrade within it.
  return CURRENT_TARGETS[cls];
}

// Sweep every anthropic student row and rewrite stale model IDs.
// Returns a summary { scanned, migrated, changes:[{studentId, tier, from, to}] }
export function migrateAllStudentClaudeModels(piiVault) {
  if (!piiVault?.db) return { scanned: 0, migrated: 0, changes: [] };
  const rows = piiVault.db
    .prepare(`
      SELECT student_id, provider,
             default_small_model, default_medium_model, default_large_model
      FROM student_api_keys
      WHERE provider = 'anthropic' OR provider IS NULL
    `)
    .all();

  const update = piiVault.db.prepare(`
    UPDATE student_api_keys
    SET default_small_model  = COALESCE(?, default_small_model),
        default_medium_model = COALESCE(?, default_medium_model),
        default_large_model  = COALESCE(?, default_large_model),
        updated_at = datetime('now')
    WHERE student_id = ?
  `);

  const changes = [];
  let migratedRows = 0;

  for (const row of rows) {
    const newSmall  = resolveMigrationTarget(row.default_small_model,  "small");
    const newMedium = resolveMigrationTarget(row.default_medium_model, "medium");
    const newLarge  = resolveMigrationTarget(row.default_large_model,  "large");

    if (newSmall || newMedium || newLarge) {
      update.run(newSmall, newMedium, newLarge, row.student_id);
      migratedRows++;
      if (newSmall)  changes.push({ studentId: row.student_id, tier: "small",  from: row.default_small_model,  to: newSmall  });
      if (newMedium) changes.push({ studentId: row.student_id, tier: "medium", from: row.default_medium_model, to: newMedium });
      if (newLarge)  changes.push({ studentId: row.student_id, tier: "large",  from: row.default_large_model,  to: newLarge  });
    }
  }

  return { scanned: rows.length, migrated: migratedRows, changes };
}

// Per-student migration — called from /api/students/apikey GET so a
// returning student picks up the new defaults the moment they hit the
// app, even if they were offline during the boot sweep.
export function migrateOneStudentClaudeModels(piiVault, studentId) {
  if (!piiVault?.db || !studentId) return { migrated: false, changes: [] };
  const row = piiVault.db
    .prepare(`
      SELECT provider, default_small_model, default_medium_model, default_large_model
      FROM student_api_keys WHERE student_id = ?
    `)
    .get(studentId);
  if (!row || (row.provider && row.provider !== "anthropic")) {
    return { migrated: false, changes: [] };
  }
  const newSmall  = resolveMigrationTarget(row.default_small_model,  "small");
  const newMedium = resolveMigrationTarget(row.default_medium_model, "medium");
  const newLarge  = resolveMigrationTarget(row.default_large_model,  "large");
  if (!newSmall && !newMedium && !newLarge) return { migrated: false, changes: [] };
  piiVault.db
    .prepare(`
      UPDATE student_api_keys
      SET default_small_model  = COALESCE(?, default_small_model),
          default_medium_model = COALESCE(?, default_medium_model),
          default_large_model  = COALESCE(?, default_large_model),
          updated_at = datetime('now')
      WHERE student_id = ?
    `)
    .run(newSmall, newMedium, newLarge, studentId);
  const changes = [];
  if (newSmall)  changes.push({ tier: "small",  from: row.default_small_model,  to: newSmall  });
  if (newMedium) changes.push({ tier: "medium", from: row.default_medium_model, to: newMedium });
  if (newLarge)  changes.push({ tier: "large",  from: row.default_large_model,  to: newLarge  });
  return { migrated: true, changes };
}

// ═══════════════════════════════════════════════════════════════════════
// BUDGET TRACKING & AUTO-CUTOFF
// ═══════════════════════════════════════════════════════════════════════
// One row per student in student_api_keys holds the user-defined monthly
// USD cap (`monthly_budget_usd`). Token usage already lives in
// api_usage_log; the helper below converts tokens → USD using
// CLAUDE_PRICING_USD_PER_MTOK and compares to the cap.
//
// Behavior:
//   - Default budget = 0 → unlimited (key never auto-cuts off).
//   - Set a positive cap → /api/llm and /api/anthropic refuse with 402
//     once month-to-date spend exceeds the cap.
//   - First of the month resets naturally (we compute against a rolling
//     30-day window via the existing api_usage_log index).

export function ensureBudgetColumn(piiVault) {
  if (!piiVault?.db) return;
  const cols = piiVault.db.prepare(`PRAGMA table_info(student_api_keys)`).all().map(r => r.name);
  if (!cols.includes("monthly_budget_usd")) {
    piiVault.db.exec(`ALTER TABLE student_api_keys ADD COLUMN monthly_budget_usd REAL DEFAULT 0`);
  }
}

export function getStudentBudget(piiVault, studentId) {
  if (!piiVault?.db || !studentId) return 0;
  const row = piiVault.db
    .prepare(`SELECT monthly_budget_usd FROM student_api_keys WHERE student_id = ?`)
    .get(studentId);
  return row?.monthly_budget_usd != null ? Number(row.monthly_budget_usd) : 0;
}

export function setStudentBudget(piiVault, studentId, monthlyBudgetUsd) {
  if (!piiVault?.db || !studentId) return false;
  const n = Number(monthlyBudgetUsd);
  if (!Number.isFinite(n) || n < 0) return false;
  const result = piiVault.db
    .prepare(`
      UPDATE student_api_keys
      SET monthly_budget_usd = ?, updated_at = datetime('now')
      WHERE student_id = ?
    `)
    .run(n, studentId);
  return result.changes > 0;
}

// Walk api_usage_log over the last 30 days and tally USD using the
// per-model price map. Unknown models contribute $0 (not Anthropic →
// not our budget to enforce).
export function getMonthlySpendUsd(ragStmts, studentId) {
  if (!ragStmts?.getUsageHistoryByModel) return 0;
  const rows = ragStmts.getUsageHistoryByModel.all(studentId);
  let total = 0;
  for (const r of rows) {
    // Strip optional "provider:" prefix that the LLM router writes.
    const model = String(r.model || "").replace(/^[^:]+:/, "");
    const price = CLAUDE_PRICING_USD_PER_MTOK[model];
    if (!price) continue;
    total += (Number(r.input_total)  || 0) / 1_000_000 * price.input;
    total += (Number(r.output_total) || 0) / 1_000_000 * price.output;
  }
  return Math.round(total * 1_000_000) / 1_000_000; // 6-decimal precision
}

// ═══════════════════════════════════════════════════════════════════════
// LIVE TARGET REFRESH — pull the latest Claude IDs from Anthropic.
// ═══════════════════════════════════════════════════════════════════════
// Calls Anthropic's /v1/models endpoint, classifies each model into a
// tier (opus / sonnet / haiku), and picks the latest of each. Updates
// CURRENT_TARGETS in place and writes a JSON cache so restarts inherit
// the last-known-good targets even if Anthropic is unreachable at boot.
//
// Pricing for newly-discovered IDs is auto-mirrored from the closest
// existing entry in CLAUDE_PRICING_USD_PER_MTOK (per the /claude-api
// skill, intra-family pricing stays stable across point releases —
// e.g. Opus 4.6 and 4.7 are both $5/$25). When that doesn't hold,
// update CLAUDE_PRICING_USD_PER_MTOK by hand.

import fs from "node:fs";
import path from "node:path";

const TARGETS_CACHE_FILE = path.join(process.cwd(), "data", "claude-targets-cache.json");

// Pick the "best" candidate per family — prefer bare alias over dated
// snapshot (e.g. `claude-opus-4-7` over `claude-opus-4-7-20251101`),
// then sort by created_at desc, then by ID desc as a tiebreaker.
function pickLatestFromFamily(candidates) {
  if (!candidates.length) return null;
  const bare = candidates.filter(m => !/-20\d{6}$/.test(m.id));
  const pool = bare.length ? bare : candidates;
  pool.sort((a, b) => {
    const aT = a.created_at || "";
    const bT = b.created_at || "";
    if (aT && bT && aT !== bT) return bT.localeCompare(aT);
    return b.id.localeCompare(a.id);
  });
  return pool[0].id;
}

function classifyFamily(id) {
  const s = String(id || "").toLowerCase();
  if (!s.startsWith("claude-")) return null;
  if (/\bopus\b/.test(s))   return "opus";
  if (/\bsonnet\b/.test(s)) return "sonnet";
  if (/\bhaiku\b/.test(s))  return "haiku";
  return null;
}

// Live-fetch from Anthropic. Returns { opus, sonnet, haiku } or throws.
export async function fetchLatestClaudeTargetsFromAnthropic(apiKey) {
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY required for live target refresh");
  const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic /v1/models returned ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const families = { opus: [], sonnet: [], haiku: [] };
  for (const m of data.data || []) {
    const fam = classifyFamily(m.id);
    if (fam) families[fam].push(m);
  }
  return {
    opus:   pickLatestFromFamily(families.opus)   || CURRENT_TARGETS.opus,
    sonnet: pickLatestFromFamily(families.sonnet) || CURRENT_TARGETS.sonnet,
    haiku:  pickLatestFromFamily(families.haiku)  || CURRENT_TARGETS.haiku,
  };
}

// Read the cached targets from disk (fast — used at boot before the
// network refresh completes). Returns null if no cache exists.
export function loadCachedTargets() {
  try {
    if (!fs.existsSync(TARGETS_CACHE_FILE)) return null;
    const raw = fs.readFileSync(TARGETS_CACHE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && parsed.targets && parsed.targets.opus && parsed.targets.sonnet && parsed.targets.haiku) {
      return parsed.targets;
    }
  } catch (err) {
    console.warn("[CLAUDE-MIGRATE] Failed to read cached targets:", err.message);
  }
  return null;
}

function saveCachedTargets(targets) {
  try {
    fs.mkdirSync(path.dirname(TARGETS_CACHE_FILE), { recursive: true });
    fs.writeFileSync(TARGETS_CACHE_FILE, JSON.stringify({
      targets,
      updatedAt: new Date().toISOString(),
    }, null, 2));
  } catch (err) {
    console.warn("[CLAUDE-MIGRATE] Failed to persist cached targets:", err.message);
  }
}

// Mirror pricing for a new ID from the nearest known entry in the same
// family. Conservative: if the new ID's family has no pricing entry,
// log a warning and leave CLAUDE_PRICING_USD_PER_MTOK unchanged so the
// budget tracker stays honest (over-counting is safer than under).
function ensurePricingFor(newId) {
  if (CLAUDE_PRICING_USD_PER_MTOK[newId]) return;
  const fam = classifyFamily(newId);
  if (!fam) return;
  // Find any existing entry in the same family
  const existing = Object.entries(CLAUDE_PRICING_USD_PER_MTOK)
    .find(([id]) => classifyFamily(id) === fam);
  if (existing) {
    CLAUDE_PRICING_USD_PER_MTOK[newId] = { ...existing[1] };
    console.log(`[CLAUDE-MIGRATE] Mirrored pricing for new model ${newId} from ${existing[0]} ($${existing[1].input}/$${existing[1].output} per Mtok)`);
  } else {
    console.warn(`[CLAUDE-MIGRATE] No pricing reference for ${newId}; budget tracking will undercount until you add it to CLAUDE_PRICING_USD_PER_MTOK`);
  }
}

// Apply a target map IN PLACE to CURRENT_TARGETS — ES module bindings
// mean importers see the new values without re-importing.
export function applyTargets(newTargets) {
  const changes = [];
  for (const tier of ["opus", "sonnet", "haiku"]) {
    if (newTargets[tier] && newTargets[tier] !== CURRENT_TARGETS[tier]) {
      changes.push({ tier, from: CURRENT_TARGETS[tier], to: newTargets[tier] });
      CURRENT_TARGETS[tier] = newTargets[tier];
      ensurePricingFor(newTargets[tier]);
    }
  }
  return changes;
}

// Boot helper: prefer cached values (fast), then async-refresh from
// Anthropic in the background. Returns the targets that were applied
// synchronously (cached or default).
export function loadCachedTargetsIntoMemory() {
  const cached = loadCachedTargets();
  if (cached) {
    const changes = applyTargets(cached);
    if (changes.length) {
      console.log(`[CLAUDE-MIGRATE] Loaded cached targets: ${changes.map(c => `${c.tier} ${c.from}→${c.to}`).join(", ")}`);
    }
  }
  return { ...CURRENT_TARGETS };
}

// Full refresh cycle: pull live → diff → apply → persist → migrate every
// student. Called on boot (after the cached load) and on a 24h timer.
// Returns { refreshed: bool, changes: [{tier,from,to}], migrated: int }
export async function refreshClaudeTargetsAndMigrate(piiVault, apiKey) {
  if (!apiKey) {
    return { refreshed: false, reason: "no_api_key", changes: [], migrated: 0 };
  }
  let latest;
  try {
    latest = await fetchLatestClaudeTargetsFromAnthropic(apiKey);
  } catch (err) {
    console.warn("[CLAUDE-MIGRATE] Live refresh failed:", err.message);
    return { refreshed: false, reason: "fetch_failed", error: err.message, changes: [], migrated: 0 };
  }
  const changes = applyTargets(latest);
  if (changes.length) {
    saveCachedTargets({ ...CURRENT_TARGETS });
    console.log(`[CLAUDE-MIGRATE] Live targets updated: ${changes.map(c => `${c.tier} ${c.from}→${c.to}`).join(", ")}`);
    // Migrate every student to the new targets now that they're live.
    const sweep = migrateAllStudentClaudeModels(piiVault);
    return { refreshed: true, changes, migrated: sweep.migrated, scanned: sweep.scanned };
  } else {
    // Still persist so the cache mtime reflects "checked recently"
    saveCachedTargets({ ...CURRENT_TARGETS });
    return { refreshed: true, changes: [], migrated: 0 };
  }
}

// Hard gate — call before any LLM dispatch. Returns:
//   { allowed: true } when under cap (or cap == 0 = unlimited)
//   { allowed: false, spend, cap, reason } when over
export function checkBudget(piiVault, ragStmts, studentId) {
  if (!studentId) return { allowed: true };
  const cap = getStudentBudget(piiVault, studentId);
  if (!cap || cap <= 0) return { allowed: true, cap: 0 };
  const spend = getMonthlySpendUsd(ragStmts, studentId);
  if (spend >= cap) {
    return {
      allowed: false,
      spend,
      cap,
      reason: `Monthly spend $${spend.toFixed(4)} has reached your cap of $${cap.toFixed(2)}.`,
    };
  }
  return { allowed: true, spend, cap };
}

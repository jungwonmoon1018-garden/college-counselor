// ═══════════════════════════════════════════════════════════════════════
// USAGE BUDGET — per-student monthly USD cap + auto-cutoff
// ═══════════════════════════════════════════════════════════════════════
// One row per student in student_api_keys holds the user-defined monthly USD
// cap (`monthly_budget_usd`). Token usage lives in api_usage_log; the helper
// below converts tokens → USD using live OpenRouter pricing and compares to
// the cap.
//
// Behavior:
//   - Default budget = 0 → unlimited (key never auto-cuts off).
//   - Positive cap → /api/chat and /api/llm refuse with 402 once
//     month-to-date spend exceeds the cap.
//   - Rolling 30-day window via the existing api_usage_log index.
//
// Pricing source: OpenRouter's live /api/v1/models catalog (per-token prompt
// and completion prices), exposed by openrouter-model-refresh.js. Models not
// found in the catalog contribute $0 (undercount is safer than blocking).
// ═══════════════════════════════════════════════════════════════════════

import { getOpenRouterPricingUSDPerMTok } from "./openrouter-model-refresh.js";

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

// Walk api_usage_log over the last 30 days and tally USD using live OpenRouter
// per-model pricing. The router writes models as "provider:model" — strip the
// prefix before the price lookup. Unknown models contribute $0.
export function getMonthlySpendUsd(ragStmts, studentId) {
  if (!ragStmts?.getUsageHistoryByModel) return 0;
  const rows = ragStmts.getUsageHistoryByModel.all(studentId);
  let total = 0;
  for (const r of rows) {
    const model = String(r.model || "").replace(/^[^:]+:/, "");
    const price = getOpenRouterPricingUSDPerMTok(model);
    if (!price) continue;
    total += (Number(r.input_total)  || 0) / 1_000_000 * price.input;
    total += (Number(r.output_total) || 0) / 1_000_000 * price.output;
  }
  return Math.round(total * 1_000_000) / 1_000_000; // 6-decimal precision
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

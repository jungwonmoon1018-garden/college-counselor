// Calendar-month cost reservations for OpenRouter calls.

import crypto from "node:crypto";
import { getOpenRouterPricingUSDPerMTok } from "./openrouter-model-refresh.js";

export const MONTHLY_CAPS_USD = Object.freeze({
  9: 10,
  10: 10,
  11: 10,
  12: 15,
});

function normalizeGrade(grade) {
  const match = String(grade ?? "").match(/\d{1,2}/);
  const value = match ? Number(match[0]) : NaN;
  return Object.hasOwn(MONTHLY_CAPS_USD, value) ? value : null;
}

export function monthlyCapForGrade(grade) {
  const normalized = normalizeGrade(grade);
  return normalized ? MONTHLY_CAPS_USD[normalized] : null;
}

export function calendarMonthKey(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return year + "-" + month;
}

function modelIdForPricing(model) {
  return String(model || "").replace(/^openrouter:/, "");
}

function normalizedPricing(model, pricingLookup) {
  const pricing = pricingLookup(modelIdForPricing(model));
  if (!pricing) return null;
  const input = Number(pricing.input);
  const output = Number(pricing.output);
  if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) return null;
  return { input, output };
}

function costForTokens(tokensIn, tokensOut, pricing) {
  const value =
    Math.max(0, Number(tokensIn) || 0) / 1_000_000 * pricing.input +
    Math.max(0, Number(tokensOut) || 0) / 1_000_000 * pricing.output;
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function estimateRequestCost({
  model,
  maxInputTokens,
  maxOutputTokens,
  pricingLookup = getOpenRouterPricingUSDPerMTok,
} = {}) {
  const pricing = normalizedPricing(model, pricingLookup);
  if (!pricing) {
    return {
      ok: false,
      code: "unknown_model_pricing",
      reason: "The selected model has no verified price and cannot be used.",
    };
  }
  const inputTokens = Math.max(0, Number(maxInputTokens) || 0);
  const outputTokens = Math.max(0, Number(maxOutputTokens) || 0);
  if (inputTokens === 0 && outputTokens === 0) {
    return { ok: false, code: "invalid_token_limit", reason: "A positive token limit is required." };
  }
  return {
    ok: true,
    model: modelIdForPricing(model),
    maxInputTokens: inputTokens,
    maxOutputTokens: outputTokens,
    pricing,
    estimatedCostUsd: costForTokens(inputTokens, outputTokens, pricing),
  };
}

export function initUsageBudget(db) {
  db.exec([
    "CREATE TABLE IF NOT EXISTS usage_budget_reservations (",
    " id TEXT PRIMARY KEY,",
    " request_id TEXT NOT NULL UNIQUE,",
    " student_id TEXT NOT NULL,",
    " period TEXT NOT NULL,",
    " grade INTEGER NOT NULL CHECK (grade BETWEEN 9 AND 12),",
    " model TEXT NOT NULL,",
    " max_input_tokens INTEGER NOT NULL,",
    " max_output_tokens INTEGER NOT NULL,",
    " input_price_per_mtok REAL NOT NULL,",
    " output_price_per_mtok REAL NOT NULL,",
    " reserved_usd REAL NOT NULL,",
    " actual_usd REAL,",
    " actual_input_tokens INTEGER,",
    " actual_output_tokens INTEGER,",
    " status TEXT NOT NULL CHECK (status IN ('reserved', 'reconciled', 'released')),",
    " created_at TEXT NOT NULL,",
    " reconciled_at TEXT",
    ");",
    "CREATE INDEX IF NOT EXISTS idx_budget_student_period",
    " ON usage_budget_reservations(student_id, period, status);",
  ].join("\n"));
}

function rowCharge(row) {
  if (row.status === "reserved") return Number(row.reserved_usd) || 0;
  if (row.status === "reconciled") return Number(row.actual_usd) || 0;
  return 0;
}

export function getBudgetStatus(db, { studentId, grade, now = new Date() } = {}) {
  const cap = monthlyCapForGrade(grade);
  if (!studentId) return { allowed: false, code: "student_required" };
  if (cap == null) return { allowed: false, code: "grade_required", reason: "Grade 9-12 is required before paid calls." };
  const period = calendarMonthKey(now);
  const rows = db.prepare([
    "SELECT status, reserved_usd, actual_usd FROM usage_budget_reservations",
    "WHERE student_id = ? AND period = ?",
  ].join("\n")).all(studentId, period);
  const committedUsd = Math.round(rows.reduce((sum, row) => sum + rowCharge(row), 0) * 1_000_000) / 1_000_000;
  return {
    allowed: committedUsd < cap,
    period,
    grade: normalizeGrade(grade),
    capUsd: cap,
    committedUsd,
    remainingUsd: Math.max(0, Math.round((cap - committedUsd) * 1_000_000) / 1_000_000),
  };
}

export function reserveBudget(db, {
  studentId,
  grade,
  requestId,
  model,
  maxInputTokens,
  maxOutputTokens,
  now = new Date(),
  pricingLookup = getOpenRouterPricingUSDPerMTok,
} = {}) {
  if (!studentId || !requestId) {
    return { allowed: false, code: "identity_required", reason: "Student and request IDs are required." };
  }
  const estimate = estimateRequestCost({ model, maxInputTokens, maxOutputTokens, pricingLookup });
  if (!estimate.ok) return { allowed: false, ...estimate };
  const gradeNumber = normalizeGrade(grade);
  const cap = monthlyCapForGrade(gradeNumber);
  if (cap == null) {
    return { allowed: false, code: "grade_required", reason: "Grade 9-12 is required before paid calls." };
  }
  const period = calendarMonthKey(now);
  const createdAt = now.toISOString();

  const tx = db.transaction(() => {
    const existing = db.prepare("SELECT * FROM usage_budget_reservations WHERE request_id = ?").get(requestId);
    if (existing) {
      if (existing.student_id !== studentId) {
        return { allowed: false, code: "request_id_conflict" };
      }
      return {
        allowed: existing.status !== "released",
        idempotent: true,
        reservationId: existing.id,
        reservedUsd: Number(existing.reserved_usd),
        capUsd: cap,
        period,
      };
    }

    const status = getBudgetStatus(db, { studentId, grade: gradeNumber, now });
    const afterReservation = status.committedUsd + estimate.estimatedCostUsd;
    if (afterReservation > cap + Number.EPSILON) {
      return {
        allowed: false,
        code: "monthly_cap_exceeded",
        capUsd: cap,
        committedUsd: status.committedUsd,
        requestedUsd: estimate.estimatedCostUsd,
        remainingUsd: status.remainingUsd,
        period,
      };
    }

    const reservationId = crypto.randomUUID();
    db.prepare([
      "INSERT INTO usage_budget_reservations (",
      " id, request_id, student_id, period, grade, model, max_input_tokens, max_output_tokens,",
      " input_price_per_mtok, output_price_per_mtok, reserved_usd, status, created_at",
      ") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ].join("\n")).run(
      reservationId,
      requestId,
      studentId,
      period,
      gradeNumber,
      estimate.model,
      estimate.maxInputTokens,
      estimate.maxOutputTokens,
      estimate.pricing.input,
      estimate.pricing.output,
      estimate.estimatedCostUsd,
      "reserved",
      createdAt,
    );
    return {
      allowed: true,
      reservationId,
      requestId,
      period,
      grade: gradeNumber,
      capUsd: cap,
      reservedUsd: estimate.estimatedCostUsd,
      committedUsd: Math.round(afterReservation * 1_000_000) / 1_000_000,
      remainingUsd: Math.max(0, Math.round((cap - afterReservation) * 1_000_000) / 1_000_000),
    };
  });
  return tx.immediate();
}

export function reconcileBudget(db, {
  reservationId,
  inputTokens = 0,
  outputTokens = 0,
  now = new Date(),
} = {}) {
  if (!reservationId) return { ok: false, code: "reservation_required" };
  const tx = db.transaction(() => {
    const row = db.prepare("SELECT * FROM usage_budget_reservations WHERE id = ?").get(reservationId);
    if (!row) return { ok: false, code: "reservation_not_found" };
    if (row.status === "released") return { ok: false, code: "reservation_released" };
    if (row.status === "reconciled") {
      return { ok: true, idempotent: true, actualUsd: Number(row.actual_usd), reservationId };
    }
    const actualInput = Math.max(0, Number(inputTokens) || 0);
    const actualOutput = Math.max(0, Number(outputTokens) || 0);
    const actualUsd = costForTokens(actualInput, actualOutput, {
      input: Number(row.input_price_per_mtok),
      output: Number(row.output_price_per_mtok),
    });
    db.prepare([
      "UPDATE usage_budget_reservations SET status = 'reconciled', actual_usd = ?,",
      " actual_input_tokens = ?, actual_output_tokens = ?, reconciled_at = ? WHERE id = ? AND status = 'reserved'",
    ].join("\n")).run(actualUsd, actualInput, actualOutput, now.toISOString(), reservationId);
    return {
      ok: true,
      reservationId,
      reservedUsd: Number(row.reserved_usd),
      actualUsd,
      releasedUsd: Math.max(0, Math.round((Number(row.reserved_usd) - actualUsd) * 1_000_000) / 1_000_000),
      overrun: actualUsd > Number(row.reserved_usd),
    };
  });
  return tx.immediate();
}

export function releaseBudget(db, { reservationId, now = new Date() } = {}) {
  if (!reservationId) return { ok: false, code: "reservation_required" };
  const result = db.prepare([
    "UPDATE usage_budget_reservations SET status = 'released', reconciled_at = ?",
    "WHERE id = ? AND status = 'reserved'",
  ].join("\n")).run(now.toISOString(), reservationId);
  return { ok: result.changes === 1, reservationId };
}

// Compatibility helpers retained while server routes migrate to the ledger.
export function ensureBudgetColumn(piiVault) {
  if (!piiVault?.db) return;
  const table = piiVault.db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'student_api_keys'"
  ).get();
  if (!table) return;
  const columns = piiVault.db.prepare("PRAGMA table_info(student_api_keys)").all().map((row) => row.name);
  if (!columns.includes("monthly_budget_usd")) {
    piiVault.db.exec("ALTER TABLE student_api_keys ADD COLUMN monthly_budget_usd REAL DEFAULT 0");
  }
}

export function getStudentBudget(piiVault, studentId) {
  if (!piiVault?.db || !studentId) return 0;
  const table = piiVault.db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'student_api_keys'"
  ).get();
  if (!table) return 0;
  const row = piiVault.db.prepare(
    "SELECT monthly_budget_usd FROM student_api_keys WHERE student_id = ?"
  ).get(studentId);
  return Number(row?.monthly_budget_usd) || 0;
}

export function setStudentBudget(piiVault, studentId, monthlyBudgetUsd) {
  if (!piiVault?.db || !studentId) return false;
  const value = Number(monthlyBudgetUsd);
  if (!Number.isFinite(value) || value < 0) return false;
  const result = piiVault.db.prepare([
    "UPDATE student_api_keys SET monthly_budget_usd = ?, updated_at = datetime('now')",
    "WHERE student_id = ?",
  ].join("\n")).run(value, studentId);
  return result.changes > 0;
}

export function getMonthlySpendUsd(ragStmts, studentId, { allowUnknown = false } = {}) {
  if (!ragStmts?.getUsageHistoryByModel) return 0;
  let total = 0;
  for (const row of ragStmts.getUsageHistoryByModel.all(studentId)) {
    const pricing = normalizedPricing(row.model, getOpenRouterPricingUSDPerMTok);
    if (!pricing) {
      if (allowUnknown) continue;
      throw new Error("Unknown model pricing for " + String(row.model || "(missing model)"));
    }
    total += costForTokens(row.input_total, row.output_total, pricing);
  }
  return Math.round(total * 1_000_000) / 1_000_000;
}

export function checkBudget(piiVault, ragStmts, studentId) {
  const cap = getStudentBudget(piiVault, studentId);
  if (!cap || cap <= 0) {
    return { allowed: false, cap: 0, reason: "Use the grade-based reservation ledger before paid calls." };
  }
  try {
    const spend = getMonthlySpendUsd(ragStmts, studentId);
    return spend >= cap
      ? { allowed: false, spend, cap, reason: "Monthly spend has reached the configured cap." }
      : { allowed: true, spend, cap };
  } catch (error) {
    return { allowed: false, cap, reason: error.message, code: "unknown_model_pricing" };
  }
}

export function recordEmbeddedCall() {
  return false;
}

export function recordCouncilCall() {
  return false;
}

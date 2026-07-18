import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  MONTHLY_CAPS_USD,
  initUsageBudget,
  estimateRequestCost,
  reserveBudget,
  reconcileBudget,
  releaseBudget,
  getBudgetStatus,
} from "../usage-budget.js";

const pricing = () => ({ input: 1, output: 2 });

function ledger() {
  const db = new Database(":memory:");
  initUsageBudget(db);
  return db;
}

describe("usage budget pricing", () => {
  it("fails closed when model pricing is unknown", () => {
    const result = estimateRequestCost({
      model: "unknown/model",
      maxInputTokens: 1000,
      maxOutputTokens: 1000,
      pricingLookup: () => null,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "unknown_model_pricing");
  });

  it("uses fixed grade caps", () => {
    assert.equal(MONTHLY_CAPS_USD[9], 10);
    assert.equal(MONTHLY_CAPS_USD[11], 10);
    assert.equal(MONTHLY_CAPS_USD[12], 15);
  });
});

describe("usage reservations", () => {
  it("reserves worst-case cost and rejects a request beyond the cap", () => {
    const db = ledger();
    for (let index = 0; index < 3; index++) {
      const result = reserveBudget(db, {
        studentId: "student",
        grade: 9,
        requestId: "request-" + index,
        model: "priced/model",
        maxInputTokens: 1_000_000,
        maxOutputTokens: 1_000_000,
        pricingLookup: pricing,
      });
      assert.equal(result.allowed, true);
      assert.equal(result.reservedUsd, 3);
    }
    const denied = reserveBudget(db, {
      studentId: "student",
      grade: 9,
      requestId: "request-over",
      model: "priced/model",
      maxInputTokens: 1_000_000,
      maxOutputTokens: 1_000_000,
      pricingLookup: pricing,
    });
    assert.equal(denied.allowed, false);
    assert.equal(denied.code, "monthly_cap_exceeded");
    db.close();
  });

  it("reconciles actual tokens and releases unused reservation", () => {
    const db = ledger();
    const reservation = reserveBudget(db, {
      studentId: "student",
      grade: 12,
      requestId: "request",
      model: "priced/model",
      maxInputTokens: 1_000_000,
      maxOutputTokens: 1_000_000,
      pricingLookup: pricing,
    });
    const result = reconcileBudget(db, {
      reservationId: reservation.reservationId,
      inputTokens: 100_000,
      outputTokens: 100_000,
    });
    assert.equal(result.ok, true);
    assert.equal(result.actualUsd, 0.3);
    assert.equal(result.releasedUsd, 2.7);
    assert.equal(getBudgetStatus(db, { studentId: "student", grade: 12 }).committedUsd, 0.3);
    db.close();
  });

  it("is idempotent by request ID and can release failed calls", () => {
    const db = ledger();
    const input = {
      studentId: "student",
      grade: 10,
      requestId: "same-request",
      model: "priced/model",
      maxInputTokens: 1000,
      maxOutputTokens: 1000,
      pricingLookup: pricing,
    };
    const first = reserveBudget(db, input);
    const second = reserveBudget(db, input);
    assert.equal(second.idempotent, true);
    assert.equal(second.reservationId, first.reservationId);
    assert.equal(releaseBudget(db, { reservationId: first.reservationId }).ok, true);
    assert.equal(getBudgetStatus(db, { studentId: "student", grade: 10 }).committedUsd, 0);
    db.close();
  });

  it("resets on the first day of each local calendar month", () => {
    const db = ledger();
    reserveBudget(db, {
      studentId: "student",
      grade: 9,
      requestId: "january",
      model: "priced/model",
      maxInputTokens: 3_000_000,
      maxOutputTokens: 3_000_000,
      pricingLookup: pricing,
      now: new Date(2026, 0, 31, 23, 59),
    });
    assert.equal(
      getBudgetStatus(db, {
        studentId: "student",
        grade: 9,
        now: new Date(2026, 1, 1, 0, 1),
      }).committedUsd,
      0,
    );
    db.close();
  });

  it("requires a grade before any paid reservation", () => {
    const db = ledger();
    const result = reserveBudget(db, {
      studentId: "student",
      requestId: "no-grade",
      model: "priced/model",
      maxInputTokens: 1000,
      maxOutputTokens: 1000,
      pricingLookup: pricing,
    });
    assert.equal(result.allowed, false);
    assert.equal(result.code, "grade_required");
    db.close();
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  initAdmissionsIntelligenceTables,
  prepareAdmissionsIntelStatements,
  seedOfficialCipMappings,
  resolveIpedsGrowthForMajor,
  resolveMajorPolicyForSchool,
  resolveStrategicFocusForSchool,
  upsertIpedsGrowth,
  upsertMajorPolicy,
  upsertStrategicFocus,
} from "../admissions-intelligence.js";

function makeDb() {
  const db = new Database(":memory:");
  initAdmissionsIntelligenceTables(db);
  seedOfficialCipMappings(db);
  return { db, stmts: prepareAdmissionsIntelStatements(db) };
}

test("seedOfficialCipMappings populates official CIP registry", () => {
  const { db, stmts } = makeDb();
  const csRows = stmts.getCipMajorMapByBucket.all("computer_science");
  assert.ok(csRows.length > 0);
  db.close();
});

test("resolveIpedsGrowthForMajor prefers school-specific official rows", () => {
  const { db, stmts } = makeDb();
  upsertIpedsGrowth(stmts, {
    unitId: "166683",
    cipCode: "11.0701",
    awardLevel: "bachelor",
    yearStart: 2021,
    yearEnd: 2024,
    completionsStart: 120,
    completionsEnd: 180,
    growthRate: 0.5,
    sourceUrl: "https://nces.ed.gov/ipeds",
  });
  const result = resolveIpedsGrowthForMajor(stmts, { unitId: "166683", major: "Computer Science" });
  assert.equal(result.scope, "school");
  assert.equal(result.cipCode, "11.0701");
  assert.equal(result.growthRate, 0.5);
  db.close();
});

test("resolveMajorPolicyForSchool returns normalized official policy", () => {
  const { db, stmts } = makeDb();
  upsertMajorPolicy(stmts, {
    unitId: "166683",
    schoolName: "Example Tech",
    subject: "Computer Science",
    policyType: "direct_admit",
    internalTransferDifficulty: "high",
    capacityExpansionOffset: 0.1,
    sourceUrl: "https://example.edu/catalog/cs",
    sourceDomain: "example.edu",
    sourceTitle: "Catalog",
    sourceExcerpt: "Direct admission required.",
  });
  const result = resolveMajorPolicyForSchool(stmts, {
    unitId: "166683",
    schoolName: "Example Tech",
    major: "Computer Science",
  });
  assert.ok(result);
  assert.equal(result.policyType, "direct_admit");
  assert.equal(result.internalTransferDifficulty, "high");
  db.close();
});

test("resolveStrategicFocusForSchool returns recent official signals", () => {
  const { db, stmts } = makeDb();
  upsertStrategicFocus(stmts, {
    unitId: "166683",
    schoolName: "Example Tech",
    subject: "Computer Science",
    signalType: "new_center",
    signalTitle: "New AI Institute",
    signalSummary: "University launched a new AI institute.",
    evidenceStrength: 0.9,
    recencyScore: 0.85,
    sourceUrl: "https://example.edu/news/ai-institute",
    sourceDomain: "example.edu",
    sourceTitle: "University News",
    publishedAt: "2026-01-10",
  });
  const signals = resolveStrategicFocusForSchool(stmts, { unitId: "166683", major: "Computer Science", limit: 5 });
  assert.equal(signals.length, 1);
  assert.equal(signals[0].signalTitle, "New AI Institute");
  db.close();
});

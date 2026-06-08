import test from "node:test";
import assert from "node:assert/strict";

import {
  parseCsv,
  normalizeIpedsLongRows,
  computeGrowthRows,
} from "../admissions-intelligence-loader.js";

test("parseCsv handles quoted CSV rows", () => {
  const rows = parseCsv('unitid,cipcode,year,completions\n166683,"11.0701",2021,120\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].unitid, 166683);
  assert.equal(rows[0].cipcode, 11.0701);
});

test("normalizeIpedsLongRows maps raw IPEDS-like rows", () => {
  const rows = normalizeIpedsLongRows([
    { unitid: "166683", cipcode: "11.0701", year: 2021, completions: 120, award_level: "Bachelor's" },
    { unitid: "166683", cipcode: "11.0701", year: 2024, completions: 180, award_level: "Bachelor's" },
  ], {
    sourceUrl: "https://nces.ed.gov/ipeds/datacenter/DataFiles.aspx",
    sourceTitle: "IPEDS test",
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].cipCode, "11.0701");
  assert.equal(rows[0].awardLevel, "bachelor");
});

test("computeGrowthRows derives growth rows from long-form data", () => {
  const growth = computeGrowthRows([
    { unitId: "166683", cipCode: "11.0701", awardLevel: "bachelor", year: 2021, completions: 120, sourceUrl: "x", sourceTitle: "y" },
    { unitId: "166683", cipCode: "11.0701", awardLevel: "bachelor", year: 2024, completions: 180, sourceUrl: "x", sourceTitle: "y" },
  ]);
  assert.equal(growth.length, 1);
  assert.equal(growth[0].yearStart, 2021);
  assert.equal(growth[0].yearEnd, 2024);
  assert.equal(growth[0].completionsStart, 120);
  assert.equal(growth[0].completionsEnd, 180);
  assert.equal(growth[0].growthRate, 0.5);
});

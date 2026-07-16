import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareLensValues,
  verifySeasonalRecordV2,
} from '../seasonal-verification-v2.js';

test('seasonal comparator applies deterministic tolerances', () => {
  assert.equal(compareLensValues(0.2, 0.205, 'admit_rate'), 'confirm');
  assert.equal(compareLensValues(0.2, 0.4, 'admit_rate'), 'contradict');
  assert.equal(compareLensValues(1400, 1440, 'sat_25'), 'confirm');
  assert.equal(compareLensValues(1400, 1600, 'sat_25'), 'contradict');
  assert.equal(compareLensValues(1400, null, 'sat_25'), 'unconfirmed');
});

test('official and cached-source disagreement is quarantined without tokens', async () => {
  const result = await verifySeasonalRecordV2({
    slug: 'nonexistent-test-school',
    field: 'admit_rate',
    scraped: 0.2,
    citedRow: { admit_rate: 0.4, scraped_at: new Date().toISOString() },
    scorecardAPI: { getCollegeById: async () => ({ admit_rate: 0.2 }) },
  });
  assert.equal(result.status, 'discrepancy');
  assert.equal(result.adjudication.method, 'deterministic_quarantine');
  assert.deepEqual(result.total_tokens, { input: 0, output: 0 });
});

test('a cached citation alone cannot verify a record', async () => {
  const result = await verifySeasonalRecordV2({
    slug: 'nonexistent-test-school',
    field: 'sat_25',
    scraped: 1400,
    citedRow: { sat_25: 1400, scraped_at: new Date().toISOString() },
    scorecardAPI: { getCollegeById: async () => null },
  });
  assert.equal(result.status, 'unverified');
  assert.equal(result.adjudication, null);
});

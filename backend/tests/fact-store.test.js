import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  initFactStore,
  prepareFactStatements,
  insertFact,
  searchFacts,
  seedCollegeFacts,
} from "../fact-store.js";

function store() {
  const db = new Database(":memory:");
  initFactStore(db);
  return { db, stmts: prepareFactStatements(db) };
}

describe("fact store semantic identity", () => {
  it("upserts one semantic fact instead of adding startup duplicates", () => {
    const { db, stmts } = store();
    const profiles = [{
      unitId: "100",
      name: "Example University",
      acceptance: 20,
      sat25: 1200,
      dataYear: 2024,
    }];
    seedCollegeFacts(stmts, profiles, db);
    seedCollegeFacts(stmts, profiles, db);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM canonical_facts").get().count, 2);
    const row = db.prepare("SELECT * FROM canonical_facts WHERE fact_key = 'acceptance_rate'").get();
    assert.equal(row.confidence, "extracted");
    assert.equal(row.provenance_type, "bundled_baseline");
    assert.equal(row.source_domain, "bundled-baseline.local");
    assert.equal(row.extracted_at, "2024-12-31T00:00:00.000Z");
    db.close();
  });

  it("updates changed values under the same semantic key", () => {
    const { db, stmts } = store();
    const base = {
      topic_type: "deadlines",
      entity_type: "university",
      entity_id: "mit",
      fact_key: "early_action_deadline",
      source_domain: "mitadmissions.org",
      source_url: "https://mitadmissions.org/apply/",
      confidence: "verified",
      expires_at: "2099-01-01T00:00:00.000Z",
    };
    insertFact(stmts, { ...base, fact_value: "November 1" });
    insertFact(stmts, { ...base, fact_value: "November 2" });
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM canonical_facts").get().count, 1);
    assert.equal(db.prepare("SELECT fact_value FROM canonical_facts").get().fact_value, "November 2");
    db.close();
  });
});

describe("fact search", () => {
  it("tokenizes natural questions and treats SQL wildcard input as data", () => {
    const { db, stmts } = store();
    insertFact(stmts, {
      topic_type: "deadlines",
      entity_type: "university",
      entity_id: "mit",
      entity_name: "Massachusetts Institute of Technology",
      fact_key: "early_action_deadline",
      fact_value: "The early action deadline is November 1.",
      source_domain: "mitadmissions.org",
      source_url: "https://mitadmissions.org/apply/",
      confidence: "verified",
      expires_at: "2099-01-01T00:00:00.000Z",
    });
    assert.equal(searchFacts(stmts, "When is the MIT early action deadline?", 10).length, 1);
    assert.deepEqual(searchFacts(stmts, "%_%%", 10), []);
    db.close();
  });

  it("does not retrieve expired facts", () => {
    const { db, stmts } = store();
    insertFact(stmts, {
      topic_type: "fafsa",
      fact_key: "fafsa_eligibility",
      fact_value: "Old eligibility rule",
      source_domain: "studentaid.gov",
      confidence: "verified",
      expires_at: "2000-01-01T00:00:00.000Z",
    });
    assert.deepEqual(searchFacts(stmts, "FAFSA eligibility", 10), []);
    db.close();
  });
});

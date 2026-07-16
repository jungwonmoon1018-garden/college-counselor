// ═══════════════════════════════════════════════════════════
// TESTS: Evidence Graph
// ═══════════════════════════════════════════════════════════

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  EVIDENCE_TYPES,
  EVIDENCE_DIMENSIONS,
  initEvidenceGraph,
  prepareEvidenceStatements,
  insertEvidence,
  getEvidenceProfile,
  buildStudentDimensionProfile,
  searchEvidence,
  seedCollegeEvidence,
} from "../evidence-graph.js";

let db, stmts;

before(() => {
  db = new Database(":memory:");
  initEvidenceGraph(db);
  stmts = prepareEvidenceStatements(db);
});

after(() => {
  db.close();
});

describe("EVIDENCE_TYPES", () => {
  it("defines three types that are never merged", () => {
    assert.equal(EVIDENCE_TYPES.OFFICIAL, 1);
    assert.equal(EVIDENCE_TYPES.PREPARATION, 2);
    assert.equal(EVIDENCE_TYPES.INFERRED, 3);
  });
});

describe("EVIDENCE_DIMENSIONS", () => {
  it("includes key dimensions", () => {
    assert.ok(EVIDENCE_DIMENSIONS.includes("leadership"));
    assert.ok(EVIDENCE_DIMENSIONS.includes("service"));
    assert.ok(EVIDENCE_DIMENSIONS.includes("sustained_commitment"));
    assert.ok(EVIDENCE_DIMENSIONS.includes("field_preparation"));
    assert.ok(EVIDENCE_DIMENSIONS.includes("mission_fit"));
  });
});

describe("insertEvidence", () => {
  it("inserts an official evidence item", () => {
    const id = insertEvidence(stmts, {
      evidence_type: EVIDENCE_TYPES.OFFICIAL,
      entity_type: "college",
      entity_id: "MIT",
      claim: "MIT acceptance rate is 3.9%",
      claim_category: "admissions",
      dimension: "field_preparation",
      confidence: 0.95,
      source_url: "https://mitadmissions.org",
      source_domain: "mitadmissions.org",
    });
    assert.ok(id);
  });

  it("inserts a preparation evidence item", () => {
    const id = insertEvidence(stmts, {
      evidence_type: EVIDENCE_TYPES.PREPARATION,
      entity_type: "student",
      entity_id: "student-123",
      claim: "Student completed AP Calculus BC with score 5",
      claim_category: "academics",
      dimension: "field_preparation",
      confidence: 0.9,
    });
    assert.ok(id);
  });

  it("inserts an inferred evidence item", () => {
    const id = insertEvidence(stmts, {
      evidence_type: EVIDENCE_TYPES.INFERRED,
      entity_type: "college",
      entity_id: "MIT",
      claim: "MIT values research-oriented extracurriculars",
      claim_category: "ec_emphasis",
      dimension: "research_creative_output",
      confidence: 0.6,
    });
    assert.ok(id);
  });
});

describe("getEvidenceProfile", () => {
  it("retrieves evidence for an entity", () => {
    const profile = getEvidenceProfile(stmts, "college", "MIT");
    assert.ok(profile.totalCount >= 2);
  });

  it("separates evidence by type", () => {
    const profile = getEvidenceProfile(stmts, "college", "MIT");
    assert.ok(profile.official.length > 0);
    assert.ok(profile.inferred.length > 0);
  });

  it("returns empty for unknown entity", () => {
    const profile = getEvidenceProfile(stmts, "college", "NONEXISTENT");
    assert.equal(profile.totalCount, 0);
  });
});

describe("evidence lifecycle and semantic seeding", () => {
  it("seeds bundled college evidence idempotently without claiming official provenance", () => {
    const localDb = new Database(":memory:");
    initEvidenceGraph(localDb);
    const localStmts = prepareEvidenceStatements(localDb);
    const profiles = [{
      unitId: "100",
      name: "Example University",
      dataYear: 2024,
      topMajors: ["Computer Science"],
      apCoursesValued: ["Calculus BC"],
      ecEmphasis: ["Robotics"],
    }];
    seedCollegeEvidence(localStmts, profiles, localDb);
    seedCollegeEvidence(localStmts, profiles, localDb);
    const rows = localDb.prepare("SELECT * FROM evidence_items").all();
    assert.equal(rows.length, 3);
    assert.ok(rows.every((row) => row.trust_level === "inferred"));
    assert.ok(rows.every((row) => row.provenance_type === "bundled_baseline"));
    localDb.close();
  });

  it("uses token search and ignores wildcard-only input", () => {
    assert.ok(searchEvidence(stmts, "MIT research evidence", 10).length > 0);
    assert.deepEqual(searchEvidence(stmts, "%_%%", 10), []);
  });
});

describe("buildStudentDimensionProfile", () => {
  it("builds dimension profile from student context", () => {
    const profile = buildStudentDimensionProfile({
      currentProfile: {
        activities: [
          { name: "Math Olympiad", role: "Captain", category: "academic", hoursPerWeek: 10, weeksPerYear: 40, years: 4 },
          { name: "Food Bank Volunteer", role: "Volunteer", category: "community_service", hoursPerWeek: 5, weeksPerYear: 30, years: 3 },
          { name: "Research Lab", role: "Research Assistant", category: "research", hoursPerWeek: 15, weeksPerYear: 20, years: 2 },
        ],
        courses: [
          { name: "AP Calculus BC", type: "ap" },
          { name: "AP Physics C", type: "ap" },
        ],
        apScores: [
          { exam: "Calculus BC", score: 5 },
        ],
      },
      majorInterest: "Computer Science",
    });

    assert.ok(profile.dimensions.leadership.score > 0, "Should detect leadership from Captain role");
    assert.ok(profile.dimensions.service.score > 0, "Should detect service from volunteer work");
    assert.ok(profile.dimensions.field_preparation.score > 0, "Should detect field prep from AP courses");
    assert.ok(profile.dimensions.sustained_commitment.score > 0, "Should detect commitment from 2+ years");
  });

  it("returns zeros for empty profile", () => {
    const profile = buildStudentDimensionProfile({
      currentProfile: { activities: [], courses: [], apScores: [] },
    });
    assert.equal(profile.dimensions.leadership.score, 0);
    assert.equal(profile.dimensions.service.score, 0);
  });
});

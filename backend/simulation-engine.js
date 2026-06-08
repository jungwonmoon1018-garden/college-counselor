import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildStudentModel, buildPositioningForTarget } from "./positioning-engine.js";
import { vectorizeECStrength } from "./ec-strength-vectorizer.js";

const ALLOWED_PATCH_KEYS = new Set([
  "gpa",
  "courses",
  "apScores",
  "testScores",
  "activities",
  "goals",
  "majorInterest",
  "narrative",
]);

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeProfile(snapshot = {}) {
  return {
    gpa: snapshot.gpa || {
      unweighted: snapshot.gpa_unweighted ?? snapshot.gpaUnweighted ?? null,
      weighted: snapshot.gpa_weighted ?? snapshot.gpaWeighted ?? null,
    },
    courses: safeArray(snapshot.courses),
    apScores: safeArray(snapshot.apScores),
    testScores: safeArray(snapshot.testScores),
    activities: safeArray(snapshot.activities),
    goals: safeArray(snapshot.goals),
    majorInterest: snapshot.majorInterest ?? snapshot.major_interest ?? null,
    narrative: snapshot.narrative ?? null,
  };
}

function validatePatch(patch = {}) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw Object.assign(new Error("profilePatch must be an object"), { status: 400 });
  }
  for (const key of Object.keys(patch)) {
    if (!ALLOWED_PATCH_KEYS.has(key)) {
      throw Object.assign(new Error(`Unsupported simulation patch field: ${key}`), { status: 400 });
    }
  }
}

function mergeProfile(baseProfile, patch) {
  validatePatch(patch);
  const merged = structuredClone(normalizeProfile(baseProfile));
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (key === "gpa" && value && typeof value === "object" && !Array.isArray(value)) {
      merged.gpa = { ...(merged.gpa || {}), ...value };
    } else {
      merged[key] = value;
    }
  }
  return normalizeProfile(merged);
}

function snapshotForPositioning(profile) {
  return {
    gpa_unweighted: profile.gpa?.unweighted ?? null,
    gpa_weighted: profile.gpa?.weighted ?? null,
    courses_json: JSON.stringify(safeArray(profile.courses)),
    ap_scores_json: JSON.stringify(safeArray(profile.apScores)),
    test_scores_json: JSON.stringify(safeArray(profile.testScores)),
    activities_json: JSON.stringify(safeArray(profile.activities)),
    major_interest: profile.majorInterest ?? null,
  };
}

async function buildSimulatedStrengthRows(profile) {
  const rows = [];
  for (const activity of safeArray(profile.activities)) {
    if (!activity?.name) continue;
    const result = await vectorizeECStrength({
      ec: activity,
      description: activity.description || activity.role || activity.category || "",
      majorInterest: profile.majorInterest || null,
    });
    rows.push({
      ec_name: activity.name,
      tier_label: result.tier || result.tierLabel || result.label || "tier_3_developing",
      dedication: result.factors?.dedication ?? 0,
      achievement: result.factors?.achievement ?? 0,
      leadership: result.factors?.leadership ?? 0,
      prestige: result.factors?.prestige ?? 0,
      major_spike: result.factors?.major_spike ?? 0,
      narrative_fit: result.factors?.narrative_fit ?? 0,
      source_json: JSON.stringify(result),
    });
  }
  return rows;
}

function buildDefaultTarget(profile) {
  return {
    collegeContext: {
      unitId: "simulated-target",
      name: "Simulated Target",
      acceptanceRate: 20,
      avgGpaAdmitted: 3.85,
      sat25: 1380,
      sat75: 1530,
      topMajors: [profile.majorInterest || "Undeclared"],
      source: "simulation_default",
    },
    cdsResult: {
      schoolName: "Simulated Target",
      source: "simulation_default",
      fetchStatus: "simulated",
      parsed: {
        admitRatePercent: 20,
        gpaAverage: 3.85,
        testPolicy: "test_considered_or_required",
        c7: { academicGpa: 1, rigor: 0.7, standardizedTests: 0.7, essay: 0.35, extracurriculars: 0.35, recommendation: 0.35, character: 0.35 },
      },
    },
  };
}

function normalizeTargets(targets, profile) {
  const list = Array.isArray(targets) && targets.length ? targets : [buildDefaultTarget(profile)];
  return list.map((target) => ({
    collegeContext: target.collegeContext || target,
    cdsResult: target.cdsResult || {
      schoolName: target.schoolName || target.name || target.collegeContext?.name || "Simulated Target",
      source: "simulation_request",
      fetchStatus: "simulated",
      parsed: target.parsed || {},
    },
    options: target.options || {},
  }));
}

export function initSimulationStore(dataDir, options = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const profilePath = options.profilePath || path.join(dataDir, "simulated-profiles.db");
  const vectorPath = options.vectorPath || path.join(dataDir, "simulated-vectors.db");
  const profileBase = path.basename(profilePath);
  const vectorBase = path.basename(vectorPath);
  if (!profileBase.startsWith("simulated-profiles")) {
    throw new Error("Simulation profile DB path must use a simulated-profiles*.db filename");
  }
  if (!vectorBase.startsWith("simulated-vectors")) {
    throw new Error("Simulation vector DB path must use a simulated-vectors*.db filename");
  }
  const profileDb = new Database(profilePath);
  const vectorDb = new Database(vectorPath);
  profileDb.pragma("journal_mode = WAL");
  vectorDb.pragma("journal_mode = WAL");

  profileDb.exec(`
    CREATE TABLE IF NOT EXISTS simulated_profiles (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      scenario_name TEXT,
      scenario_json TEXT,
      base_profile_json TEXT NOT NULL,
      simulated_profile_json TEXT NOT NULL,
      positioning_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sim_profiles_student ON simulated_profiles(student_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sim_profiles_expiry ON simulated_profiles(expires_at);
  `);

  vectorDb.exec(`
    CREATE TABLE IF NOT EXISTS simulated_vectors (
      id TEXT PRIMARY KEY,
      simulation_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      vector_type TEXT NOT NULL,
      vector_name TEXT,
      vector_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sim_vectors_simulation ON simulated_vectors(simulation_id);
    CREATE INDEX IF NOT EXISTS idx_sim_vectors_expiry ON simulated_vectors(expires_at);
  `);

  const profileStmts = {
    insert: profileDb.prepare(`INSERT INTO simulated_profiles (id, student_id, scenario_name, scenario_json, base_profile_json, simulated_profile_json, positioning_json, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    get: profileDb.prepare(`SELECT * FROM simulated_profiles WHERE id = ? AND student_id = ? AND expires_at > datetime('now')`),
    delete: profileDb.prepare(`DELETE FROM simulated_profiles WHERE id = ? AND student_id = ?`),
    cleanup: profileDb.prepare(`DELETE FROM simulated_profiles WHERE expires_at <= datetime('now')`),
    count: profileDb.prepare(`SELECT COUNT(*) AS count FROM simulated_profiles`),
  };
  const vectorStmts = {
    insert: vectorDb.prepare(`INSERT INTO simulated_vectors (id, simulation_id, student_id, vector_type, vector_name, vector_json, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`),
    list: vectorDb.prepare(`SELECT * FROM simulated_vectors WHERE simulation_id = ? AND student_id = ? AND expires_at > datetime('now') ORDER BY vector_type, vector_name`),
    deleteBySimulation: vectorDb.prepare(`DELETE FROM simulated_vectors WHERE simulation_id = ? AND student_id = ?`),
    cleanup: vectorDb.prepare(`DELETE FROM simulated_vectors WHERE expires_at <= datetime('now')`),
    count: vectorDb.prepare(`SELECT COUNT(*) AS count FROM simulated_vectors`),
  };

  return { profileDb, vectorDb, profilePath, vectorPath, profileStmts, vectorStmts };
}

export function closeSimulationStore(store) {
  store?.profileDb?.close();
  store?.vectorDb?.close();
}

export function cleanupExpiredSimulations(store) {
  const vectors = store.vectorStmts.cleanup.run().changes;
  const profiles = store.profileStmts.cleanup.run().changes;
  return { profiles, vectors };
}

export async function createSimulation(store, request, options = {}) {
  cleanupExpiredSimulations(store);
  const ttlDays = Number(options.ttlDays ?? request.ttlDays ?? 7);
  const studentId = request.studentId;
  if (!studentId) throw Object.assign(new Error("studentId required"), { status: 400 });

  const baseProfile = normalizeProfile(request.baseProfile);
  const simulatedProfile = mergeProfile(baseProfile, request.profilePatch || request.scenario?.profilePatch || {});
  const simulationId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + Math.max(1, ttlDays) * 24 * 60 * 60 * 1000).toISOString();
  const createdAt = new Date().toISOString();

  const strengthRows = await buildSimulatedStrengthRows(simulatedProfile);
  const narrative = simulatedProfile.narrative ? { narrativeText: simulatedProfile.narrative } : request.narrative || null;
  const studentModel = buildStudentModel(snapshotForPositioning(simulatedProfile), strengthRows, narrative);
  const targets = normalizeTargets(request.targets, simulatedProfile).map((target) =>
    buildPositioningForTarget(studentModel, target.collegeContext, target.cdsResult, {
      major: simulatedProfile.majorInterest,
      ...(target.options || {}),
    })
  );

  const vectors = strengthRows.map((row) => ({
    type: "ec_strength",
    name: row.ec_name,
    vector: {
      dedication: row.dedication,
      achievement: row.achievement,
      leadership: row.leadership,
      prestige: row.prestige,
      major_spike: row.major_spike,
      narrative_fit: row.narrative_fit,
      tier_label: row.tier_label,
    },
  }));

  const positioning = {
    major: simulatedProfile.majorInterest,
    modelVersion: "simulation_positioning_v1",
    simulation: true,
    targets,
  };

  store.profileStmts.insert.run(
    simulationId,
    studentId,
    request.scenarioName || request.scenario?.name || null,
    JSON.stringify(request.scenario || {}),
    JSON.stringify(baseProfile),
    JSON.stringify(simulatedProfile),
    JSON.stringify(positioning),
    expiresAt,
  );
  for (const vector of vectors) {
    store.vectorStmts.insert.run(
      crypto.randomUUID(),
      simulationId,
      studentId,
      vector.type,
      vector.name || null,
      JSON.stringify(vector.vector),
      expiresAt,
    );
  }

  return {
    simulation: true,
    simulationId,
    basedOnStudentId: studentId,
    createdAt,
    expiresAt,
    profile: simulatedProfile,
    vectors,
    positioning,
  };
}

export function getSimulation(store, studentId, simulationId) {
  cleanupExpiredSimulations(store);
  const row = store.profileStmts.get.get(simulationId, studentId);
  if (!row) return null;
  const vectorRows = store.vectorStmts.list.all(simulationId, studentId);
  return {
    simulation: true,
    simulationId: row.id,
    basedOnStudentId: row.student_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    scenario: row.scenario_json ? JSON.parse(row.scenario_json) : {},
    profile: JSON.parse(row.simulated_profile_json),
    vectors: vectorRows.map((v) => ({ type: v.vector_type, name: v.vector_name, vector: JSON.parse(v.vector_json) })),
    positioning: JSON.parse(row.positioning_json),
  };
}

export function deleteSimulation(store, studentId, simulationId) {
  store.vectorStmts.deleteBySimulation.run(simulationId, studentId);
  const deleted = store.profileStmts.delete.run(simulationId, studentId).changes;
  return { deleted: deleted > 0 };
}

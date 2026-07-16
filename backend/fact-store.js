// Canonical fact storage with semantic identity, provenance, and lifecycle.

import crypto from "node:crypto";

const SEARCH_STOP_WORDS = new Set([
  "a", "an", "and", "are", "for", "from", "how", "in", "is", "of",
  "on", "or", "the", "to", "what", "when", "where", "which", "with",
]);

function normalizeIdentityPart(value) {
  return String(value ?? "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

export function semanticFactKey(fact) {
  const identity = [
    fact.topic_type,
    fact.entity_type,
    fact.entity_id,
    fact.fact_key,
    fact.source_domain,
  ].map(normalizeIdentityPart).join("|");
  return crypto.createHash("sha256").update(identity).digest("hex");
}

function ensureColumn(db, name, sqlType) {
  const columns = db.prepare("PRAGMA table_info(canonical_facts)").all().map((row) => row.name);
  if (!columns.includes(name)) {
    db.exec("ALTER TABLE canonical_facts ADD COLUMN " + name + " " + sqlType);
  }
}

function confidenceRank(value) {
  return { verified: 4, extracted: 3, stale: 2, expired: 1 }[value] || 0;
}

export function deduplicateFactStore(db) {
  const rows = db.prepare("SELECT * FROM canonical_facts ORDER BY updated_at DESC, created_at DESC").all();
  const updateKey = db.prepare("UPDATE canonical_facts SET semantic_key = ? WHERE id = ?");
  const deleteFact = db.prepare("DELETE FROM canonical_facts WHERE id = ?");
  const keepers = new Map();
  let removed = 0;

  const tx = db.transaction(() => {
    for (const row of rows) {
      const key = semanticFactKey(row);
      const existing = keepers.get(key);
      if (!existing) {
        keepers.set(key, row);
        updateKey.run(key, row.id);
        continue;
      }
      const currentRank = confidenceRank(row.confidence);
      const existingRank = confidenceRank(existing.confidence);
      if (currentRank > existingRank) {
        deleteFact.run(existing.id);
        updateKey.run(key, row.id);
        keepers.set(key, row);
      } else {
        deleteFact.run(row.id);
      }
      removed++;
    }
  });
  tx();
  return { removed, remaining: keepers.size };
}

export function initFactStore(db) {
  db.exec([
    "CREATE TABLE IF NOT EXISTS canonical_facts (",
    "  id TEXT PRIMARY KEY,",
    "  semantic_key TEXT,",
    "  topic_type TEXT NOT NULL,",
    "  entity_type TEXT,",
    "  entity_id TEXT,",
    "  entity_name TEXT,",
    "  fact_key TEXT NOT NULL,",
    "  fact_value TEXT NOT NULL,",
    "  fact_type TEXT NOT NULL DEFAULT 'text',",
    "  source_url TEXT,",
    "  source_domain TEXT NOT NULL,",
    "  source_title TEXT,",
    "  source_snapshot_hash TEXT,",
    "  extracted_at TEXT NOT NULL,",
    "  verified_at TEXT,",
    "  verified_by TEXT,",
    "  effective_at TEXT,",
    "  expires_at TEXT,",
    "  academic_year TEXT,",
    "  provenance_type TEXT NOT NULL DEFAULT 'external_source',",
    "  seed_version TEXT,",
    "  confidence TEXT DEFAULT 'extracted',",
    "  created_at TEXT DEFAULT (datetime('now')),",
    "  updated_at TEXT DEFAULT (datetime('now'))",
    ");",
    "CREATE INDEX IF NOT EXISTS idx_facts_topic ON canonical_facts(topic_type, entity_id, fact_key);",
    "CREATE INDEX IF NOT EXISTS idx_facts_confidence ON canonical_facts(confidence, expires_at);",
    "CREATE INDEX IF NOT EXISTS idx_facts_entity ON canonical_facts(entity_type, entity_id);",
    "CREATE INDEX IF NOT EXISTS idx_facts_domain ON canonical_facts(source_domain);",
  ].join("\n"));

  ensureColumn(db, "semantic_key", "TEXT");
  ensureColumn(db, "effective_at", "TEXT");
  ensureColumn(db, "academic_year", "TEXT");
  ensureColumn(db, "provenance_type", "TEXT NOT NULL DEFAULT 'external_source'");
  ensureColumn(db, "seed_version", "TEXT");
  deduplicateFactStore(db);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_facts_semantic_unique ON canonical_facts(semantic_key)");
}

export function prepareFactStatements(db) {
  return {
    insertFact: db.prepare([
      "INSERT INTO canonical_facts (",
      " id, semantic_key, topic_type, entity_type, entity_id, entity_name, fact_key, fact_value, fact_type,",
      " source_url, source_domain, source_title, source_snapshot_hash, extracted_at, verified_at, verified_by,",
      " effective_at, expires_at, academic_year, provenance_type, seed_version, confidence",
      ") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      "ON CONFLICT(semantic_key) DO UPDATE SET",
      " entity_name = excluded.entity_name,",
      " fact_value = excluded.fact_value,",
      " fact_type = excluded.fact_type,",
      " source_url = excluded.source_url,",
      " source_title = excluded.source_title,",
      " source_snapshot_hash = excluded.source_snapshot_hash,",
      " extracted_at = CASE WHEN canonical_facts.fact_value != excluded.fact_value OR",
      "   COALESCE(canonical_facts.source_snapshot_hash, '') != COALESCE(excluded.source_snapshot_hash, '')",
      "   THEN excluded.extracted_at ELSE canonical_facts.extracted_at END,",
      " verified_at = excluded.verified_at,",
      " verified_by = excluded.verified_by,",
      " effective_at = excluded.effective_at,",
      " expires_at = excluded.expires_at,",
      " academic_year = excluded.academic_year,",
      " provenance_type = excluded.provenance_type,",
      " seed_version = excluded.seed_version,",
      " confidence = excluded.confidence,",
      " updated_at = CASE WHEN canonical_facts.fact_value != excluded.fact_value OR",
      "   COALESCE(canonical_facts.source_snapshot_hash, '') != COALESCE(excluded.source_snapshot_hash, '')",
      "   THEN datetime('now') ELSE canonical_facts.updated_at END",
    ].join("\n")),
    getFact: db.prepare("SELECT * FROM canonical_facts WHERE id = ?"),
    getFactBySemantic: db.prepare("SELECT * FROM canonical_facts WHERE semantic_key = ?"),
    getFactsByEntity: db.prepare([
      "SELECT * FROM canonical_facts",
      "WHERE entity_type = ? AND entity_id = ?",
      " AND confidence IN ('verified', 'extracted')",
      " AND (expires_at IS NULL OR expires_at > datetime('now'))",
      "ORDER BY CASE confidence WHEN 'verified' THEN 0 ELSE 1 END, fact_key ASC",
    ].join("\n")),
    getFactsByTopic: db.prepare([
      "SELECT * FROM canonical_facts",
      "WHERE topic_type = ? AND confidence IN ('verified', 'extracted')",
      " AND (expires_at IS NULL OR expires_at > datetime('now'))",
      "ORDER BY CASE confidence WHEN 'verified' THEN 0 ELSE 1 END, entity_name ASC, fact_key ASC",
    ].join("\n")),
    getFactByKey: db.prepare([
      "SELECT * FROM canonical_facts",
      "WHERE entity_id = ? AND fact_key = ? AND confidence IN ('verified', 'extracted')",
      " AND (expires_at IS NULL OR expires_at > datetime('now'))",
      "ORDER BY CASE confidence WHEN 'verified' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1",
    ].join("\n")),
    getVerifiedFacts: db.prepare([
      "SELECT * FROM canonical_facts",
      "WHERE confidence = 'verified' AND (expires_at IS NULL OR expires_at > datetime('now'))",
      "ORDER BY topic_type, entity_name, fact_key",
    ].join("\n")),
    searchFacts: db.prepare([
      "SELECT * FROM canonical_facts",
      "WHERE (lower(entity_name) LIKE ? ESCAPE '\\' OR lower(fact_key) LIKE ? ESCAPE '\\'",
      " OR lower(fact_value) LIKE ? ESCAPE '\\')",
      " AND confidence IN ('verified', 'extracted')",
      " AND (expires_at IS NULL OR expires_at > datetime('now'))",
      "ORDER BY CASE confidence WHEN 'verified' THEN 0 ELSE 1 END, updated_at DESC",
      "LIMIT ?",
    ].join("\n")),
    updateConfidence: db.prepare([
      "UPDATE canonical_facts SET confidence = ?, verified_at = datetime('now'),",
      " verified_by = ?, updated_at = datetime('now') WHERE id = ?",
    ].join("\n")),
    markStale: db.prepare("UPDATE canonical_facts SET confidence = 'stale', updated_at = datetime('now') WHERE id = ?"),
    markExpired: db.prepare([
      "UPDATE canonical_facts SET confidence = 'expired', updated_at = datetime('now')",
      "WHERE expires_at IS NOT NULL AND expires_at <= datetime('now') AND confidence != 'expired'",
    ].join("\n")),
    deleteFact: db.prepare("DELETE FROM canonical_facts WHERE id = ?"),
    getExpiringSoon: db.prepare([
      "SELECT * FROM canonical_facts WHERE expires_at IS NOT NULL",
      " AND expires_at <= datetime('now', '+7 days')",
      " AND confidence IN ('verified', 'extracted') ORDER BY expires_at ASC",
    ].join("\n")),
    countByConfidence: db.prepare("SELECT confidence, COUNT(*) AS count FROM canonical_facts GROUP BY confidence"),
  };
}

export function insertFact(stmts, fact) {
  if (!fact?.topic_type || !fact?.fact_key || fact?.fact_value == null || !fact?.source_domain) {
    throw new Error("Fact requires topic_type, fact_key, fact_value, and source_domain.");
  }
  const semanticKey = fact.semantic_key || semanticFactKey(fact);
  const id = fact.id || "fact_" + semanticKey.slice(0, 32);
  const now = new Date().toISOString();
  const result = stmts.insertFact.run(
    id,
    semanticKey,
    fact.topic_type,
    fact.entity_type || null,
    fact.entity_id || null,
    fact.entity_name || null,
    fact.fact_key,
    String(fact.fact_value),
    fact.fact_type || "text",
    fact.source_url || null,
    fact.source_domain,
    fact.source_title || null,
    fact.source_snapshot_hash || null,
    fact.extracted_at || now,
    fact.verified_at || null,
    fact.verified_by || null,
    fact.effective_at || null,
    fact.expires_at || null,
    fact.academic_year || null,
    fact.provenance_type || "external_source",
    fact.seed_version || null,
    fact.confidence || "extracted",
  );
  const stored = stmts.getFactBySemantic.get(semanticKey);
  return { id: stored?.id || id, inserted: result.changes > 0, semanticKey };
}

export function verifyFact(stmts, factId, verifiedBy = "manual") {
  const result = stmts.updateConfidence.run("verified", verifiedBy, factId);
  return { id: factId, verified: result.changes > 0, verifiedBy };
}

export function markFactStale(stmts, factId) {
  const result = stmts.markStale.run(factId);
  return { id: factId, stale: result.changes > 0 };
}

export function lookupFact(stmts, entityId, factKey) {
  return stmts.getFactByKey.get(entityId, factKey) || null;
}

export function lookupFactsForEntity(stmts, entityType, entityId) {
  return stmts.getFactsByEntity.all(entityType, entityId);
}

export function lookupFactsForTopic(stmts, topicType) {
  return stmts.getFactsByTopic.all(topicType);
}

function escapeLike(value) {
  /*
  return value.replace(/[\\%_]/g, (character) => "\" + character);
  */
  return value.replace(/[%_]/g, (character) => String.fromCharCode(92) + character);
}

export function tokenizeFactQuery(query) {
  return [...new Set(
    String(query || "")
      .normalize("NFKC")
      .toLowerCase()
      .match(/[a-z0-9][a-z0-9.-]{1,}|[\u3131-\uD79D]{2,}/g) || []
  )].filter((token) => !SEARCH_STOP_WORDS.has(token)).slice(0, 8);
}

export function searchFacts(stmts, query, limit = 20) {
  const tokens = tokenizeFactQuery(query);
  if (!tokens.length) return [];
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
  const scores = new Map();
  for (const token of tokens) {
    const pattern = "%" + escapeLike(token) + "%";
    const rows = stmts.searchFacts.all(pattern, pattern, pattern, safeLimit * 2);
    for (const row of rows) {
      const current = scores.get(row.id) || { row, score: 0 };
      current.score += row.confidence === "verified" ? 3 : 1;
      const haystack = [row.entity_name, row.fact_key, row.fact_value].join(" ").toLowerCase();
      if (haystack.includes(token)) current.score += 1;
      scores.set(row.id, current);
    }
  }
  return [...scores.values()]
    .sort((a, b) => b.score - a.score || String(b.row.updated_at).localeCompare(String(a.row.updated_at)))
    .slice(0, safeLimit)
    .map((entry) => entry.row);
}

export function expireOldFacts(stmts) {
  const result = stmts.markExpired.run();
  return { expired: result.changes };
}

export function getFactStoreStats(stmts) {
  const counts = stmts.countByConfidence.all();
  const expiringSoon = stmts.getExpiringSoon.all();
  return {
    counts: Object.fromEntries(counts.map((row) => [row.confidence, row.count])),
    expiringSoonCount: expiringSoon.length,
    expiringSoon: expiringSoon.slice(0, 10).map((fact) => ({
      id: fact.id,
      entityName: fact.entity_name,
      factKey: fact.fact_key,
      expiresAt: fact.expires_at,
    })),
  };
}

export function seedCollegeFacts(stmts, collegeProfiles, db) {
  const tx = db.transaction(() => {
    for (const college of collegeProfiles) {
      const entityId = college.unitId || college.unit_id;
      const entityName = college.name;
      const dataYear = Number(college.dataYear || college.data_year) || null;
      const extractedAt = dataYear ? dataYear + "-12-31T00:00:00.000Z" : "1970-01-01T00:00:00.000Z";
      const facts = [
        ["acceptance_rate", college.acceptance_rate ?? college.acceptance, "number"],
        ["sat_25", college.sat_25 ?? college.sat25, "number"],
        ["sat_75", college.sat_75 ?? college.sat75, "number"],
        ["act_25", college.act_25 ?? college.act25, "number"],
        ["act_75", college.act_75 ?? college.act75, "number"],
        ["tuition_in_state", college.tuition_in ?? college.tuitionIn, "number"],
        ["tuition_out_of_state", college.tuition_out ?? college.tuitionOut, "number"],
        ["enrollment", college.enrollment, "number"],
        ["grad_rate_6yr", college.grad_rate_6yr ?? college.gradRate6yr, "number"],
        ["retention_rate", college.retention_rate ?? college.retentionRate, "number"],
        ["median_earnings_10yr", college.median_earnings_10yr ?? college.medianEarnings10yr, "number"],
        ["state", college.state, "text"],
      ];
      for (const [key, value, type] of facts) {
        if (value == null || value === "") continue;
        insertFact(stmts, {
          topic_type: "statistics",
          entity_type: "university",
          entity_id: entityId,
          entity_name: entityName,
          fact_key: key,
          fact_value: value,
          fact_type: type,
          source_domain: "bundled-baseline.local",
          source_title: "Bundled college profile baseline" + (dataYear ? " (data year " + dataYear + ")" : ""),
          extracted_at: extractedAt,
          academic_year: dataYear ? String(dataYear) : null,
          provenance_type: "bundled_baseline",
          seed_version: "college_profiles_v1",
          confidence: "extracted",
        });
      }
    }
  });
  tx();
}

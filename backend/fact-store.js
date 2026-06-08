// ═══════════════════════════════════════════════════════════════════════
// FACT STORE — Canonical verified facts with provenance and lifecycle
// ═══════════════════════════════════════════════════════════════════════
// Stores verified facts extracted from official sources. Each fact has:
//   - Full provenance (URL, domain, extraction date, snapshot hash)
//   - Lifecycle status (extracted → verified → stale → expired)
//   - Expiration date (facts auto-expire and require re-verification)
//
// The verified_facts lane in answer-composer can ONLY be populated
// from this store when confidence = 'verified'.
// ═══════════════════════════════════════════════════════════════════════

import crypto from "node:crypto";

// ─── Schema initialization ───
export function initFactStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS canonical_facts (
      id TEXT PRIMARY KEY,
      topic_type TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      entity_name TEXT,
      fact_key TEXT NOT NULL,
      fact_value TEXT NOT NULL,
      fact_type TEXT NOT NULL DEFAULT 'text',
      source_url TEXT,
      source_domain TEXT NOT NULL,
      source_title TEXT,
      source_snapshot_hash TEXT,
      extracted_at TEXT NOT NULL,
      verified_at TEXT,
      verified_by TEXT,
      expires_at TEXT,
      confidence TEXT DEFAULT 'extracted',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_facts_topic
      ON canonical_facts(topic_type, entity_id, fact_key);
    CREATE INDEX IF NOT EXISTS idx_facts_confidence
      ON canonical_facts(confidence, expires_at);
    CREATE INDEX IF NOT EXISTS idx_facts_entity
      ON canonical_facts(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_facts_domain
      ON canonical_facts(source_domain);
  `);
}

// ─── Prepared statements ───
export function prepareFactStatements(db) {
  return {
    insertFact: db.prepare(`
      INSERT INTO canonical_facts
        (id, topic_type, entity_type, entity_id, entity_name, fact_key, fact_value, fact_type,
         source_url, source_domain, source_title, source_snapshot_hash,
         extracted_at, verified_at, verified_by, expires_at, confidence)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `),

    getFact: db.prepare(`SELECT * FROM canonical_facts WHERE id = ?`),

    getFactsByEntity: db.prepare(`
      SELECT * FROM canonical_facts
      WHERE entity_type = ? AND entity_id = ? AND confidence IN ('verified', 'extracted')
      ORDER BY fact_key ASC
    `),

    getFactsByTopic: db.prepare(`
      SELECT * FROM canonical_facts
      WHERE topic_type = ? AND confidence IN ('verified', 'extracted')
      ORDER BY entity_name ASC, fact_key ASC
    `),

    getFactByKey: db.prepare(`
      SELECT * FROM canonical_facts
      WHERE entity_id = ? AND fact_key = ? AND confidence IN ('verified', 'extracted')
      ORDER BY updated_at DESC LIMIT 1
    `),

    getVerifiedFacts: db.prepare(`
      SELECT * FROM canonical_facts
      WHERE confidence = 'verified' AND (expires_at IS NULL OR expires_at > datetime('now'))
      ORDER BY topic_type, entity_name, fact_key
    `),

    searchFacts: db.prepare(`
      SELECT * FROM canonical_facts
      WHERE (entity_name LIKE ? OR fact_key LIKE ? OR fact_value LIKE ?)
        AND confidence IN ('verified', 'extracted')
      ORDER BY confidence DESC, updated_at DESC
      LIMIT ?
    `),

    updateConfidence: db.prepare(`
      UPDATE canonical_facts
      SET confidence = ?, verified_at = datetime('now'), verified_by = ?, updated_at = datetime('now')
      WHERE id = ?
    `),

    markStale: db.prepare(`
      UPDATE canonical_facts
      SET confidence = 'stale', updated_at = datetime('now')
      WHERE id = ?
    `),

    markExpired: db.prepare(`
      UPDATE canonical_facts
      SET confidence = 'expired', updated_at = datetime('now')
      WHERE expires_at IS NOT NULL AND expires_at < datetime('now') AND confidence != 'expired'
    `),

    deleteFact: db.prepare(`DELETE FROM canonical_facts WHERE id = ?`),

    getExpiringSoon: db.prepare(`
      SELECT * FROM canonical_facts
      WHERE expires_at IS NOT NULL
        AND expires_at <= datetime('now', '+7 days')
        AND confidence IN ('verified', 'extracted')
      ORDER BY expires_at ASC
    `),

    countByConfidence: db.prepare(`
      SELECT confidence, COUNT(*) as count FROM canonical_facts
      GROUP BY confidence
    `),
  };
}

// ─── CRUD operations ───

export function insertFact(stmts, fact) {
  const id = fact.id || crypto.randomUUID();
  const now = new Date().toISOString();

  stmts.insertFact.run(
    id,
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
    fact.expires_at || null,
    fact.confidence || "extracted",
  );

  return { id, inserted: true };
}

export function verifyFact(stmts, factId, verifiedBy = "auto:diff_stable") {
  stmts.updateConfidence.run("verified", verifiedBy, factId);
  return { id: factId, verified: true, verifiedBy };
}

export function markFactStale(stmts, factId) {
  stmts.markStale.run(factId);
  return { id: factId, stale: true };
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

export function searchFacts(stmts, query, limit = 20) {
  const pattern = `%${query}%`;
  return stmts.searchFacts.all(pattern, pattern, pattern, limit);
}

export function expireOldFacts(stmts) {
  const result = stmts.markExpired.run();
  return { expired: result.changes };
}

export function getFactStoreStats(stmts) {
  const counts = stmts.countByConfidence.all();
  const expiringSoon = stmts.getExpiringSoon.all();
  return {
    counts: Object.fromEntries(counts.map((c) => [c.confidence, c.count])),
    expiringSoonCount: expiringSoon.length,
    expiringSoon: expiringSoon.slice(0, 10).map((f) => ({
      id: f.id,
      entityName: f.entity_name,
      factKey: f.fact_key,
      expiresAt: f.expires_at,
    })),
  };
}

// ─── Seed facts from baseline college data ───
export function seedCollegeFacts(stmts, collegeProfiles, db) {
  const tx = db.transaction(() => {
    for (const c of collegeProfiles) {
      const entityId = c.unitId || c.unit_id;
      const entityName = c.name;
      const domain = "collegescorecard.ed.gov";
      const now = new Date().toISOString();
      // Set expiry 6 months from now for institutional data
      const expires = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();

      const facts = [
        { key: "acceptance_rate", value: c.acceptance_rate ?? c.acceptance, type: "number" },
        { key: "sat_25", value: c.sat_25 ?? c.sat25, type: "number" },
        { key: "sat_75", value: c.sat_75 ?? c.sat75, type: "number" },
        { key: "act_25", value: c.act_25 ?? c.act25, type: "number" },
        { key: "act_75", value: c.act_75 ?? c.act75, type: "number" },
        { key: "tuition_in_state", value: c.tuition_in ?? c.tuitionIn, type: "number" },
        { key: "tuition_out_of_state", value: c.tuition_out ?? c.tuitionOut, type: "number" },
        { key: "enrollment", value: c.enrollment, type: "number" },
        { key: "grad_rate_6yr", value: c.grad_rate_6yr ?? c.gradRate6yr, type: "number" },
        { key: "retention_rate", value: c.retention_rate ?? c.retentionRate, type: "number" },
        { key: "median_earnings_10yr", value: c.median_earnings_10yr ?? c.medianEarnings10yr, type: "number" },
        { key: "state", value: c.state, type: "text" },
      ];

      for (const f of facts) {
        if (f.value == null || f.value === "") continue;
        insertFact(stmts, {
          topic_type: "statistics",
          entity_type: "university",
          entity_id: entityId,
          entity_name: entityName,
          fact_key: f.key,
          fact_value: String(f.value),
          fact_type: f.type,
          source_url: `https://collegescorecard.ed.gov/school/?${entityId}`,
          source_domain: domain,
          source_title: `College Scorecard — ${entityName}`,
          extracted_at: now,
          verified_by: "auto:ipeds_import",
          verified_at: now,
          expires_at: expires,
          confidence: "verified",
        });
      }
    }
  });

  tx();
}

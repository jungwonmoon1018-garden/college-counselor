// ═══════════════════════════════════════════════════════════════════════
// REVIEW QUEUE — Human review for legal, policy, and school-integrated cases
// ═══════════════════════════════════════════════════════════════════════
// Triggers for human review:
//   1. Model confidence below threshold on regulated topics
//   2. Cross-source conflict in canonical facts
//   3. School-integrated: any response touching school-specific policies
//   4. Legal/compliance topics with no verified source
//   5. Content moderation flags (non-crisis)
//   6. Student/parent disputes a fact
//   7. High-stakes changes detected by domain monitor
// ═══════════════════════════════════════════════════════════════════════

import crypto from "node:crypto";

// ─── Schema ───
export function initReviewQueue(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS review_queue (
      id TEXT PRIMARY KEY,
      created_at TEXT DEFAULT (datetime('now')),
      review_type TEXT NOT NULL,
      priority TEXT DEFAULT 'normal',
      status TEXT DEFAULT 'pending',
      student_id_hash TEXT,
      query_text TEXT,
      proposed_response TEXT,
      model_used TEXT,
      topic_type TEXT,
      sub_intent TEXT,
      evidence_objects_json TEXT,
      missing_sources TEXT,
      confidence_score REAL,
      trigger_reason TEXT,
      reviewer_id TEXT,
      reviewer_notes TEXT,
      reviewed_at TEXT,
      disposition TEXT,
      resolved_at TEXT,
      resolution_notes TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_review_status
      ON review_queue(status, priority, created_at);
    CREATE INDEX IF NOT EXISTS idx_review_type
      ON review_queue(review_type, status);
  `);
}

// ─── Prepared statements ───
export function prepareReviewStatements(db) {
  return {
    insertReview: db.prepare(`
      INSERT INTO review_queue
        (id, review_type, priority, status, student_id_hash, query_text, proposed_response,
         model_used, topic_type, sub_intent, evidence_objects_json, missing_sources,
         confidence_score, trigger_reason)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `),

    getPending: db.prepare(`
      SELECT * FROM review_queue
      WHERE status = 'pending'
      ORDER BY
        CASE priority WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 WHEN 'low' THEN 2 END,
        created_at ASC
      LIMIT ?
    `),

    getByStatus: db.prepare(`
      SELECT * FROM review_queue WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
    `),

    getById: db.prepare(`SELECT * FROM review_queue WHERE id = ?`),

    updateStatus: db.prepare(`
      UPDATE review_queue
      SET status = ?, reviewer_id = ?, reviewed_at = datetime('now')
      WHERE id = ?
    `),

    resolve: db.prepare(`
      UPDATE review_queue
      SET status = 'resolved', disposition = ?, resolution_notes = ?,
          resolved_at = datetime('now'), reviewer_id = ?
      WHERE id = ?
    `),

    getStats: db.prepare(`
      SELECT status, priority, COUNT(*) as count
      FROM review_queue
      GROUP BY status, priority
    `),

    cleanOld: db.prepare(`
      DELETE FROM review_queue
      WHERE status = 'resolved' AND resolved_at < datetime('now', '-90 days')
    `),
  };
}

// ─── Submit item for review ───
export function submitForReview(stmts, item) {
  const id = item.id || crypto.randomUUID();

  stmts.insertReview.run(
    id,
    item.review_type,
    item.priority || "normal",
    "pending",
    item.student_id_hash || null,
    (item.query_text || "").slice(0, 2000),
    (item.proposed_response || "").slice(0, 5000),
    item.model_used || null,
    item.topic_type || null,
    item.sub_intent || null,
    item.evidence_objects_json ? JSON.stringify(item.evidence_objects_json) : null,
    item.missing_sources || null,
    item.confidence_score ?? null,
    item.trigger_reason || null,
  );

  return { id, submitted: true, review_type: item.review_type, priority: item.priority || "normal" };
}

// ─── Check if a response should trigger review ───
export function shouldTriggerReview(classification, modelOutput, options = {}) {
  const triggers = [];

  // 1. Low confidence on regulated topics
  if ((classification.topicType === "regulated" || classification.topicType === "high_stakes") &&
      modelOutput?.confidence != null && modelOutput.confidence < 0.5) {
    triggers.push({
      review_type: "low_confidence",
      priority: "normal",
      trigger_reason: `Model confidence ${modelOutput.confidence} below threshold (0.5) on ${classification.topicType} topic.`,
    });
  }

  // 2. No verified source for regulated topic
  if ((classification.topicType === "regulated" || classification.topicType === "high_stakes") &&
      (!options.evidenceCount || options.evidenceCount === 0)) {
    triggers.push({
      review_type: "no_verified_source",
      priority: "normal",
      trigger_reason: `No verified evidence available for ${classification.subIntent} query.`,
    });
  }

  // 3. School-integrated mode
  if (options.isSchoolIntegrated && classification.topicType !== "administrative") {
    triggers.push({
      review_type: "school_integration",
      priority: "low",
      trigger_reason: "Response generated in school-integrated mode requires oversight.",
    });
  }

  // 4. Content flag
  if (options.contentFlag) {
    triggers.push({
      review_type: "content_flag",
      priority: "urgent",
      trigger_reason: `Content moderation flagged: ${options.contentFlag}`,
    });
  }

  return {
    shouldReview: triggers.length > 0,
    triggers,
  };
}

// ─── Resolve a review item ───
export function resolveReview(stmts, reviewId, disposition, notes, reviewerId) {
  stmts.resolve.run(disposition, notes, reviewerId, reviewId);
  return { id: reviewId, resolved: true, disposition };
}

// ─── Get queue stats ───
export function getQueueStats(stmts) {
  const rows = stmts.getStats.all();
  const stats = { pending: 0, in_review: 0, resolved: 0, byPriority: {} };

  for (const row of rows) {
    stats[row.status] = (stats[row.status] || 0) + row.count;
    if (row.status === "pending") {
      stats.byPriority[row.priority] = (stats.byPriority[row.priority] || 0) + row.count;
    }
  }

  return stats;
}

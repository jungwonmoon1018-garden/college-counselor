// ═══════════════════════════════════════════════════════════════════════
// RETENTION — Automated data lifecycle management
// ═══════════════════════════════════════════════════════════════════════
// Enforces retention policies:
//   - Uploaded documents: 72 hours
//   - Conversation logs: 30 days (consumer), per-institution (school)
//   - Audit logs: 90 days (consumer), 5+ years (institutional)
//   - Canonical facts: until superseded + 90 days
//   - Vector embeddings: updated on diff, no raw backing
//   - Profile data: until deletion requested
// ═══════════════════════════════════════════════════════════════════════

// ─── Default retention policies ───
export const RETENTION_POLICIES = {
  consumer: {
    documents: { hours: 72, label: "72 hours" },
    conversation_logs: { days: 30, label: "30 days" },
    audit_events: { days: 90, label: "90 days" },
    notifications: { days: 90, label: "90 days" },
    stale_facts: { days: 90, label: "90 days after superseded" },
    expired_evidence: { days: 90, label: "90 days after expiry" },
    resolved_reviews: { days: 90, label: "90 days after resolution" },
    profile_data: { days: null, label: "Until deletion requested" },
  },
  institutional: {
    documents: { hours: 72, label: "72 hours" },
    conversation_logs: { days: null, label: "Per institutional agreement" },
    audit_events: { years: 7, label: "7 years (FERPA minimum)" },
    notifications: { years: 7, label: "7 years" },
    stale_facts: { days: 180, label: "180 days after superseded" },
    expired_evidence: { days: 180, label: "180 days after expiry" },
    resolved_reviews: { years: 5, label: "5 years" },
    profile_data: { days: null, label: "Per institutional agreement" },
  },
};

// ─── Run retention cleanup ───
export function runRetentionCleanup(db, piiVaultDb, mode = "consumer") {
  const policy = RETENTION_POLICIES[mode] || RETENTION_POLICIES.consumer;
  const results = {};

  // 1. Clean expired documents from PII vault
  if (piiVaultDb) {
    try {
      const docResult = piiVaultDb.prepare(
        `DELETE FROM document_vault WHERE auto_delete = 1 AND retention_expires_at < datetime('now')`
      ).run();
      results.documents = { deleted: docResult.changes };
    } catch (e) {
      results.documents = { error: e.message };
    }
  }

  // 2. Clean old audit events
  if (policy.audit_events.days) {
    try {
      const auditResult = db.prepare(
        `DELETE FROM audit_events WHERE timestamp < datetime('now', '-${policy.audit_events.days} days')`
      ).run();
      results.audit_events = { deleted: auditResult.changes };
    } catch (e) {
      results.audit_events = { error: e.message };
    }
  } else if (policy.audit_events.years) {
    try {
      const days = policy.audit_events.years * 365;
      const auditResult = db.prepare(
        `DELETE FROM audit_events WHERE timestamp < datetime('now', '-${days} days')`
      ).run();
      results.audit_events = { deleted: auditResult.changes };
    } catch (e) {
      results.audit_events = { error: e.message };
    }
  }

  // 3. Clean old notifications
  if (policy.notifications.days) {
    try {
      const notifResult = db.prepare(
        `DELETE FROM notification_queue WHERE created_at < datetime('now', '-${policy.notifications.days} days')`
      ).run();
      results.notifications = { deleted: notifResult.changes };
    } catch (e) {
      results.notifications = { error: e.message };
    }
  }

  // 4. Clean stale/expired facts
  if (policy.stale_facts.days) {
    try {
      const staleResult = db.prepare(
        `DELETE FROM canonical_facts WHERE confidence IN ('stale', 'expired') AND updated_at < datetime('now', '-${policy.stale_facts.days} days')`
      ).run();
      results.stale_facts = { deleted: staleResult.changes };
    } catch (e) {
      results.stale_facts = { error: e.message };
    }
  }

  // 5. Clean expired evidence
  if (policy.expired_evidence.days) {
    try {
      const evidenceResult = db.prepare(
        `DELETE FROM evidence_items WHERE trust_level = 'expired' AND updated_at < datetime('now', '-${policy.expired_evidence.days} days')`
      ).run();
      results.expired_evidence = { deleted: evidenceResult.changes };
    } catch (e) {
      results.expired_evidence = { error: e.message };
    }
  }

  // 6. Clean resolved review queue items
  if (policy.resolved_reviews.days) {
    try {
      const reviewResult = db.prepare(
        `DELETE FROM review_queue WHERE status = 'resolved' AND resolved_at < datetime('now', '-${policy.resolved_reviews.days} days')`
      ).run();
      results.resolved_reviews = { deleted: reviewResult.changes };
    } catch (e) {
      results.resolved_reviews = { error: e.message };
    }
  }

  return {
    mode,
    results,
    completedAt: new Date().toISOString(),
  };
}

// ─── Get retention status/report ───
export function getRetentionReport(db, piiVaultDb, mode = "consumer") {
  const report = { mode, policy: RETENTION_POLICIES[mode] };

  try {
    report.audit_events = db.prepare("SELECT COUNT(*) as count, MIN(timestamp) as oldest FROM audit_events").get();
  } catch { report.audit_events = null; }

  try {
    report.canonical_facts = db.prepare(
      "SELECT confidence, COUNT(*) as count FROM canonical_facts GROUP BY confidence"
    ).all();
  } catch { report.canonical_facts = null; }

  try {
    report.evidence_items = db.prepare(
      "SELECT trust_level, COUNT(*) as count FROM evidence_items GROUP BY trust_level"
    ).all();
  } catch { report.evidence_items = null; }

  try {
    report.review_queue = db.prepare(
      "SELECT status, COUNT(*) as count FROM review_queue GROUP BY status"
    ).all();
  } catch { report.review_queue = null; }

  if (piiVaultDb) {
    try {
      report.documents = piiVaultDb.prepare(
        "SELECT COUNT(*) as count, MIN(created_at) as oldest FROM document_vault"
      ).get();
    } catch { report.documents = null; }
  }

  return report;
}

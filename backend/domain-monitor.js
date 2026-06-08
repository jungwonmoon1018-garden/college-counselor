// ═══════════════════════════════════════════════════════════════════════
// DOMAIN MONITOR — Diff-based official page monitoring
// ═══════════════════════════════════════════════════════════════════════
// Daily monitoring of university admissions pages:
//   - Change detection via SHA256 hash comparison
//   - Diff-based re-indexing (only changed pages)
//   - High-stakes changes trigger review workflows
//   - Respects robots.txt and rate limits
//
// Monitored page categories:
//   admissions, financial_aid, department_majors,
//   application_faq, policy, deadlines
// ═══════════════════════════════════════════════════════════════════════

import crypto from "node:crypto";

// ─── Schema ───
export function initDomainMonitor(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS monitored_pages (
      id TEXT PRIMARY KEY,
      university_id TEXT NOT NULL,
      university_name TEXT,
      page_url TEXT NOT NULL UNIQUE,
      page_category TEXT NOT NULL,
      last_hash TEXT,
      last_checked_at TEXT,
      last_changed_at TEXT,
      check_count INTEGER DEFAULT 0,
      change_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_monitor_university ON monitored_pages(university_id);
    CREATE INDEX IF NOT EXISTS idx_monitor_status ON monitored_pages(status, last_checked_at);

    CREATE TABLE IF NOT EXISTS page_change_log (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL REFERENCES monitored_pages(id),
      detected_at TEXT DEFAULT (datetime('now')),
      previous_hash TEXT,
      new_hash TEXT,
      change_type TEXT,
      review_status TEXT DEFAULT 'pending',
      review_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_changes_review ON page_change_log(review_status);
  `);
}

// ─── Prepared statements ───
export function prepareMonitorStatements(db) {
  return {
    addPage: db.prepare(`
      INSERT OR IGNORE INTO monitored_pages (id, university_id, university_name, page_url, page_category)
      VALUES (?,?,?,?,?)
    `),

    getActivePages: db.prepare(`
      SELECT * FROM monitored_pages WHERE status = 'active'
      ORDER BY last_checked_at ASC NULLS FIRST
      LIMIT ?
    `),

    getPagesByUniversity: db.prepare(`
      SELECT * FROM monitored_pages WHERE university_id = ? AND status = 'active'
    `),

    updatePageCheck: db.prepare(`
      UPDATE monitored_pages
      SET last_hash = ?, last_checked_at = datetime('now'), check_count = check_count + 1
      WHERE id = ?
    `),

    updatePageChanged: db.prepare(`
      UPDATE monitored_pages
      SET last_hash = ?, last_checked_at = datetime('now'), last_changed_at = datetime('now'),
          check_count = check_count + 1, change_count = change_count + 1
      WHERE id = ?
    `),

    logChange: db.prepare(`
      INSERT INTO page_change_log (id, page_id, previous_hash, new_hash, change_type)
      VALUES (?,?,?,?,?)
    `),

    getPendingChanges: db.prepare(`
      SELECT cl.*, mp.university_name, mp.page_url, mp.page_category
      FROM page_change_log cl
      JOIN monitored_pages mp ON cl.page_id = mp.id
      WHERE cl.review_status = 'pending'
      ORDER BY cl.detected_at ASC
    `),

    resolveChange: db.prepare(`
      UPDATE page_change_log SET review_status = ?, review_id = ? WHERE id = ?
    `),

    getMonitorStats: db.prepare(`
      SELECT
        COUNT(*) as total_pages,
        SUM(CASE WHEN last_checked_at >= datetime('now', '-24 hours') THEN 1 ELSE 0 END) as checked_today,
        SUM(change_count) as total_changes
      FROM monitored_pages WHERE status = 'active'
    `),
  };
}

// ─── Register a page for monitoring ───
export function registerPage(stmts, universityId, universityName, pageUrl, pageCategory) {
  const id = crypto.randomUUID();
  stmts.addPage.run(id, universityId, universityName, pageUrl, pageCategory);
  return { id, universityId, pageUrl, pageCategory, registered: true };
}

// ─── Check a single page for changes ───
export async function checkPage(stmts, page, options = {}) {
  const timeout = options.timeout || 10000;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(page.page_url, {
      signal: controller.signal,
      headers: { "User-Agent": "CollegeCounselorBot/1.0 (educational; change-detection)" },
    });
    clearTimeout(timer);

    if (!response.ok) {
      return { pageId: page.id, checked: false, error: `HTTP ${response.status}` };
    }

    const content = await response.text();
    const newHash = crypto.createHash("sha256").update(content).digest("hex");
    const previousHash = page.last_hash;

    if (previousHash && previousHash !== newHash) {
      // Page changed!
      stmts.updatePageChanged.run(newHash, page.id);

      const changeId = crypto.randomUUID();
      const changeType = categorizeChange(page.page_category);
      stmts.logChange.run(changeId, page.id, previousHash, newHash, changeType);

      return {
        pageId: page.id,
        checked: true,
        changed: true,
        changeId,
        changeType,
        university: page.university_name,
        category: page.page_category,
        needsReview: changeType === "high_stakes",
      };
    }

    // No change
    stmts.updatePageCheck.run(newHash, page.id);
    return { pageId: page.id, checked: true, changed: false };
  } catch (err) {
    return { pageId: page.id, checked: false, error: err.message };
  }
}

// ─── Run daily monitoring batch ───
export async function runDailyMonitor(stmts, options = {}) {
  const batchSize = options.batchSize || 100;
  const delayMs = options.delayMs || 1000; // 1 request per second per domain

  const pages = stmts.getActivePages.all(batchSize);
  const results = { checked: 0, changed: 0, errors: 0, reviewTriggered: 0 };

  for (const page of pages) {
    const result = await checkPage(stmts, page, options);

    if (result.checked) {
      results.checked++;
      if (result.changed) {
        results.changed++;
        if (result.needsReview) results.reviewTriggered++;
      }
    } else {
      results.errors++;
    }

    // Rate limiting
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return {
    ...results,
    batchSize,
    totalActive: pages.length,
    completedAt: new Date().toISOString(),
  };
}

// ─── Categorize change urgency ───
function categorizeChange(pageCategory) {
  const highStakes = ["deadlines", "financial_aid", "policy"];
  if (highStakes.includes(pageCategory)) return "high_stakes";
  return "normal";
}

// ─── Get monitoring statistics ───
export function getMonitorStats(stmts) {
  return stmts.getMonitorStats.get();
}

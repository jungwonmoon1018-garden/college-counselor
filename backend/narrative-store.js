// ═══════════════════════════════════════════════════════════════════════
// NARRATIVE STORE — versioned cache of the student's self-presentation
// ═══════════════════════════════════════════════════════════════════════
// Stores the 100-1500 char narrative a student writes about the story
// they want their application to tell (e.g., "systems-thinking computer
// scientist focused on climate policy"). Each update becomes a new row
// with is_active=1; prior active rows are flipped to is_active=0 in the
// same transaction, so we keep full history without UPDATE-in-place.
//
// extractNarrativeThemes() produces the keyword set the EC strength
// vectorizer uses for the narrative_fit factor. Themes are derived
// deterministically — no LLM — so theme extraction is fast, free, and
// reproducible.
// ═══════════════════════════════════════════════════════════════════════

import crypto from "node:crypto";
import { normalizeText, LEXICON, matchMajorBucket } from "./ec-vectorizer.js";

// Narrative is public self-presentation (not PII) so this table lives
// alongside the unified EC strength tables in counselor.db.
export function initNarrativeTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS student_narratives (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      narrative_text TEXT NOT NULL,
      extracted_themes_json TEXT,
      major_buckets_json TEXT,
      narrative_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      is_active INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_student_narratives_active
      ON student_narratives(student_id, is_active, created_at DESC);
  `);
  // Idempotent migrations for existing DBs (CREATE TABLE IF NOT EXISTS won't
  // add new columns). 'source' distinguishes student-written ('student')
  // from auto-generated ('auto') narratives so the auto-updater never
  // overwrites the student's own voice. 'profile_fingerprint' records the
  // EC/course/major set the narrative was generated against, so we can tell
  // when the story predates newly-added activities/courses.
  for (const ddl of [
    "ALTER TABLE student_narratives ADD COLUMN source TEXT DEFAULT 'student'",
    "ALTER TABLE student_narratives ADD COLUMN profile_fingerprint TEXT",
  ]) {
    try { db.exec(ddl); } catch { /* column already exists */ }
  }
}

export function prepareNarrativeStatements(db) {
  return {
    insert: db.prepare(`
      INSERT INTO student_narratives
        (id, student_id, narrative_text, extracted_themes_json,
         major_buckets_json, narrative_hash, source, profile_fingerprint,
         is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
    `),
    deactivatePrior: db.prepare(`
      UPDATE student_narratives
      SET is_active = 0
      WHERE student_id = ? AND is_active = 1
    `),
    getActive: db.prepare(`
      SELECT * FROM student_narratives
      WHERE student_id = ? AND is_active = 1
      ORDER BY created_at DESC LIMIT 1
    `),
    getById: db.prepare(`
      SELECT * FROM student_narratives WHERE id = ?
    `),
    softDelete: db.prepare(`
      UPDATE student_narratives
      SET is_active = 0
      WHERE student_id = ? AND is_active = 1
    `),
    listByStudent: db.prepare(`
      SELECT id, student_id, narrative_hash, created_at, is_active
      FROM student_narratives
      WHERE student_id = ?
      ORDER BY created_at DESC LIMIT 20
    `),
  };
}

// ─── Stopword list (EN + KR) ────────────────────────────────
// 200-word list covering the highest-frequency function words in both
// languages. Applied before n-gram extraction so themes are actually
// meaningful content words, not connectives.
const STOPWORDS_EN = [
  "a","an","the","and","or","but","if","then","else","when","while","of","at","by","for",
  "with","about","against","between","into","through","during","before","after","above","below",
  "to","from","up","down","in","out","on","off","over","under","again","further","once","here",
  "there","why","how","all","any","both","each","few","more","most","other","some","such","no",
  "nor","not","only","own","same","so","than","too","very","can","will","just","don","should",
  "now","i","me","my","myself","we","our","ours","ourselves","you","your","yours","yourself",
  "yourselves","he","him","his","himself","she","her","hers","herself","it","its","itself",
  "they","them","their","theirs","themselves","what","which","who","whom","this","that","these",
  "those","am","is","are","was","were","be","been","being","have","has","had","having","do",
  "does","did","doing","would","could","should","might","may","must","shall","also","because",
  "as","until","while","although","though","since","unless","whether","like","want","need","know",
  "think","feel","make","made","going","go","get","got","one","two","three","really","very",
  "much","many","make","take","see","look","find","say","said","said","tell","told","come","came",
];
const STOPWORDS_KR = [
  "그리고","그래서","하지만","그러나","또한","또","만약","만일","즉","때문에","때문","위해","위하여",
  "대해","대하여","대한","통해","통하여","통한","의해","의하여","의한","함께","등","것","수","등의",
  "처럼","같이","이","그","저","이런","그런","저런","이것","그것","저것","여기","거기","저기",
  "지금","이제","나는","저는","내가","나의","우리","당신","그는","그녀는","그들","이는","저는",
  "있다","있는","있었","있었다","없다","없는","없었","된다","되는","했다","한다","하는","하다",
  "이다","였다","아니다","안","못","잘","많이","조금","더","매우","정말","가장","제일",
  "그렇게","이렇게","저렇게","어떻게","무엇","누구","어디","언제","왜","으로","로","에","에서",
  "에게","한테","께","와","과","의","을","를","이","가","은","는","도","만","부터","까지",
  "마저","조차","이나","든지","라도","나","이나","거나","야","아","요","이에","대해서","에관한",
];
const STOPWORDS = new Set([...STOPWORDS_EN, ...STOPWORDS_KR]);

// ─── Theme extraction ──────────────────────────────────────
/**
 * Extract themes from a narrative string. Each theme has a weight:
 *   - unigrams:     weight 0.5
 *   - bigrams:      weight 1.0
 *   - major-bucket: weight 1.2  (source: "major_bucket")
 *
 * Returns the top 30 themes by weight, plus the detected major buckets.
 *
 * @param {string} text
 * @returns {{ themes: Array<{theme, weight, source}>, majorBuckets: string[] }}
 */
export function extractNarrativeThemes(text) {
  const norm = normalizeText(text);
  if (!norm) return { themes: [], majorBuckets: [] };

  // Tokenize: keep word chars + Korean syllables
  const tokens = norm
    .split(/[^a-z0-9\u3131-\u318E\uAC00-\uD7A3]+/)
    .filter((t) => t && t.length >= 2 && !STOPWORDS.has(t));

  const themeMap = new Map(); // theme → {theme, weight, source}

  const bump = (key, delta, source) => {
    const k = key.toLowerCase().trim();
    if (!k || k.length < 2) return;
    const prev = themeMap.get(k);
    if (prev) {
      prev.weight = Math.max(prev.weight, delta);
      if (source === "major_bucket") prev.source = "major_bucket";
    } else {
      themeMap.set(k, { theme: k, weight: delta, source });
    }
  };

  // Unigrams
  for (const t of tokens) bump(t, 0.5, "unigram");

  // Bigrams (adjacent non-stopword pairs)
  for (let i = 0; i < tokens.length - 1; i++) {
    const bigram = `${tokens[i]} ${tokens[i + 1]}`;
    bump(bigram, 1.0, "bigram");
  }

  // Major-bucket detection — give keywords from matched buckets a bump
  const majorBuckets = [];
  for (const [bucket, keywords] of Object.entries(LEXICON.majorBuckets)) {
    let hits = 0;
    for (const kw of keywords) {
      if (norm.includes(kw)) {
        bump(kw.trim(), 1.2, "major_bucket");
        hits += 1;
      }
    }
    if (hits >= 2) majorBuckets.push(bucket);
  }
  // Also try direct major-bucket inference from the normalized text
  const inferredBucket = matchMajorBucket(norm);
  if (inferredBucket && !majorBuckets.includes(inferredBucket)) {
    // Only add if we see at least one keyword from that bucket
    const bucketKeywords = LEXICON.majorBuckets[inferredBucket] || [];
    if (bucketKeywords.some((kw) => norm.includes(kw))) {
      majorBuckets.push(inferredBucket);
    }
  }

  // Sort & trim top 30
  const themes = [...themeMap.values()]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 30);

  return { themes, majorBuckets };
}

// ─── CRUD ──────────────────────────────────────────────────
/**
 * @returns {{ id, hash, themes, majorBuckets }}
 */
export function saveNarrative(stmts, studentId, narrativeText, opts = {}) {
  if (!studentId) throw new Error("studentId required");
  const text = String(narrativeText || "").trim();
  validateNarrativeText(text);

  const source = opts.source === "auto" ? "auto" : "student";
  const profileFingerprint = opts.profileFingerprint || null;

  const { themes, majorBuckets } = extractNarrativeThemes(text);
  const hash = crypto.createHash("sha256").update(text).digest("hex");
  const id = crypto.randomUUID();

  // Transactionally: deactivate prior active → insert new as active
  stmts.deactivatePrior.run(studentId);
  stmts.insert.run(
    id,
    studentId,
    text,
    JSON.stringify(themes),
    JSON.stringify(majorBuckets),
    hash,
    source,
    profileFingerprint,
  );

  return { id, hash, themes, majorBuckets, source, profileFingerprint };
}

// Stable fingerprint of the EC/course/major SET a narrative is generated
// against. Order-independent: changes only when an activity/course is
// added/removed/renamed or the major changes — exactly the events that
// should make an auto-narrative refresh (or flag a student one as stale).
export function computeProfileFingerprint(profile) {
  const norm = (s) => String(s || "").trim().toLowerCase();
  const courses = (profile?.courses || [])
    .map((c) => norm(c?.name || c?.title || c))
    .filter(Boolean)
    .sort();
  const activities = (profile?.activities || [])
    .map((a) => norm(a?.name))
    .filter(Boolean)
    .sort();
  const payload = JSON.stringify({
    major: norm(profile?.majorInterest),
    courses,
    activities,
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export function getActiveNarrative(stmts, studentId) {
  const row = stmts.getActive.get(studentId);
  if (!row) return null;
  return {
    id: row.id,
    studentId: row.student_id,
    narrativeText: row.narrative_text,
    themes: safeJSON(row.extracted_themes_json, []),
    majorBuckets: safeJSON(row.major_buckets_json, []),
    hash: row.narrative_hash,
    source: row.source || "student",
    profileFingerprint: row.profile_fingerprint || null,
    createdAt: row.created_at,
  };
}

export function softDeleteNarrative(stmts, studentId) {
  const info = stmts.softDelete.run(studentId);
  return { deactivated: info.changes };
}

// ─── Validation ────────────────────────────────────────────
export const NARRATIVE_MIN_CHARS = 100;
export const NARRATIVE_MAX_CHARS = 1500;
export const NARRATIVE_MIN_WORDS = 20;

export function validateNarrativeText(text) {
  const s = String(text || "");
  if (s.length < NARRATIVE_MIN_CHARS) {
    throw new NarrativeValidationError(
      "too_short",
      `Narrative must be at least ${NARRATIVE_MIN_CHARS} characters (got ${s.length})`,
    );
  }
  if (s.length > NARRATIVE_MAX_CHARS) {
    throw new NarrativeValidationError(
      "too_long",
      `Narrative must be at most ${NARRATIVE_MAX_CHARS} characters (got ${s.length})`,
    );
  }
  const wordCount = s.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount < NARRATIVE_MIN_WORDS) {
    throw new NarrativeValidationError(
      "too_few_words",
      `Narrative must be at least ${NARRATIVE_MIN_WORDS} words (got ${wordCount})`,
    );
  }
  return true;
}

export class NarrativeValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "NarrativeValidationError";
    this.code = code;
  }
}

function safeJSON(v, fallback) {
  if (!v) return fallback;
  if (typeof v !== "string") return v;
  try {
    const p = JSON.parse(v);
    return p ?? fallback;
  } catch {
    return fallback;
  }
}

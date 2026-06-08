// ═══════════════════════════════════════════════════════════════════════
// VECTOR STORE — Semantic search, physically separate from PII
// ═══════════════════════════════════════════════════════════════════════
// Stores embeddings for:
//   - Official university page content
//   - College descriptions and programs
//   - Anonymized benchmarks and statistics
//
// CRITICAL: No student PII is stored in this database.
// The vector store can be replaced (SQLite → Pinecone → Qdrant)
// without touching PII.
//
// Uses a simple cosine similarity search over stored embeddings.
// For production, replace with a dedicated vector database.
// ═══════════════════════════════════════════════════════════════════════

import Database from "better-sqlite3";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";

// ─── Initialize vector store database ───
export function initVectorStore(dataDir, nodeEnv = "development") {
  const vectorPath = path.join(dataDir, "vectors.db");
  fs.mkdirSync(path.dirname(vectorPath), { recursive: true });

  const db = new Database(vectorPath, {
    verbose: nodeEnv === "development" ? console.log : undefined,
  });
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS embeddings (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_id TEXT,
      source_name TEXT,
      content_text TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      embedding BLOB,
      dimensions INTEGER,
      metadata_json TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_embed_source ON embeddings(source_type, source_id);
    CREATE INDEX IF NOT EXISTS idx_embed_hash ON embeddings(content_hash);
  `);

  return { db, vectorPath };
}

// ─── Prepared statements ───
export function prepareVectorStatements(store) {
  const { db } = store;
  return {
    insertEmbedding: db.prepare(`
      INSERT INTO embeddings (id, source_type, source_id, source_name, content_text, content_hash, embedding, dimensions, metadata_json)
      VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        content_text=excluded.content_text, content_hash=excluded.content_hash,
        embedding=excluded.embedding, dimensions=excluded.dimensions,
        metadata_json=excluded.metadata_json, updated_at=datetime('now')
    `),

    getBySourceId: db.prepare(`SELECT * FROM embeddings WHERE source_type = ? AND source_id = ?`),

    getByHash: db.prepare(`SELECT * FROM embeddings WHERE content_hash = ?`),

    getAllByType: db.prepare(`SELECT * FROM embeddings WHERE source_type = ? ORDER BY source_name`),

    deleteBySource: db.prepare(`DELETE FROM embeddings WHERE source_type = ? AND source_id = ?`),

    getStats: db.prepare(`
      SELECT source_type, COUNT(*) as count, SUM(dimensions) as total_dimensions
      FROM embeddings GROUP BY source_type
    `),
  };
}

// ─── Store an embedding ───
export function storeEmbedding(stmts, item) {
  const id = item.id || crypto.randomUUID();
  const contentHash = crypto.createHash("sha256").update(item.content_text).digest("hex");

  stmts.insertEmbedding.run(
    id,
    item.source_type,
    item.source_id || null,
    item.source_name || null,
    item.content_text,
    contentHash,
    item.embedding ? Buffer.from(new Float32Array(item.embedding).buffer) : null,
    item.embedding ? item.embedding.length : 0,
    item.metadata ? JSON.stringify(item.metadata) : null,
  );

  return { id, contentHash, stored: true };
}

// ─── Simple keyword search (fallback when no embeddings available) ───
export function keywordSearch(stmts, query, sourceType = null, limit = 5) {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  if (terms.length === 0) return [];

  // Get all embeddings of the specified type
  const candidates = sourceType
    ? stmts.getAllByType.all(sourceType)
    : [];

  // Score by keyword overlap
  const scored = candidates.map((item) => {
    const text = (item.content_text + " " + (item.source_name || "")).toLowerCase();
    const score = terms.reduce((sum, term) => {
      const matches = (text.match(new RegExp(term, "g")) || []).length;
      return sum + matches;
    }, 0);
    return { ...item, score };
  });

  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      sourceType: item.source_type,
      sourceId: item.source_id,
      sourceName: item.source_name,
      contentPreview: item.content_text.slice(0, 200),
      score: item.score,
      metadata: item.metadata_json ? JSON.parse(item.metadata_json) : null,
    }));
}

// ─── Cosine similarity search (when embeddings are available) ───
export function similaritySearch(stmts, queryEmbedding, sourceType = null, limit = 5) {
  if (!queryEmbedding || queryEmbedding.length === 0) return [];

  const candidates = sourceType
    ? stmts.getAllByType.all(sourceType)
    : [];

  const scored = candidates
    .filter((item) => item.embedding && item.dimensions > 0)
    .map((item) => {
      const storedEmbedding = new Float32Array(item.embedding.buffer, item.embedding.byteOffset, item.dimensions);
      const score = cosineSimilarity(queryEmbedding, storedEmbedding);
      return { ...item, score };
    });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      sourceType: item.source_type,
      sourceId: item.source_id,
      sourceName: item.source_name,
      contentPreview: item.content_text.slice(0, 200),
      score: item.score,
      metadata: item.metadata_json ? JSON.parse(item.metadata_json) : null,
    }));
}

// ─── Cosine similarity helper ───
function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Get store statistics ───
export function getVectorStoreStats(stmts) {
  return stmts.getStats.all();
}

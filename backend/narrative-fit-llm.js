// Optional small-tier narrative-fit scorer. It uses only an explicitly
// injected administrator OpenRouter key; there are no student BYOK or
// environment fallbacks. Without a key the caller keeps its deterministic
// keyword score.
import crypto from 'node:crypto';
import {
  callLLM,
  resolveTierDefault,
  OPENROUTER_BASE_URL,
} from './llm-adapters/index.js';

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TOKENS = 80;
const MAX_NARRATIVE_CHARS = 1200;
const MAX_EC_CHARS = 1200;

export const NARRATIVE_FIT_LLM_MODEL = 'small';

export function initNarrativeFitCacheTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS narrative_fit_cache (
      cache_key TEXT PRIMARY KEY,
      score REAL NOT NULL,
      reason TEXT,
      model TEXT,
      provider TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  const columns = db.prepare('PRAGMA table_info(narrative_fit_cache)').all().map((row) => row.name);
  if (!columns.includes('provider')) {
    db.exec('ALTER TABLE narrative_fit_cache ADD COLUMN provider TEXT');
  }
}

export function prepareNarrativeFitCacheStatements(db) {
  return {
    get: db.prepare('SELECT * FROM narrative_fit_cache WHERE cache_key = ?'),
    put: db.prepare(`
      INSERT OR REPLACE INTO narrative_fit_cache
        (cache_key, score, reason, model, provider, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `),
  };
}

export function computeCacheKey(narrativeHash, ecTextHash) {
  return crypto
    .createHash('sha256')
    .update(`${narrativeHash}:${ecTextHash}`)
    .digest('hex');
}

export function hashText(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

function resolveAdapterConfig(options = {}) {
  if (options.provider && options.provider !== 'openrouter') return null;
  if (options.baseUrl && String(options.baseUrl).replace(/\/$/, '') !== OPENROUTER_BASE_URL) return null;
  if (!String(options.apiKey || '').startsWith('sk-or-')) return null;
  return {
    provider: 'openrouter',
    apiKey: options.apiKey,
    model: options.model || resolveTierDefault('openrouter', 'small'),
  };
}

export async function callHaikuForNarrativeFit({
  narrative,
  ecText,
  narrativeHash,
  ecTextHash,
  stmts,
  options = {},
}) {
  if (!narrative || !ecText) return null;
  if (!stmts) throw new Error('narrative_fit_cache statements required');

  const cacheKey = computeCacheKey(narrativeHash, ecTextHash);
  const cached = stmts.get.get(cacheKey);
  if (cached) {
    return {
      score: Number(cached.score),
      reason: String(cached.reason || ''),
      cached: true,
    };
  }

  const adapter = resolveAdapterConfig(options);
  if (!adapter?.model) return null;

  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const system =
      'Score how well an extracurricular activity fits a student-written narrative. ' +
      'Respond with JSON only: {\u0022score\u0022: NUMBER, \u0022reason\u0022: STRING}. ' +
      'Score must be 0.0-1.0 and reason must be at most 30 words.';
    const prompt =
      `NARRATIVE:\n${String(narrative).slice(0, MAX_NARRATIVE_CHARS)}` +
      `\n\nEC DESCRIPTION:\n${String(ecText).slice(0, MAX_EC_CHARS)}`;
    const response = await callLLM({
      provider: adapter.provider,
      apiKey: adapter.apiKey,
      model: adapter.model,
      system,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: MAX_TOKENS,
      temperature: 0,
      signal: controller.signal,
      fetchImpl: options.fetchImpl,
    });
    const raw = Array.isArray(response?.content)
      ? response.content.map((block) => block?.text || '').join('').trim()
      : '';
    const parsed = parseJsonLoose(raw);
    if (!parsed) return null;
    const score = clamp01(Number(parsed.score));
    if (!Number.isFinite(score)) return null;
    const reason = String(parsed.reason || '').slice(0, 240);
    stmts.put.run(cacheKey, score, reason, adapter.model, adapter.provider);
    return { score, reason, cached: false };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function parseJsonLoose(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    if (start < 0) return null;
    let depth = 0;
    for (let index = start; index < raw.length; index += 1) {
      if (raw[index] === '{') depth += 1;
      else if (raw[index] === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(raw.slice(start, index + 1));
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }
}

function clamp01(value) {
  if (!Number.isFinite(value)) return NaN;
  return Math.max(0, Math.min(1, value));
}

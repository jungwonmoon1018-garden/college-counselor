// ═══════════════════════════════════════════════════════════════════════
// KNOWLEDGE GRAPH CACHE POLICY — rebuild cadence + debounce helpers
// ═══════════════════════════════════════════════════════════════════════
// Per-student rebuild rules:
//
//   - On vault file change: debounce 90 seconds, then `graphify --update`.
//     Coalesces bursts of explicit evidence and narrative updates
//     seconds during a writing session) into a single incremental pass.
//   - Weekly: full `graphify` rebuild (no --update). Picks up any drift
//     and refreshes community detection from scratch.
//   - On council convene: force-rebuild before answering (with a 10s cap)
//     so the council sees the freshest graph.
//
// All policy lives here so the file-watcher (Pillar 8) and the council
// (Pillar 9) share one source of truth.
// ═══════════════════════════════════════════════════════════════════════

export const DEBOUNCE_MS = Number(process.env.GRAPHIFY_DEBOUNCE_MS || 90_000);
export const FULL_REBUILD_INTERVAL_MS = Number(process.env.GRAPHIFY_FULL_REBUILD_MS || 7 * 24 * 60 * 60 * 1000);
export const COUNCIL_REBUILD_BUDGET_MS = Number(process.env.GRAPHIFY_COUNCIL_REBUILD_BUDGET_MS || 10_000);

/**
 * In-memory debounce store. Keyed by studentId. Each entry holds the
 * scheduled timeout + a `nextRunAt` epoch ms so we can probe "is a
 * rebuild already queued for this student?" without firing it.
 */
const DEBOUNCED = new Map();
const LAST_FULL_REBUILD = new Map();

/**
 * Schedule a debounced rebuild for a student. If a rebuild is already
 * scheduled within the debounce window, no-op (the existing scheduler
 * will pick up the latest changes).
 */
export function scheduleDebouncedRebuild(studentId, runFn) {
  const existing = DEBOUNCED.get(studentId);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(async () => {
    DEBOUNCED.delete(studentId);
    try {
      await runFn(studentId);
    } catch (err) {
      console.error(`[cache-policy] rebuild failed for ${studentId}:`, err.message);
    }
  }, DEBOUNCE_MS);
  DEBOUNCED.set(studentId, { timer, nextRunAt: Date.now() + DEBOUNCE_MS });
}

/** True iff a debounced rebuild is currently scheduled for this student. */
export function hasPendingRebuild(studentId) {
  return DEBOUNCED.has(studentId);
}

/** Whether the student is due for a full rebuild based on the weekly cadence. */
export function isFullRebuildDue(studentId) {
  const last = LAST_FULL_REBUILD.get(studentId) || 0;
  return Date.now() - last >= FULL_REBUILD_INTERVAL_MS;
}

/** Record a full rebuild completion so the weekly cadence ticks. */
export function recordFullRebuild(studentId) {
  LAST_FULL_REBUILD.set(studentId, Date.now());
}

/** Force-cancel a pending debounce (e.g. on student deletion). */
export function cancelPendingRebuild(studentId) {
  const existing = DEBOUNCED.get(studentId);
  if (!existing) return;
  clearTimeout(existing.timer);
  DEBOUNCED.delete(studentId);
}

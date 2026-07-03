import { useEffect, useRef } from "react";

// ═══════════════════════════════════════════════════════════════════════
// useDraftPersistence — client-side auto-save for the app's OWN in-progress
// data (the survey a student is filling out), so a refresh, tab close, or
// crash doesn't lose their entries.
//
// It persists through the SAME storage layer App.jsx already uses (the async
// window.storage / localStorage `storageApi`), under a per-account key the
// caller supplies. Scope is strictly the logged-in account's own data — it
// never reads browser history, cache, or any other site's storage.
//
// Best-effort by design: every storage call is guarded, so a quota error or a
// missing storage layer degrades to "no autosave", never a thrown error.
// ═══════════════════════════════════════════════════════════════════════

// Load a previously-saved draft object, or null if none / unreadable.
export async function loadDraft(storage, key) {
  if (!storage || !key) return null;
  try {
    const r = await storage.get(key);
    return r?.value ? JSON.parse(r.value) : null;
  } catch {
    return null;
  }
}

// Remove a saved draft (call this once the data is committed, e.g. after the
// survey syncs to the backend, so a stale draft can't rehydrate later).
export async function clearDraft(storage, key) {
  if (!storage || !key) return;
  try {
    await storage.delete(key);
  } catch {
    /* ignore */
  }
}

// Debounced persistence of `value` under `key`. No-ops while `enabled` is
// false (e.g. no active account, or the user isn't on the draftable screen).
// The dependency on JSON.stringify(value) keeps the effect firing on any
// nested change without the caller having to memoize the object.
export function useDraftPersistence(storage, key, value, { enabled = true, debounceMs = 800 } = {}) {
  const timer = useRef(null);
  const serialized = JSON.stringify(value);
  useEffect(() => {
    if (!enabled || !storage || !key) return undefined;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      Promise.resolve(storage.set(key, serialized)).catch(() => {});
    }, debounceMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [storage, key, enabled, debounceMs, serialized]);
}

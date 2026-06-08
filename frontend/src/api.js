// ═══════════════════════════════════════════════════════════════════════
// src/api.js — thin client for Round 1-5 backend endpoints
// ═══════════════════════════════════════════════════════════════════════
// Centralizes the new endpoint calls (narrative, drift, candidates,
// deadlines, prestige, 5-factor strength) so App.jsx doesn't grow another
// 400 lines of inline fetch() boilerplate.
//
// Locale plumbing: every request appends ?locale=ko (or whatever the
// student picked) AND sends X-CollegeApp-Locale header — same contract as
// the skill scripts at skills/collegeapp-ai/scripts/. The server's i18n
// layer translates friendlyMessage / friendlyLegendI18n on the wire so the
// UI can render server text verbatim.
//
// Auth: reads window.__CC_SESSION_TOKEN__ at call time (App.jsx writes it
// after register/login). No state subscription — the token is a mutable
// global, the helpers are stateless.
// ═══════════════════════════════════════════════════════════════════════

const HANGUL_RE = /^ko/i;

export function getApiBase() {
  // App.jsx convention: window.__CC_PROXY_URL__ ends in "/anthropic" so the
  // existing proxy can route Anthropic completions. The other endpoints
  // share the same prefix minus "/anthropic".
  const proxyUrl = (typeof window !== "undefined" && window.__CC_PROXY_URL__) || "/api/anthropic";
  return proxyUrl.replace(/\/anthropic\/?$/, "");
}

export function getSessionToken() {
  return (typeof window !== "undefined" && window.__CC_SESSION_TOKEN__) || "";
}

export function getLocale() {
  if (typeof window === "undefined") return "en-US";
  const stored = window.localStorage?.getItem?.("cc_locale");
  if (stored) return stored;
  const nav = (window.navigator?.language || "").toLowerCase();
  if (HANGUL_RE.test(nav)) return "ko";
  return "en-US";
}

export function setLocale(locale) {
  if (typeof window !== "undefined") {
    window.localStorage?.setItem?.("cc_locale", locale);
  }
}

// ─── Error shape so callers can branch on missing-narrative ──────────────
export class NoNarrativeError extends Error {
  constructor(friendlyMessage) {
    super(friendlyMessage || "No active narrative");
    this.name = "NoNarrativeError";
    this.friendlyMessage = friendlyMessage || "Save your narrative first.";
  }
}

// ─── Core fetch wrapper ──────────────────────────────────────────────────
// Always adds locale + bearer auth + JSON content-type. Throws on !ok with
// the parsed body attached so the caller can read friendlyMessage.
async function ccFetch(path, opts = {}) {
  const locale = getLocale();
  const token = getSessionToken();
  // Callers pass root-absolute "/api/..." paths. The browser resolves a
  // relative URL string against the page origin (Vite proxies /api → backend
  // in dev; same-origin in prod), so we pass the relative path straight to
  // fetch — matching App.jsx's convention. We must NOT use
  // `new URL(path, base)` with a relative base ("/api" from __CC_PROXY_URL__):
  // that throws "Invalid base URL". Append locale as a query string.
  const sep = path.includes("?") ? "&" : "?";
  const url = (locale && !/[?&]locale=/.test(path))
    ? `${path}${sep}locale=${encodeURIComponent(locale)}`
    : path;
  const headers = {
    "Accept": "application/json",
    "X-CollegeApp-Locale": locale,
    ...(opts.headers || {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (opts.body && typeof opts.body !== "string") {
    headers["Content-Type"] = "application/json";
    opts = { ...opts, body: JSON.stringify(opts.body) };
  }
  const resp = await fetch(url.toString(), { ...opts, headers });
  const text = await resp.text();
  let json;
  try { json = text ? JSON.parse(text) : null; }
  catch { json = { raw: text }; }
  if (!resp.ok) {
    if (resp.status === 409 && (json?.error === "no_active_narrative" || /narrative/i.test(json?.error || ""))) {
      throw new NoNarrativeError(json?.friendlyMessage || json?.message);
    }
    const err = new Error(json?.message || json?.error || `HTTP ${resp.status}`);
    err.status = resp.status;
    err.body = json;
    throw err;
  }
  return json;
}

// ─── Narrative ──────────────────────────────────────────────────────────
export const narrative = {
  async save({ text }) {
    return ccFetch("/api/ec/narrative", {
      method: "POST",
      body: { narrative_text: text },
    });
  },
  async getActive() {
    try {
      return await ccFetch("/api/ec/narrative/active", { method: "GET" });
    } catch (err) {
      // 404 = no narrative yet — that's a valid steady state, not an error.
      if (err.status === 404) return null;
      throw err;
    }
  },
  async delete(id) {
    return ccFetch(`/api/ec/narrative/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  async drift() {
    return ccFetch("/api/narrative/drift", { method: "GET" });
  },
  // Generate a DRAFT narrative from the student's profile (not saved — the
  // student edits, then calls save()), optionally tailored to target schools.
  async draft(targetSchools) {
    const body = (Array.isArray(targetSchools) && targetSchools.length) ? { targetSchools } : {};
    return ccFetch("/api/narrative/draft", { method: "POST", body });
  },
};

// ─── Candidate ranker (F6) ──────────────────────────────────────────────
export const ec = {
  async rankCandidates(candidates, targetSchools) {
    const body = { candidates };
    if (Array.isArray(targetSchools) && targetSchools.length) body.targetSchools = targetSchools;
    return ccFetch("/api/ec/candidates/rank", {
      method: "POST",
      body,
    });
  },
  async strength() {
    return ccFetch("/api/ec/strength?friendly=1", { method: "GET" });
  },
  async prestige(ecName) {
    return ccFetch(`/api/ec/strength/${encodeURIComponent(ecName)}/prestige`, { method: "GET" });
  },
  // Spike Finder — which 2-3 ECs should lead the application + wellbeing read.
  async spike(targetSchools) {
    const qs = (Array.isArray(targetSchools) && targetSchools.length)
      ? `?targetSchools=${encodeURIComponent(targetSchools.join(","))}`
      : "";
    return ccFetch(`/api/ec/spike${qs}`, { method: "GET" });
  },
  // Auto-generate grounded EC ideas from the student's full profile,
  // optionally tailored to specific target universities.
  async generateIdeas(count, targetSchools) {
    const body = {};
    if (count) body.count = count;
    if (Array.isArray(targetSchools) && targetSchools.length) body.targetSchools = targetSchools;
    return ccFetch("/api/ec/ideas/generate", { method: "POST", body });
  },
};

// ─── Positioning (calibrated reach/target/safety fit) ────────────────────
export const positioning = {
  // Calibrated fit for a single looked-up college. Passes the name as a
  // target so the positioning engine resolves CDS data for it on the fly.
  async forCollege(schoolName, major) {
    return ccFetch("/api/positioning/targets", {
      method: "POST",
      body: { targets: [{ schoolName }], ...(major ? { major } : {}) },
    });
  },
};

// ─── Admissions calendar / date awareness ───────────────────────────────
export const calendar = {
  async context(targetSchools) {
    const body = (Array.isArray(targetSchools) && targetSchools.length) ? { targetSchools } : {};
    return ccFetch("/api/calendar/context", { method: "POST", body });
  },
};

// ─── Course-sequence recommender (major-aligned) ─────────────────────────
export const courses = {
  async recommendations(major, targetSchools) {
    const params = new URLSearchParams();
    if (major) params.set("major", major);
    if (Array.isArray(targetSchools) && targetSchools.length) params.set("targetSchools", targetSchools.join(","));
    const qs = params.toString();
    return ccFetch(`/api/courses/recommendations${qs ? `?${qs}` : ""}`, { method: "GET" });
  },
};

// ─── Deadlines (F7) ──────────────────────────────────────────────────────
export const deadlines = {
  async list() {
    return ccFetch("/api/students/deadlines", { method: "GET" });
  },
  async create(d) {
    return ccFetch("/api/students/deadlines", {
      method: "POST",
      body: d,
    });
  },
  async patch(id, body) {
    return ccFetch(`/api/students/deadlines/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body,
    });
  },
  async delete(id) {
    return ccFetch(`/api/students/deadlines/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },
};

// ─── Bundle (used by skill + can hydrate a quick dashboard) ──────────────
export const context = {
  async bundle({ narrativeText = false } = {}) {
    const params = new URLSearchParams({ friendly: "1" });
    if (narrativeText) params.set("narrativeText", "1");
    return ccFetch(`/api/context/bundle?${params.toString()}`, { method: "GET" });
  },
};

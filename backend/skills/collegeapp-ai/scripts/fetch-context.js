#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
// fetch-context.js — pull the /api/context/bundle payload
// ═══════════════════════════════════════════════════════════════════════
// The collegeapp-ai skill calls this on session start to hydrate its
// reasoning context. Usage:
//
//   COLLEGEAPP_BACKEND_URL=http://localhost:3001 \
//   COLLEGEAPP_SESSION_TOKEN=...jwt... \
//   node scripts/fetch-context.js [--focus holistic] [--narrative-text] [--locale ko]
//
// Prints the JSON bundle to stdout. Exits non-zero on HTTP error so the
// skill can detect a stale session token and prompt re-auth.
//
// F8 (Korean i18n): all help/error copy routes through i18n.js so a
// Korean-locale student does not see English on the terminal either.
// Locale is picked from --locale, then COLLEGEAPP_LOCALE, then LANG/LC_ALL.
// ═══════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const BACKEND = process.env.COLLEGEAPP_BACKEND_URL || "http://localhost:3001";
const TOKEN = process.env.COLLEGEAPP_SESSION_TOKEN || "";

// ─── i18n bootstrap (same pattern as register.js) ───
// Tries the backend-bundled path first, then a sibling drop-in copy, then
// falls back to an English-only stub so user-side skill installs still run
// even if they don't ship i18n.js.
async function loadI18n() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../../i18n.js"),
    path.resolve(here, "../../i18n.js"),
    path.resolve(here, "i18n.js"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const mod = await import(pathToFileURL(p).href);
        if (typeof mod.t === "function") return mod;
      }
    } catch { /* fall through */ }
  }
  return {
    t: (key) => key,
    normalizeLocale: (v) => v || "en-US",
    DEFAULT_LOCALE: "en-US",
  };
}

function detectEnvLocale() {
  const lang = process.env.COLLEGEAPP_LOCALE || process.env.LANG || process.env.LC_ALL || process.env.LC_MESSAGES || "";
  if (!lang) return "en-US";
  const lower = String(lang).toLowerCase();
  if (lower.startsWith("ko")) return "ko";
  if (lower.startsWith("es")) return "es";
  if (lower.startsWith("zh")) return "zh";
  return "en-US";
}

// ─── arg parsing ─────────────────────────────────────────────────────────
// Read args. --locale tells the backend to emit friendly labels + messages
// in that language (ko, en-US). Falls back to COLLEGEAPP_LOCALE or LANG.
function parseArgs(argv) {
  let focus = "holistic";
  let includeNarrativeText = false;
  let locale = null;
  let help = false;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--focus" && argv[i + 1]) { focus = argv[i + 1]; i++; continue; }
    if (argv[i] === "--narrative-text" || argv[i] === "--narrative") { includeNarrativeText = true; continue; }
    if (argv[i] === "--locale" && argv[i + 1]) { locale = argv[i + 1]; i++; continue; }
    if (argv[i] === "--help" || argv[i] === "-h") { help = true; continue; }
  }
  return { focus, includeNarrativeText, locale, help };
}

function printHelp(t, locale) {
  const lines = [
    t("fetch.usage", locale),
    "",
    "  " + t("fetch.focus_flag", locale),
    "  " + t("fetch.narrative_flag", locale),
    "  " + t("fetch.locale_flag", locale),
    "",
  ];
  process.stdout.write(lines.join("\n"));
}

async function main() {
  const i18n = await loadI18n();
  const { t, normalizeLocale } = i18n;
  const args = parseArgs(process.argv);
  const locale = normalizeLocale(args.locale || detectEnvLocale());

  if (args.help) { printHelp(t, locale); process.exit(0); }

  if (!TOKEN) {
    console.error(t("fetch.err.no_token", locale));
    process.exit(2);
  }

  const qs = new URLSearchParams({ focus: args.focus });
  if (args.includeNarrativeText) qs.set("narrativeText", "1");
  if (locale) qs.set("locale", locale);
  const url = `${BACKEND.replace(/\/$/, "")}/api/context/bundle?${qs.toString()}`;
  const headers = {
    "Authorization": `Bearer ${TOKEN}`,
    "Accept": "application/json",
  };
  if (locale) headers["X-CollegeApp-Locale"] = locale;
  const resp = await fetch(url, { headers });
  const text = await resp.text();
  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) {
      console.error(t("fetch.err.auth_expired", locale, { status: resp.status }));
      process.exit(3);
    }
    console.error(t("fetch.err.http", locale, { status: resp.status, url, body: text }));
    process.exit(1);
  }
  // Emit compact JSON to stdout so skill pipelines can pipe it directly.
  try {
    const parsed = JSON.parse(text);
    process.stdout.write(JSON.stringify(parsed));
  } catch {
    process.stdout.write(text);
  }
}

main().catch(async (err) => {
  try {
    const i18n = await loadI18n();
    const locale = i18n.normalizeLocale(detectEnvLocale());
    console.error(i18n.t("fetch.err.unexpected", locale, { message: err?.message || String(err) }));
  } catch {
    console.error(`error: ${err?.message || err}`);
  }
  process.exit(1);
});

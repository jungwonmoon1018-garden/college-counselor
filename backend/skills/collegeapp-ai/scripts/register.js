#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
// register.js — one-step onboarding for a new student
// ═══════════════════════════════════════════════════════════════════════
// Registers a student account, grants the three mandatory consents
// (data_processing, ai_interaction, cross_border_transfer), saves the
// student's personal narrative, and prints the resulting session token +
// student id to stdout. Matches the UX-audit F1 finding: a desperate
// student should not have to hand-roll curl calls just to start reasoning.
//
// F8 (Korean i18n): all help and error copy routes through i18n.js so a
// Korean-locale student does not see English on the terminal either.
// Locale is picked from --locale, then COLLEGEAPP_LOCALE, then LANG/LC_ALL.
//
// Usage:
//   COLLEGEAPP_BACKEND_URL=http://localhost:3001 \
//   node scripts/register.js \
//     --email "student@school.edu" \
//     --password "goodpassword1" \
//     --name "Jiyeon Park" \
//     --narrative-file ./narrative.txt
//
// Or pass the narrative inline:
//   node scripts/register.js --email … --password … --narrative "I care about …"
//
// Exit codes:
//   0 — success (JSON printed to stdout)
//   2 — bad arguments
//   3 — email already registered (try --login instead)
//   4 — backend rejected register / auth / narrative / consent
//   5 — backend unreachable at COLLEGEAPP_BACKEND_URL
//   6 — narrative is missing or fails the 100-char / 20-word minimum
//   7 — one or more mandatory Korea-PIPA consents failed to record
// ═══════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const BACKEND = (process.env.COLLEGEAPP_BACKEND_URL || "http://localhost:3001").replace(/\/$/, "");

// Resolve i18n dynamically — the skill may be installed at the user-side
// ~/.claude/skills/collegeapp-ai/ with no sibling backend, in which case
// we ship English only. The backend bundle has i18n.js 4 directories up.
async function loadI18n() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../../i18n.js"),           // backend/skills/collegeapp-ai/scripts/../../../i18n.js
    path.resolve(here, "../../i18n.js"),              // backend/skills/collegeapp-ai/scripts/../../i18n.js
    path.resolve(here, "i18n.js"),                    // sibling (if operator copied it)
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const mod = await import(pathToFileURL(p).href);
        if (typeof mod.t === "function") return mod;
      }
    } catch { /* fall through */ }
  }
  // Minimal English-only stub so the script still runs if i18n.js is
  // missing (e.g. user-side install without the backend bundle).
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

function parseArgs(argv) {
  const out = { login: false };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    switch (k) {
      case "--email":          out.email = v; i++; break;
      case "--password":       out.password = v; i++; break;
      case "--name":           out.name = v; i++; break;
      case "--narrative":      out.narrative = v; i++; break;
      case "--narrative-file": out.narrativeFile = v; i++; break;
      case "--login":          out.login = true; break;
      case "--locale":         out.locale = v; i++; break;
      case "--help":
      case "-h":               out.help = true; break;
      default:
        if (k.startsWith("--")) {
          // i18n happens after argv parse, so stash for later localization.
          out._unknownFlag = k;
          out._argParseError = true;
        }
    }
  }
  return out;
}

function printHelp(t, locale) {
  const lines = [
    t("register.usage.line1", locale),
    t("register.usage.line2", locale),
    "",
    t("register.tagline", locale),
    "",
    t("register.section.required", locale),
    "  " + t("register.required.email", locale),
    "  " + t("register.required.password", locale),
    "",
    t("register.section.required_first", locale),
    "  " + t("register.required.narrative_inline", locale),
    "  " + t("register.required.narrative_file", locale),
    "",
    t("register.section.optional", locale),
    "  " + t("register.optional.name", locale),
    "  " + t("register.optional.login", locale),
    "  " + t("register.optional.locale", locale),
    "",
    t("register.section.env", locale),
    "  " + t("register.env.backend", locale),
    "  " + t("register.env.locale", locale),
    "",
    t("register.footer", locale),
    "",
  ];
  process.stdout.write(lines.join("\n"));
}

async function post(path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const r = await fetch(`${BACKEND}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { ok: r.ok, status: r.status, json };
}

async function main() {
  const i18n = await loadI18n();
  const { t, normalizeLocale } = i18n;
  const args = parseArgs(process.argv);
  const locale = normalizeLocale(args.locale || detectEnvLocale());

  if (args.help) { printHelp(t, locale); process.exit(0); }
  if (args._argParseError) {
    console.error(t("register.err.unknown_flag", locale, { flag: args._unknownFlag }));
    process.exit(2);
  }
  if (!args.email || !args.password) {
    console.error(t("register.err.missing_email_or_password", locale));
    console.error("");
    printHelp(t, locale);
    process.exit(2);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.email)) {
    console.error(t("register.err.email_invalid", locale, { email: args.email }));
    process.exit(2);
  }
  if (String(args.password).length < 8) {
    console.error(t("register.err.password_too_short", locale));
    process.exit(2);
  }

  // Resolve narrative text (file wins over inline).
  let narrativeText = args.narrative || "";
  if (args.narrativeFile) {
    try {
      narrativeText = fs.readFileSync(args.narrativeFile, "utf8");
    } catch (err) {
      console.error(t("register.err.narrative_file_read", locale, { path: args.narrativeFile, message: err.message }));
      process.exit(2);
    }
  }
  // Narrative validation is a HARD requirement unless --login (returning
  // student, narrative already on file). The backend's minimums are
  // 100 chars and 20 words — surface that up-front.
  const trimmed = (narrativeText || "").trim();
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  const narrativeProvided = trimmed.length > 0;
  const narrativeValid = trimmed.length >= 100 && trimmed.length <= 1500 && wordCount >= 20;
  if (!args.login && !narrativeProvided) {
    console.error(t("register.err.narrative_required", locale));
    console.error(t("register.err.narrative_required_hint", locale));
    process.exit(6);
  }
  if (narrativeProvided && !narrativeValid) {
    console.error(t("register.err.narrative_size", locale));
    console.error(t("register.err.narrative_size_detail", locale, { chars: trimmed.length, words: wordCount }));
    process.exit(6);
  }

  // Step 0 — preflight.
  try {
    const probe = await fetch(`${BACKEND}/api/health`, { method: "GET" });
    if (!probe.ok && probe.status !== 404) {
      console.error(t("register.err.backend_probe", locale, { backend: BACKEND, status: probe.status }));
      process.exit(5);
    }
  } catch (err) {
    console.error(t("register.err.backend_unreachable", locale, { backend: BACKEND, message: err?.message || String(err) }));
    console.error(t("register.err.backend_unreachable_hint", locale));
    process.exit(5);
  }

  // Step 1 — register or log in.
  const authPath = args.login ? "/api/students/auth" : "/api/students/register";
  const authBody = args.login
    ? { email: args.email, password: args.password }
    : { email: args.email, password: args.password, fullName: args.name || "" };
  const auth = await post(authPath, authBody);
  if (!auth.ok) {
    if (auth.status === 409) {
      console.error(t("register.err.already_registered", locale));
      process.exit(3);
    }
    console.error(t("register.err.auth_failed", locale, { path: authPath, status: auth.status, body: JSON.stringify(auth.json) }));
    process.exit(4);
  }
  const studentId = auth.json.studentId || auth.json.student_id;
  const sessionToken = auth.json.sessionToken || auth.json.session_token;
  if (!studentId || !sessionToken) {
    console.error(t("register.err.auth_missing_fields", locale, { body: JSON.stringify(auth.json) }));
    process.exit(4);
  }

  // Step 2 — grant the mandatory consents.
  const consents = ["data_processing", "ai_interaction", "cross_border_transfer"];
  const consentFailures = [];
  for (const c of consents) {
    const r = await post("/api/consent/grant", { consentType: c, grantedBy: "student" }, sessionToken);
    if (!r.ok) consentFailures.push({ type: c, status: r.status, body: r.json });
  }
  if (consentFailures.length > 0) {
    console.error(t("register.err.consent_failed", locale));
    for (const f of consentFailures) {
      // Swap the raw enum for the friendly consent-type label so Korean users
      // see "개인정보 처리 동의" instead of "data_processing".
      const friendlyType = t(`consent.type.${f.type}`, locale);
      console.error(t("register.err.consent_failed_item", locale, {
        type: friendlyType === `consent.type.${f.type}` ? f.type : friendlyType,
        status: f.status,
        body: JSON.stringify(f.body),
      }));
    }
    console.error(t("register.err.consent_failed_hint", locale));
    process.exit(7);
  }

  // Step 3 — save the narrative.
  let narrativeId = null;
  if (narrativeProvided) {
    const r = await post("/api/ec/narrative", { narrative_text: narrativeText }, sessionToken);
    if (!r.ok) {
      console.error(t("register.err.narrative_save_failed", locale, { status: r.status, body: JSON.stringify(r.json) }));
      console.error(t("register.err.narrative_save_hint", locale));
      process.exit(6);
    }
    narrativeId = r.json.id;
  }

  // Step 4 — emit summary.
  const summary = {
    ok: true,
    studentId,
    sessionToken,
    narrativeId,
    narrativeSaved: Boolean(narrativeId),
    consentsGranted: consents,
    backendUrl: BACKEND,
    locale,
    nextStep: narrativeId
      ? t("register.nextstep.ready", locale)
      : t("register.nextstep.no_narrative", locale),
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
}

main().catch(async (err) => {
  // Best-effort localization of the final catch path — loadI18n may itself
  // have failed, so fall back to an English stub.
  try {
    const i18n = await loadI18n();
    const locale = i18n.normalizeLocale(detectEnvLocale());
    console.error(i18n.t("register.err.unexpected", locale, { message: err?.message || String(err) }));
  } catch {
    console.error(`error: ${err?.message || err}`);
  }
  process.exit(1);
});

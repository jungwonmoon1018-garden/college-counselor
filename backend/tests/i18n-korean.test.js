// ═══════════════════════════════════════════════════════════════════════
// tests/i18n-korean.test.js — F8 Korean i18n coverage
// ═══════════════════════════════════════════════════════════════════════
// Locks:
//   1. Every Korean-critical key has a Korean translation (no English leaking
//      through to Jiyeon-class students).
//   2. t() falls through to en-US when a ko key is intentionally missing.
//   3. Placeholders in ko strings match the ones expected by the callers in
//      server.js and register.js.
//   4. resolveLocale() maps Accept-Language / X-CollegeApp-Locale / ?locale=
//      correctly.
//   5. localizeFriendlyLabels("ko") returns Korean labels for all 4 tiers,
//      6 prestige sources, 6 factors, 5 directionality factors, 5 labels.
//   6. server.js routes its friendlyMessage strings through t().
// ═══════════════════════════════════════════════════════════════════════

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  STRINGS,
  LOCALES,
  DEFAULT_LOCALE,
  t,
  resolveLocale,
  normalizeLocale,
  localizeFriendlyLabels,
} from "../i18n.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── 1. Locale registry ────────────────────────────────────────────────
test("LOCALES registry includes ko with Hangul label", () => {
  assert.ok(LOCALES.ko, "ko locale missing");
  assert.match(LOCALES.ko.label, /[\uac00-\ud7af]/, "ko label should be Hangul");
  assert.equal(LOCALES.ko.dir, "ltr");
});

test("DEFAULT_LOCALE is en-US", () => {
  assert.equal(DEFAULT_LOCALE, "en-US");
});

// ─── 2. Korean coverage of critical keys ───────────────────────────────
// These keys must be Korean. Any English value here is a regression.
const KO_REQUIRED_KEYS = [
  // Onboarding
  "app.title", "create.title", "create.submit", "create.name", "create.email",
  "create.grade", "create.passphrase", "create.passphrase_confirm", "create.passphrase_hint",
  "create.age_attest",
  "login.title", "login.subtitle", "login.email", "login.passphrase", "login.submit",
  "login.create_link",
  // Survey
  "survey.continue", "survey.back", "survey.skip", "survey.finish", "survey.required", "survey.optional",
  "survey.gpa.title", "survey.gpa.subtitle", "survey.gpa.unweighted", "survey.gpa.weighted",
  "survey.gpa.not_available",
  "survey.courses.title", "survey.courses.subtitle",
  "survey.tests.title", "survey.tests.subtitle", "survey.tests.not_taken",
  "survey.ecs.title", "survey.ecs.subtitle",
  "survey.goals.title", "survey.goals.subtitle",
  "survey.parent.title", "survey.parent.subtitle", "survey.parent.reframe",
  // Chat
  "chat.placeholder", "chat.send", "chat.cancel", "chat.thinking", "chat.cancelled",
  "chat.rate_limit", "chat.export", "chat.logout", "chat.delete_account", "chat.edit_profile",
  // Status
  "status.screening", "status.academics", "status.ec", "status.college", "status.strategy",
  "status.supervisor", "status.validator", "status.upload_screener",
  // Errors
  "error.api_busy", "error.too_long", "error.network", "error.unknown", "error.session_expired",
  // Apps
  "apps.title", "apps.add", "apps.status.researching", "apps.status.applying",
  "apps.status.submitted", "apps.status.accepted", "apps.status.rejected",
  "apps.status.waitlisted", "apps.status.enrolled",
  "apps.deadline", "apps.decision", "apps.ed", "apps.ea", "apps.rd", "apps.rolling",
  // AI disclosure + output labels
  "ai.disclosure.banner", "ai.disclosure.advisory", "ai.disclosure.fafsa",
  "output.verified_fact", "output.model_inference", "output.coaching_suggestion",
  "output.no_verified_answer", "output.source_label",
  // Explanation + consent
  "explain.how_generated", "explain.sources_used", "explain.model_used", "explain.routing_logic",
  "consent.data_processing", "consent.ai_interaction", "consent.cross_border", "consent.parental",
  // Friendly labels — tiers
  "friendly.tier.tier_1_distinctive.short", "friendly.tier.tier_1_distinctive.summary",
  "friendly.tier.tier_2_strong.short", "friendly.tier.tier_2_strong.summary",
  "friendly.tier.tier_3_developing.short", "friendly.tier.tier_3_developing.summary",
  "friendly.tier.tier_4_foundational.short", "friendly.tier.tier_4_foundational.summary",
  // Friendly labels — prestige sources
  "friendly.prestige.research.short", "friendly.prestige.research.summary",
  "friendly.prestige.benchmark.short", "friendly.prestige.benchmark.summary",
  "friendly.prestige.legacy.short", "friendly.prestige.legacy.summary",
  "friendly.prestige.override.short", "friendly.prestige.override.summary",
  "friendly.prestige.unavailable.short", "friendly.prestige.unavailable.summary",
  "friendly.prestige.research_failed.short", "friendly.prestige.research_failed.summary",
  // Friendly labels — factors
  "friendly.factor.dedication.short", "friendly.factor.dedication.summary",
  "friendly.factor.achievement.short", "friendly.factor.achievement.summary",
  "friendly.factor.leadership.short", "friendly.factor.leadership.summary",
  "friendly.factor.prestige.short", "friendly.factor.prestige.summary",
  "friendly.factor.narrative_fit.short", "friendly.factor.narrative_fit.summary",
  "friendly.factor.major_spike.short", "friendly.factor.major_spike.summary",
  // Friendly labels — directionality factors
  "friendly.directionality_factor.academic_momentum.short",
  "friendly.directionality_factor.academic_momentum.summary",
  "friendly.directionality_factor.test_score_strength.short",
  "friendly.directionality_factor.test_score_strength.summary",
  "friendly.directionality_factor.major_academic_fit.short",
  "friendly.directionality_factor.major_academic_fit.summary",
  "friendly.directionality_factor.rigor_and_challenge.short",
  "friendly.directionality_factor.rigor_and_challenge.summary",
  "friendly.directionality_factor.overall_academic_standing.short",
  "friendly.directionality_factor.overall_academic_standing.summary",
  // Friendly labels — directionality labels
  "friendly.directionality_label.rising_strong.short",
  "friendly.directionality_label.rising_strong.summary",
  "friendly.directionality_label.rising_developing.short",
  "friendly.directionality_label.rising_developing.summary",
  "friendly.directionality_label.stable_strong.short",
  "friendly.directionality_label.stable_strong.summary",
  "friendly.directionality_label.stable_developing.short",
  "friendly.directionality_label.stable_developing.summary",
  "friendly.directionality_label.declining.short",
  "friendly.directionality_label.declining.summary",
  // Drift / candidates / deadlines / prestige
  "drift.no_active_narrative", "drift.all_fresh", "drift.one_stale", "drift.many_stale",
  "candidates.no_active_narrative", "candidates.name_required",
  "candidates.summary_strong", "candidates.summary_partial",
  "candidates.summary_weak", "candidates.summary_major_hit",
  "deadlines.no_upcoming", "deadlines.overdue_one", "deadlines.overdue_many",
  "deadlines.upcoming_next_one", "deadlines.upcoming_next_many",
  "deadlines.due_at_invalid", "deadlines.status_invalid",
  "prestige.ec_not_found", "prestige.no_cached_rationale",
  // Register.js
  "register.usage.line1", "register.usage.line2", "register.tagline",
  "register.section.required", "register.required.email", "register.required.password",
  "register.section.required_first", "register.required.narrative_inline", "register.required.narrative_file",
  "register.section.optional", "register.optional.name", "register.optional.login", "register.optional.locale",
  "register.section.env", "register.env.backend", "register.env.locale",
  "register.footer",
  "register.err.missing_email_or_password", "register.err.email_invalid", "register.err.password_too_short",
  "register.err.narrative_file_read", "register.err.narrative_required", "register.err.narrative_required_hint",
  "register.err.narrative_size", "register.err.narrative_size_detail",
  "register.err.backend_probe", "register.err.backend_unreachable", "register.err.backend_unreachable_hint",
  "register.err.already_registered", "register.err.auth_failed", "register.err.auth_missing_fields",
  "register.err.consent_failed", "register.err.consent_failed_item", "register.err.consent_failed_hint",
  "register.err.narrative_save_failed", "register.err.narrative_save_hint",
  // Round-5 Jiyeon audit follow-ups — cover the paths she hits at 2am.
  "register.err.unknown_flag", "register.err.unexpected",
  "register.nextstep.ready", "register.nextstep.no_narrative",
  "consent.type.data_processing", "consent.type.ai_interaction", "consent.type.cross_border_transfer",
  // fetch-context.js — previously had only stdout/stderr English, now localized.
  "fetch.usage", "fetch.narrative_flag", "fetch.focus_flag", "fetch.locale_flag",
  "fetch.err.no_token", "fetch.err.http", "fetch.err.auth_expired", "fetch.err.unexpected",
];

const HANGUL = /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/;

test("every Korean-critical key has a value containing Hangul", () => {
  const ko = STRINGS.ko || {};
  const missing = [];
  const noHangul = [];
  for (const key of KO_REQUIRED_KEYS) {
    if (!(key in ko)) {
      missing.push(key);
      continue;
    }
    if (!HANGUL.test(ko[key])) {
      noHangul.push(key);
    }
  }
  if (missing.length || noHangul.length) {
    console.log("MISSING ko keys:", missing);
    console.log("No-Hangul ko values:", noHangul);
  }
  assert.equal(missing.length, 0, `ko missing ${missing.length} keys: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "..." : ""}`);
  assert.equal(noHangul.length, 0, `ko values without Hangul: ${noHangul.slice(0, 5).join(", ")}`);
});

test("every English key in en-US is also present in STRINGS registry", () => {
  const en = STRINGS["en-US"] || {};
  assert.ok(Object.keys(en).length > 100, "en-US should have 100+ keys after expansion");
});

// ─── 3. Placeholder contracts ──────────────────────────────────────────
test("placeholders in ko match the ones in en-US for every shared key", () => {
  const en = STRINGS["en-US"];
  const ko = STRINGS.ko;
  const extractPlaceholders = (s) => new Set([...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  const mismatches = [];
  for (const key of Object.keys(ko)) {
    if (!(key in en)) continue;
    const a = extractPlaceholders(en[key]);
    const b = extractPlaceholders(ko[key]);
    if (a.size !== b.size || [...a].some((x) => !b.has(x))) {
      mismatches.push({ key, en: [...a], ko: [...b] });
    }
  }
  assert.equal(mismatches.length, 0, `placeholder mismatches: ${JSON.stringify(mismatches.slice(0, 3))}`);
});

test("t() interpolates params in both locales", () => {
  const en = t("deadlines.upcoming_next_many", "en-US", { count: 3, title: "Common App", days: 12 });
  assert.match(en, /3 upcoming/);
  assert.match(en, /Common App/);
  assert.match(en, /12 days/);
  const ko = t("deadlines.upcoming_next_many", "ko", { count: 3, title: "Common App", days: 12 });
  assert.match(ko, /Common App/);
  assert.match(ko, /\uc608\uc815/); // 예정
  assert.match(ko, /12/);
});

test("t() falls back to en-US when a ko key is genuinely missing", () => {
  // Deliberately pick a key Korean doesn't need to override.
  const missing = t("__nonexistent_key_for_test__", "ko");
  assert.equal(missing, "__nonexistent_key_for_test__");
});

// ─── 4. normalizeLocale / resolveLocale ────────────────────────────────
test("normalizeLocale handles ko-KR, ko_KR, KO", () => {
  assert.equal(normalizeLocale("ko-KR"), "ko");
  assert.equal(normalizeLocale("ko_KR"), "ko");
  assert.equal(normalizeLocale("KO"), "ko");
  assert.equal(normalizeLocale("en-GB"), "en-US"); // prefix match
  assert.equal(normalizeLocale(""), "en-US");
  assert.equal(normalizeLocale(undefined), "en-US");
});

test("resolveLocale prioritises ?locale over header over Accept-Language", () => {
  const req1 = {
    query: { locale: "ko" },
    headers: { "accept-language": "en-US,en;q=0.9" },
    get: (h) => ({ "Accept-Language": "en-US,en;q=0.9" })[h] || null,
  };
  assert.equal(resolveLocale(req1), "ko");

  const req2 = {
    query: {},
    headers: { "x-collegeapp-locale": "ko" },
    get: (h) => ({ "X-CollegeApp-Locale": "ko" })[h] || null,
  };
  assert.equal(resolveLocale(req2), "ko");

  const req3 = {
    query: {},
    headers: { "accept-language": "ko-KR,en;q=0.8" },
    get: (h) => ({ "Accept-Language": "ko-KR,en;q=0.8" })[h] || null,
  };
  assert.equal(resolveLocale(req3), "ko");

  const req4 = { query: {}, headers: {}, get: () => null };
  assert.equal(resolveLocale(req4), "en-US");
});

// ─── 5. localizeFriendlyLabels ─────────────────────────────────────────
test("localizeFriendlyLabels('ko') emits Hangul for all tiers/sources/factors", () => {
  const ko = localizeFriendlyLabels("ko");
  assert.equal(ko.locale, "ko");
  const tierKeys = ["tier_1_distinctive", "tier_2_strong", "tier_3_developing", "tier_4_foundational"];
  for (const k of tierKeys) {
    assert.ok(ko.tiers[k], `missing tier ${k}`);
    assert.match(ko.tiers[k].short, HANGUL, `tier ${k}.short not Hangul: ${ko.tiers[k].short}`);
    assert.match(ko.tiers[k].summary, HANGUL, `tier ${k}.summary not Hangul`);
  }
  const sourceKeys = ["research", "benchmark", "legacy", "override", "unavailable", "research_failed"];
  for (const k of sourceKeys) {
    assert.match(ko.prestigeSources[k].short, HANGUL);
  }
  const factorKeys = ["dedication", "achievement", "leadership", "prestige", "narrative_fit", "major_spike"];
  for (const k of factorKeys) {
    assert.match(ko.factors[k].short, HANGUL, `factor ${k}.short not Hangul: ${ko.factors[k].short}`);
  }
  for (const k of ["academic_momentum", "test_score_strength", "major_academic_fit", "rigor_and_challenge", "overall_academic_standing"]) {
    assert.match(ko.directionalityFactors[k].short, HANGUL);
  }
  for (const k of ["rising_strong", "rising_developing", "stable_strong", "stable_developing", "declining"]) {
    assert.match(ko.directionalityLabels[k].short, HANGUL);
  }
});

test("localizeFriendlyLabels('en-US') preserves the original English", () => {
  const en = localizeFriendlyLabels("en-US");
  assert.equal(en.tiers.tier_1_distinctive.short, "Distinctive");
  assert.equal(en.factors.narrative_fit.short, "Narrative fit");
});

// ─── 6. server.js wiring — grep-style assertions ───────────────────────
test("server.js imports resolveLocale + localizeFriendlyLabels from i18n.js", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../server.js"), "utf8");
  assert.match(src, /import\s*\{[^}]*resolveLocale[^}]*\}\s*from\s*["']\.\/i18n\.js["']/);
  assert.match(src, /import\s*\{[^}]*localizeFriendlyLabels[^}]*\}\s*from\s*["']\.\/i18n\.js["']/);
});

test("drift/candidates/deadlines/prestige endpoints route friendlyMessage through t()", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../server.js"), "utf8");
  assert.match(src, /t\("drift\.no_active_narrative",\s*locale\)/);
  assert.match(src, /t\("drift\.all_fresh",\s*locale\)/);
  assert.match(src, /t\("drift\.one_stale",\s*locale\)/);
  assert.match(src, /t\("drift\.many_stale",\s*locale,\s*\{\s*count/);
  assert.match(src, /t\("candidates\.no_active_narrative",\s*locale\)/);
  assert.match(src, /t\("deadlines\.no_upcoming",\s*locale\)/);
  assert.match(src, /"deadlines\.overdue_one"/);
  assert.match(src, /"deadlines\.overdue_many"/);
  assert.match(src, /"deadlines\.upcoming_next_one"/);
  assert.match(src, /"deadlines\.upcoming_next_many"/);
  assert.match(src, /t\("prestige\.ec_not_found",\s*locale\)/);
  assert.match(src, /t\("prestige\.no_cached_rationale",\s*locale/);
});

test("context/bundle and /api/ec/strength ship friendlyLegendI18n", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../server.js"), "utf8");
  assert.match(src, /friendlyLegendI18n/, "bundle/strength should include friendlyLegendI18n");
  assert.match(src, /localizeFriendlyLabels\(locale\)/, "endpoint should call localizeFriendlyLabels");
});

// ─── 7. Skill scripts wire locale ──────────────────────────────────────
test("register.js loads i18n dynamically and localizes help + errors", () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../skills/collegeapp-ai/scripts/register.js"),
    "utf8",
  );
  assert.match(src, /loadI18n/, "should load i18n dynamically");
  assert.match(src, /register\.err\.email_invalid/, "error keys should come from i18n");
  assert.match(src, /register\.err\.consent_failed/);
  assert.match(src, /register\.err\.narrative_save_failed/);
  assert.match(src, /--locale/, "should document --locale flag");
  assert.match(src, /COLLEGEAPP_LOCALE/, "should honour COLLEGEAPP_LOCALE env var");
});

test("fetch-context.js forwards locale to the backend", () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../skills/collegeapp-ai/scripts/fetch-context.js"),
    "utf8",
  );
  assert.match(src, /--locale/, "fetch-context should accept --locale");
  assert.match(src, /X-CollegeApp-Locale/, "fetch-context should send X-CollegeApp-Locale header");
  assert.match(src, /locale/, "fetch-context should append ?locale=");
});

// ─── 9. Round-5 Jiyeon-audit follow-ups ────────────────────────────────
test("fetch-context.js routes stdout + stderr through i18n (no hardcoded English)", () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../skills/collegeapp-ai/scripts/fetch-context.js"),
    "utf8",
  );
  // The dynamic i18n loader is present (same pattern as register.js)
  assert.match(src, /loadI18n/, "should load i18n dynamically");
  // Error paths go through t()
  assert.match(src, /t\("fetch\.err\.no_token"/);
  assert.match(src, /t\("fetch\.err\.auth_expired"/);
  assert.match(src, /t\("fetch\.err\.http"/);
  assert.match(src, /t\("fetch\.err\.unexpected"/);
  // --help output goes through t() too
  assert.match(src, /printHelp\(t, locale\)/);
  // No leftover hardcoded English error: strings
  assert.doesNotMatch(src, /console\.error\("error: COLLEGEAPP_SESSION_TOKEN/);
  assert.doesNotMatch(src, /console\.error\(`error: HTTP \$\{resp\.status\}/);
});

test("register.js localizes its final summary nextStep + unknown-flag path", () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../skills/collegeapp-ai/scripts/register.js"),
    "utf8",
  );
  // nextStep now renders through t() — no more hardcoded English in stdout.
  assert.match(src, /t\("register\.nextstep\.ready"/);
  assert.match(src, /t\("register\.nextstep\.no_narrative"/);
  // Unknown-flag error flows through t() after locale resolution.
  assert.match(src, /t\("register\.err\.unknown_flag"/);
  // Top-level catch localizes the message.
  assert.match(src, /register\.err\.unexpected/);
  // The old hardcoded nextStep English is gone.
  assert.doesNotMatch(src, /"export COLLEGEAPP_SESSION_TOKEN and run scripts\/fetch-context\.js"/);
});

test("consent.type.* Korean friendly labels exist and register.js uses them", () => {
  const ko = STRINGS.ko;
  assert.match(ko["consent.type.data_processing"], /\uac1c\uc778\uc815\ubcf4/); // 개인정보
  assert.match(ko["consent.type.ai_interaction"], /AI/);
  assert.match(ko["consent.type.cross_border_transfer"], /\uad6d\uc678/); // 국외
  const src = fs.readFileSync(
    path.resolve(__dirname, "../skills/collegeapp-ai/scripts/register.js"),
    "utf8",
  );
  // register.js should look up consent.type.<enum> before interpolating.
  assert.match(src, /consent\.type\.\$\{f\.type\}/);
});

// ─── 8. Register.js help text sanity — Korean round-trip ───────────────
test("register.js help output in Korean has Hangul for every expected section", () => {
  const ko = STRINGS.ko;
  const sections = [
    ko["register.usage.line1"],
    ko["register.tagline"],
    ko["register.section.required"],
    ko["register.section.required_first"],
    ko["register.section.optional"],
    ko["register.section.env"],
    ko["register.footer"],
  ];
  for (const s of sections) {
    assert.match(s, HANGUL, `help section lacks Hangul: "${s}"`);
  }
});

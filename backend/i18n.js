// ═══════════════════════════════════════════════════════════════════════
// i18n — Internationalization, AI Disclosure, & First-Gen Glossary
// ═══════════════════════════════════════════════════════════════════════
// Provides:
//   1. Translation strings for all UI text (en-US + ko full coverage; others stubs)
//   2. Namespaced keys for the Round 1-4 student-facing copy (friendly labels,
//      drift messages, candidate-rank messages, deadline messages, prestige
//      rationale copy, onboarding help + errors from scripts/register.js)
//   3. College admissions glossary for first-gen students
//   4. International curriculum support (IB, A-Level, CBSE)
//   5. Locale-aware formatting (dates, numbers, currency)
//   6. AI disclosure strings (Korea AI Basic Act compliance)
//   7. Output labeling strings for three-lane responses
//   8. resolveLocale(req) — picks the best locale from the request
//   9. localizeFriendlyLabels(locale) — locale-aware mirrors of friendly-labels.js
//
// F8 from the Jiyeon UX audit ("Korean students see English strings on
// student-facing surfaces"). The goal is zero untranslated strings on the
// paths a Korean 11th-grader actually reads — onboarding, narrative drift,
// candidate ranking, deadlines, prestige rationale, friendly labels.
// ═══════════════════════════════════════════════════════════════════════

// ─── SUPPORTED LOCALES ───
export const LOCALES = {
  "en-US": { label: "English (US)", dir: "ltr" },
  "es":    { label: "Espa\u00f1ol", dir: "ltr" },
  "ko":    { label: "\ud55c\uad6d\uc5b4", dir: "ltr" },
  "zh":    { label: "\u4e2d\u6587", dir: "ltr" },
  "hi":    { label: "\u0939\u093f\u0928\u094d\u0926\u0940", dir: "ltr" },
  "ar":    { label: "\u0627\u0644\u0639\u0631\u0628\u064a\u0629", dir: "rtl" },
};

export const DEFAULT_LOCALE = "en-US";

// ─── TRANSLATION STRINGS ───
// en-US is fully populated. ko is fully populated for every student-facing
// surface introduced in Rounds 1-4 (friendly labels, drift, candidates,
// deadlines, prestige rationale, register.js) plus the long-standing
// onboarding/survey/chat/apps/error paths. Other locales get en-US fallback.
//
// Naming conventions:
//   friendly.tier.<tier_label>.short|summary            — TIER_FRIENDLY
//   friendly.prestige.<source_enum>.short|summary       — PRESTIGE_SOURCE_FRIENDLY
//   friendly.factor.<factor_key>.short|summary          — FACTOR_FRIENDLY
//   friendly.directionality_factor.<key>.short|summary  — DIRECTIONALITY_FACTOR_FRIENDLY
//   friendly.directionality_label.<key>.short|summary   — DIRECTIONALITY_LABEL_FRIENDLY
//   drift.*                                             — /api/narrative/drift
//   candidates.*                                        — /api/ec/candidates/rank
//   deadlines.*                                         — /api/students/deadlines
//   prestige.*                                          — /api/ec/strength/:ecName/prestige
//   register.*                                          — scripts/register.js help + errors
//   fetch.*                                             — scripts/fetch-context.js help
export const STRINGS = {
  "en-US": {
    // ─── Onboarding ───
    "app.title": "College Counselor",
    "app.subtitle": "AI-powered college planning for high school students",
    "create.title": "Create your account",
    "create.subtitle": "Your data is encrypted and stored locally on your device.",
    "create.name": "Full name",
    "create.email": "School email",
    "create.grade": "Current grade",
    "create.passphrase": "Passphrase",
    "create.passphrase_confirm": "Confirm passphrase",
    "create.passphrase_hint": "Use a memorable phrase like: my dog spot ate homework",
    "create.age_attest": "I confirm I am a high school student (ages 14-18), or I have parental/guardian consent to use this tool.",
    "create.submit": "Create account",
    "login.title": "Welcome back",
    "login.subtitle": "Sign in to your encrypted vault",
    "login.email": "School email",
    "login.passphrase": "Passphrase",
    "login.submit": "Sign in",
    "login.create_link": "New student? Create account",

    // ─── Survey ───
    "survey.step": "Step {current}/{total}",
    "survey.required": "Required",
    "survey.optional": "Optional",
    "survey.continue": "Continue",
    "survey.back": "Back",
    "survey.skip": "Skip",
    "survey.finish": "Finish setup",
    "survey.gpa.title": "Your GPA",
    "survey.gpa.subtitle": "We use this to find schools that match your academic profile.",
    "survey.gpa.unweighted": "Unweighted GPA (4.0 scale)",
    "survey.gpa.weighted": "Weighted GPA (optional)",
    "survey.gpa.not_available": "I don't have a GPA yet",
    "survey.courses.title": "Your courses",
    "survey.courses.subtitle": "Add courses by school year. Include AP, IB, Honors, and Dual Enrollment.",
    "survey.tests.title": "Test scores",
    "survey.tests.subtitle": "SAT, ACT, AP exams, and other standardized tests.",
    "survey.tests.not_taken": "I haven't taken any tests yet",
    "survey.ecs.title": "Extracurriculars",
    "survey.ecs.subtitle": "Clubs, sports, volunteering, work, research, arts.",
    "survey.goals.title": "Your goals",
    "survey.goals.subtitle": "What kind of college experience are you looking for?",
    "survey.parent.title": "Emergency contact",
    "survey.parent.subtitle": "If you ever need help, we want to make sure someone you trust knows.",
    "survey.parent.reframe": "This is completely optional. We never share what you say \u2014 only that you might need support.",

    // ─── Chat ───
    "chat.placeholder": "Ask about academics, ECs, colleges, or strategy...",
    "chat.placeholder_file": "Add a message about this file...",
    "chat.send": "Send",
    "chat.cancel": "Cancel",
    "chat.thinking": "Thinking...",
    "chat.cancelled": "Cancelled. You can send a new question whenever you're ready.",
    "chat.rate_limit": "You're sending messages too quickly. Please wait a moment.",
    "chat.export": "Export",
    "chat.logout": "Log out",
    "chat.delete_account": "Delete account",
    "chat.edit_profile": "Edit profile",
    "chat.file_types": "PDF, images",

    // ─── Agent status ───
    "status.screening": "Checking your question...",
    "status.academics": "Researching academics...",
    "status.ec": "Analyzing activities...",
    "status.college": "Searching colleges...",
    "status.strategy": "Building your plan...",
    "status.supervisor": "Combining advice...",
    "status.validator": "Verifying accuracy...",
    "status.upload_screener": "Checking upload safety...",

    // ─── Errors ───
    "error.api_busy": "The system is busy right now. Please try again in a minute.",
    "error.too_long": "Your message was too long. Try a shorter question.",
    "error.network": "Check your internet connection and try again.",
    "error.unknown": "Something went wrong. Please try again.",
    "error.session_expired": "Session expired due to inactivity. Please sign in again.",

    // ─── Application tracker ───
    "apps.title": "My Applications",
    "apps.add": "Add college",
    "apps.status.researching": "Researching",
    "apps.status.applying": "Applying",
    "apps.status.submitted": "Submitted",
    "apps.status.accepted": "Accepted",
    "apps.status.rejected": "Rejected",
    "apps.status.waitlisted": "Waitlisted",
    "apps.status.enrolled": "Enrolled",
    "apps.deadline": "Deadline",
    "apps.decision": "Decision type",
    "apps.ed": "Early Decision",
    "apps.ea": "Early Action",
    "apps.rd": "Regular Decision",
    "apps.rolling": "Rolling",

    // ─── AI Disclosure ───
    "ai.disclosure.banner": "This service uses AI (artificial intelligence) to provide guidance. AI-generated content is clearly labeled.",
    "ai.disclosure.session": "This response was generated with AI assistance. Verified facts are sourced from official publications.",
    "ai.disclosure.model": "AI Model: Claude via Anthropic API",
    "ai.disclosure.advisory": "This tool provides informational guidance only. It is not a substitute for professional college counseling, financial advice, or official determinations.",
    "ai.disclosure.fafsa": "This is NOT an official FAFSA tool and does not replace StudentAid.gov.",

    // ─── Output labels (three-lane) ───
    "output.verified_fact": "Verified fact from official source",
    "output.model_inference": "AI-generated inference",
    "output.coaching_suggestion": "Non-binding coaching suggestion",
    "output.no_verified_answer": "No verified answer available for this question.",
    "output.source_label": "Source",

    // ─── Explanation capability ───
    "explain.how_generated": "How this response was generated",
    "explain.sources_used": "Sources used",
    "explain.model_used": "AI model used",
    "explain.routing_logic": "Routing logic",

    // ─── Consent (Korea PIPA) ───
    "consent.data_processing": "Data Processing Consent",
    "consent.ai_interaction": "AI Interaction Consent",
    "consent.cross_border": "Cross-Border Data Transfer Consent",
    "consent.parental": "Parental Notification Consent",

    // ─── Friendly labels — tier ───
    "friendly.tier.tier_1_distinctive.short": "Distinctive",
    "friendly.tier.tier_1_distinctive.summary": "Reads as a top-tier application piece \u2014 national-level depth.",
    "friendly.tier.tier_2_strong.short": "Strong",
    "friendly.tier.tier_2_strong.summary": "Clear value beyond participation \u2014 you've committed real time and delivered.",
    "friendly.tier.tier_3_developing.short": "Developing",
    "friendly.tier.tier_3_developing.summary": "Visible commitment with room to deepen before application season.",
    "friendly.tier.tier_4_foundational.short": "Foundational",
    "friendly.tier.tier_4_foundational.summary": "You've started \u2014 small, steady steps count here. No shame in the early chapter.",

    // ─── Friendly labels — prestige source ───
    "friendly.prestige.research.short": "Researched",
    "friendly.prestige.research.summary": "Scored from reputable admissions + competition sources. See rationale.",
    "friendly.prestige.benchmark.short": "Matched",
    "friendly.prestige.benchmark.summary": "Recognised as a well-known competition in our catalogue.",
    "friendly.prestige.legacy.short": "Not yet scored",
    "friendly.prestige.legacy.summary": "We haven't looked this one up yet \u2014 ask to refresh and we'll research it.",
    "friendly.prestige.override.short": "Counselor set",
    "friendly.prestige.override.summary": "Your counselor set this score manually based on personal knowledge.",
    "friendly.prestige.unavailable.short": "Research unavailable",
    "friendly.prestige.unavailable.summary": "Prestige lookup needs an Anthropic key \u2014 ask your counselor to enable it.",
    "friendly.prestige.research_failed.short": "Needs your context",
    "friendly.prestige.research_failed.summary": "We couldn't find public sources for this one yet \u2014 a counselor can add detail.",

    // ─── Friendly labels — EC factors ───
    "friendly.factor.dedication.short": "Dedication",
    "friendly.factor.dedication.summary": "Total hours \u00d7 years \u00d7 how recently you were active.",
    "friendly.factor.achievement.short": "Achievement",
    "friendly.factor.achievement.summary": "Verified awards or outcomes compared to what this activity typically produces.",
    "friendly.factor.leadership.short": "Leadership",
    "friendly.factor.leadership.summary": "Scope of responsibility \u2014 people you lead, budget, or outputs you own.",
    "friendly.factor.prestige.short": "Prestige",
    "friendly.factor.prestige.summary": "How elite this activity reads to a US admissions officer.",
    "friendly.factor.narrative_fit.short": "Narrative fit",
    "friendly.factor.narrative_fit.summary": "How tightly this activity connects to your written story and intended major.",
    "friendly.factor.major_spike.short": "Major spike",
    "friendly.factor.major_spike.summary": "How directly this activity signals your intended major.",

    // ─── Friendly labels — directionality factors ───
    "friendly.directionality_factor.academic_momentum.short": "Momentum",
    "friendly.directionality_factor.academic_momentum.summary": "GPA trajectory across semesters \u2014 are you rising or flat?",
    "friendly.directionality_factor.test_score_strength.short": "Test scores",
    "friendly.directionality_factor.test_score_strength.summary": "SAT/ACT/AP scores vs. your target schools' 25th/75th.",
    "friendly.directionality_factor.major_academic_fit.short": "Major fit",
    "friendly.directionality_factor.major_academic_fit.summary": "Coursework + grades in your intended major's feeder subjects.",
    "friendly.directionality_factor.rigor_and_challenge.short": "Rigor",
    "friendly.directionality_factor.rigor_and_challenge.summary": "Courseload difficulty relative to what your school offers.",
    "friendly.directionality_factor.overall_academic_standing.short": "Overall standing",
    "friendly.directionality_factor.overall_academic_standing.summary": "Composite signal across all factors.",

    // ─── Friendly labels — directionality labels ───
    "friendly.directionality_label.rising_strong.short": "Rising strong",
    "friendly.directionality_label.rising_strong.summary": "You're trending upward and already at a competitive level.",
    "friendly.directionality_label.rising_developing.short": "Rising developing",
    "friendly.directionality_label.rising_developing.summary": "Trajectory is positive but the baseline still needs lift.",
    "friendly.directionality_label.stable_strong.short": "Stable strong",
    "friendly.directionality_label.stable_strong.summary": "Consistently competitive \u2014 reach schools are realistic.",
    "friendly.directionality_label.stable_developing.short": "Stable developing",
    "friendly.directionality_label.stable_developing.summary": "Flat but serviceable \u2014 target/safety schools will notice.",
    "friendly.directionality_label.declining.short": "Declining",
    "friendly.directionality_label.declining.summary": "Recent semesters are weaker. This is fixable \u2014 many students write a short note explaining what changed.",

    // ─── Drift (F10) ───
    "drift.no_active_narrative": "No active narrative yet \u2014 save one with POST /api/ec/narrative to unlock drift detection.",
    "drift.all_fresh": "Every activity's narrative_fit was scored against your current narrative. You're up to date.",
    "drift.one_stale": "1 activity still reflects an older version of your story. One-click recompute from the Activities page.",
    "drift.many_stale": "{count} activities still reflect an older version of your story. Recompute them so your fit scores line up with what you just wrote.",

    // ─── Candidates (F6) ───
    "candidates.no_active_narrative": "Save your narrative first (POST /api/ec/narrative). Candidate ranking needs your story as the baseline.",
    "candidates.name_required": "name required",
    "candidates.summary_strong": "Strong fit: touches your {bucket} track and aligns with {themes}. Predicted narrative fit \u2248 {fit}.",
    "candidates.summary_partial": "Partial fit: brushes {themes} but doesn't land in your declared major direction.",
    "candidates.summary_weak": "Weak narrative fit \u2014 no major or theme overlap. Rewrite your narrative first, or pick a different candidate.",
    "candidates.summary_major_hit": "Major-bucket match for {bucket}, no theme overlap yet. Could become strong if you frame it toward your story.",

    // ─── Deadlines (F7) ───
    "deadlines.no_upcoming": "No upcoming deadlines on your list. Add one with POST /api/students/deadlines.",
    "deadlines.overdue_one": "{count} deadline already passed \u2014 snooze or mark done.",
    "deadlines.overdue_many": "{count} deadlines already passed \u2014 snooze or mark done.",
    "deadlines.upcoming_next_one": "{count} upcoming \u2014 next is {title} in 1 day.",
    "deadlines.upcoming_next_many": "{count} upcoming \u2014 next is {title} in {days} days.",
    "deadlines.due_at_invalid": "dueAt must be a parseable ISO-8601 date",
    "deadlines.status_invalid": "status must be open|done|snoozed",

    // ─── Prestige rationale (F5) ───
    "prestige.ec_not_found": "We don't have this activity on file. Check the spelling on your activities list, or upload a new attachment for it.",
    "prestige.no_cached_rationale": "{short}: {summary} Want a fresh lookup? Hit the recompute URL below.",

    // ─── Register.js CLI copy (F1) ───
    "register.usage.line1": "Usage: node scripts/register.js --email <addr> --password <pw> [--name <full name>]",
    "register.usage.line2": "                                [--narrative <text> | --narrative-file <path>] [--login] [--locale <code>]",
    "register.tagline": "Registers (or logs in with --login) and seeds the student's narrative in one step.",
    "register.section.required": "Required:",
    "register.required.email": "--email        school email (e.g. you@school.edu). A school domain is preferred;\n                 the backend may reject personal addresses.",
    "register.required.password": "--password     \u2265 8 characters, must include a letter and a digit. Stored hashed\n                 with per-student salt; we never log it.",
    "register.section.required_first": "Required on first registration (skippable only if you already saved it):",
    "register.required.narrative_inline": "--narrative <text>          the raw 100-1500 character story that drives your\n                              subject + EC + school choices.",
    "register.required.narrative_file": "--narrative-file <path>     path to a UTF-8 file with that story. Prefer this\n                              over --narrative so the shell doesn't truncate it.",
    "register.section.optional": "Optional:",
    "register.optional.name": "--name <full name>          kept in the PII vault, never sent to the LLM.",
    "register.optional.login": "--login                     skip registration and fetch a token for an existing\n                              account. Narrative save is still attempted if one\n                              is provided.",
    "register.optional.locale": "--locale <code>             ko or en-US. Controls the language of register.js\n                              error + help output. Default: en-US.",
    "register.section.env": "Environment:",
    "register.env.backend": "COLLEGEAPP_BACKEND_URL      default http://localhost:3001. Must be reachable\n                              from this machine.",
    "register.env.locale": "COLLEGEAPP_LOCALE           optional locale fallback (ko, en-US).",
    "register.footer": "On success a JSON object is printed with studentId, sessionToken, narrativeId.\nSave the sessionToken \u2014 you will pass it to fetch-context.js via\n$COLLEGEAPP_SESSION_TOKEN.",
    "register.err.missing_email_or_password": "error: --email and --password are required.",
    "register.err.email_invalid": "error: --email \"{email}\" does not look like a valid address",
    "register.err.password_too_short": "error: --password must be at least 8 characters (the backend will also require a digit and a letter).",
    "register.err.narrative_file_read": "error: reading --narrative-file {path}: {message}",
    "register.err.narrative_required": "error: --narrative or --narrative-file is required for new registrations.",
    "register.err.narrative_required_hint": "       Tell the backend why you want to go to college in your own voice (100-1500 chars, \u2265 20 words).",
    "register.err.narrative_size": "error: narrative does not meet minimum size.",
    "register.err.narrative_size_detail": "       length={chars} chars (need 100-1500), words={words} (need \u2265 20)",
    "register.err.backend_probe": "error: backend at {backend} returned HTTP {status} on /api/health",
    "register.err.backend_unreachable": "error: cannot reach backend at {backend} ({message}).",
    "register.err.backend_unreachable_hint": "       Set COLLEGEAPP_BACKEND_URL to the host your counselor gave you.",
    "register.err.already_registered": "error: email already registered. Retry with --login to fetch a fresh token.",
    "register.err.auth_failed": "error: {path} returned HTTP {status}: {body}",
    "register.err.auth_missing_fields": "error: backend response missing studentId / sessionToken: {body}",
    "register.err.consent_failed": "error: one or more mandatory consents did not record.",
    "register.err.consent_failed_item": "       - {type}: HTTP {status} {body}",
    "register.err.consent_failed_hint": "       /api/llm will 403 until these are granted. Contact your counselor.",
    "register.err.narrative_save_failed": "error: narrative save failed (HTTP {status}): {body}",
    "register.err.narrative_save_hint": "       Fix the narrative text and re-run with --login.",
    "register.err.unknown_flag": "error: unknown flag: {flag}. Run with --help to see all options.",
    "register.err.unexpected": "error: unexpected failure: {message}",
    "register.nextstep.ready": "Export COLLEGEAPP_SESSION_TOKEN with the token above, then run scripts/fetch-context.js to pull your reasoning bundle.",
    "register.nextstep.no_narrative": "Save your narrative to ./narrative.txt, then POST /api/ec/narrative with your session token.",

    // ─── Consent-type friendly labels (for register error paths) ───
    // Used by register.err.consent_failed_item when a grant call fails — we
    // look up the enum → friendly name so Jiyeon sees "개인정보 처리 동의"
    // instead of "data_processing".
    "consent.type.data_processing": "Data processing consent",
    "consent.type.ai_interaction": "AI interaction consent",
    "consent.type.cross_border_transfer": "Cross-border data transfer consent",

    // ─── Fetch-context.js CLI copy ───
    "fetch.usage": "Usage: node scripts/fetch-context.js [--focus FOCUS] [--narrative-text] [--locale LOCALE]",
    "fetch.narrative_flag": "--narrative-text          include the raw narrative text in the bundle (opt-in, v1.1).",
    "fetch.focus_flag": "--focus FOCUS             focus tag for the bundle (default: holistic).",
    "fetch.locale_flag": "--locale LOCALE           ko | en-US. Asks the backend to localize friendly labels.",
    "fetch.err.no_token": "error: COLLEGEAPP_SESSION_TOKEN env var is required. Run scripts/register.js first.",
    "fetch.err.http": "error: HTTP {status} from {url}\n{body}",
    "fetch.err.auth_expired": "error: session token rejected (HTTP {status}). Re-run scripts/register.js --login to refresh.",
    "fetch.err.unexpected": "error: unexpected failure: {message}",
  },

  // ═════════════════════════════════════════════════════════════════════
  // Korean (ko) — full coverage of student-facing surfaces
  // ═════════════════════════════════════════════════════════════════════
  // Tone: 반말 is too casual for an admissions product; 존댓말 with a warm
  // advisor voice. We use "활동" for extracurriculars (neutral, matches
  // Korean 진학 vocabulary) and keep English acronyms (GPA/SAT/ACT/AP/IB)
  // because Korean students recognise them in that form.
  "ko": {
    "app.title": "\ub300\ud559 \uc9c4\ud559 \ucf54\uce58",
    "app.subtitle": "\uace0\ub4f1\ud559\uc0dd\uc744 \uc704\ud55c AI \uae30\ubc18 \ub300\ud559 \uc9c4\ud559 \uc124\uacc4",
    "create.title": "\uacc4\uc815 \ub9cc\ub4e4\uae30",
    "create.subtitle": "\uc785\ub825\ud55c \ub370\uc774\ud130\ub294 \uc554\ud638\ud654\ub418\uc5b4 \uae30\uae30\uc5d0 \uc800\uc7a5\ub429\ub2c8\ub2e4.",
    "create.name": "\uc131\ud568",
    "create.email": "\ud559\uad50 \uc774\uba54\uc77c",
    "create.grade": "\ud604\uc7ac \ud559\ub144",
    "create.passphrase": "\ube44\ubc00\ubc88\ud638",
    "create.passphrase_confirm": "\ube44\ubc00\ubc88\ud638 \ud655\uc778",
    "create.passphrase_hint": "\uae30\uc5b5\ud558\uae30 \uc26c\uc6b4 \ubb38\uc7a5\uc744 \uc368 \uc8fc\uc138\uc694, \uc608: \ub098\uc758\uac15\uc544\uc9c0\uac00\uc9d1\uc744\uc9c0\ud0a8\ub2e4",
    "create.age_attest": "\uc800\ub294 \uace0\ub4f1\ud559\uc0dd(\ub9cc 14\u201318\uc138)\uc774\uac70\ub098, \ubcf4\ud638\uc790\uc758 \ub3d9\uc758\ub97c \ubc1b\uace0 \uc774 \ub3c4\uad6c\ub97c \uc0ac\uc6a9\ud569\ub2c8\ub2e4.",
    "create.submit": "\uacc4\uc815 \ub9cc\ub4e4\uae30",
    "login.title": "\ub2e4\uc2dc \ub9cc\ub098\uc11c \ubc18\uac11\uc2b5\ub2c8\ub2e4",
    "login.subtitle": "\uc554\ud638\ud654\ub41c \ub0b4 \ubcf4\uad00\ud568\uc73c\ub85c \ub85c\uadf8\uc778",
    "login.email": "\ud559\uad50 \uc774\uba54\uc77c",
    "login.passphrase": "\ube44\ubc00\ubc88\ud638",
    "login.submit": "\ub85c\uadf8\uc778",
    "login.create_link": "\ucc98\uc74c \uc624\uc168\uc5b4\uc694? \uacc4\uc815 \ub9cc\ub4e4\uae30",

    // Survey
    "survey.step": "{current}/{total}\ub2e8\uacc4",
    "survey.required": "\ud544\uc218",
    "survey.optional": "\uc120\ud0dd",
    "survey.continue": "\uacc4\uc18d",
    "survey.back": "\ub4a4\ub85c",
    "survey.skip": "\uac74\ub108\ub6f0\uae30",
    "survey.finish": "\uc124\uc815 \ub9c8\uce58\uae30",
    "survey.gpa.title": "\ub0b4 GPA",
    "survey.gpa.subtitle": "\ud559\uc5c5 \ud504\ub85c\ud544\uacfc \uc798 \ub9de\ub294 \ud559\uad50\ub97c \ucc3e\ub294 \ub370 \uc0ac\uc6a9\ud569\ub2c8\ub2e4.",
    "survey.gpa.unweighted": "\ube44\uac00\uc911 GPA (4.0 \uae30\uc900)",
    "survey.gpa.weighted": "\uac00\uc911 GPA (\uc120\ud0dd)",
    "survey.gpa.not_available": "\uc544\uc9c1 GPA\uac00 \uc5c6\uc5b4\uc694",
    "survey.courses.title": "\uc218\uac15 \uacfc\ubaa9",
    "survey.courses.subtitle": "\ud559\ub144\ubcc4\ub85c \uc218\uac15 \uacfc\ubaa9\uc744 \ucd94\uac00\ud558\uc138\uc694. AP, IB, \uc6b0\uc218\uc0dd \uacfc\uc815, \ub300\ud559 \uc774\uc911 \uc131\uc801 \ud3ec\ud568.",
    "survey.tests.title": "\uc2dc\ud5d8 \uc810\uc218",
    "survey.tests.subtitle": "SAT, ACT, AP \uc2dc\ud5d8, \uadf8 \uc678 \ud45c\uc900\ud654 \uc2dc\ud5d8.",
    "survey.tests.not_taken": "\uc544\uc9c1 \uc2dc\ud5d8\uc744 \ubcf4\uc9c0 \uc54a\uc558\uc5b4\uc694",
    "survey.ecs.title": "\uacfc\uc678 \ud65c\ub3d9",
    "survey.ecs.subtitle": "\ub3d9\uc544\ub9ac, \uc6b4\ub3d9, \ubd09\uc0ac, \uc77c, \uc5f0\uad6c, \uc608\uc220.",
    "survey.goals.title": "\ub0b4 \ubaa9\ud45c",
    "survey.goals.subtitle": "\uc5b4\ub5a4 \ub300\ud559 \uacbd\ud5d8\uc744 \uc6d0\ud558\uc138\uc694?",
    "survey.parent.title": "\ube44\uc0c1 \uc5f0\ub77d\ucc98",
    "survey.parent.subtitle": "\ub3c4\uc6c0\uc774 \ud544\uc694\ud560 \ub54c \uc2e0\ub8b0\ud558\ub294 \uc0ac\ub78c\uc774 \uc54c \uc218 \uc788\ub3c4\ub85d \ud574\ub450\uace0 \uc2f6\uc5b4\uc694.",
    "survey.parent.reframe": "\uc804\uc801\uc73c\ub85c \uc120\ud0dd \uc0ac\ud56d\uc785\ub2c8\ub2e4. \ub9d0\uc500\ud558\uc2e0 \ub0b4\uc6a9\uc740 \uacf5\uc720\ud558\uc9c0 \uc54a\uc73c\uba70, \ub3c4\uc6c0\uc774 \ud544\uc694\ud560 \uc218 \uc788\ub2e4\ub294 \uc0ac\uc2e4\ub9cc \uc804\ub2ec\ub429\ub2c8\ub2e4.",

    // Chat
    "chat.placeholder": "\ud559\uc5c5, \ud65c\ub3d9, \ub300\ud559, \uc804\ub7b5\uc5d0 \ub300\ud574 \ubb3c\uc5b4\ubcf4\uc138\uc694...",
    "chat.placeholder_file": "\uc774 \ud30c\uc77c\uc5d0 \ub300\ud55c \uba54\uc2dc\uc9c0\ub97c \ucd94\uac00\ud558\uc138\uc694...",
    "chat.send": "\ubcf4\ub0b4\uae30",
    "chat.cancel": "\ucde8\uc18c",
    "chat.thinking": "\uc0dd\uac01 \uc911...",
    "chat.cancelled": "\ucde8\uc18c\ub418\uc5c8\uc2b5\ub2c8\ub2e4. \uc900\ube44\uac00 \ub418\uba74 \uc0c8 \uc9c8\ubb38\uc744 \ubcf4\ub0b4\uc138\uc694.",
    "chat.rate_limit": "\uba54\uc2dc\uc9c0\ub97c \ub108\ubb34 \ube68\ub9ac \ubcf4\ub0b4\uace0 \uacc4\uc138\uc694. \uc7a0\uc2dc \uae30\ub2e4\ub824 \uc8fc\uc138\uc694.",
    "chat.export": "\ub0b4\ubcf4\ub0b4\uae30",
    "chat.logout": "\ub85c\uadf8\uc544\uc6c3",
    "chat.delete_account": "\uacc4\uc815 \uc0ad\uc81c",
    "chat.edit_profile": "\ud504\ub85c\ud544 \uc218\uc815",
    "chat.file_types": "PDF, \uc774\ubbf8\uc9c0",

    // Agent status
    "status.screening": "\uc9c8\ubb38\uc744 \ud655\uc778\ud558\ub294 \uc911...",
    "status.academics": "\ud559\uc5c5 \uc815\ubcf4\ub97c \uc870\uc0ac \uc911...",
    "status.ec": "\ud65c\ub3d9 \ub0b4\uc5ed\uc744 \ubd84\uc11d \uc911...",
    "status.college": "\ub300\ud559\uc744 \uac80\uc0c9 \uc911...",
    "status.strategy": "\uc804\ub7b5\uc744 \uc138\uc6b0\ub294 \uc911...",
    "status.supervisor": "\uc870\uc5b8\uc744 \uc885\ud569 \uc911...",
    "status.validator": "\uc815\ud655\uc131\uc744 \uac80\uc99d \uc911...",
    "status.upload_screener": "\uc5c5\ub85c\ub4dc \uc548\uc804\uc131\uc744 \ud655\uc778 \uc911...",

    // Errors
    "error.api_busy": "\uc9c0\uae08 \uc2dc\uc2a4\ud15c\uc774 \ubcf5\uc7a1\ud569\ub2c8\ub2e4. \uc7a0\uc2dc \ud6c4 \ub2e4\uc2dc \uc2dc\ub3c4\ud574\uc8fc\uc138\uc694.",
    "error.too_long": "\uba54\uc2dc\uc9c0\uac00 \ub108\ubb34 \uae41\ub2c8\ub2e4. \ub354 \uac04\ub2e8\ud558\uac8c \uc9c8\ubb38\ud574\uc8fc\uc138\uc694.",
    "error.network": "\uc778\ud130\ub137 \uc5f0\uacb0\uc744 \ud655\uc778\ud55c \ud6c4 \ub2e4\uc2dc \uc2dc\ub3c4\ud574\uc8fc\uc138\uc694.",
    "error.unknown": "\ubb38\uc81c\uac00 \ubc1c\uc0dd\ud588\uc2b5\ub2c8\ub2e4. \ub2e4\uc2dc \uc2dc\ub3c4\ud574\uc8fc\uc138\uc694.",
    "error.session_expired": "\uc7a5\uc2dc\uac04 \ud65c\ub3d9\uc774 \uc5c6\uc5b4 \uc138\uc158\uc774 \ub9cc\ub8cc\ub418\uc5c8\uc2b5\ub2c8\ub2e4. \ub2e4\uc2dc \ub85c\uadf8\uc778\ud574\uc8fc\uc138\uc694.",

    // Application tracker
    "apps.title": "\ub0b4 \uc9c0\uc6d0 \ud604\ud669",
    "apps.add": "\ub300\ud559 \ucd94\uac00",
    "apps.status.researching": "\uc870\uc0ac \uc911",
    "apps.status.applying": "\uc9c0\uc6d0 \uc900\ube44",
    "apps.status.submitted": "\uc81c\ucd9c \uc644\ub8cc",
    "apps.status.accepted": "\ud569\uaca9",
    "apps.status.rejected": "\ubd88\ud569\uaca9",
    "apps.status.waitlisted": "\ub300\uae30\uc790 \uba85\ub2e8",
    "apps.status.enrolled": "\ub4f1\ub85d",
    "apps.deadline": "\ub9c8\uac10\uc77c",
    "apps.decision": "\uc9c0\uc6d0 \uc720\ud615",
    "apps.ed": "\uc870\uae30 \uacb0\uc815 (ED)",
    "apps.ea": "\uc870\uae30 \uc9c0\uc6d0 (EA)",
    "apps.rd": "\uc815\uc2dc \uc9c0\uc6d0 (RD)",
    "apps.rolling": "\uc218\uc2dc \uc9c0\uc6d0",

    // AI Disclosure (Korea AI Basic Act compliance)
    "ai.disclosure.banner": "\uc774 \uc11c\ube44\uc2a4\ub294 AI(\uc778\uacf5\uc9c0\ub2a5)\ub97c \uc0ac\uc6a9\ud558\uc5ec \uc548\ub0b4\ub97c \uc81c\uacf5\ud569\ub2c8\ub2e4. AI \uc0dd\uc131 \ucf58\ud150\uce20\ub294 \uba85\ud655\ud558\uac8c \ud45c\uc2dc\ub429\ub2c8\ub2e4.",
    "ai.disclosure.session": "\uc774 \uc751\ub2f5\uc740 AI \uc9c0\uc6d0\uc73c\ub85c \uc0dd\uc131\ub418\uc5c8\uc2b5\ub2c8\ub2e4. \ud655\uc778\ub41c \uc0ac\uc2e4\uc740 \uacf5\uc2dd \ucd9c\ud310\ubb3c\uc5d0\uc11c \uac00\uc838\uc654\uc2b5\ub2c8\ub2e4.",
    "ai.disclosure.model": "AI \ubaa8\ub378: Anthropic API\ub97c \ud1b5\ud55c Claude",
    "ai.disclosure.advisory": "\uc774 \ub3c4\uad6c\ub294 \uc815\ubcf4 \uc548\ub0b4\ub9cc \uc81c\uacf5\ud569\ub2c8\ub2e4. \uc804\ubb38 \ub300\ud559 \uc0c1\ub2f4, \uc7ac\uc815 \uc870\uc5b8 \ub610\ub294 \uacf5\uc2dd \uacb0\uc815\uc744 \ub300\uccb4\ud558\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4.",
    "ai.disclosure.fafsa": "\uc774\uac83\uc740 \uacf5\uc2dd FAFSA \ub3c4\uad6c\uac00 \uc544\ub2c8\uba70 StudentAid.gov\ub97c \ub300\uccb4\ud558\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4.",

    // Output labels (three-lane)
    "output.verified_fact": "\uacf5\uc2dd \ucd9c\ucc98\uc5d0\uc11c \ud655\uc778\ub41c \uc0ac\uc2e4",
    "output.model_inference": "AI\uac00 \uc0dd\uc131\ud55c \ucd94\ub860",
    "output.coaching_suggestion": "\ube44\uad6c\uc18d\uc801 \ucf54\uce6d \uc81c\uc548",
    "output.no_verified_answer": "\uc774 \uc9c8\ubb38\uc5d0 \ub300\ud574 \ud655\uc778\ub41c \ub2f5\ubcc0\uc744 \uc0ac\uc6a9\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.",
    "output.source_label": "\ucd9c\ucc98",

    // Explanation capability (Korea AI Basic Act)
    "explain.how_generated": "\uc774 \uc751\ub2f5\uc774 \uc5b4\ub5bb\uac8c \uc0dd\uc131\ub418\uc5c8\ub294\uc9c0",
    "explain.sources_used": "\uc0ac\uc6a9\ub41c \ucd9c\ucc98",
    "explain.model_used": "\uc0ac\uc6a9\ub41c AI \ubaa8\ub378",
    "explain.routing_logic": "\ub77c\uc6b0\ud305 \ub17c\ub9ac",

    // Consent (Korea PIPA)
    "consent.data_processing": "\ub370\uc774\ud130 \ucc98\ub9ac \ub3d9\uc758",
    "consent.ai_interaction": "AI \uc0c1\ud638\uc791\uc6a9 \ub3d9\uc758",
    "consent.cross_border": "\uad6d\uc678 \ub370\uc774\ud130 \uc804\uc1a1 \ub3d9\uc758",
    "consent.parental": "\ubcf4\ud638\uc790 \uc54c\ub9bc \ub3d9\uc758",

    // ─── Friendly labels — tier ───
    "friendly.tier.tier_1_distinctive.short": "\ub6f0\uc5b4\ub0a8",
    "friendly.tier.tier_1_distinctive.summary": "\ucd5c\uc0c1\uc704 \ub808\ubca8\uc758 \uc9c0\uc6d0\uc11c \uc1a1\uc73c\ub85c \uc77d\ud799\ub2c8\ub2e4 \u2014 \uc804\uad6d \ubb34\ub300\uc5d0 \uac78\ub9de\uc740 \uae4a\uc774.",
    "friendly.tier.tier_2_strong.short": "\uacac\uace0\ud568",
    "friendly.tier.tier_2_strong.summary": "\ub2e8\uc21c \ucc38\uc5ec\ub97c \ub118\uc5b4 \uc2e4\uc9c8\uc801 \uc131\uacfc\ub97c \ub0b4\uc168\uc2b5\ub2c8\ub2e4 \u2014 \uc2dc\uac04\uacfc \uac04\ucc2d \ud488\uc744 \uc81c\ub300\ub85c \ub4e4\uc778 \ud65c\ub3d9.",
    "friendly.tier.tier_3_developing.short": "\uc131\uc7a5 \uc911",
    "friendly.tier.tier_3_developing.summary": "\ub208\uc5d0 \ubcf4\uc774\ub294 \ud5cc\uc2e0\uc774 \uc788\uc73c\uba70 \uc9c0\uc6d0 \uc2dc\uc988 \uc804\uc5d0 \ub354 \uae4a\uac8c \ubc1c\uc804\uc2dc\ud0ac \uc5ec\uc9c0\uac00 \uc788\uc5b4\uc694.",
    "friendly.tier.tier_4_foundational.short": "\uae30\ucd08",
    "friendly.tier.tier_4_foundational.summary": "\ub9c9 \uc2dc\uc791\ud558\uc168\ub124\uc694 \u2014 \uc791\uc9c0\ub9cc \uafb8\uc900\ud55c \uac78\uc74c\uc774 \uc911\uc694\ud569\ub2c8\ub2e4. \ucd08\uae30 \ub2e8\uacc4\ub77c\uace0 \ubd80\ub044\ub7ec\uc6cc\ud560 \uc774\uc720\ub294 \uc5c6\uc5b4\uc694.",

    // ─── Friendly labels — prestige source ───
    "friendly.prestige.research.short": "\uc870\uc0ac\ub428",
    "friendly.prestige.research.summary": "\uc2e0\ub8b0\ud560 \ub9cc\ud55c \uc785\uc2dc \u00b7 \ub300\ud68c \ucd9c\ucc98\ub97c \ubc14\ud0d5\uc73c\ub85c \uc810\uc218\ub97c \uc0b0\ucd9c\ud588\uc2b5\ub2c8\ub2e4. \uadfc\uac70\ub97c \ud655\uc778\ud574\ubcf4\uc138\uc694.",
    "friendly.prestige.benchmark.short": "\uce74\ub2e4\ub85c\uadf8 \ub9e4\uce6d",
    "friendly.prestige.benchmark.summary": "\uc800\ud76c \uce74\ub2e4\ub85c\uadf8\uc5d0 \uc791 \uc54c\ub824\uc9c4 \ub300\ud68c\ub85c \ub4f1\ub85d\ub418\uc5b4 \uc788\uc2b5\ub2c8\ub2e4.",
    "friendly.prestige.legacy.short": "\uc544\uc9c1 \uc810\uc218 \uc5c6\uc74c",
    "friendly.prestige.legacy.summary": "\uc544\uc9c1 \uc870\uc0ac\ud558\uc9c0 \uc54a\uc558\uc5b4\uc694 \u2014 \uc7ac\uacc4\uc0b0\uc744 \uc694\uccad\ud558\uc2dc\uba74 \uc870\uc0ac\ud574\ub4dc\ub824\uc694.",
    "friendly.prestige.override.short": "\uc0c1\ub2f4 \uc120\uc0dd\ub2d8\uc774 \uc124\uc815",
    "friendly.prestige.override.summary": "\uc0c1\ub2f4 \uc120\uc0dd\ub2d8\uc774 \ubcf8\uc778\uc758 \uc804\ubb38 \uc9c0\uc2dd\uc73c\ub85c \uc810\uc218\ub97c \uc9c1\uc811 \uc124\uc815\ud558\uc168\uc5b4\uc694.",
    "friendly.prestige.unavailable.short": "\uc870\uc0ac \ubd88\uac00",
    "friendly.prestige.unavailable.summary": "\uba85\uc131 \uc810\uc218 \uc870\uc0ac\uc5d0\ub294 Anthropic API \ud0a4\uac00 \ud544\uc694\ud569\ub2c8\ub2e4 \u2014 \uc0c1\ub2f4 \uc120\uc0dd\ub2d8\uaed8 \ud65c\uc131\ud654\ub97c \uc694\uccad\ud558\uc138\uc694.",
    "friendly.prestige.research_failed.short": "\ub9e5\ub77d \ubcf4\uac15 \ud544\uc694",
    "friendly.prestige.research_failed.summary": "\uc544\uc9c1 \uacf5\uac1c \ucd9c\ucc98\ub97c \ucc3e\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4 \u2014 \uc0c1\ub2f4 \uc120\uc0dd\ub2d8\uc774 \uc138\ubd80 \ub9e5\ub77d\uc744 \ucd94\uac00\ud574\ub4dc\ub9b4 \uc218 \uc788\uc5b4\uc694.",

    // ─── Friendly labels — EC factors ───
    "friendly.factor.dedication.short": "\ud5cc\uc2e0\ub3c4",
    "friendly.factor.dedication.summary": "\ucd1d \ud65c\ub3d9 \uc2dc\uac04 \u00d7 \uc9c0\uc18d \uae30\uac04 \u00d7 \ucd5c\uadfc\uc131.",
    "friendly.factor.achievement.short": "\uc131\uc7a5",
    "friendly.factor.achievement.summary": "\uc778\uc99d\ub41c \uc218\uc0c1\uc774\ub098 \uc131\uacfc\ub97c \uc774 \ud65c\ub3d9\uc774 \uc77c\ubc18\uc801\uc73c\ub85c \ub0b4\ub294 \uc131\uacfc\uc640 \ube44\uad50\ud569\ub2c8\ub2e4.",
    "friendly.factor.leadership.short": "\ub9ac\ub354\uc2ed",
    "friendly.factor.leadership.summary": "\ucc45\uc784 \ubc94\uc704 \u2014 \uc774\ub04c\uace0 \uc788\ub294 \uc778\uc6d0, \uc608\uc0b0, \uc82c\ub294 \uc0b0\ucd9c\ubb3c.",
    "friendly.factor.prestige.short": "\uba85\uc131",
    "friendly.factor.prestige.summary": "\ubbf8\uad6d \uc785\ud559 \uc0ac\uc815\uad00\uc774 \uc774 \ud65c\ub3d9\uc744 \uc5bc\ub9c8\ub098 \ub6f0\uc5b4\ub09c \uac83\uc73c\ub85c \uc77d\uc744\uc9c0.",
    "friendly.factor.narrative_fit.short": "\ub0b4\ub7ec\ud2f0\ube0c \ubd80\ud569\ub3c4",
    "friendly.factor.narrative_fit.summary": "\uc774 \ud65c\ub3d9\uc774 \uc791\uc131\ud558\uc2e0 \ub0b4\ub7ec\ud2f0\ube0c(\uc790\uc18c\uc11c \uc2a4\ud1a0\ub9ac)\uc640 \uc9c0\uc6d0 \uc804\uacf5\uc5d0 \uc5bc\ub9c8\ub098 \ub9de\ub2ff\ub294\uc9c0.",
    "friendly.factor.major_spike.short": "\uc804\uacf5 \ud2b9\ud654",
    "friendly.factor.major_spike.summary": "\uc774 \ud65c\ub3d9\uc774 \uc9c0\uc6d0 \uc804\uacf5\uc744 \uc5bc\ub9c8\ub098 \uc9c1\uc811\uc801\uc73c\ub85c \ubcf4\uc5ec\uc8fc\ub294\uc9c0.",

    // ─── Friendly labels — directionality factors ───
    "friendly.directionality_factor.academic_momentum.short": "\ucd94\uc9c4\ub825",
    "friendly.directionality_factor.academic_momentum.summary": "\ud559\uae30\ubcc4 GPA \ud750\ub984 \u2014 \uc0c1\uc2b9\uc138\uc778\uac00\uc694, \uc544\ub2c8\uba74 \ud3c9\uc774\ub4e4\uc5b4 \uc788\ub098\uc694?",
    "friendly.directionality_factor.test_score_strength.short": "\uc2dc\ud5d8 \uc810\uc218",
    "friendly.directionality_factor.test_score_strength.summary": "SAT/ACT/AP \uc810\uc218\uac00 \ubaa9\ud45c \ud559\uad50\uc758 25\u201375 \ubc31\ubd84\uc704 \ubc94\uc704 \uc548\uc5d0 \ub4e4\uc5b4\uac00\ub294\uc9c0.",
    "friendly.directionality_factor.major_academic_fit.short": "\uc804\uacf5 \uc801\ud569\ub3c4",
    "friendly.directionality_factor.major_academic_fit.summary": "\uc9c0\uc6d0 \uc804\uacf5\uc758 \ud575\uc2ec \uc120\uc218 \uacfc\ubaa9\uc5d0\uc11c\uc758 \uc218\uac15 \ub0b4\uc5ed\uacfc \uc131\uc801.",
    "friendly.directionality_factor.rigor_and_challenge.short": "\ud559\uc5c5 \uac15\ub3c4",
    "friendly.directionality_factor.rigor_and_challenge.summary": "\ud559\uad50\uc5d0\uc11c \uc81c\uacf5\ud558\ub294 \uacfc\uc815 \uae30\uc900\uc73c\ub85c \ub0b4 \uc218\uac15 \ub09c\uc774\ub3c4\uac00 \uc5bc\ub9c8\ub098 \ub192\uc740\uc9c0.",
    "friendly.directionality_factor.overall_academic_standing.short": "\uc885\ud569 \uc704\uce58",
    "friendly.directionality_factor.overall_academic_standing.summary": "\ubaa8\ub4e0 \uc694\uc18c\ub97c \ud569\uce5c \uc885\ud569 \uc2e0\ud638.",

    // ─── Friendly labels — directionality labels ───
    "friendly.directionality_label.rising_strong.short": "\uac15\ud558\uac8c \uc0c1\uc2b9 \uc911",
    "friendly.directionality_label.rising_strong.summary": "\uc0c1\uc2b9 \uacbd\ud5a5\uc744 \ubcf4\uc774\uba70 \uc774\ubbf8 \uacbd\uc7c1\ub825 \uc788\ub294 \uc218\uc900\uc785\ub2c8\ub2e4.",
    "friendly.directionality_label.rising_developing.short": "\uc0c1\uc2b9 \u00b7 \uc131\uc7a5 \uc911",
    "friendly.directionality_label.rising_developing.summary": "\ubc29\ud5a5\uc740 \uc62c\ubc14\ub974\uc9c0\ub9cc \uae30\ubcf8 \uc218\uc900\uc740 \ub354 \ub04c\uc5b4\uc62c\ub824\uc57c \ud569\ub2c8\ub2e4.",
    "friendly.directionality_label.stable_strong.short": "\uc548\uc815 \u00b7 \uac15\ud568",
    "friendly.directionality_label.stable_strong.summary": "\uafb8\uc900\ud788 \uacbd\uc7c1\ub825\uc774 \uc788\uc5b4 \ub9ac\uce58 \ud559\uad50\ub3c4 \ud604\uc2e4\uc801\uc785\ub2c8\ub2e4.",
    "friendly.directionality_label.stable_developing.short": "\uc548\uc815 \u00b7 \uc131\uc7a5 \uc911",
    "friendly.directionality_label.stable_developing.summary": "\ud3c9\uc774\ud558\uc9c0\ub9cc \uc4f8\ub9cc\ud569\ub2c8\ub2e4 \u2014 \ud0c0\uaca9 \u00b7 \uc548\uc804 \ud559\uad50\ub294 \uc54c\uc544\ubcfc \uac70\uc608\uc694.",
    "friendly.directionality_label.declining.short": "\ud558\ud5a5\uc138",
    "friendly.directionality_label.declining.summary": "\ucd5c\uadfc \ud559\uae30\uac00 \uc57d\ud574\uc84c\uc2b5\ub2c8\ub2e4. \ucda9\ubd84\ud788 \ud68c\ubcf5\ud560 \uc218 \uc788\uc5b4\uc694 \u2014 \ub9ce\uc740 \ud559\uc0dd\ub4e4\uc774 \ubcc0\ud654\uc758 \uc774\uc720\ub97c \uc124\uba85\ud558\ub294 \uc9e7\uc740 \uc5d0\uc138\uc774\ub97c \uc4f5\ub2c8\ub2e4.",

    // ─── Drift (F10) ───
    "drift.no_active_narrative": "\uc544\uc9c1 \ud65c\uc131 \uc790\uae30\uc11c\uc0ac\uac00 \uc5c6\uc2b5\ub2c8\ub2e4 \u2014 POST /api/ec/narrative\ub85c \uc800\uc7a5\ud558\uba74 \ub4dc\ub9ac\ud504\ud2b8 \ud0d0\uc9c0\uac00 \ud65c\uc131\ud654\ub429\ub2c8\ub2e4.",
    "drift.all_fresh": "\ubaa8\ub4e0 \ud65c\ub3d9\uc758 \uc790\uae30\uc11c\uc0ac \ubd80\ud569\uac00 \ud604\uc7ac \uc790\uae30\uc11c\uc0ac\uc5d0 \ub9de\ucdb0 \uc0b0\ucd9c\ub418\uc5c8\uc5b4\uc694. \ucd5c\uc2e0 \uc0c1\ud0dc\uc785\ub2c8\ub2e4.",
    "drift.one_stale": "1\uac1c\uc758 \ud65c\ub3d9\uc774 \uc774\uc804 \ubc84\uc804\uc758 \uc790\uae30\uc11c\uc0ac\ub97c \ubc18\uc601\ud558\uace0 \uc788\uc2b5\ub2c8\ub2e4. \ud65c\ub3d9 \ud398\uc774\uc9c0\uc5d0\uc11c \uc6d0\ud074\ub9ad\uc73c\ub85c \uc7ac\uacc4\uc0b0\ud558\uc138\uc694.",
    "drift.many_stale": "{count}\uac1c\uc758 \ud65c\ub3d9\uc774 \uc774\uc804 \ubc84\uc804\uc758 \uc790\uae30\uc11c\uc0ac\ub97c \ubc18\uc601\ud558\uace0 \uc788\uc2b5\ub2c8\ub2e4. \uc7ac\uacc4\uc0b0\ud558\uc5ec \ubd80\ud569 \uc810\uc218\ub97c \ub9c9 \uc4f0\uc2e0 \uc790\uae30\uc11c\uc0ac\uc640 \ub9de\ucd94\uc138\uc694.",

    // ─── Candidates (F6) ───
    "candidates.no_active_narrative": "\uba3c\uc800 \uc790\uae30\uc11c\uc0ac\ub97c \uc800\uc7a5\ud574\uc8fc\uc138\uc694 (POST /api/ec/narrative). \ud6c4\ubcf4 \ud65c\ub3d9 \uc21c\uc704 \uc0b0\uc815\uc5d0\ub294 \ud559\uc0dd\ub2d8\uc758 \uc774\uc57c\uae30\uac00 \uae30\uc900\uc73c\ub85c \ud544\uc694\ud569\ub2c8\ub2e4.",
    "candidates.name_required": "\uc774\ub984\uc774 \ud544\uc694\ud569\ub2c8\ub2e4",
    "candidates.summary_strong": "\uac15\ud55c \ubd80\ud569\ub3c4: {bucket} \ubd84\uc57c\uc5d0 \ub4e4\uc5b4\ub9de\uace0 {themes} \uc8fc\uc81c\uc640 \uc77c\uce58\ud569\ub2c8\ub2e4. \uc608\uc0c1 \ub0b4\ub7ec\ud2f0\ube0c \ubd80\ud569\ub3c4 \u2248 {fit}.",
    "candidates.summary_partial": "\ubd80\ubd84 \ubd80\ud569: {themes} \uc8fc\uc81c\ub97c \uc2a4\uce58\uc9c0\ub9cc \uc9c0\uc6d0 \uc804\uacf5 \ubc29\ud5a5\uc5d0\ub294 \ub4e4\uc5b4\uac00\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4.",
    "candidates.summary_weak": "\ub0b4\ub7ec\ud2f0\ube0c \ubd80\ud569\ub3c4\uac00 \uc57d\ud569\ub2c8\ub2e4 \u2014 \uc804\uacf5 \ubd84\uc57c\ub098 \uc8fc\uc81c \uacb9\uce68\uc774 \uc5c6\uc2b5\ub2c8\ub2e4. \ub0b4\ub7ec\ud2f0\ube0c\ub97c \uba3c\uc800 \ub2e4\ub4ec\uac70\ub098 \ub2e4\ub978 \ud6c4\ubcf4\ub97c \uc120\ud0dd\ud558\uc2dc\uae30 \ubc14\ub78d\ub2c8\ub2e4.",
    "candidates.summary_major_hit": "{bucket} \ubd84\uc57c\uc5d0\ub294 \ub4e4\uc5b4\ub9de\uc9c0\ub9cc \uc544\uc9c1 \uc8fc\uc81c \uacb9\uce68\uc740 \uc5c6\uc2b5\ub2c8\ub2e4. \ub0b4\ub7ec\ud2f0\ube0c \ubc29\ud5a5\uc73c\ub85c \ud504\ub808\uc774\ubc0d\ud558\uc2dc\uba74 \uac15\ud55c \ubd80\ud569\ub3c4\ub85c \ubc14\ub014 \uc218 \uc788\uc2b5\ub2c8\ub2e4.",

    // ─── Deadlines (F7) ───
    "deadlines.no_upcoming": "\uc608\uc815\ub41c \ub9c8\uac10\uc77c\uc774 \uc5c6\uc2b5\ub2c8\ub2e4. POST /api/students/deadlines\ub85c \ucd94\uac00\ud574\uc8fc\uc138\uc694.",
    "deadlines.overdue_one": "{count}\uac1c\uc758 \ub9c8\uac10\uc77c\uc774 \uc774\ubbf8 \uc9c0\ub0ac\uc5b4\uc694 \u2014 \ub2e4\uc2dc \uc54c\ub9bc \ub610\ub294 \uc644\ub8cc \ucc98\ub9ac\ud574\uc8fc\uc138\uc694.",
    "deadlines.overdue_many": "{count}\uac1c\uc758 \ub9c8\uac10\uc77c\uc774 \uc774\ubbf8 \uc9c0\ub0ac\uc5b4\uc694 \u2014 \ub2e4\uc2dc \uc54c\ub9bc \ub610\ub294 \uc644\ub8cc \ucc98\ub9ac\ud574\uc8fc\uc138\uc694.",
    "deadlines.upcoming_next_one": "\uc608\uc815 {count}\uac74 \u2014 \ub2e4\uc74c\uc740 {title}, 1\uc77c \ub0a8\uc558\uc5b4\uc694.",
    "deadlines.upcoming_next_many": "\uc608\uc815 {count}\uac74 \u2014 \ub2e4\uc74c\uc740 {title}, {days}\uc77c \ub0a8\uc558\uc5b4\uc694.",
    "deadlines.due_at_invalid": "dueAt\uc740 ISO-8601 \ud615\uc2dd\uc758 \uc5bc\uc73c\ub85c \ubd84\uc11d \uac00\ub2a5\ud55c \ub0a0\uc9dc\uc5ec\uc57c \ud569\ub2c8\ub2e4",
    "deadlines.status_invalid": "status\ub294 open|done|snoozed \uc911 \ud558\ub098\uc5ec\uc57c \ud569\ub2c8\ub2e4",

    // ─── Prestige rationale (F5) ───
    "prestige.ec_not_found": "\uc774 \ud65c\ub3d9\uc774 \ub4f1\ub85d\ub418\uc5b4 \uc788\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4. \ud65c\ub3d9 \ubaa9\ub85d\uc5d0\uc11c \uc2a4\ud3c6\ub9c1\uc744 \ud655\uc778\ud558\uac70\ub098, \uc0c8 \ucca8\ubd80 \ud30c\uc77c\uc744 \uc5c5\ub85c\ub4dc\ud574\uc8fc\uc138\uc694.",
    "prestige.no_cached_rationale": "{short}: {summary} \uc0c8\ub85c \uc870\uc0ac\ud558\uace0 \uc2f6\uc73c\uc2dc\uba74 \uc544\ub798 recompute URL\uc744 \ud638\ucd9c\ud574\uc8fc\uc138\uc694.",

    // ─── Register.js CLI copy (F1) ───
    "register.usage.line1": "\uc0ac\uc6a9\ubc95: node scripts/register.js --email <\uc8fc\uc18c> --password <\ube44\ubc00\ubc88\ud638> [--name <\uc131\ud568>]",
    "register.usage.line2": "                                       [--narrative <\ud14d\uc2a4\ud2b8> | --narrative-file <\uacbd\ub85c>] [--login] [--locale <\ucf54\ub4dc>]",
    "register.tagline": "\ud559\uc0dd\uc744 \ub4f1\ub85d\ud558\uace0(\ub610\ub294 --login\uc73c\ub85c \ub85c\uadf8\uc778), \uc790\uae30\uc11c\uc0ac\ub97c \ud55c \ubc88\uc5d0 \uc800\uc7a5\ud569\ub2c8\ub2e4.",
    "register.section.required": "\ud544\uc218:",
    "register.required.email": "--email        \ud559\uad50 \uc774\uba54\uc77c (\uc608: you@school.edu). \ud559\uad50 \ub3c4\uba54\uc778\uc774 \uad8c\uc7a5\ub418\uba70,\n                 \uac1c\uc778 \uc774\uba54\uc77c\uc740 \ubc31\uc5d4\ub4dc\uc5d0\uc11c \uac70\ubd80\ub420 \uc218 \uc788\uc2b5\ub2c8\ub2e4.",
    "register.required.password": "--password     8\uc790 \uc774\uc0c1, \ubb38\uc790\uc640 \uc22b\uc790\ub97c \ubaa8\ub450 \ud3ec\ud568\ud574\uc57c \ud569\ub2c8\ub2e4. \ud559\uc0dd\ubcc4 \uc78a\uc744 \uc54a\uace0\n                 \ud574\uc2dc\ub85c \uc800\uc7a5\ub429\ub2c8\ub2e4; \uc6d0\ubcf8\uc740 \ub85c\uadf8\uc5d0 \ub0a8\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4.",
    "register.section.required_first": "\uccab \ub4f1\ub85d \uc2dc \ud544\uc218 (\uc774\ubbf8 \uc800\uc7a5\ud55c \uacbd\uc6b0 \uc0dd\ub7b5 \uac00\ub2a5):",
    "register.required.narrative_inline": "--narrative <\ud14d\uc2a4\ud2b8>          \uc9c0\uc6d0 \ud559\uad50 \u00b7 \uc804\uacf5 \u00b7 \ud65c\ub3d9 \uc120\ud0dd\uc744 \uc774\ub04c \uc6d0\ubcf8\n                                100\u20131500\uc790 \ubd84\ub7c9\uc758 \uc790\uae30\uc11c\uc0ac.",
    "register.required.narrative_file": "--narrative-file <\uacbd\ub85c>         UTF-8 \ud14d\uc2a4\ud2b8 \ud30c\uc77c \uacbd\ub85c. \uc250\uc5d0\uc11c \uc798\ub9b4 \uc704\ud5d8\uc744\n                                \ud53c\ud558\uace0 \uc2f6\ub2e4\uba74 --narrative \ubcf4\ub2e4 \uc774\uc404 \uad8c\uc7a5\ud569\ub2c8\ub2e4.",
    "register.section.optional": "\uc120\ud0dd:",
    "register.optional.name": "--name <\uc131\ud568>                  PII \uae08\uace0\uc5d0\ub9cc \ubcf4\uad00\ub418\uba70 LLM\uc5d0\ub294 \uc804\ub2ec\ub418\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4.",
    "register.optional.login": "--login                         \ub4f1\ub85d\uc744 \uac74\ub108\ub6f0\uace0 \uae30\uc874 \uacc4\uc815\uc5d0\uc11c \uc0c8 \ud1a0\ud070\ub9cc \ubc1b\uae30. \uc790\uae30\uc11c\uc0ac\uac00\n                                \uc81c\uacf5\ub418\uba74 \uc800\uc7a5\uc744 \ub2e4\uc2dc \uc2dc\ub3c4\ud569\ub2c8\ub2e4.",
    "register.optional.locale": "--locale <\ucf54\ub4dc>                ko \ub610\ub294 en-US. register.js \ub3c4\uc6c0\ub9d0 \u00b7 \uc624\ub958 \uba54\uc2dc\uc9c0\uc758\n                                \uc5b8\uc5b4\ub97c \uacb0\uc815\ud569\ub2c8\ub2e4. \uae30\ubcf8\uac12: en-US.",
    "register.section.env": "\ud658\uacbd \ubcc0\uc218:",
    "register.env.backend": "COLLEGEAPP_BACKEND_URL         \uae30\ubcf8\uac12 http://localhost:3001. \uc774 \uba38\uc2e0\uc5d0\uc11c \uc811\uadfc \uac00\ub2a5\ud574\uc57c\n                                \ud569\ub2c8\ub2e4.",
    "register.env.locale": "COLLEGEAPP_LOCALE              \uc120\ud0dd\uc801 \uae30\ubcf8 \ub85c\ucf00\uc77c (ko, en-US).",
    "register.footer": "\uc131\uacf5 \uc2dc studentId, sessionToken, narrativeId\ub97c JSON\uc73c\ub85c \ucd9c\ub825\ud569\ub2c8\ub2e4.\nsessionToken\uc744 \uc800\uc7a5\ud574\ub450\uc138\uc694 \u2014 fetch-context.js\uc5d0\uac8c\ub294\n$COLLEGEAPP_SESSION_TOKEN \ud658\uacbd \ubcc0\uc218\ub97c \ud1b5\ud574 \uc804\ub2ec\ud569\ub2c8\ub2e4.",
    "register.err.missing_email_or_password": "\uc624\ub958: --email\uacfc --password\ub294 \ud544\uc218\uc785\ub2c8\ub2e4.",
    "register.err.email_invalid": "\uc624\ub958: --email \"{email}\"\uc740(\ub294) \uc62c\ubc14\ub978 \uc774\uba54\uc77c \ud615\uc2dd\uc774 \uc544\ub2d9\ub2c8\ub2e4",
    "register.err.password_too_short": "\uc624\ub958: --password\ub294 \ucd5c\uc18c 8\uc790\uc5ec\uc57c \ud558\uba70, \ubc31\uc5d4\ub4dc\uac00 \ubb38\uc790\uc640 \uc22b\uc790\ub97c \ubaa8\ub450 \uc694\uad6c\ud569\ub2c8\ub2e4.",
    "register.err.narrative_file_read": "\uc624\ub958: --narrative-file {path} \uc77d\uae30 \uc2e4\ud328: {message}",
    "register.err.narrative_required": "\uc624\ub958: \uc2e0\uaddc \ub4f1\ub85d\uc5d0\ub294 --narrative \ub610\ub294 --narrative-file\uac00 \ud544\uc694\ud569\ub2c8\ub2e4.",
    "register.err.narrative_required_hint": "       \ub300\ud559\uc5d0 \uac00\uace0 \uc2f6\uc740 \uc774\uc720\ub97c \uc9c1\uc811\uc758 \ubaa9\uc18c\ub9ac\ub85c \uc801\uc5b4\uc8fc\uc138\uc694 (100\u20131500\uc790, 20\ub2e8\uc5b4 \uc774\uc0c1).",
    "register.err.narrative_size": "\uc624\ub958: \uc790\uae30\uc11c\uc0ac\uac00 \ucd5c\uc18c \uae38\uc774\ub97c \ucda9\uc871\ud558\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4.",
    "register.err.narrative_size_detail": "       \uae38\uc774={chars}\uc790 (\ud544\uc694 100\u20131500), \ub2e8\uc5b4={words}\uac1c (\ud544\uc694 20 \uc774\uc0c1)",
    "register.err.backend_probe": "\uc624\ub958: {backend}\uc758 \ubc31\uc5d4\ub4dc\uac00 /api/health\uc5d0 \ub300\ud574 HTTP {status}\ub97c \ubc18\ud658\ud588\uc2b5\ub2c8\ub2e4",
    "register.err.backend_unreachable": "\uc624\ub958: {backend}\uc5d0 \uc5f0\uacb0\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4 ({message}).",
    "register.err.backend_unreachable_hint": "       \uc0c1\ub2f4 \uc120\uc0dd\ub2d8\uc774 \uc54c\ub824\uc900 \ud638\uc2a4\ud2b8\ub85c COLLEGEAPP_BACKEND_URL\uc744 \uc124\uc815\ud574\uc8fc\uc138\uc694.",
    "register.err.already_registered": "\uc624\ub958: \uc774\uba54\uc77c\uc774 \uc774\ubbf8 \ub4f1\ub85d\ub418\uc5b4 \uc788\uc2b5\ub2c8\ub2e4. \uc0c8 \ud1a0\ud070\uc744 \ubc1b\uc73c\ub824\uba74 --login\uc73c\ub85c \ub2e4\uc2dc \uc2dc\ub3c4\ud574\uc8fc\uc138\uc694.",
    "register.err.auth_failed": "\uc624\ub958: {path}\uac00 HTTP {status}\ub97c \ubc18\ud658\ud588\uc2b5\ub2c8\ub2e4: {body}",
    "register.err.auth_missing_fields": "\uc624\ub958: \ubc31\uc5d4\ub4dc \uc751\ub2f5\uc5d0 studentId \ub610\ub294 sessionToken\uc774 \ub204\ub77d\ub418\uc5c8\uc2b5\ub2c8\ub2e4: {body}",
    "register.err.consent_failed": "\uc624\ub958: \ud544\uc218 \ub3d9\uc758 \ud56d\ubaa9 \uc911 \uc77c\ubd80\uac00 \ub4f1\ub85d\ub418\uc9c0 \uc54a\uc558\uc2b5\ub2c8\ub2e4.",
    "register.err.consent_failed_item": "       - \ud56d\ubaa9 {type}: HTTP {status} \uc751\ub2f5={body}",
    "register.err.consent_failed_hint": "       \uc774 \ub3d9\uc758\uac00 \uc644\ub8cc\ub420 \ub54c\uae4c\uc9c0 /api/llm\uc740 403\uc744 \ubc18\ud658\ud569\ub2c8\ub2e4. \uc0c1\ub2f4 \uc120\uc0dd\ub2d8\uaed8 \ubb38\uc758\ud574\uc8fc\uc138\uc694.",
    "register.err.narrative_save_failed": "\uc624\ub958: \uc790\uae30\uc11c\uc0ac \uc800\uc7a5\uc5d0 \uc2e4\ud328\ud588\uc2b5\ub2c8\ub2e4 (HTTP {status}): {body}",
    "register.err.narrative_save_hint": "       \uc790\uae30\uc11c\uc0ac\ub97c \uc218\uc815\ud558\uc2e0 \ub4a4 --login \ud50c\ub798\uadf8\ub85c \ub2e4\uc2dc \uc2e4\ud589\ud574\uc8fc\uc138\uc694.",
    "register.err.unknown_flag": "\uc624\ub958: \uc54c \uc218 \uc5c6\ub294 \uc635\uc158\uc785\ub2c8\ub2e4: {flag}. \uc804\uccb4 \uc635\uc158\uc740 --help\ub85c \ud655\uc778\ud574\uc8fc\uc138\uc694.",
    "register.err.unexpected": "\uc624\ub958: \uc608\uc0c1\uce58 \ubabb\ud55c \uc2e4\ud328\uac00 \ubc1c\uc0dd\ud588\uc2b5\ub2c8\ub2e4: {message}",
    "register.nextstep.ready": "\uc704\uc758 \ud1a0\ud070\uc744 COLLEGEAPP_SESSION_TOKEN\uc73c\ub85c \uc124\uc815\ud558\uc2e0 \ub4a4, scripts/fetch-context.js\ub97c \uc2e4\ud589\ud574 \ucd94\ub860 \ubc88\ub4e4\uc744 \uac00\uc838\uc624\uc138\uc694.",
    "register.nextstep.no_narrative": "\uc790\uae30\uc11c\uc0ac\ub97c ./narrative.txt\uc5d0 \uc800\uc7a5\ud558\uc2e0 \ub4a4, \uc138\uc158 \ud1a0\ud070\uc73c\ub85c /api/ec/narrative\uc5d0 POST \ud574\uc8fc\uc138\uc694.",

    // ─── 동의 유형 친숙 라벨 ───
    "consent.type.data_processing": "\uac1c\uc778\uc815\ubcf4 \ucc98\ub9ac \ub3d9\uc758",
    "consent.type.ai_interaction": "AI \uc0c1\ud638\uc791\uc6a9 \ub3d9\uc758",
    "consent.type.cross_border_transfer": "\uad6d\uc678 \uc774\uc804 \ub3d9\uc758",

    // ─── Fetch-context.js CLI copy ───
    "fetch.usage": "\uc0ac\uc6a9\ubc95: node scripts/fetch-context.js [--focus FOCUS] [--narrative-text] [--locale LOCALE]",
    "fetch.narrative_flag": "--narrative-text          \ubc88\ub4e4\uc5d0 \uc6d0\ubcf8 \uc790\uae30\uc11c\uc0ac \ud14d\uc2a4\ud2b8\ub97c \ud3ec\ud568\ud569\ub2c8\ub2e4 (\uc120\ud0dd, v1.1).",
    "fetch.focus_flag": "--focus FOCUS             \ubc88\ub4e4\uc758 \ucd08\uc810 \ud0dc\uadf8\ub97c \uc9c0\uc815\ud569\ub2c8\ub2e4 (\uae30\ubcf8\uac12: holistic).",
    "fetch.locale_flag": "--locale LOCALE           ko \ub610\ub294 en-US. \ubc31\uc5d4\ub4dc\uc5d0 \uce5c\uc219\ud55c \ub77c\ubca8\uc744 \ud574\ub2f9 \uc5b8\uc5b4\ub85c \ubcc0\ud658\ud574\ub2ec\ub77c\uace0 \uc694\uccad\ud569\ub2c8\ub2e4.",
    "fetch.err.no_token": "\uc624\ub958: COLLEGEAPP_SESSION_TOKEN \ud658\uacbd \ubcc0\uc218\uac00 \ud544\uc694\ud569\ub2c8\ub2e4. \uba3c\uc800 scripts/register.js\ub97c \uc2e4\ud589\ud574\uc8fc\uc138\uc694.",
    "fetch.err.http": "\uc624\ub958: {url}\uc5d0\uc11c HTTP {status} \uc751\ub2f5\uc744 \ubc1b\uc558\uc2b5\ub2c8\ub2e4\n{body}",
    "fetch.err.auth_expired": "\uc624\ub958: \uc138\uc158 \ud1a0\ud070\uc774 \uac70\ubd80\ub418\uc5c8\uc2b5\ub2c8\ub2e4 (HTTP {status}). scripts/register.js --login\uc73c\ub85c \ub2e4\uc2dc \ubc1c\uae09\ubc1b\uc544\uc8fc\uc138\uc694.",
    "fetch.err.unexpected": "\uc624\ub958: \uc608\uc0c1\uce58 \ubabb\ud55c \uc2e4\ud328\uac00 \ubc1c\uc0dd\ud588\uc2b5\ub2c8\ub2e4: {message}",
  },

  "es": {
    "app.title": "Consejero Universitario",
    "create.title": "Crea tu cuenta",
    "login.title": "Bienvenido de nuevo",
    "chat.send": "Enviar",
    "chat.cancel": "Cancelar",
    "chat.thinking": "Pensando...",
    "survey.continue": "Continuar",
    "survey.back": "Atr\u00e1s",
    "survey.skip": "Omitir",
    "error.network": "Verifica tu conexi\u00f3n a internet e intenta de nuevo.",
  },
};

// ─── Locale helpers ───
export function normalizeLocale(raw) {
  if (!raw) return DEFAULT_LOCALE;
  const s = String(raw).trim();
  if (STRINGS[s]) return s;
  // Case-insensitive exact match first.
  const lower = s.toLowerCase();
  for (const k of Object.keys(STRINGS)) if (k.toLowerCase() === lower) return k;
  // Prefix match — "ko-KR", "ko_KR", "ko-KOR" → "ko"; "en-GB" → "en-US" (only en we have).
  const prefix = lower.split(/[-_.]/)[0];
  for (const k of Object.keys(STRINGS)) if (k.toLowerCase().split("-")[0] === prefix) return k;
  return DEFAULT_LOCALE;
}

/**
 * Resolve locale for an Express request. Priority:
 *   1. ?locale=ko query parameter
 *   2. X-CollegeApp-Locale header
 *   3. req.studentLocale (set by auth middleware from student.preferred_locale)
 *   4. Accept-Language header (first recognised tag)
 *   5. en-US default
 */
export function resolveLocale(req) {
  if (!req) return DEFAULT_LOCALE;
  const q = req.query?.locale;
  if (q) return normalizeLocale(q);
  const header =
    req.get?.("X-CollegeApp-Locale") ||
    req.headers?.["x-collegeapp-locale"] ||
    null;
  if (header) return normalizeLocale(header);
  if (req.studentLocale) return normalizeLocale(req.studentLocale);
  const accept =
    req.get?.("Accept-Language") ||
    req.headers?.["accept-language"] ||
    null;
  if (accept) {
    for (const tag of accept.split(",").map((s) => s.trim().split(";")[0])) {
      if (!tag) continue;
      const resolved = normalizeLocale(tag);
      if (resolved !== DEFAULT_LOCALE || tag.toLowerCase().startsWith("en")) return resolved;
    }
  }
  return DEFAULT_LOCALE;
}

// ─── Translation function ───
export function t(key, locale = DEFAULT_LOCALE, params = {}) {
  const loc = normalizeLocale(locale);
  const str = STRINGS[loc]?.[key] ?? STRINGS[DEFAULT_LOCALE]?.[key] ?? key;
  // Replace {param} placeholders
  return String(str).replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? String(params[k]) : `{${k}}`));
}

/**
 * Build a locale-aware mirror of the friendly-labels.js constants. Given a
 * locale, returns `{ tiers, prestigeSources, factors, directionalityFactors,
 * directionalityLabels }` with the same shape as the English exports but
 * every short/summary string passed through t().
 *
 * When a locale is missing a specific key, it falls back to en-US (same
 * semantics as t()). Frontends can use this to render a locale-specific
 * friendlyLegend alongside the vectors.
 */
export function localizeFriendlyLabels(locale = DEFAULT_LOCALE) {
  const loc = normalizeLocale(locale);
  const tierKeys = ["tier_1_distinctive", "tier_2_strong", "tier_3_developing", "tier_4_foundational"];
  const sourceKeys = ["research", "benchmark", "legacy", "override", "unavailable", "research_failed"];
  const factorKeys = ["dedication", "achievement", "leadership", "prestige", "narrative_fit", "major_spike"];
  const dirFactorKeys = [
    "academic_momentum",
    "test_score_strength",
    "major_academic_fit",
    "rigor_and_challenge",
    "overall_academic_standing",
  ];
  const dirLabelKeys = [
    "rising_strong",
    "rising_developing",
    "stable_strong",
    "stable_developing",
    "declining",
  ];
  const pickPair = (prefix, k) => ({
    short: t(`${prefix}.${k}.short`, loc),
    summary: t(`${prefix}.${k}.summary`, loc),
  });
  const tiers = {};
  for (const k of tierKeys) tiers[k] = pickPair("friendly.tier", k);
  const prestigeSources = {};
  for (const k of sourceKeys) prestigeSources[k] = pickPair("friendly.prestige", k);
  const factors = {};
  for (const k of factorKeys) factors[k] = pickPair("friendly.factor", k);
  const directionalityFactors = {};
  for (const k of dirFactorKeys) directionalityFactors[k] = pickPair("friendly.directionality_factor", k);
  const directionalityLabels = {};
  for (const k of dirLabelKeys) directionalityLabels[k] = pickPair("friendly.directionality_label", k);
  return { locale: loc, tiers, prestigeSources, factors, directionalityFactors, directionalityLabels };
}

// ─── FIRST-GEN GLOSSARY (Tier 3) ───
// Explains college admissions jargon. Agents can reference this when they detect
// a first-gen student or when a student asks "what does X mean?"
export const GLOSSARY = {
  "AP": { term: "Advanced Placement (AP)", definition: "College-level courses you can take in high school. Created by CollegeBoard. If you score 3+ on the AP exam, many colleges give you college credit.", related: ["IB", "Dual Enrollment", "CollegeBoard"] },
  "IB": { term: "International Baccalaureate (IB)", definition: "A rigorous international curriculum. IB Diploma students take 6 subjects (3 Higher Level, 3 Standard Level) plus Theory of Knowledge, an Extended Essay, and CAS hours. Recognized worldwide.", related: ["AP", "A-Level"] },
  "A-Level": { term: "A-Levels (Advanced Level)", definition: "The UK/international exam system. Students typically take 3-4 A-Level subjects in Years 12-13. Graded A*-E. Required for UK university admission; accepted by many US colleges.", related: ["IB", "GCSE"] },
  "GPA": { term: "Grade Point Average", definition: "A number (usually 0.0-4.0 unweighted, up to 5.0 weighted) that represents your overall grades. Unweighted treats all classes equally; weighted gives bonus points for AP/IB/Honors courses.", related: ["Weighted GPA", "Class Rank"] },
  "SAT": { term: "SAT (Scholastic Assessment Test)", definition: "A standardized college admission test by CollegeBoard. Scored 400-1600 (Math + Evidence-Based Reading/Writing). Many colleges are now test-optional.", related: ["ACT", "Test-Optional", "Superscore"] },
  "ACT": { term: "ACT (American College Testing)", definition: "A standardized college admission test. Scored 1-36 composite (English, Math, Reading, Science). Accepted by all US colleges that accept SAT.", related: ["SAT", "Superscore"] },
  "ED": { term: "Early Decision", definition: "A binding application deadline (usually November 1). If accepted, you MUST attend. You can only apply ED to one school. Best for your top-choice school if you're sure.", related: ["EA", "RD", "REA"] },
  "EA": { term: "Early Action", definition: "A non-binding early deadline (usually November 1-15). You get your decision earlier (December) but aren't required to attend. You can apply EA to multiple schools.", related: ["ED", "RD", "REA"] },
  "REA": { term: "Restrictive Early Action", definition: "Early Action with restrictions \u2014 you can't apply ED or EA to other private schools. Used by Stanford, Harvard, Yale, etc. Non-binding.", related: ["EA", "ED"] },
  "RD": { term: "Regular Decision", definition: "The standard application deadline (usually January 1-15). Decisions come in March-April. Non-binding.", related: ["ED", "EA"] },
  "Rolling": { term: "Rolling Admissions", definition: "Applications reviewed as they arrive \u2014 no fixed deadline. Apply early for best chances. Used by Penn State, Michigan State, etc.", related: ["RD"] },
  "Superscore": { term: "Superscoring", definition: "Some colleges take your highest section scores across multiple SAT/ACT sittings and combine them. Check each school's policy.", related: ["SAT", "ACT"] },
  "Test-Optional": { term: "Test-Optional", definition: "You can choose whether to submit SAT/ACT scores. If your scores are below the school's middle 50%, consider going test-optional and letting your GPA and ECs speak.", related: ["SAT", "ACT"] },
  "EFC": { term: "Expected Family Contribution", definition: "The amount your family is expected to pay for college, calculated from FAFSA. Schools use this to determine financial aid. Being replaced by SAI (Student Aid Index) in 2024+.", related: ["FAFSA", "Need-Blind", "Need-Aware"] },
  "FAFSA": { term: "Free Application for Federal Student Aid", definition: "A form you fill out to apply for financial aid (grants, loans, work-study). EVERY student should fill it out, regardless of income. Opens October 1.", related: ["EFC", "CSS Profile"] },
  "CSS Profile": { term: "CSS Profile", definition: "An additional financial aid form required by ~400 selective colleges. More detailed than FAFSA. Has a fee (waivable for low-income students).", related: ["FAFSA", "Need-Blind"] },
  "Need-Blind": { term: "Need-Blind Admissions", definition: "The school doesn't consider your ability to pay when making admission decisions. Only ~25 US schools are truly need-blind for all applicants.", related: ["Need-Aware", "FAFSA"] },
  "Need-Aware": { term: "Need-Aware Admissions", definition: "The school MAY consider your financial situation in borderline admission decisions. Most schools are need-aware.", related: ["Need-Blind"] },
  "Reach": { term: "Reach School", definition: "A school where your stats (GPA, SAT) are below the school's average admitted student. Acceptance is possible but unlikely (<25% chance). Apply to 2-3 reaches.", related: ["Match", "Safety"] },
  "Match": { term: "Match/Target School", definition: "A school where your stats are in line with the school's admitted students. Reasonable chance of acceptance (~30-60%). Apply to 3-4 matches.", related: ["Reach", "Safety"] },
  "Safety": { term: "Safety School", definition: "A school where your stats are above the school's averages. High likelihood of acceptance (>70%). Apply to 2-3 safeties. Make sure you'd actually be happy there.", related: ["Reach", "Match"] },
  "CommonApp": { term: "Common Application", definition: "A single application you can send to 1,000+ colleges. Includes your personal essay, activities list, and demographics. Most students use this.", related: ["Coalition App", "UC App"] },
  "Yield": { term: "Yield Rate", definition: "The percentage of accepted students who actually enroll. High yield = popular school. Schools care about yield because it affects rankings.", related: ["Acceptance Rate"] },
  "Demonstrated Interest": { term: "Demonstrated Interest", definition: "Some schools track whether you've visited campus, attended info sessions, emailed admissions, or opened their emails. Can affect your chances at schools that track it.", related: ["Yield"] },
  "Holistic Review": { term: "Holistic Review", definition: "Schools consider your WHOLE application \u2014 not just numbers. GPA, test scores, essays, ECs, recommendations, background, and context all matter.", related: ["GPA", "ECs"] },
  "Gap Year": { term: "Gap Year", definition: "Taking a year off between high school and college. Many colleges allow you to defer enrollment for a year. Use it for work, travel, volunteering, or personal growth.", related: [] },
  "Dual Enrollment": { term: "Dual Enrollment", definition: "Taking college courses while still in high school, usually at a local community college. You earn both high school and college credit. Shows academic ambition.", related: ["AP", "IB"] },
  "Fee Waiver": { term: "Fee Waiver", definition: "If your family income is low, you can get SAT fees, AP fees, and college application fees waived. Ask your school counselor \u2014 they can help you apply for waivers.", related: ["FAFSA", "CSS Profile"] },
};

// ─── INTERNATIONAL CURRICULUM DATA (Tier 3) ───
export const IB_RIGOR = {
  "Mathematics: Analysis and Approaches HL": { tier: 1, label: "Extremely Hard", equivalent: "AP Calculus BC+", note: "Proof-based. Covers calculus, linear algebra, statistics." },
  "Physics HL":                               { tier: 1, label: "Extremely Hard", equivalent: "AP Physics C", note: "Calculus-based. 240 hours of instruction." },
  "Chemistry HL":                             { tier: 2, label: "Very Hard", equivalent: "AP Chemistry", note: "Extensive lab work required (40 hours)." },
  "Biology HL":                               { tier: 2, label: "Very Hard", equivalent: "AP Biology", note: "Content-heavy with ecological and biochemistry depth." },
  "English A: Literature HL":                 { tier: 2, label: "Very Hard", equivalent: "AP English Literature", note: "13 literary works studied. Internal oral assessment." },
  "History HL":                               { tier: 2, label: "Very Hard", equivalent: "AP World/European History", note: "3 papers. Massive document analysis." },
  "Economics HL":                             { tier: 3, label: "Hard", equivalent: "AP Macro + Micro", note: "Covers both macro and micro. Internal assessment." },
  "Mathematics: Applications and Interpretation SL": { tier: 4, label: "Moderate", equivalent: "AP Statistics (lighter)", note: "Applied math. Statistics focus." },
  "Environmental Systems and Societies SL":   { tier: 4, label: "Moderate", equivalent: "AP Environmental Science", note: "Interdisciplinary. Only offered at SL." },
  "Theory of Knowledge":                      { tier: 3, label: "Hard", equivalent: "No AP equivalent", note: "Epistemology. Required for IB Diploma. 1600-word essay." },
  "Extended Essay":                           { tier: 3, label: "Hard", equivalent: "AP Research", note: "4000-word independent research paper. Required for Diploma." },
};

export const ALEVEL_RIGOR = {
  "Further Mathematics": { tier: 1, label: "Extremely Hard", equivalent: "Beyond AP Calculus BC", note: "Pure math, mechanics, statistics, decision math. 2 A-Levels worth." },
  "Mathematics":         { tier: 2, label: "Very Hard", equivalent: "AP Calculus AB/BC", note: "Pure math + applied (mechanics or statistics)." },
  "Physics":             { tier: 2, label: "Very Hard", equivalent: "AP Physics C", note: "Calculus-based from the start." },
  "Chemistry":           { tier: 2, label: "Very Hard", equivalent: "AP Chemistry", note: "Rigorous with practical endorsement." },
  "Biology":             { tier: 3, label: "Hard", equivalent: "AP Biology", note: "Content-heavy with required practicals." },
  "Economics":           { tier: 3, label: "Hard", equivalent: "AP Macro + Micro", note: "Covers micro and macro in depth." },
  "English Literature":  { tier: 3, label: "Hard", equivalent: "AP English Literature", note: "Close reading and literary analysis." },
  "History":             { tier: 3, label: "Hard", equivalent: "AP European/World History", note: "Extended essay component." },
  "Computer Science":    { tier: 3, label: "Hard", equivalent: "AP CS A", note: "Programming + theory. Practical project." },
  "Psychology":          { tier: 4, label: "Moderate", equivalent: "AP Psychology", note: "Research methods emphasis." },
};

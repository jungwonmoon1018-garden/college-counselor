// ═══════════════════════════════════════════════════════════════════════
// src/i18n.js — frontend-only static labels for new Round 1-5 components
// ═══════════════════════════════════════════════════════════════════════
// Scope: button labels, section headings, validation hints — strings the
// SERVER doesn't already provide. friendlyMessage / friendlyLegendI18n
// from the backend are rendered verbatim and DO NOT live here.
//
// Tone for ko: 존댓말 (polite form), warm advisor voice, matches the
// backend i18n.js so a Korean student sees one consistent voice across
// the wire and the UI chrome.
// ═══════════════════════════════════════════════════════════════════════

export const STRINGS = {
  "en-US": {
    // ─── Narrative editor ──
    "narrative.title": "Your story",
    "narrative.subtitle": "What do you care about, and how have you shown it? 100–1500 characters.",
    "narrative.placeholder": "I care deeply about... and I've shown it by...",
    "narrative.save": "Save narrative",
    "narrative.delete": "Delete narrative",
    "narrative.saved_at": "Saved {when}",
    "narrative.too_short": "{chars}/100 characters minimum. {words}/20 words minimum.",
    "narrative.too_long": "{chars}/1500 — please tighten the story.",
    "narrative.empty_hint": "Write a draft about your motivations and proof points before we rank your activities.",
    "narrative.why_required": "Your story is the baseline we use to rank activities, score candidate ECs, and detect drift. Save it once here, then revisit anytime from the sidebar.",

    // ─── Sidebar / chat tools ──
    "chat.tools.narrative": "Edit your story",
    "chat.tools.candidates": "Rank EC ideas",
    "chat.tools.deadlines": "Deadlines",
    "chat.modal.close": "Close",

    // ─── Drift banner ──
    "drift.dismiss": "Dismiss",
    "drift.review": "Review activities",

    // ─── Candidate ranker ──
    "candidates.title": "Rank EC ideas",
    "candidates.subtitle": "Type one idea per line. We'll score how well each matches your narrative.",
    "candidates.placeholder": "Computational neuroscience research at Yonsei\nVolunteer at Asan Medical Center coding lab\nFounding the school bioinformatics club",
    "candidates.rank": "Rank these",
    "candidates.no_narrative_cta": "Write your narrative first",
    "candidates.empty": "Add at least one idea above.",
    "candidates.rank_label": "#{rank}",
    "candidates.fit_label": "Fit",
    "candidates.tier_label": "Tier",
    "candidates.bucket_match": "Major match: {bucket}",
    "candidates.themes_match": "Themes: {themes}",
    "candidates.generate": "✨ Generate ideas for me",
    "candidates.generating": "Generating ideas…",
    "candidates.generated_hint": "Ideas generated from your profile — suggestions to consider, grounded in your own record. Edit and add the ones you like above to rank them.",
    "candidates.no_profile": "Add your courses, activities, and scores to your profile first so we can ground the ideas.",
    "tools.tuned_for": "🎯 Tuned for: {schools}",
    "candidates.llm_ranked": "✨ Ranked by AI with web research",
    "narrative.draft_cta": "✨ Draft from my profile",
    "narrative.drafting": "Drafting…",
    "narrative.draft_hint": "This is a starting point generated from your profile — edit it until it sounds like you, then save.",
    "narrative.auto_badge": "↻ Auto-updated from your profile. Edit and save anytime to make it your own.",
    "narrative.stale_note": "Your story predates some newly-added activities or courses. Regenerate a draft to fold them in, or keep yours as-is.",

    // ─── Deadlines ──
    "deadlines.title": "Deadlines",
    "deadlines.add": "Add deadline",
    "deadlines.title_field": "Title",
    "deadlines.due_field": "Due (date)",
    "deadlines.category_field": "Category",
    "deadlines.notes_field": "Notes",
    "deadlines.save": "Save",
    "deadlines.cancel": "Cancel",
    "deadlines.mark_done": "Mark done",
    "deadlines.snooze": "Snooze",
    "deadlines.reopen": "Reopen",
    "deadlines.remove": "Remove",
    "deadlines.empty": "No deadlines yet. Add Common App, Early Decision, scholarships.",
    "deadlines.overdue_chip": "Overdue",
    "deadlines.due_chip": "Due in {days}d",

    // ─── Prestige card ──
    "prestige.title": "Prestige rationale",
    "prestige.no_data": "No prestige rationale cached yet for this activity.",
    "prestige.score": "Score",
    "prestige.sources": "Sources cited",

    // ─── Factor vector ──
    "factor.legend": "5-factor strength",

    // ─── Sidebar tools (new differentiation panels) ──
    "chat.tools.spike": "Spike Finder",
    "chat.tools.evidence": "Why we say this",
    "chat.tools.courses": "Course plan",

    // ─── Spike Finder ──
    "spike.title": "Spike Finder",
    "spike.subtitle": "Which 2–3 activities should lead your application — and which support it.",
    "spike.leading": "Leading activities",
    "spike.supporting": "Supporting activities",
    "spike.empty": "No activities scored yet. Add activities and save your story first.",
    "spike.rank": "Lead score",
    "spike.show_supporting": "Show {n} supporting",
    "spike.hide_supporting": "Hide supporting",

    // ─── Evidence panel (three trust lanes) ──
    "evidence.title": "Why we say this",
    "evidence.subtitle": "Everything we tell you is sorted into what's verified, what's an AI inference, and what's coaching.",
    "evidence.verified": "Verified facts",
    "evidence.verified_sub": "From official sources — cited.",
    "evidence.inference": "Model inferences",
    "evidence.inference_sub": "AI-generated, grounded in your data.",
    "evidence.coaching": "Coaching",
    "evidence.coaching_sub": "Non-binding suggestions.",
    "evidence.empty": "No evidence loaded yet.",
    "evidence.source": "Source",
    "evidence.not_scored": "Not independently scored",

    // ─── Course-sequence recommender ──
    "courses.title": "Course plan",
    "courses.subtitle": "A major-aligned course sequence — what you have, and what would strengthen it.",
    "courses.have": "On your transcript",
    "courses.next": "You might consider next",
    "courses.no_major": "Set your intended major in your profile to get a tailored sequence.",
    "courses.generic_note": "We don't have a tailored ladder for this major yet — showing a broad-rigor sequence.",

    // ─── Calibrated fit ──
    "fit.confidence": "Evidence confidence",
    "fit.redflags": "What's holding it back",
    "fit.strategy": "Suggested positioning",
    "fit.limited": "Limited data for this school — showing values match only.",
    "fit.admissibility": "Admissibility",
    "fit.competitiveness": "Competitiveness",
    "fit.fitdim": "Fit",
    "fit.confidence_dim": "Confidence",

    // ─── Locale toggle ──
    "locale.label": "Language",
    "locale.en": "English",
    "locale.ko": "한국어",
  },

  "ko": {
    // ─── 자기서사 / 내러티브 ──
    "narrative.title": "\ub0b4 \uc774\uc57c\uae30",
    "narrative.subtitle": "\ubb34\uc5c7\uc744 \uc18c\uc911\ud788 \uc5ec\uae30\uace0, \uc5b4\ub5bb\uac8c \uadf8\uac83\uc744 \ubcf4\uc5ec\uc8fc\uc154\uc8e0? 100\u20131500\uc790.",
    "narrative.placeholder": "\uc800\ub294 ...\ub97c \uae4a\uc774 \uc544\ub07c\uba70, \ub2e4\uc74c\ucc98\ub7fc \ubcf4\uc5ec\uc640\uc2b5\ub2c8\ub2e4...",
    "narrative.save": "\ub0b4\ub7ec\ud2f0\ube0c \uc800\uc7a5",
    "narrative.delete": "\uc0ad\uc81c",
    "narrative.saved_at": "{when}\uc5d0 \uc800\uc7a5\ub428",
    "narrative.too_short": "\ucd5c\uc18c \uae00\uc790 100\uc790 \uc911 {chars}\uc790, \ucd5c\uc18c \ub2e8\uc5b4 20\uac1c \uc911 {words}\uac1c.",
    "narrative.too_long": "{chars}/1500\uc790 \u2014 \uc774\uc57c\uae30\ub97c \uc870\uae08 \ub354 \ub2e8\ub2e8\ud558\uac8c \ub2e4\ub4ec\uc5b4\uc8fc\uc138\uc694.",
    "narrative.empty_hint": "\ud65c\ub3d9 \uc21c\uc704\ub97c \uc0b0\uc815\ud558\uae30 \uc804\uc5d0, \ud559\uc0dd\ub2c8\uc758 \ub3d9\uae30\uc640 \uadfc\uac70\uac00 \ub4e4\uc5b4\uac04 \ucd08\uace0\ub97c \uba3c\uc800 \uc801\uc5b4\uc8fc\uc138\uc694.",
    "narrative.why_required": "\uc774 \uc774\uc57c\uae30\ub294 \ud65c\ub3d9 \uc21c\uc704\ub97c \uc815\ud558\uace0, \ud6c4\ubcf4 EC\uc758 \uc801\ud569\ub3c4\ub97c \ucc44\uc810\ud558\uba70, \ub4dc\ub9ac\ud504\ud2b8\ub97c \uac10\uc9c0\ud558\ub294 \uae30\uc900\uc785\ub2c8\ub2e4. \uc5ec\uae30\uc11c \ud55c \ubc88 \uc800\uc7a5\ud558\uc2dc\uba74 \uc774\ud6c4\uc5d4 \uc0ac\uc774\ub4dc\ubc14\uc5d0\uc11c \uc5b8\uc81c\ub4e0\uc9c0 \ub2e4\uc2dc \uc5fc\uc5b4\ubcfc \uc218 \uc788\uc2b5\ub2c8\ub2e4.",

    // ─── 사이드바 / 채팅 도구 ──
    "chat.tools.narrative": "\ub0b4 \uc774\uc57c\uae30 \ud3b8\uc9d1",
    "chat.tools.candidates": "\ud65c\ub3d9 \uc544\uc774\ub514\uc5b4 \uc21c\uc704",
    "chat.tools.deadlines": "\ub9c8\uac10\uc77c",
    "chat.modal.close": "\ub2eb\uae30",

    // ─── 드리프트 배너 ──
    "drift.dismiss": "\ub2eb\uae30",
    "drift.review": "\ud65c\ub3d9 \uc810\uac80",

    // ─── 후보 활동 랭킹 ──
    "candidates.title": "\ud65c\ub3d9 \uc544\uc774\ub514\uc5b4 \uc21c\uc704",
    "candidates.subtitle": "\ud55c \uc904\uc5d0 \ud558\ub098\uc529 \uc544\uc774\ub514\uc5b4\ub97c \uc801\uc5b4\uc8fc\uc138\uc694. \ub0b4\ub7ec\ud2f0\ube0c\uc640\uc758 \ubd80\ud569\ub3c4\ub97c \uc0b0\uc815\ud574\ub4dc\ub9bd\ub2c8\ub2e4.",
    "candidates.placeholder": "\uc5f0\uc138\ub300 \uacc4\uc0b0 \uc2e0\uacbd\uacfc\ud559 \uc5f0\uad6c\n\uc544\uc0b0\ubcd1\uc6d0 \ucf54\ub529 \ub79c \ubcf4\uc870 \ubd09\uc0ac\n\uad50\ub0b4 \uc0dd\uba85\uc815\ubcf4\ud559 \ub3d9\uc544\ub9ac \ucc3d\ub9bd",
    "candidates.rank": "\uc21c\uc704 \uc0b0\uc815",
    "candidates.no_narrative_cta": "\uba3c\uc800 \ub0b4\ub7ec\ud2f0\ube0c\ub97c \uc791\uc131\ud558\uc138\uc694",
    "candidates.empty": "\uc704\uc5d0 \uc544\uc774\ub514\uc5b4\ub97c \ucd5c\uc18c \ud558\ub098 \uc785\ub825\ud574\uc8fc\uc138\uc694.",
    "candidates.rank_label": "#{rank}",
    "candidates.fit_label": "\ubd80\ud569\ub3c4",
    "candidates.tier_label": "\ud2f0\uc5b4",
    "candidates.bucket_match": "\uc804\uacf5 \ub9e4\uce6d: {bucket}",
    "candidates.themes_match": "\uc8fc\uc81c: {themes}",

    // ─── 마감일 ──
    "deadlines.title": "\ub9c8\uac10\uc77c",
    "deadlines.add": "\ub9c8\uac10\uc77c \ucd94\uac00",
    "deadlines.title_field": "\uc81c\ubaa9",
    "deadlines.due_field": "\ub9c8\uac10\uc77c (\ub0a0\uc9dc)",
    "deadlines.category_field": "\uce74\ud14c\uace0\ub9ac",
    "deadlines.notes_field": "\uba54\ubaa8",
    "deadlines.save": "\uc800\uc7a5",
    "deadlines.cancel": "\ucde8\uc18c",
    "deadlines.mark_done": "\uc644\ub8cc \ud45c\uc2dc",
    "deadlines.snooze": "\ub098\uc911\uc5d0",
    "deadlines.reopen": "\ub2e4\uc2dc \uc5f4\uae30",
    "deadlines.remove": "\uc0ad\uc81c",
    "deadlines.empty": "\uc544\uc9c1 \ub9c8\uac10\uc77c\uc774 \uc5c6\uc2b5\ub2c8\ub2e4. Common App, Early Decision, \uc7a5\ud559\uae08 \ub4f1\uc744 \ucd94\uac00\ud574\uc8fc\uc138\uc694.",
    "deadlines.overdue_chip": "\uc9c0\ub0a8",
    "deadlines.due_chip": "{days}\uc77c \ub0a8\uc74c",

    // ─── 명성 카드 ──
    "prestige.title": "\uba85\uc131 \uadfc\uac70",
    "prestige.no_data": "\uc774 \ud65c\ub3d9\uc758 \uba85\uc131 \uadfc\uac70\uac00 \uc544\uc9c1 \ucea1\uc25c\ub418\uc5b4 \uc788\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4.",
    "prestige.score": "\uc810\uc218",
    "prestige.sources": "\uc778\uc6a9\ub41c \ucd9c\ucc98",

    // ─── 5-팩터 ──
    "factor.legend": "5\uac1c \uc694\uc18c \uac15\uc810",

    // ─── 언어 선택 ──
    "locale.label": "\uc5b8\uc5b4",
    "locale.en": "English",
    "locale.ko": "\ud55c\uad6d\uc5b4",

    "chat.tools.spike": "\uc2a4\ud30c\uc774\ud06c \ud30c\uc778\ub354",
    "chat.tools.evidence": "\uadfc\uac70 \ubcf4\uae30",
    "chat.tools.courses": "\uc218\uac15 \uacc4\ud68d",
    "spike.title": "\uc2a4\ud30c\uc774\ud06c \ud30c\uc778\ub354",
    "spike.subtitle": "\uc5b4\ub5a4 2~3\uac1c \ud65c\ub3d9\uc774 \uc9c0\uc6d0\uc11c\ub97c \uc774\ub04c\uc5b4\uc57c \ud558\ub294\uc9c0, \uadf8\ub9ac\uace0 \uc5b4\ub5a4 \ud65c\ub3d9\uc774 \uc774\ub97c \ub4b7\ubc1b\uce68\ud558\ub294\uc9c0 \ubcf4\uc5ec\ub4dc\ub9bd\ub2c8\ub2e4.",
    "spike.leading": "\uc8fc\ub825 \ud65c\ub3d9",
    "spike.supporting": "\ubcf4\uc870 \ud65c\ub3d9",
    "spike.empty": "\uc544\uc9c1 \uc0b0\uc815\ub41c \ud65c\ub3d9\uc774 \uc5c6\uc2b5\ub2c8\ub2e4. \uba3c\uc800 \ud65c\ub3d9\uc744 \ucd94\uac00\ud558\uace0 \ub0b4 \uc774\uc57c\uae30\ub97c \uc800\uc7a5\ud574\uc8fc\uc138\uc694.",
    "spike.rank": "\uc8fc\ub825 \uc810\uc218",
    "spike.show_supporting": "\ubcf4\uc870 \ud65c\ub3d9 {n}\uac1c \ubcf4\uae30",
    "spike.hide_supporting": "\ubcf4\uc870 \ud65c\ub3d9 \uc228\uae30\uae30",
    "evidence.title": "\uadfc\uac70 \ubcf4\uae30",
    "evidence.subtitle": "\ubaa8\ub4e0 \uc548\ub0b4\ub294 \uac80\uc99d\ub41c \uc0ac\uc2e4, AI \ucd94\ub860, \ucf54\uce6d \uc138 \uac00\uc9c0\ub85c \uad6c\ubd84\ub429\ub2c8\ub2e4.",
    "evidence.verified": "\uac80\uc99d\ub41c \uc0ac\uc2e4",
    "evidence.verified_sub": "\uacf5\uc2dd \ucd9c\ucc98 \uae30\ubc18 \u2014 \ucd9c\ucc98 \ud45c\uae30.",
    "evidence.inference": "\ubaa8\ub378 \ucd94\ub860",
    "evidence.inference_sub": "\ud559\uc0dd\ub2d8 \ub370\uc774\ud130\uc5d0 \uadfc\uac70\ud55c AI \uc0dd\uc131 \uacb0\uacfc.",
    "evidence.coaching": "\ucf54\uce6d",
    "evidence.coaching_sub": "\uad6c\uc18d\ub825 \uc5c6\ub294 \uc81c\uc548.",
    "evidence.empty": "\uc544\uc9c1 \ubd88\ub7ec\uc628 \uadfc\uac70\uac00 \uc5c6\uc2b5\ub2c8\ub2e4.",
    "evidence.source": "\ucd9c\ucc98",
    "evidence.not_scored": "\ub3c5\ub9bd\uc801\uc73c\ub85c \ud3c9\uac00\ub418\uc9c0 \uc54a\uc74c",
    "courses.title": "\uc218\uac15 \uacc4\ud68d",
    "courses.subtitle": "\uc804\uacf5\uc5d0 \ub9de\ucd98 \uc218\uac15 \uc21c\uc11c \u2014 \uc774\ubbf8 \ub4e4\uc740 \uacfc\ubaa9\uacfc \ubcf4\uac15\ud558\uba74 \uc88b\uc744 \uacfc\ubaa9\uc785\ub2c8\ub2e4.",
    "courses.have": "\uc218\uac15\ud55c \uacfc\ubaa9",
    "courses.next": "\ub2e4\uc74c\uc73c\ub85c \uace0\ub824\ud574\ubcfc \uacfc\ubaa9",
    "courses.no_major": "\ub9de\ucda4\ud615 \uc21c\uc11c\ub97c \ubc1b\uc73c\ub824\uba74 \ud504\ub85c\ud544\uc5d0\uc11c \ud76c\ub9dd \uc804\uacf5\uc744 \uc124\uc815\ud574\uc8fc\uc138\uc694.",
    "courses.generic_note": "\uc774 \uc804\uacf5\uc5d0 \ub300\ud55c \ub9de\ucda4 \uc21c\uc11c\uac00 \uc544\uc9c1 \uc5c6\uc5b4 \ud3ed\ub113\uc740 \ud559\uc5c5 \uac15\ub3c4 \uae30\uc900 \uc21c\uc11c\ub97c \ubcf4\uc5ec\ub4dc\ub9bd\ub2c8\ub2e4.",
    "fit.confidence": "\uadfc\uac70 \uc2e0\ub8b0\ub3c4",
    "fit.redflags": "\ubcf4\uc644\uc774 \ud544\uc694\ud55c \uc810",
    "fit.strategy": "\uc81c\uc548 \ud3ec\uc9c0\uc154\ub2dd",
    "fit.limited": "\uc774 \ud559\uad50\uc5d0 \ub300\ud55c \ub370\uc774\ud130\uac00 \ubd80\uc871\ud574 \uac00\uce58\uad00 \uc77c\uce58\ub3c4\ub9cc \ud45c\uc2dc\ud569\ub2c8\ub2e4.",
    "fit.admissibility": "\ud559\uc5c5 \uc900\ube44\ub3c4",
    "fit.competitiveness": "\uacbd\uc7c1 \uac15\ub3c4",
    "fit.fitdim": "\uc801\ud569\ub3c4",
    "fit.confidence_dim": "\uc2e0\ub8b0\ub3c4",
    "candidates.generate": "\u2728 \ub0b4 \ud504\ub85c\ud544\ub85c \uc544\uc774\ub514\uc5b4 \uc0dd\uc131",
    "candidates.generating": "\uc544\uc774\ub514\uc5b4 \uc0dd\uc131 \uc911\u2026",
    "candidates.generated_hint": "\ud504\ub85c\ud544\uc744 \ubc14\ud0d5\uc73c\ub85c \uc0dd\uc131\ud55c \uc544\uc774\ub514\uc5b4\uc785\ub2c8\ub2e4 \u2014 \ud559\uc0dd\ub2d8\uc758 \uae30\ub85d\uc5d0 \uadfc\uac70\ud55c \uc81c\uc548\uc774\ub2c8, \ub9c8\uc74c\uc5d0 \ub4dc\ub294 \ud56d\ubaa9\uc744 \uc704\uc5d0 \ucd94\uac00\ud574 \uc21c\uc704\ub97c \ub9e4\uaca8\ubcf4\uc138\uc694.",
    "candidates.no_profile": "\uc544\uc774\ub514\uc5b4\uc758 \uadfc\uac70\uac00 \ub420 \uc218 \uc788\ub3c4\ub85d \uba3c\uc800 \ud504\ub85c\ud544\uc5d0 \uc218\uac15 \uacfc\ubaa9, \ud65c\ub3d9, \uc810\uc218\ub97c \ucd94\uac00\ud574\uc8fc\uc138\uc694.",
    "tools.tuned_for": "\ud83c\udfaf \ub9de\ucda4 \ub300\uc0c1: {schools}",
    "candidates.llm_ranked": "\u2728 \uc6f9 \ub9ac\uc11c\uce58 \uae30\ubc18 AI \uc21c\uc704",
    "narrative.draft_cta": "\u2728 \ub0b4 \ud504\ub85c\ud544\ub85c \ucd08\uc548 \uc791\uc131",
    "narrative.drafting": "\ucd08\uc548 \uc791\uc131 \uc911\u2026",
    "narrative.draft_hint": "\ud504\ub85c\ud544\uc744 \ubc14\ud0d5\uc73c\ub85c \uc0dd\uc131\ud55c \uc2dc\uc791\uc810\uc785\ub2c8\ub2e4 \u2014 \ud559\uc0dd\ub2d8\ub2f5\uac8c \ub2e4\ub4ec\uc740 \ub4a4 \uc800\uc7a5\ud558\uc138\uc694.",
    "narrative.auto_badge": "\u21bb \ud504\ub85c\ud544\uc744 \ubc14\ud0d5\uc73c\ub85c \uc790\ub3d9 \uc5c5\ub370\uc774\ud2b8\ub429\ub2c8\ub2e4. \uc5b8\uc81c\ub4e0 \uc9c1\uc811 \uc218\uc815\u00b7\uc800\uc7a5\ud574 \ub0b4 \uac83\uc73c\ub85c \ub9cc\ub4dc\uc138\uc694.",
    "narrative.stale_note": "\uc791\uc131\ud558\uc2e0 \uc774\uc57c\uae30\uac00 \uc0c8\ub85c \ucd94\uac00\ub41c \ud65c\ub3d9\u00b7\uacfc\ubaa9\ubcf4\ub2e4 \uc774\uc804 \uac83\uc785\ub2c8\ub2e4. \ucd08\uc548\uc744 \ub2e4\uc2dc \uc0dd\uc131\ud574 \ubc18\uc601\ud558\uac70\ub098, \uc9c0\uae08 \ub0b4\uc6a9\uc744 \uadf8\ub300\ub85c \ub450\uc154\ub3c4 \ub429\ub2c8\ub2e4.",
  },
};

const PLACEHOLDER_RE = /\{(\w+)\}/g;

// Pure t(): looks up a key in the locale dict, falls back to en-US, then
// to the key literal. Interpolates {placeholder} from params.
export function t(locale, key, params) {
  const dict = STRINGS[locale] || STRINGS["en-US"];
  let s = dict[key];
  if (s === undefined) s = STRINGS["en-US"][key];
  if (s === undefined) return key;
  if (!params) return s;
  return String(s).replace(PLACEHOLDER_RE, (m, name) => (name in params ? String(params[name]) : m));
}

export function detectLocale() {
  if (typeof window === "undefined") return "en-US";
  const stored = window.localStorage?.getItem?.("cc_locale");
  if (stored && (stored === "ko" || stored === "en-US")) return stored;
  const nav = (window.navigator?.language || "").toLowerCase();
  if (nav.startsWith("ko")) return "ko";
  return "en-US";
}

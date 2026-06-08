import { useState, useEffect } from "react";
import { narrative as narrativeApi } from "../api.js";
import { t } from "../i18n.js";

// ═══════════════════════════════════════════════════════════════════════
// NarrativeEditor — write/edit the student's personal story (100–1500 chars,
// 20+ words). The backend uses this as the baseline for EC fit + drift +
// candidate ranking. Mirrors server-side validation client-side for instant
// feedback, but trusts the server's 422 on save as the source of truth.
// ═══════════════════════════════════════════════════════════════════════

const MIN_CHARS = 100;
const MAX_CHARS = 1500;
const MIN_WORDS = 20;

export default function NarrativeEditor({ locale = "en-US", onSaved, targetSchools = [] }) {
  const [text, setText] = useState("");
  const [activeId, setActiveId] = useState(null);
  const [savedAt, setSavedAt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [serverMsg, setServerMsg] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftedNote, setDraftedNote] = useState(false);
  const [source, setSource] = useState("student");
  const [profileStale, setProfileStale] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const active = await narrativeApi.getActive();
        if (!alive || !active) return;
        setText(active.narrative_text || active.text || "");
        setActiveId(active.id || active.narrative_id || null);
        setSavedAt(active.created_at || active.updated_at || null);
        setSource(active.source || "student");
        setProfileStale(Boolean(active.profileStale));
      } catch { /* surfaced on save */ }
    })();
    return () => { alive = false; };
  }, []);

  const trimmed = text.trim();
  const charCount = trimmed.length;
  const wordCount = trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
  const tooShort = charCount < MIN_CHARS || wordCount < MIN_WORDS;
  const tooLong = charCount > MAX_CHARS;
  const valid = !tooShort && !tooLong;

  async function save() {
    setBusy(true); setErr(""); setServerMsg("");
    try {
      const r = await narrativeApi.save({ text: trimmed });
      setActiveId(r.id || r.narrative_id || null);
      setSavedAt(new Date().toISOString());
      setServerMsg(r.friendlyMessage || "");
      // Saving is the student taking ownership — flips it to their voice and
      // stops auto-overwrite; clears the stale flag.
      setSource("student");
      setProfileStale(false);
      setDraftedNote(false);
      if (onSaved) onSaved(r);
    } catch (e) {
      setErr(e.body?.friendlyMessage || e.message || "Failed to save narrative.");
    } finally {
      setBusy(false);
    }
  }

  async function draftFromProfile() {
    setDrafting(true); setErr(""); setServerMsg(""); setDraftedNote(false);
    try {
      const r = await narrativeApi.draft(targetSchools);
      if (r?.draft) { setText(r.draft); setDraftedNote(true); }
      else setErr("No draft was generated. Add more to your profile and try again.");
    } catch (e) {
      setErr(e.body?.friendlyMessage || e.body?.error || e.message || "Failed to draft narrative.");
    } finally {
      setDrafting(false);
    }
  }

  async function remove() {
    if (!activeId) return;
    setBusy(true); setErr("");
    try {
      await narrativeApi.delete(activeId);
      setText(""); setActiveId(null); setSavedAt(null);
      if (onSaved) onSaved(null);
    } catch (e) {
      setErr(e.body?.friendlyMessage || e.message || "Failed to delete narrative.");
    } finally {
      setBusy(false);
    }
  }

  const labelColor = valid ? "#68d391" : tooLong ? "#f56565" : "#8a8a9a";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#fff", marginBottom: 4 }}>
            {t(locale, "narrative.title")}
          </div>
          <div style={{ fontSize: 12, color: "#8a8a9a" }}>
            {t(locale, "narrative.subtitle")}
          </div>
        </div>
        <button
          onClick={draftFromProfile}
          disabled={drafting || busy}
          style={{
            flexShrink: 0, padding: "8px 14px", borderRadius: 10,
            border: "1px solid rgba(167,139,250,0.35)",
            background: "rgba(167,139,250,0.10)", color: "#c4b5fd",
            fontSize: 12, fontWeight: 600, cursor: drafting || busy ? "default" : "pointer",
          }}
        >
          {drafting ? t(locale, "narrative.drafting") : t(locale, "narrative.draft_cta")}
        </button>
      </div>
      {draftedNote && !err && (
        <div style={{ fontSize: 12, color: "#c4b5fd", padding: "10px 14px", borderRadius: 10, background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.18)", lineHeight: 1.5 }}>
          {t(locale, "narrative.draft_hint")}
        </div>
      )}
      {!draftedNote && activeId && source === "auto" && (
        <div style={{ fontSize: 11, color: "#9ae6b4", padding: "6px 12px", borderRadius: 8, background: "rgba(104,211,145,0.06)", border: "1px solid rgba(104,211,145,0.18)" }}>
          {t(locale, "narrative.auto_badge")}
        </div>
      )}
      {!draftedNote && activeId && source === "student" && profileStale && (
        <div style={{ fontSize: 12, color: "#fbd38d", padding: "10px 14px", borderRadius: 10, background: "rgba(251,211,141,0.08)", border: "1px solid rgba(251,211,141,0.2)", lineHeight: 1.5 }}>
          {t(locale, "narrative.stale_note")}
        </div>
      )}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t(locale, "narrative.placeholder")}
        rows={8}
        style={{
          width: "100%",
          padding: "14px",
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.02)",
          color: "#e0e0e0",
          fontSize: 14,
          lineHeight: 1.6,
          resize: "vertical",
          fontFamily: "inherit",
        }}
      />
      <div style={{ fontSize: 12, color: labelColor }}>
        {tooShort
          ? t(locale, "narrative.too_short", { chars: charCount, words: wordCount })
          : tooLong
            ? t(locale, "narrative.too_long", { chars: charCount })
            : `${charCount} / ${MAX_CHARS} • ${wordCount} ${locale === "ko" ? "단어" : "words"}`}
      </div>
      {err && (
        <div style={{ fontSize: 13, color: "#f56565", padding: "10px 14px", borderRadius: 10, background: "rgba(245,101,101,0.08)" }}>
          {err}
        </div>
      )}
      {serverMsg && !err && (
        <div style={{ fontSize: 13, color: "#68d391", padding: "10px 14px", borderRadius: 10, background: "rgba(104,211,145,0.08)" }}>
          {serverMsg}
        </div>
      )}
      <div style={{ display: "flex", gap: 10 }}>
        <button
          onClick={save}
          disabled={!valid || busy}
          style={{
            padding: "10px 18px",
            borderRadius: 12,
            border: "none",
            background: valid && !busy ? "linear-gradient(135deg,#378ADD,#667eea)" : "rgba(255,255,255,0.04)",
            color: valid && !busy ? "#fff" : "#444",
            fontSize: 14,
            fontWeight: 600,
            cursor: valid && !busy ? "pointer" : "default",
          }}
        >
          {t(locale, "narrative.save")}
        </button>
        {activeId && (
          <button
            onClick={remove}
            disabled={busy}
            style={{
              padding: "10px 18px",
              borderRadius: 12,
              border: "1px solid rgba(245,101,101,0.3)",
              background: "transparent",
              color: "#f56565",
              fontSize: 13,
              cursor: busy ? "default" : "pointer",
            }}
          >
            {t(locale, "narrative.delete")}
          </button>
        )}
        {savedAt && (
          <div style={{ alignSelf: "center", fontSize: 11, color: "#555", marginLeft: "auto" }}>
            {t(locale, "narrative.saved_at", { when: new Date(savedAt).toLocaleString(locale === "ko" ? "ko-KR" : "en-US") })}
          </div>
        )}
      </div>
      {!activeId && (
        <div style={{ fontSize: 12, color: "#8a8a9a", padding: "10px 14px", borderRadius: 10, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", lineHeight: 1.6 }}>
          {t(locale, "narrative.empty_hint")}
        </div>
      )}
    </div>
  );
}

NarrativeEditor.MIN_CHARS = MIN_CHARS;
NarrativeEditor.MAX_CHARS = MAX_CHARS;
NarrativeEditor.MIN_WORDS = MIN_WORDS;

import { useEffect, useState } from "react";
import { deadlines as deadlinesApi } from "../api.js";
import { t } from "../i18n.js";

// ═══════════════════════════════════════════════════════════════════════
// DeadlineTracker — list/add/patch/delete student deadlines. summary lives
// on the GET response (overdue/dueIn7/dueIn30/friendlyMessage). Render the
// server's friendlyMessage verbatim.
// ═══════════════════════════════════════════════════════════════════════

const STATUS_NEXT = { open: "done", done: "open", snoozed: "open" };

export default function DeadlineTracker({ locale = "en-US", compact = false }) {
  const [list, setList] = useState([]);
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ title: "", dueAt: "", category: "", notes: "" });

  async function refresh() {
    setBusy(true); setErr("");
    try {
      const r = await deadlinesApi.list();
      setList(r.deadlines || r.list || []);
      setSummary(r.summary || null);
    } catch (e) {
      setErr(e.body?.friendlyMessage || e.message || "Failed to load deadlines.");
    } finally { setBusy(false); }
  }

  useEffect(() => { refresh(); }, []);

  async function save() {
    if (!draft.title.trim() || !draft.dueAt) return;
    setBusy(true); setErr("");
    try {
      await deadlinesApi.create({
        title: draft.title.trim(),
        dueAt: new Date(draft.dueAt).toISOString(),
        category: draft.category || undefined,
        notes: draft.notes || undefined,
      });
      setDraft({ title: "", dueAt: "", category: "", notes: "" });
      setAdding(false);
      await refresh();
    } catch (e) {
      setErr(e.body?.friendlyMessage || e.message || "Failed to save deadline.");
    } finally { setBusy(false); }
  }

  async function patch(id, body) {
    setBusy(true); setErr("");
    try {
      await deadlinesApi.patch(id, body);
      await refresh();
    } catch (e) {
      setErr(e.body?.friendlyMessage || e.message || "Failed to update deadline.");
    } finally { setBusy(false); }
  }

  async function remove(id) {
    setBusy(true); setErr("");
    try {
      await deadlinesApi.delete(id);
      await refresh();
    } catch (e) {
      setErr(e.body?.friendlyMessage || e.message || "Failed to delete deadline.");
    } finally { setBusy(false); }
  }

  // Compact summary chip — used at the top of CHAT.
  if (compact) {
    if (!summary || (summary.overdue === 0 && summary.dueIn7 === 0)) return null;
    const isOverdue = summary.overdue > 0;
    return (
      <div style={{
        fontSize: 12,
        padding: "6px 12px",
        borderRadius: 999,
        background: isOverdue ? "rgba(245,101,101,0.1)" : "rgba(237,137,54,0.1)",
        color: isOverdue ? "#fed7d7" : "#fbd38d",
        border: `1px solid ${isOverdue ? "rgba(245,101,101,0.2)" : "rgba(237,137,54,0.2)"}`,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}>
        {summary.friendlyMessage || `${summary.overdue} overdue, ${summary.dueIn7} due in 7d`}
      </div>
    );
  }

  function dayDelta(dueAt) {
    const ms = new Date(dueAt).getTime() - Date.now();
    return Math.round(ms / (1000 * 60 * 60 * 24));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: "#fff" }}>
          {t(locale, "deadlines.title")}
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={() => setAdding((v) => !v)} style={{
          fontSize: 13, padding: "6px 12px", borderRadius: 8,
          border: "1px solid rgba(255,255,255,0.1)",
          background: "transparent", color: "#e0e0e0", cursor: "pointer",
        }}>
          {t(locale, "deadlines.add")}
        </button>
      </div>
      {summary?.friendlyMessage && (
        <div style={{ fontSize: 12, color: "#8a8a9a", padding: "8px 12px", borderRadius: 8, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          {summary.friendlyMessage}
        </div>
      )}
      {adding && (
        <div style={{ padding: 12, borderRadius: 10, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", gap: 8 }}>
          <input
            value={draft.title}
            onChange={(e) => setDraft((p) => ({ ...p, title: e.target.value }))}
            placeholder={t(locale, "deadlines.title_field")}
            style={inp}
          />
          <input
            type="date"
            value={draft.dueAt}
            onChange={(e) => setDraft((p) => ({ ...p, dueAt: e.target.value }))}
            style={inp}
          />
          <input
            value={draft.category}
            onChange={(e) => setDraft((p) => ({ ...p, category: e.target.value }))}
            placeholder={t(locale, "deadlines.category_field")}
            style={inp}
          />
          <input
            value={draft.notes}
            onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))}
            placeholder={t(locale, "deadlines.notes_field")}
            style={inp}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={save} disabled={busy || !draft.title.trim() || !draft.dueAt} style={{
              fontSize: 13, padding: "8px 14px", borderRadius: 8, border: "none",
              background: draft.title.trim() && draft.dueAt && !busy ? "linear-gradient(135deg,#378ADD,#667eea)" : "rgba(255,255,255,0.04)",
              color: draft.title.trim() && draft.dueAt && !busy ? "#fff" : "#444",
              cursor: draft.title.trim() && draft.dueAt && !busy ? "pointer" : "default", fontWeight: 600,
            }}>{t(locale, "deadlines.save")}</button>
            <button onClick={() => setAdding(false)} style={{
              fontSize: 13, padding: "8px 14px", borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.1)", background: "transparent",
              color: "#8a8a9a", cursor: "pointer",
            }}>{t(locale, "deadlines.cancel")}</button>
          </div>
        </div>
      )}
      {err && <div style={{ fontSize: 13, color: "#f56565" }}>{err}</div>}
      {list.length === 0 && !busy && (
        <div style={{ fontSize: 13, color: "#8a8a9a", padding: "12px 14px", borderRadius: 10, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          {t(locale, "deadlines.empty")}
        </div>
      )}
      {list.map((d) => {
        const days = dayDelta(d.dueAt || d.due_at);
        const overdue = days < 0;
        const isDone = d.status === "done";
        return (
          <div key={d.id} style={{
            padding: "12px 14px", borderRadius: 10,
            background: isDone ? "rgba(104,211,145,0.04)" : "rgba(255,255,255,0.02)",
            border: `1px solid ${isDone ? "rgba(104,211,145,0.12)" : "rgba(255,255,255,0.06)"}`,
            opacity: isDone ? 0.7 : 1,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1, fontSize: 14, color: "#fff", textDecoration: isDone ? "line-through" : "none" }}>
                {d.title}
              </div>
              <span style={{
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 999,
                color: overdue ? "#fed7d7" : days <= 7 ? "#fbd38d" : "#cbd5e0",
                background: overdue ? "rgba(245,101,101,0.1)" : days <= 7 ? "rgba(237,137,54,0.1)" : "rgba(255,255,255,0.04)",
              }}>
                {overdue ? t(locale, "deadlines.overdue_chip") : t(locale, "deadlines.due_chip", { days })}
              </span>
            </div>
            {d.notes && (
              <div style={{ fontSize: 12, color: "#8a8a9a", marginTop: 6 }}>{d.notes}</div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button onClick={() => patch(d.id, { status: STATUS_NEXT[d.status || "open"] })} style={btn}>
                {isDone ? t(locale, "deadlines.reopen") : t(locale, "deadlines.mark_done")}
              </button>
              {!isDone && (
                <button onClick={() => patch(d.id, { status: "snoozed" })} style={btn}>
                  {t(locale, "deadlines.snooze")}
                </button>
              )}
              <div style={{ flex: 1 }} />
              <button onClick={() => remove(d.id)} style={{ ...btn, color: "#f56565", borderColor: "rgba(245,101,101,0.2)" }}>
                {t(locale, "deadlines.remove")}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const inp = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.02)",
  color: "#e0e0e0",
  fontSize: 13,
};

const btn = {
  fontSize: 11,
  padding: "5px 10px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "transparent",
  color: "#cbd5e0",
  cursor: "pointer",
};

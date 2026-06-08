import { useState, useEffect } from "react";
import { courses as coursesApi } from "../api.js";
import { t } from "../i18n.js";

// ═══════════════════════════════════════════════════════════════════════
// CourseSequencer — major-aligned course-sequence recommender. Self-fetches
// GET /api/courses/recommendations and renders the three trust lanes:
//   • inference: the reference ladder for the major + what's on the
//     transcript (have) vs. structurally implied (missing)
//   • coaching: concrete "you might consider next" suggestions, each with a
//     why-for-this-major rationale + any concept gap it fills
//   • verified: a school's stated course expectations, cited (when present)
// Resolution no human counselor matches: course AND concept level.
// ═══════════════════════════════════════════════════════════════════════

const LEVEL_COLORS = {
  foundational: "#8a8a9a",
  core: "#63b3ed",
  advanced: "#9f7aea",
  recommended: "#f6ad55",
};

function ConceptTag({ signal }) {
  if (!signal) return null;
  if (signal.status === "developing") {
    return <span style={{ fontSize: 10, color: "#f6ad55", marginLeft: 8 }}>concept mastery developing ({Number(signal.subjectVector).toFixed(2)})</span>;
  }
  if (signal.status === "solid") {
    return <span style={{ fontSize: 10, color: "#68d391", marginLeft: 8 }}>concepts solid ({Number(signal.subjectVector).toFixed(2)})</span>;
  }
  return null;
}

function CourseRow({ c, dim }) {
  const color = LEVEL_COLORS[c.level] || "#8a8a9a";
  return (
    <div style={{ padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 13, color: dim ? "#a0aec0" : "#fff", fontWeight: 600, flex: 1 }}>{c.name}</span>
        <span style={{ fontSize: 9, color, textTransform: "uppercase", letterSpacing: "0.05em" }}>{c.level}</span>
      </div>
      {c.conceptSignal && <div><ConceptTag signal={c.conceptSignal} /></div>}
      {(c.suggestion || c.why) && (
        <div style={{ fontSize: 11, color: "#8a8a9a", marginTop: 3, lineHeight: 1.5 }}>{c.suggestion || c.why}</div>
      )}
    </div>
  );
}

export default function CourseSequencer({ locale = "en-US", targetSchools = [] }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");

  const targetsKey = (targetSchools || []).join("|");
  useEffect(() => {
    let alive = true;
    (async () => {
      setBusy(true); setErr("");
      try {
        const r = await coursesApi.recommendations(undefined, targetSchools);
        if (alive) setData(r);
      } catch (e) {
        if (alive) setErr(e.body?.error || e.message || "Failed to load course plan.");
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetsKey]);

  const inference = data?.lanes?.inference;
  const coaching = data?.lanes?.coaching;
  const verified = data?.lanes?.verified || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={{ fontSize: 16, fontWeight: 600, color: "#fff", marginBottom: 4 }}>{t(locale, "courses.title")}</div>
        <div style={{ fontSize: 12, color: "#8a8a9a" }}>{t(locale, "courses.subtitle")}</div>
      </div>

      {busy && <div style={{ fontSize: 13, color: "#8a8a9a" }}>…</div>}
      {err && <div style={{ fontSize: 13, color: "#f56565" }}>{err}</div>}

      {data && !inference?.bucket && !busy && (
        <div style={{ fontSize: 13, color: "#fbd38d" }}>{t(locale, "courses.no_major")}</div>
      )}

      {inference?.isGenericLadder && (
        <div style={{ fontSize: 11, color: "#8a8a9a", padding: "8px 12px", borderRadius: 8, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          {t(locale, "courses.generic_note")}
        </div>
      )}

      {inference && (
        <div style={{ fontSize: 12, color: "#a0aec0" }}>
          <span style={{ color: "#63b3ed", fontWeight: 600 }}>{inference.majorLabel}</span>
          {inference.majorRelevantCourseCount != null && (
            <span> · {inference.majorRelevantCourseCount} major-relevant course{inference.majorRelevantCourseCount === 1 ? "" : "s"} on your transcript</span>
          )}
        </div>
      )}

      {/* ── COACHING: next steps ── */}
      {coaching?.next?.length > 0 && (
        <div style={{ background: "rgba(251,211,141,0.05)", border: "1px solid rgba(251,211,141,0.18)", borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#fbd38d" }}>{t(locale, "courses.next")}</div>
          <div style={{ fontSize: 10, color: "#8a8a9a", marginBottom: 8 }}>{coaching.label}</div>
          {coaching.next.map((c) => <CourseRow key={c.id} c={c} />)}
        </div>
      )}

      {/* ── INFERENCE: what's on the transcript ── */}
      {inference?.have?.length > 0 && (
        <div style={{ background: "rgba(99,179,237,0.05)", border: "1px solid rgba(99,179,237,0.18)", borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#63b3ed" }}>{t(locale, "courses.have")}</div>
          <div style={{ fontSize: 10, color: "#8a8a9a", marginBottom: 8 }}>{inference.label}</div>
          {inference.have.map((c) => <CourseRow key={c.id} c={c} dim />)}
        </div>
      )}

      {/* ── VERIFIED: cited school expectations (when present) ── */}
      {verified.length > 0 && (
        <div style={{ background: "rgba(104,211,145,0.05)", border: "1px solid rgba(104,211,145,0.18)", borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#68d391", marginBottom: 8 }}>{t(locale, "evidence.verified")}</div>
          {verified.map((v, i) => (
            <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 12, color: "#cbd5e0" }}>
              {v.statement || v.text}
              {v.source?.url && <a href={v.source.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: "#6a8ab5", marginLeft: 6, textDecoration: "none" }}>↗</a>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

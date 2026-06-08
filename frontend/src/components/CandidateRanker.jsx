import { useState } from "react";
import { ec as ecApi, NoNarrativeError } from "../api.js";
import { t } from "../i18n.js";

// ═══════════════════════════════════════════════════════════════════════
// CandidateRanker — student types EC ideas (one per line), backend ranks
// them by predicted narrative fit. Hard-gates on missing narrative: if the
// server returns 409 + friendlyMessage, surface the message and a CTA back
// to the narrative editor instead of silently failing.
// ═══════════════════════════════════════════════════════════════════════

export default function CandidateRanker({ locale = "en-US", onWriteNarrative, targetSchools = [] }) {
  const [raw, setRaw] = useState("");
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [noNarrative, setNoNarrative] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(null);

  async function generateIdeas() {
    setGenerating(true); setErr(""); setGenerated(null);
    try {
      const r = await ecApi.generateIdeas(undefined, targetSchools);
      setGenerated(r);
    } catch (e) {
      setErr(e.body?.friendlyMessage || e.body?.error || e.message || "Failed to generate ideas.");
    } finally {
      setGenerating(false);
    }
  }

  function addIdeaToRanker(name) {
    setRaw((prev) => (prev.trim() ? `${prev.trim()}\n${name}` : name));
  }

  const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  async function rank() {
    if (lines.length === 0) { setErr(t(locale, "candidates.empty")); return; }
    setBusy(true); setErr(""); setNoNarrative(""); setResults(null);
    try {
      const candidates = lines.slice(0, 25).map((name) => ({ name }));
      const r = await ecApi.rankCandidates(candidates, targetSchools);
      setResults(r);
    } catch (e) {
      if (e instanceof NoNarrativeError) {
        setNoNarrative(e.friendlyMessage);
      } else {
        setErr(e.body?.friendlyMessage || e.message || "Failed to rank candidates.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#fff", marginBottom: 4 }}>
            {t(locale, "candidates.title")}
          </div>
          <div style={{ fontSize: 12, color: "#8a8a9a" }}>
            {t(locale, "candidates.subtitle")}
          </div>
        </div>
        <button
          onClick={generateIdeas}
          disabled={generating || busy}
          style={{
            flexShrink: 0, padding: "8px 14px", borderRadius: 10,
            border: "1px solid rgba(167,139,250,0.35)",
            background: "rgba(167,139,250,0.10)", color: "#c4b5fd",
            fontSize: 12, fontWeight: 600, cursor: generating || busy ? "default" : "pointer",
          }}
        >
          {generating ? t(locale, "candidates.generating") : t(locale, "candidates.generate")}
        </button>
      </div>

      {generated && Array.isArray(generated.ideas) && generated.ideas.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, color: "#c4b5fd", padding: "8px 12px", borderRadius: 8, background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.18)", lineHeight: 1.5 }}>
            {t(locale, "candidates.generated_hint")}
            {generated.targetSchools?.length > 0 && (
              <span style={{ display: "block", marginTop: 4, color: "#9ae6b4" }}>
                {t(locale, "tools.tuned_for", { schools: generated.targetSchools.join(", ") })}
              </span>
            )}
          </div>
          {generated.ideas.map((idea, i) => (
            <div key={i} style={{ padding: "12px 14px", borderRadius: 10, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(167,139,250,0.15)" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 14, color: "#fff", fontWeight: 600, flex: 1 }}>{idea.name}</span>
                {idea.category && <span style={{ fontSize: 10, color: "#c4b5fd", padding: "2px 8px", borderRadius: 12, background: "rgba(167,139,250,0.12)" }}>{idea.category}</span>}
                {idea.friendly?.tier?.short && <span style={{ fontSize: 11, color: "#68d391" }}>{idea.friendly.tier.short}</span>}
              </div>
              {idea.rationale && <div style={{ fontSize: 12, color: "#cbd5e0", marginTop: 6, lineHeight: 1.5 }}>{idea.rationale}</div>}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                {idea.hoursPerWeekEstimate != null && <span style={{ fontSize: 10, color: "#8a8a9a" }}>~{idea.hoursPerWeekEstimate} hrs/wk</span>}
                <button onClick={() => addIdeaToRanker(idea.name)} style={{ marginLeft: "auto", fontSize: 11, padding: "4px 10px", borderRadius: 8, border: "1px solid rgba(104,211,145,0.25)", background: "rgba(104,211,145,0.06)", color: "#9ce5b6", cursor: "pointer" }}>
                  + Add to ranker
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder={t(locale, "candidates.placeholder")}
        rows={6}
        style={{
          width: "100%", padding: 14, borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.02)", color: "#e0e0e0",
          fontSize: 14, lineHeight: 1.6, resize: "vertical", fontFamily: "inherit",
        }}
      />
      {noNarrative && (
        <div style={{ padding: "12px 14px", borderRadius: 10, background: "rgba(245,101,101,0.08)", border: "1px solid rgba(245,101,101,0.18)" }}>
          <div style={{ fontSize: 13, color: "#fed7d7", marginBottom: 8, lineHeight: 1.5 }}>
            {noNarrative}
          </div>
          {onWriteNarrative && (
            <button onClick={onWriteNarrative} style={{
              fontSize: 13, padding: "8px 14px", borderRadius: 10,
              border: "none", background: "linear-gradient(135deg,#378ADD,#667eea)",
              color: "#fff", fontWeight: 600, cursor: "pointer",
            }}>
              {t(locale, "candidates.no_narrative_cta")}
            </button>
          )}
        </div>
      )}
      {err && <div style={{ fontSize: 13, color: "#f56565" }}>{err}</div>}
      <button
        onClick={rank}
        disabled={busy || lines.length === 0}
        style={{
          padding: "10px 18px", borderRadius: 12, border: "none",
          background: lines.length > 0 && !busy ? "linear-gradient(135deg,#378ADD,#667eea)" : "rgba(255,255,255,0.04)",
          color: lines.length > 0 && !busy ? "#fff" : "#444",
          fontSize: 14, fontWeight: 600, cursor: lines.length > 0 && !busy ? "pointer" : "default",
          alignSelf: "flex-start",
        }}
      >
        {t(locale, "candidates.rank")}
      </button>
      {(() => {
        // The /api/ec/candidates/rank endpoint returns { candidates: [...] }.
        // (Accept legacy `ranked` defensively.) Each item:
        //   { name, predictedNarrativeFit, predictedTier, candidateBucket,
        //     bucketHit, matchedThemes, friendly: { summary } }
        const ranked = results?.candidates || results?.ranked || [];
        if (!ranked.length) return null;
        return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
          {results?.engine === "llm" && (
            <div style={{ fontSize: 11, color: "#9ae6b4" }}>
              {t(locale, "candidates.llm_ranked")}
              {results.targetSchools?.length > 0 && ` · ${t(locale, "tools.tuned_for", { schools: results.targetSchools.join(", ") })}`}
            </div>
          )}
          {ranked.map((r, i) => (
            <div key={i} style={{
              padding: "12px 14px", borderRadius: 10,
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.06)",
            }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={{ fontSize: 12, color: "#667eea", fontWeight: 700 }}>
                  {t(locale, "candidates.rank_label", { rank: i + 1 })}
                </span>
                <span style={{ fontSize: 14, color: "#fff", fontWeight: 600, flex: 1 }}>
                  {r.name}
                </span>
                <span style={{ fontSize: 11, color: "#8a8a9a" }}>
                  {t(locale, "candidates.fit_label")} {Number(r.predictedNarrativeFit ?? 0).toFixed(2)}
                </span>
                {r.predictedTier && (
                  <span style={{ fontSize: 11, color: "#68d391" }}>
                    {t(locale, "candidates.tier_label")} {r.friendly?.tier?.short || r.predictedTier}
                  </span>
                )}
              </div>
              {r.friendly?.summary && (
                <div style={{ fontSize: 12, color: "#cbd5e0", marginTop: 6, lineHeight: 1.5 }}>
                  {r.friendly.summary}
                </div>
              )}
              {(r.bucketHit || r.matchedThemes?.length > 0) && (
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  {r.bucketHit && r.candidateBucket && (
                    <span style={{ fontSize: 10, color: "#fbd38d", padding: "2px 8px", borderRadius: 12, background: "rgba(251,211,141,0.08)" }}>
                      {t(locale, "candidates.bucket_match", { bucket: String(r.candidateBucket).replace(/_/g, " ") })}
                    </span>
                  )}
                  {r.matchedThemes?.length > 0 && (
                    <span style={{ fontSize: 10, color: "#90cdf4", padding: "2px 8px", borderRadius: 12, background: "rgba(144,205,244,0.08)" }}>
                      {t(locale, "candidates.themes_match", { themes: r.matchedThemes.join(", ") })}
                    </span>
                  )}
                </div>
              )}
              {r.sources?.length > 0 && (
                <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                  {r.sources.slice(0, 3).map((u, j) => (
                    <a key={j} href={u} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: "#6a8ab5", textDecoration: "none" }}>↗ source</a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        );
      })()}
    </div>
  );
}

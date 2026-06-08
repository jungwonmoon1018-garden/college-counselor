import { useState, useEffect } from "react";
import { ec as ecApi, NoNarrativeError } from "../api.js";
import { t } from "../i18n.js";
import FactorVector5 from "./FactorVector5.jsx";

// ═══════════════════════════════════════════════════════════════════════
// SpikeFinder — "which 2-3 activities should LEAD your application?"
// Self-fetches GET /api/ec/spike. Renders Leading activities as highlighted
// cards (5-factor bar + tier chip), Supporting activities as a collapsed
// list, and a wellbeing banner when the student is over-committed. This is
// the consultant's depth-over-breadth reframing, surfaced from vectors the
// backend already computed.
// ═══════════════════════════════════════════════════════════════════════

const TIER_COLORS = {
  tier_1_distinctive: "#68d391",
  tier_2_strong: "#63b3ed",
  tier_3_developing: "#f6ad55",
  tier_4_foundational: "#8a8a9a",
};

function tierLabel(tier, legend) {
  return legend?.tiers?.[tier]?.short || tier?.replace(/^tier_\d+_/, "") || tier;
}

function ECCard({ v, legend, locale, highlighted }) {
  const color = TIER_COLORS[v.tierLabel] || "#8a8a9a";
  return (
    <div style={{
      padding: "12px 14px", borderRadius: 10,
      background: highlighted ? "rgba(104,211,145,0.05)" : "rgba(255,255,255,0.02)",
      border: `1px solid ${highlighted ? "rgba(104,211,145,0.20)" : "rgba(255,255,255,0.06)"}`,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 14, color: "#fff", fontWeight: 600, flex: 1 }}>{v.ecName}</span>
        <span style={{ fontSize: 10, color, padding: "2px 8px", borderRadius: 12, background: `${color}1a`, whiteSpace: "nowrap" }}>
          {tierLabel(v.tierLabel, legend)}
        </span>
        {typeof v.rankScore === "number" && (
          <span style={{ fontSize: 11, color: "#8a8a9a" }}>
            {t(locale, "spike.rank")} {v.rankScore.toFixed(2)}
          </span>
        )}
      </div>
      <FactorVector5 vector={v.factors} friendlyLegendI18n={legend} locale={locale} />
      {v.leadRationale && (
        <div style={{ fontSize: 12, color: "#cbd5e0", marginTop: 8, lineHeight: 1.5 }}>
          {v.leadRationale}
        </div>
      )}
      {v.friendly?.prestige?.summary && (
        <div style={{ fontSize: 11, color: "#8a8a9a", marginTop: 6, lineHeight: 1.5 }}>
          {v.friendly.prestige.summary}
        </div>
      )}
      {v.sources?.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
          {v.sources.slice(0, 3).map((u, j) => (
            <a key={j} href={u} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: "#6a8ab5", textDecoration: "none" }}>↗ source</a>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SpikeFinder({ locale = "en-US", onWriteNarrative, targetSchools = [] }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");
  const [noNarrative, setNoNarrative] = useState("");
  const [showSupporting, setShowSupporting] = useState(false);

  const targetsKey = (targetSchools || []).join("|");
  useEffect(() => {
    let alive = true;
    (async () => {
      setBusy(true); setErr(""); setNoNarrative("");
      try {
        const r = await ecApi.spike(targetSchools);
        if (alive) setData(r);
      } catch (e) {
        if (!alive) return;
        if (e instanceof NoNarrativeError) setNoNarrative(e.friendlyMessage);
        else setErr(e.body?.friendlyMessage || e.message || "Failed to load Spike Finder.");
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetsKey]);

  const legend = data?.friendlyLegendI18n || null;
  const leading = data?.leading || [];
  const supporting = data?.supporting || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={{ fontSize: 16, fontWeight: 600, color: "#fff", marginBottom: 4 }}>
          {t(locale, "spike.title")}
        </div>
        <div style={{ fontSize: 12, color: "#8a8a9a" }}>{t(locale, "spike.subtitle")}</div>
      </div>

      {data?.engine === "llm" && (
        <div style={{ fontSize: 11, color: "#9ae6b4" }}>
          {t(locale, "candidates.llm_ranked")}
          {data.targetSchools?.length > 0 && ` · ${t(locale, "tools.tuned_for", { schools: data.targetSchools.join(", ") })}`}
        </div>
      )}

      {busy && <div style={{ fontSize: 13, color: "#8a8a9a" }}>…</div>}

      {noNarrative && (
        <div style={{ padding: "12px 14px", borderRadius: 10, background: "rgba(245,101,101,0.08)", border: "1px solid rgba(245,101,101,0.18)" }}>
          <div style={{ fontSize: 13, color: "#fed7d7", marginBottom: 8, lineHeight: 1.5 }}>{noNarrative}</div>
          {onWriteNarrative && (
            <button onClick={onWriteNarrative} style={{
              fontSize: 13, padding: "8px 14px", borderRadius: 10, border: "none",
              background: "linear-gradient(135deg,#378ADD,#667eea)", color: "#fff", fontWeight: 600, cursor: "pointer",
            }}>
              {t(locale, "candidates.no_narrative_cta")}
            </button>
          )}
        </div>
      )}

      {err && <div style={{ fontSize: 13, color: "#f56565" }}>{err}</div>}

      {data?.wellbeing && (
        <div style={{
          padding: "10px 12px", borderRadius: 8, fontSize: 12, lineHeight: 1.5,
          color: data.wellbeing.overCommitted ? "#fbd38d" : "#8a8a9a",
          background: data.wellbeing.overCommitted ? "rgba(251,211,141,0.08)" : "rgba(255,255,255,0.02)",
          border: `1px solid ${data.wellbeing.overCommitted ? "rgba(251,211,141,0.2)" : "rgba(255,255,255,0.06)"}`,
        }}>
          {data.wellbeing.message}
        </div>
      )}

      {!busy && !noNarrative && leading.length === 0 && !err && (
        <div style={{ fontSize: 13, color: "#8a8a9a" }}>{t(locale, "spike.empty")}</div>
      )}

      {leading.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#68d391", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
            {t(locale, "spike.leading")}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {leading.map((v) => <ECCard key={v.ecName} v={v} legend={legend} locale={locale} highlighted />)}
          </div>
        </div>
      )}

      {supporting.length > 0 && (
        <div>
          <button
            onClick={() => setShowSupporting((s) => !s)}
            style={{
              fontSize: 12, color: "#8a8a9a", background: "transparent",
              border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8,
              padding: "6px 12px", cursor: "pointer", marginBottom: showSupporting ? 8 : 0,
            }}
          >
            {showSupporting
              ? t(locale, "spike.hide_supporting")
              : t(locale, "spike.show_supporting", { n: supporting.length })}
          </button>
          {showSupporting && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {supporting.map((v) => <ECCard key={v.ecName} v={v} legend={legend} locale={locale} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

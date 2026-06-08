import { useEffect, useState } from "react";
import { ec as ecApi } from "../api.js";
import { t } from "../i18n.js";

// ═══════════════════════════════════════════════════════════════════════
// PrestigeCard — fetches /api/ec/strength/:ecName/prestige and renders the
// score, source-shape, and cited URLs. Backend already localizes the
// rationale + source labels through friendlyLegendI18n; we render verbatim.
// ═══════════════════════════════════════════════════════════════════════

export default function PrestigeCard({ ecName, locale = "en-US" }) {
  const [data, setData] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoaded(false); setData(null);
    (async () => {
      try {
        const r = await ecApi.prestige(ecName);
        if (alive) setData(r);
      } catch { /* surface as no-data */ }
      finally { if (alive) setLoaded(true); }
    })();
    return () => { alive = false; };
  }, [ecName]);

  if (!loaded) {
    return <div style={{ fontSize: 12, color: "#555", padding: "8px 12px" }}>...</div>;
  }
  if (!data || data.error) {
    return (
      <div style={{ fontSize: 12, color: "#8a8a9a", padding: "10px 14px", borderRadius: 10, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
        {data?.friendlyMessage || t(locale, "prestige.no_data")}
      </div>
    );
  }

  const score = Number(data.score ?? 0);
  const scoreColor = score >= 0.8 ? "#68d391" : score >= 0.6 ? "#fbd38d" : score >= 0.4 ? "#f6ad55" : "#a0aec0";

  return (
    <div style={{
      padding: "12px 14px",
      borderRadius: 10,
      background: "rgba(255,255,255,0.02)",
      border: "1px solid rgba(255,255,255,0.06)",
      display: "flex",
      flexDirection: "column",
      gap: 8,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#fff", flex: 1 }}>
          {t(locale, "prestige.title")}
        </span>
        <span style={{ fontSize: 13, color: scoreColor, fontWeight: 700 }}>
          {t(locale, "prestige.score")} {score.toFixed(2)}
        </span>
        {data.sourceLabel?.short && (
          <span style={{ fontSize: 10, color: "#8a8a9a", padding: "2px 6px", borderRadius: 6, background: "rgba(255,255,255,0.04)" }}>
            {data.sourceLabel.short}
          </span>
        )}
      </div>
      {data.rationale && (
        <div style={{ fontSize: 12, color: "#cbd5e0", lineHeight: 1.5 }}>
          {data.rationale}
        </div>
      )}
      {Array.isArray(data.sourcesCited) && data.sourcesCited.length > 0 && (
        <div style={{ fontSize: 11, color: "#8a8a9a" }}>
          {t(locale, "prestige.sources")}: {data.sourcesCited.map((s, i) => (
            <a key={i} href={s} target="_blank" rel="noreferrer" style={{ color: "#90cdf4", marginLeft: 6 }}>
              {(() => { try { return new URL(s).hostname; } catch { return s; } })()}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

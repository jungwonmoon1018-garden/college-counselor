import { t } from "../i18n.js";

// ═══════════════════════════════════════════════════════════════════════
// FactorVector5 — renders the 5-factor strength bar. Reads localized
// labels from the bundle's friendlyLegendI18n.factors so a Korean student
// sees Korean factor names without a frontend dictionary.
// ═══════════════════════════════════════════════════════════════════════

const FACTOR_ORDER = ["dedication", "achievement", "leadership", "prestige", "narrative_fit"];

const COLORS = {
  dedication: "#90cdf4",
  achievement: "#fbd38d",
  leadership: "#f6ad55",
  prestige: "#fc8181",
  narrative_fit: "#9ae6b4",
};

export default function FactorVector5({ vector, friendlyLegendI18n, locale = "en-US" }) {
  if (!vector || typeof vector !== "object") return null;
  const labels = friendlyLegendI18n?.factors || {};

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 11, color: "#8a8a9a", marginBottom: 2 }}>
        {t(locale, "factor.legend")}
      </div>
      {FACTOR_ORDER.map((k) => {
        const score = Number(vector[k] ?? 0);
        const pct = Math.max(0, Math.min(1, score)) * 100;
        const label = labels[k]?.short || k;
        return (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 100, fontSize: 11, color: "#cbd5e0", flexShrink: 0 }}>{label}</div>
            <div style={{ flex: 1, height: 6, borderRadius: 3, background: "rgba(255,255,255,0.04)", position: "relative", overflow: "hidden" }}>
              <div style={{
                width: `${pct}%`,
                height: "100%",
                background: COLORS[k] || "#667eea",
                borderRadius: 3,
                transition: "width 200ms",
              }} />
            </div>
            <div style={{ width: 36, fontSize: 11, color: "#8a8a9a", textAlign: "right" }}>
              {score.toFixed(2)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

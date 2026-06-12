import { useEffect, useState } from "react";

// ═══════════════════════════════════════════════════════════════════════
// MethodologyPanel — public, read-only transparency page. Fetches the live
// /api/methodology surface so the in-app explanation always matches the
// running system (weights, thresholds, data freshness, model migration).
// ═══════════════════════════════════════════════════════════════════════

const C = {
  bg: "#0a0e17", card: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.10)",
  text: "#e2e8f0", sub: "#94a3b8", muted: "#64748b",
  green: "#68d391", orange: "#f6ad55", red: "#f56565", blue: "#63b3ed", purple: "#a78bfa",
};
const box = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 18, marginBottom: 16 };
const h2 = { fontSize: 16, fontWeight: 700, marginBottom: 10, color: C.text };

function pct(n) { return `${Math.round((n || 0) * 100)}%`; }

export default function MethodologyPanel() {
  const [m, setM] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/methodology")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setM)
      .catch((e) => setErr(e.message));
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, padding: "32px 16px" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <h1 style={{ fontSize: 24, marginBottom: 4 }}>How scoring works</h1>
        <p style={{ color: C.sub, fontSize: 14, marginBottom: 20 }}>
          Full transparency on the weights, thresholds, data sources, and model policy behind every recommendation.
        </p>

        {err && <div style={{ ...box, borderColor: C.red, color: C.red }}>⚠ Couldn’t load methodology: {err}</div>}
        {!m && !err && <div style={{ ...box, color: C.muted }}>Loading…</div>}

        {m && (
          <>
            <div style={{ ...box, borderColor: "rgba(104,211,145,0.3)" }}>
              <div style={{ color: C.sub, fontSize: 13, lineHeight: 1.6 }}>{m.summary}</div>
            </div>

            {/* EC weights */}
            <div style={box}>
              <div style={h2}>Extracurricular factors &amp; weights</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ color: C.muted, textAlign: "left" }}>
                    <th style={{ padding: "4px 6px" }}>Factor</th>
                    <th style={{ padding: "4px 6px", width: 70 }}>Weight</th>
                    <th style={{ padding: "4px 6px" }}>What it measures</th>
                  </tr>
                </thead>
                <tbody>
                  {m.ecScoring.factors.map((f) => (
                    <tr key={f.factor} style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ padding: "6px", fontWeight: 600 }}>{f.label}</td>
                      <td style={{ padding: "6px", color: C.purple, fontWeight: 700 }}>{pct(f.weight)}</td>
                      <td style={{ padding: "6px", color: C.sub }}>{f.what}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ color: C.muted, fontSize: 12, marginTop: 10 }}>
                Weights sum to {m.ecScoring.weightsSumTo}. Composite = {m.ecScoring.composite.formula}.
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                {m.ecScoring.composite.thresholds.map((t) => (
                  <span key={t.label} style={{ fontSize: 12, color: C.sub, border: `1px solid ${C.border}`, borderRadius: 999, padding: "3px 9px" }}>
                    ≥ {t.atLeast.toFixed(2)} → {t.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Narrative / human oversight */}
            <div style={box}>
              <div style={h2}>Narrative, essays &amp; human oversight</div>
              <div style={{ color: C.sub, fontSize: 13, lineHeight: 1.6 }}>{m.narrativeQuality.explanation}</div>
              <div style={{ color: C.green, fontSize: 12, marginTop: 8 }}>✓ No ghostwriting — drafts stay in your own voice.</div>
              <div style={{ color: C.orange, fontSize: 12, marginTop: 8, lineHeight: 1.6 }}>{m.narrativeQuality.humanOversight}</div>
            </div>

            {/* Data sources */}
            <div style={box}>
              <div style={h2}>Data sources &amp; freshness</div>
              {Object.entries(m.dataSources).filter(([, v]) => v && typeof v === "object").map(([k, v]) => (
                <div key={k} style={{ fontSize: 13, color: C.sub, lineHeight: 1.7 }}>
                  <strong style={{ color: C.text }}>{k}</strong>: {v.source}{v.freshness ? ` — ${v.freshness}` : ""}{v.refresh ? ` — ${v.refresh}` : ""}{v.year ? ` (${v.year})` : ""}{v.latestCycleIngested ? ` — latest cycle: ${v.latestCycleIngested}` : ""}
                </div>
              ))}
              <div style={{ color: C.orange, fontSize: 12, marginTop: 10, lineHeight: 1.6 }}>{m.dataSources.internationalCaveat}</div>
            </div>

            {/* Model transparency */}
            <div style={box}>
              <div style={h2}>Model transparency &amp; migration</div>
              <div style={{ color: C.sub, fontSize: 13, lineHeight: 1.6, marginBottom: 8 }}>{m.modelTransparency.whyItMatters}</div>
              <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.7 }}>
                <strong style={{ color: C.text }}>Anthropic</strong>: {m.modelTransparency.anthropic.policy}
                {m.modelTransparency.anthropic.currentTargets && (
                  <div style={{ color: C.muted, fontSize: 12 }}>
                    Current: {Object.entries(m.modelTransparency.anthropic.currentTargets).map(([k, v]) => `${k}=${v}`).join(", ")}
                    {m.modelTransparency.anthropic.lastRefresh ? ` · refreshed ${new Date(m.modelTransparency.anthropic.lastRefresh).toLocaleString()}` : ""}
                  </div>
                )}
              </div>
              <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.7, marginTop: 8 }}>
                <strong style={{ color: C.text }}>OpenRouter &amp; other BYOK providers</strong>: {m.modelTransparency.otherProviders.policy}
                {m.modelTransparency.otherProviders.status?.openrouter && (
                  <div style={{ color: C.muted, fontSize: 12 }}>
                    OpenRouter: {m.modelTransparency.otherProviders.status.openrouter.reachable ? `${m.modelTransparency.otherProviders.status.openrouter.availableCount} models available` : "unreachable"}
                    {Array.isArray(m.modelTransparency.otherProviders.status.openrouter.proposals) && m.modelTransparency.otherProviders.status.openrouter.proposals.length > 0
                      ? ` · ${m.modelTransparency.otherProviders.status.openrouter.proposals.length} update(s) awaiting your approval`
                      : " · no pending changes"}
                  </div>
                )}
              </div>
            </div>

            {/* Your controls */}
            <div style={box}>
              <div style={h2}>Your controls</div>
              {Object.values(m.yourControls).map((v, i) => (
                <div key={i} style={{ fontSize: 13, color: C.sub, lineHeight: 1.7 }}>• {v}</div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

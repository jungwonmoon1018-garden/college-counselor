import { useEffect, useState } from "react";

// ═══════════════════════════════════════════════════════════════════════
// SetupPanel — operator-only, first-run deployment setup.
//
// Backed by the loopback + token-guarded endpoints in server.js:
//   GET  /api/setup/status        → what still needs configuring
//   POST /api/setup/initialize    → generate ENCRYPTION_KEY (server-side) and/or
//                                    save the College Scorecard (IPEDS) key
//
// SECURITY MODEL (surfaced to the operator, not just enforced server-side):
//   • The vault master key is GENERATED ON THE SERVER. The browser only
//     triggers it — the secret never travels to or through this page.
//   • The endpoint only answers on the server host (localhost) and requires
//     the one-time token printed to the server console at boot.
//   • Changes are written to .env; the backend must be restarted to apply.
// ═══════════════════════════════════════════════════════════════════════

const C = {
  bg: "#0a0e17", card: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.10)",
  text: "#e2e8f0", sub: "#94a3b8", muted: "#64748b",
  green: "#68d391", orange: "#f6ad55", red: "#f56565", blue: "#63b3ed", purple: "#a78bfa",
};

const box = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 18, marginBottom: 16 };
const label = { fontSize: 12, color: C.sub, display: "block", marginBottom: 6 };
const input = { width: "100%", padding: "9px 11px", borderRadius: 8, background: "rgba(0,0,0,0.3)", border: `1px solid ${C.border}`, color: C.text, fontSize: 14, fontFamily: "inherit" };
const btn = (bg) => ({ padding: "9px 16px", borderRadius: 8, border: "none", background: bg, color: "#0a0e17", fontWeight: 600, cursor: "pointer", fontSize: 14 });
const btnGhost = { padding: "9px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: "transparent", color: C.text, cursor: "pointer", fontSize: 14 };

// Props:
//   embedded   — rendered inside the registration flow (vs the standalone
//                /setup.html page). Adds a "Continue to API key" handoff.
//   onComplete — called when the operator finishes (or skips) this step;
//                the flow uses it to advance to the API-key scene.
export default function SetupPanel({ embedded = false, onComplete } = {}) {
  const [status, setStatus] = useState(null);
  const [statusErr, setStatusErr] = useState("");
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [scorecard, setScorecard] = useState("");
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  async function loadStatus() {
    setStatusErr("");
    try {
      const r = await fetch("/api/setup/status");
      if (!r.ok) { setStatusErr((await safeJson(r))?.error || `Status check failed (HTTP ${r.status})`); return; }
      setStatus(await r.json());
    } catch (e) { setStatusErr(e.message); }
  }
  useEffect(() => { loadStatus(); }, []);

  async function initialize(payload, busyKey) {
    setError(""); setResult(null); setBusy(busyKey);
    try {
      const r = await fetch("/api/setup/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Setup-Token": token.trim() },
        body: JSON.stringify(payload),
      });
      const body = await safeJson(r);
      if (!r.ok) { setError(body?.error || `Failed (HTTP ${r.status})`); return; }
      setResult(body);
      loadStatus();
    } catch (e) { setError(e.message); }
    finally { setBusy(""); }
  }

  const needsToken = !token.trim();
  const encConfigured = status?.encryptionKeyConfigured;
  const scoreConfigured = status?.scorecardConfigured;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, padding: "32px 16px" }}>
      <div style={{ maxWidth: 620, margin: "0 auto" }}>
        <h1 style={{ fontSize: 24, marginBottom: 4 }}>
          {embedded ? "One-time server setup" : "Operator Setup"}
        </h1>
        <p style={{ color: C.sub, fontSize: 14, marginBottom: 20 }}>
          {embedded
            ? "Your account is created. Before the AI features turn on, the backend needs its encryption key and (optionally) live college data. This runs once for the whole deployment — paste the one-time token from your server console below, then continue."
            : <>First-run deployment configuration. This page only works on the server host and
              requires the one-time token printed in the backend console at startup
              (<code>[SETUP] …</code>).</>}
        </p>

        {/* Status */}
        <div style={box}>
          <div style={{ ...label, marginBottom: 10 }}>Status</div>
          {statusErr && <Row color={C.red}>⚠ {statusErr}</Row>}
          {!status && !statusErr && <Row color={C.muted}>Checking…</Row>}
          {status && (
            <>
              <Row color={encConfigured ? C.green : C.orange}>
                {encConfigured ? "✓ Encryption key configured (via environment)" : "• Encryption key not yet set — generate below"}
              </Row>
              <Row color={scoreConfigured ? C.green : C.orange}>
                {scoreConfigured ? "✓ College Scorecard (IPEDS) key configured" : "• Scorecard (IPEDS) key not set — backend runs offline"}
              </Row>
              <Row color={C.muted}>Environment: {status.nodeEnv}</Row>
            </>
          )}
        </div>

        {/* Token */}
        <div style={box}>
          <label style={label}>One-time setup token (from the server console)</label>
          <input style={input} value={token} onChange={(e) => setToken(e.target.value)}
                 placeholder="paste the [SETUP] token" autoComplete="off" spellCheck={false} />
        </div>

        {/* Encryption key */}
        <div style={box}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>1 · Vault encryption key</div>
          <p style={{ color: C.sub, fontSize: 13, marginBottom: 12 }}>
            Generated <strong>on the server</strong> and written to <code>.env</code> — the key
            never appears in this browser. Only runs on first setup; it will not rotate an
            existing key (that would make stored data unrecoverable).
          </p>
          {encConfigured ? (
            <Row color={C.green}>Already configured via environment — nothing to do.</Row>
          ) : (
            <button style={btn(C.purple)} disabled={needsToken || busy === "enc"}
                    onClick={() => initialize({ generateEncryptionKey: true }, "enc")}>
              {busy === "enc" ? "Generating…" : "Generate encryption key & save to .env"}
            </button>
          )}
        </div>

        {/* Scorecard / IPEDS */}
        <div style={box}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>2 · College Scorecard (IPEDS) data key</div>
          <p style={{ color: C.sub, fontSize: 13, marginBottom: 12 }}>
            Free from api.data.gov. Sign up with your email to get a key, then paste it here.
          </p>
          <label style={label}>Your email (for the api.data.gov signup)</label>
          <input style={{ ...input, marginBottom: 10 }} value={email} onChange={(e) => setEmail(e.target.value)}
                 placeholder="you@example.com" type="email" autoComplete="email" />
          <a href={signupUrl(email)} target="_blank" rel="noopener noreferrer"
             style={{ ...btnGhost, display: "inline-block", textDecoration: "none", marginBottom: 14 }}>
            ↗ Get a free key (api.data.gov signup)
          </a>
          <label style={label}>Paste the key you received</label>
          <input style={{ ...input, marginBottom: 10 }} value={scorecard} onChange={(e) => setScorecard(e.target.value)}
                 placeholder="40-character api.data.gov key (or DEMO_KEY)" autoComplete="off" spellCheck={false} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={btn(C.blue)} disabled={needsToken || !scorecard.trim() || busy === "score"}
                    onClick={() => initialize({ scorecardApiKey: scorecard.trim() }, "score")}>
              {busy === "score" ? "Verifying…" : "Verify & save to .env"}
            </button>
            <button style={btnGhost} disabled={needsToken || busy === "demo"}
                    onClick={() => initialize({ scorecardApiKey: "DEMO_KEY" }, "demo")}>
              {busy === "demo" ? "Verifying…" : "Use DEMO_KEY (rate-limited)"}
            </button>
          </div>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 8 }}>
            The key is checked live against api.data.gov before saving — it won't store a dead key.
          </p>
        </div>

        {error && <div style={{ ...box, borderColor: C.red, color: C.red }}>⚠ {error}</div>}
        {result?.ok && (
          <div style={{ ...box, borderColor: C.green }}>
            <Row color={C.green}>✓ {result.message}</Row>
            <Row color={C.sub}>Wrote: {result.wrote.join(", ")}{result.backup ? ` · backup: ${result.backup}` : ""}</Row>
            {result.scorecardVerified && <Row color={C.green}>Scorecard key verified live against api.data.gov ✓</Row>}
            {result.promotedDevKey && <Row color={C.sub}>Promoted the existing dev key, so current local data stays readable.</Row>}
            <Row color={C.orange}>Restart the backend (<code>npm start</code>) to apply.</Row>
          </div>
        )}

        {embedded && (
          <div style={{ ...box, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <span style={{ color: C.muted, fontSize: 12 }}>
              {scoreConfigured && encConfigured
                ? "Both keys configured."
                : "You can finish this later from the Setup page — the app still works."}
            </span>
            <button style={btn(C.green)} onClick={() => onComplete && onComplete()}>
              Continue to API key →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ color, children }) {
  return <div style={{ color, fontSize: 13, lineHeight: 1.7 }}>{children}</div>;
}

function signupUrl(email) {
  // api.data.gov's signup form doesn't accept a prefilled email param reliably,
  // so we just open it; the operator signs up with the email shown above.
  return "https://api.data.gov/signup/";
}

async function safeJson(r) {
  try { return await r.json(); } catch { return null; }
}

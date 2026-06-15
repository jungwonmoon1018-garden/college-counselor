import { useState } from "react";
import "./PreSignupPage.css";

// ═══════════════════════════════════════════════════════════════════════
// LoginPage — standalone, branded sign-in page (served at /login.html).
// Shares the light pre-signup design system.
//
// Architecture note: the student app is LOCAL-FIRST — a passphrase decrypts
// data held in the browser, and the backend session token is re-derived by
// the SPA on each unlock. This page therefore verifies the account against
// the public backend session endpoint (POST /api/students/auth, email-based)
// and then routes the student into the app (/index.html), where the
// passphrase completes the local unlock. We never transmit the passphrase
// here — it only matters client-side, inside the app.
// ═══════════════════════════════════════════════════════════════════════

const GITHUB_URL = "https://github.com/jungwonmoon1018-garden/college-counselor";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    const value = email.trim().toLowerCase();
    if (!value) { setError("Email is required."); return; }
    if (!EMAIL_RE.test(value)) { setError("Please enter a valid email address."); return; }

    setBusy(true);
    try {
      const r = await fetch("/api/students/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value }),
      });
      if (r.ok) {
        // Recognized account — hand off to the app to unlock with the
        // passphrase. Prefill the email so the student doesn't retype it.
        try { localStorage.setItem("cc_prefill_email", value); } catch { /* ignore */ }
        window.location.href = "/index.html";
        return;
      }
      if (r.status === 404) {
        setError("No account found with that email. Create one in the app, or join the beta.");
      } else {
        const d = await r.json().catch(() => ({}));
        setError(d.error || "Could not sign you in. Please try again.");
      }
    } catch {
      setError("Could not reach the server. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ps-root">
      <div className="ps-login-wrap">
        <div className="ps-login-card">
          <div className="ps-login-brand">College Counselor AI</div>
          <h1 className="ps-login-title">Welcome back</h1>
          <p className="ps-login-sub">Sign in to continue planning your applications.</p>

          <form onSubmit={submit} noValidate>
            <div className="ps-field">
              <label className="ps-label" htmlFor="login-email">Email</label>
              <input
                id="login-email" className="ps-input" type="email" autoComplete="email"
                value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required
              />
              <div className="ps-login-hint">
                You'll unlock your encrypted data with your passphrase inside the app.
              </div>
            </div>

            <button type="submit" className="ps-btn ps-btn-primary" disabled={busy}>
              {busy ? "Signing in..." : "Continue"}
            </button>

            {error && <div className="ps-form-msg err" role="alert">{error}</div>}
          </form>

          <div className="ps-login-foot">
            <span>New here? <a className="ps-link" href="/pre-signup.html">Join the beta</a></span>
            <span>Need an account? <a className="ps-link" href="/index.html">Create one in the app</a></span>
            <span><a className="ps-link" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">View on GitHub</a></span>
          </div>
        </div>
      </div>
    </div>
  );
}

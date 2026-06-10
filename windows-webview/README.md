# College Counselor — Windows app (WebView2 wrapper)

The **full** Windows app: a thin WPF + **WebView2** shell that loads your real
React SPA (`../frontend`). Because it hosts the actual SPA, it has **everything
you built** — survey-first onboarding, passphrase/vault encryption, the full
chat UI, and every component (Spike Finder, Candidate Ranker, Course Sequencer,
Deadline Tracker, Narrative Editor, Calibrated Fit Card, …) — and stays in sync
with `frontend/` automatically. This is the Windows parallel to
[`../apple-webview`](../apple-webview).

## Build & run (on Windows)
Requires the **.NET 8 SDK** and the **Microsoft Edge WebView2 Runtime**
(Evergreen — preinstalled on current Windows 10/11).

```powershell
cd windows-webview/CollegeCounselorWeb
dotnet run            # or: dotnet build -c Release
```

## Point it at your frontend
Priority: `CC_FRONTEND_URL` env var → `%APPDATA%\CollegeCounselorWeb\frontend-url.txt`
→ the Vite dev-server default `http://localhost:5173`.

- **Dev:** `cd frontend && npm run dev` (Vite proxies `/api` to the backend on
  `:3001`), then launch this app.
- **Production:** `setx CC_FRONTEND_URL https://your-host` (or write the txt
  file), then launch.

The **backend** URL is configured inside the web app itself (its
`window.__CC_PROXY_URL__` convention) — this wrapper only chooses which frontend
to load.

## Behavior
- Same-host navigation stays in-app; off-host links (and pop-outs) open in the
  system browser.
- Cookies / localStorage persist (the SPA's session survives relaunch).
- If the WebView2 runtime is missing or the page fails to load, a clear message
  is shown instead of a blank window.

## Notes
- Verified locally: `dotnet build` succeeds and the app loads the live SPA
  (the React "Create your account" / survey onboarding renders in-window).
- App icon / MSIX packaging aren't set up — this is the runnable project.

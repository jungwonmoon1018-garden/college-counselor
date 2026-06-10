# College Counselor — Windows app (WPF / .NET 8)

Native **Windows desktop** client for the College Counselor backend, mirroring
the macOS/iOS SwiftUI app. Thin client — all intelligence stays server-side.

Built with WPF on **.NET 8** (`net8.0-windows`). The UI is constructed in C#
code (no XAML views) for simplicity; `HttpClient` + `System.Text.Json` for the
API, and **DPAPI** (`ProtectedData`, CurrentUser scope) for at-rest protection
of the session token + email — the Windows parallel to the Apple Keychain.

## What's implemented
- **Onboarding + consent** — register + the three consent grants
  (`data_processing`, `ai_interaction`, `cross_border_transfer`); consent copy
  never names a model.
- **BYOK key entry** — provider list from `GET /api/llm/providers`, tier
  defaults, write-only `PasswordBox` (`PUT /api/students/apikey`).
- **College Fit** — `POST /api/positioning/targets`: calibrated label, four
  sub-scores as bars (with an honest low–high range when supplied), confidence,
  and a provenance line that flags `cds_live` / `cds_web` as unverified.
- **Chat** — BYOK-routed via `POST /api/llm` (tier-based), trims to the last 30
  turns.
- **Settings** — backend URL, language (`en-US` / `ko`), live data-source
  status via `GET /api/health`, sign out.
- Bearer auth in DPAPI, one transparent re-auth on `401`, upstream error
  pass-through.

## Build & run (on Windows)
Requires the **.NET 8 SDK** (`winget install Microsoft.DotNet.SDK.8`, or grab
the installer from https://dotnet.microsoft.com/download).

```powershell
cd windows/CollegeCounselor
dotnet run                # or: dotnet build -c Release
```

By default it talks to `http://localhost:3001/api`. Change the backend URL in
**Settings** (e.g. a hosted HTTPS host). Config + token live under
`%APPDATA%\CollegeCounselor\`.

## Notes
- Authored on a machine without the .NET SDK, so it's **compiled in CI**
  (`windows-latest` + .NET 8) rather than locally — see the `Windows app build`
  job in `.github/workflows/ci.yml`.
- App icon / packaging (MSIX) aren't set up — this is the runnable app project.
- The operator first-run setup (vault key + Scorecard/IPEDS key) lives in the
  React `/setup.html` and the macOS app; it isn't duplicated here.

# College Counselor — Apple apps (macOS + iOS)

Native **SwiftUI** client for the College Counselor backend. One shared codebase
(`Sources/Shared`) builds **two native apps**: an iOS/iPadOS app and a macOS app.
The backend holds all intelligence (rules engine, evidence graph, CDS data, LLM
routing, compliance) — this app is presentation + input only, exactly as the
[session summary](../) prescribes for a native client.

## What's implemented

- **Onboarding + consent** — register (email + grade), grant the three required
  consents (`data_processing`, `ai_interaction`, `cross_border_transfer`).
  Consent copy never names an AI model (a deliberate compliance-UX rule).
- **BYOK key entry** — provider picker fed by `GET /api/llm/providers`, tier
  model defaults, write-only key field (`PUT /api/students/apikey`). The key is
  never logged, echoed, or read back.
- **College Fit** — `POST /api/positioning/targets` rendered honestly: a
  calibrated label, four independent sub-scores **as uncertainty bands** (not a
  single merged number), an evidence-confidence indicator, and a
  **provenance/source line** that flags `cds_live` / `cds_web` data as
  *unverified*. Plus school core values from `POST /api/colleges/values`.
- **Chat** — grounded chat via `POST /api/llm` (tier-based, routes through the
  student's BYOK key). The backend handles input screening, crisis detection,
  and PII redaction.
- **Settings** — editable backend URL, language (`en-US` / `ko`), update key,
  sign out, and a read-only **Data sources** status showing whether the
  backend's College Scorecard (IPEDS) API is *Live* or *Offline (baseline)*
  (via `GET /api/health`).
- **Cross-cutting** — Bearer auth in the Keychain, one transparent re-auth on
  `401`, pass-through of upstream provider error messages (`402`/`429`/`401`),
  TLS, and full `en-US` / `ko` localization.

## Build (on a Mac)

Requires Xcode 15+ and [XcodeGen](https://github.com/yonom/XcodeGen)
(`brew install xcodegen`).

```sh
cd apple
xcodegen generate          # creates CollegeCounselor.xcodeproj from project.yml
open CollegeCounselor.xcodeproj
```

Then in Xcode:

1. Select the **CollegeCounselor-iOS** or **CollegeCounselor-macOS** scheme.
2. Set your signing team (Signing & Capabilities), or use automatic signing.
3. Run (⌘R).

> No Mac handy? The project was authored on Windows — `project.yml` + the Swift
> sources are the source of truth; the `.xcodeproj` is generated, not committed.

## First run

1. Make sure the backend is running and reachable (see `../backend/DEPLOY.md`).
   Default dev URL is `http://localhost:3001/api`. Configure the backend's
   server-side secrets first with `cd ../backend && npm run setup` — this
   generates the PII-vault `ENCRYPTION_KEY` and accepts the College Scorecard
   (IPEDS) data API key. These are **deployment secrets**: they live on the
   server and are deliberately *not* entered through this app. (The only key
   the app collects is the student's own BYOK LLM key, stored encrypted
   server-side.)
2. On a **physical iOS device**, `localhost` is the phone, not your Mac — open
   **Settings → Backend URL** and point it at your Mac's LAN IP
   (e.g. `http://192.168.1.20:3001/api`) or a hosted HTTPS host.
3. Create an account, grant consent, connect your AI key, then use College Fit
   and Chat.

## Project layout

```
apple/
  project.yml                      XcodeGen spec — two targets, shared sources
  Platforms/iOS/Info.plist         iOS bundle + localhost ATS exception (dev)
  Platforms/macOS/Info.plist       macOS bundle + localhost ATS exception (dev)
  Platforms/macOS/*.entitlements   sandbox + network-client
  Sources/Shared/
    App/                           @main entry
    Config/                        backend URL + locale prefs
    Networking/                    APIClient (actor), Keychain
    Models/                        Codable contract models
    State/                         AppState (navigation + session)
    Views/                         Onboarding, BYOK, Fit/, Chat, Settings
    Theme.swift                    shared palette + band/confidence colors
  Resources/Shared/
    en.lproj / ko.lproj            Localizable.strings
    Assets.xcassets                AppIcon + AccentColor
```

## Notes / known limitations

- **App icon** is a placeholder (empty `AppIcon` set) — drop in a 1024² PNG
  before shipping.
- The **language picker** changes the API locale immediately; the on-screen UI
  strings follow the device language until the next launch (standard iOS bundle
  behavior). Wire `AppleLanguages` override if you want instant UI switching.
- Auth follows the **actual** server contract (email-based
  `POST /api/students/auth` returns the session token). The session summary's
  "unlock with passphrase" describes the web client's local-encryption step,
  which isn't required by the backend.
- Chat uses the BYOK `/api/llm` path (tier-based), so the client never names a
  model.
- **Operator setup (macOS):** Settings → Operator → "Operator Setup" can
  generate the backend's vault `ENCRYPTION_KEY` (server-side) and save the
  Scorecard/IPEDS key, via the loopback + console-token-guarded `/api/setup/*`
  endpoints. Only works when the app runs on the backend host.

# College Counselor — WebView wrapper (macOS + iOS)

The **fast v1**: a thin native `WKWebView` shell around the existing React SPA
(`../frontend`). One Swift codebase, two Apple targets (iOS + macOS). No
JavaScript build coupling — the app just loads a configurable frontend URL, and
all the existing web client behavior (auth, consent, BYOK, College Fit, chat)
comes along for free.

Use this for a quick ship; use the native app in [`../apple`](../apple) when you
want platform-native UX.

## Build (on a Mac)

```sh
cd apple-webview
brew install xcodegen        # if not already installed
xcodegen generate
open CollegeCounselorWeb.xcodeproj   # pick the -iOS or -macOS scheme, set signing, ⌘R
```

## Configure the frontend URL

Priority: in-app override (gear button) → `CCFrontendURL` in `Info.plist` →
`http://localhost:5173`.

- **Dev**: run the SPA with `cd frontend && npm run dev` (Vite, default
  `http://localhost:5173`, which proxies `/api` to the backend on `:3001`).
- **iOS device**: `localhost` is the phone — tap the gear, set your Mac's LAN IP
  (`http://192.168.1.20:5173`) or a hosted HTTPS URL.
- **Production**: set `CCFrontendURL` to your deployed SPA (HTTPS), and drop the
  localhost ATS exception from `Info.plist`.

> The **backend** URL is configured *inside* the web app (its
> `window.__CC_PROXY_URL__` convention), not here — this wrapper only chooses
> which frontend to load.

## Layout

```
apple-webview/
  project.yml                  XcodeGen spec — iOS + macOS targets
  Platforms/iOS/Info.plist     CCFrontendURL + localhost ATS (dev)
  Platforms/macOS/Info.plist   CCFrontendURL + localhost ATS (dev)
  Platforms/macOS/App.entitlements  sandbox + network-client
  Sources/Shared/
    App.swift                  @main
    WebView.swift              cross-platform WKWebView (NS/UI representable)
    ContentView.swift          webview + loading/error states + URL editor
```

## Notes

- Cookies/localStorage persist (`WKWebsiteDataStore.default()`), so the web
  app's session token survives relaunches.
- App icon is not set — add an `Assets.xcassets`/`AppIcon` before shipping.
- This wrapper and the native app share the same display name but **different**
  bundle IDs (`ai.collegecounselor.web.app` vs `ai.collegecounselor.app`), so
  both can be installed side by side.

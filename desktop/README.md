# College Counselor Desktop

This is the production desktop host. It launches the bundled backend on an ephemeral `127.0.0.1` port, serves the built React app from a second loopback-only port, and proxies `/api` without exposing provider secrets to the renderer.

## Development

1. Install dependencies in `backend`, `frontend`, and `desktop`.
2. Build the frontend with `npm --prefix frontend run build` from the repository root.
3. Run `npm --prefix desktop start`.

Set `CC_NODE_BINARY` only when development requires a specific Node 22 executable. Packaged builds run the backend through Electron's bundled Node runtime after `electron-rebuild` rebuilds native backend modules.

## Packaging

- Windows: `npm --prefix desktop run dist:win`
- macOS: `npm --prefix desktop run dist:mac`

The Windows target is NSIS and the macOS target is DMG. Signing and notarization credentials must be supplied through CI before public release.

Administrator secrets are encrypted with Electron `safeStorage` (DPAPI on Windows and Keychain on macOS). The encryption key is generated once. OpenRouter and College Scorecard keys can be replaced or cleared from `admin.html`; secret values never return to the renderer after submission.

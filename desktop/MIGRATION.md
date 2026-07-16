# Native wrapper migration

The former WPF WebView2 and Swift WKWebView wrappers were development shells that depended on separately running localhost services. They have been removed.

`desktop/` is now the only supported native host for Windows and macOS. It owns backend startup, local port selection, static asset serving, OS credential-store access, navigation policy, and installer generation. iOS is not a supported target.

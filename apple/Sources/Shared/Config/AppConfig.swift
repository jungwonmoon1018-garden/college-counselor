import Foundation

/// User-tunable runtime configuration. The backend host is editable in
/// Settings because a hosted deployment, a LAN dev box, and `localhost` all
/// differ per environment (and iOS devices can't reach the Mac's localhost).
enum ConfigKeys {
    static let apiBase = "cc.apiBase"
    static let locale = "cc.locale"
    static let grade = "cc.grade"
    static let consentGranted = "cc.consentGranted"
    // Note: email is PII and lives in the Keychain (see APIClient/AppState),
    // not UserDefaults.
}

struct AppConfig {
    /// Default dev base. Override in Settings → "Backend URL".
    /// Production: set this to `https://your-host/api`.
    static let defaultAPIBase = "http://localhost:3001/api"

    static var apiBase: String {
        get {
            let raw = UserDefaults.standard.string(forKey: ConfigKeys.apiBase) ?? defaultAPIBase
            return normalize(raw)
        }
        set { UserDefaults.standard.set(normalize(newValue), forKey: ConfigKeys.apiBase) }
    }

    /// Supported locales end-to-end: en-US and ko.
    static var locale: String {
        get {
            if let stored = UserDefaults.standard.string(forKey: ConfigKeys.locale) { return stored }
            let pref = Locale.preferredLanguages.first?.lowercased() ?? "en"
            return pref.hasPrefix("ko") ? "ko" : "en-US"
        }
        set { UserDefaults.standard.set(newValue, forKey: ConfigKeys.locale) }
    }

    /// Strip a trailing slash and an accidental `/anthropic` suffix so callers
    /// can paste either `.../api` or `.../api/anthropic`.
    static func normalize(_ raw: String) -> String {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasSuffix("/anthropic") { s = String(s.dropLast("/anthropic".count)) }
        while s.hasSuffix("/") { s = String(s.dropLast()) }
        return s
    }
}

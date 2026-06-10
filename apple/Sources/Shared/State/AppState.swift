import SwiftUI

/// Drives top-level navigation and owns the calls that mutate session state.
/// Everything user-facing observes this; the network details live in APIClient.
@MainActor
final class AppState: ObservableObject {

    enum Stage { case launching, onboarding, byok, main }

    @Published var stage: Stage = .launching
    @Published var email: String = Keychain.get(account: "email") ?? ""
    @Published var grade: String = UserDefaults.standard.string(forKey: ConfigKeys.grade) ?? ""
    @Published var hasAPIKey: Bool = false
    @Published var banner: String? = nil    // transient error/info shown at top

    private let api = APIClient.shared

    /// Decide the entry screen. A stored token + recorded consent skips
    /// straight to BYOK-or-main; a verified personal key skips to main.
    func bootstrap() async {
        let consented = UserDefaults.standard.bool(forKey: ConfigKeys.consentGranted)
        let signedIn = await api.hasToken && !email.isEmpty
        guard signedIn, consented else {
            stage = .onboarding
            return
        }
        // Verify the BYOK key status. Distinguish "no key on file" (→ BYOK
        // screen) from "couldn't reach the backend" (→ don't force re-entry of
        // a key that's almost certainly already there; the next API call will
        // surface any real auth/key problem).
        do {
            let status = try await api.apiKeyStatus()
            hasAPIKey = (status.hasPersonalKey == true)
            stage = hasAPIKey ? .main : .byok
        } catch {
            hasAPIKey = true
            stage = .main
        }
    }

    // ─── Onboarding: register + grant the three consents ─────────────────
    func completeOnboarding() async {
        banner = nil
        let cleanEmail = email.lowercased().trimmingCharacters(in: .whitespaces)
        guard cleanEmail.contains("@") else { banner = "Enter a valid email."; return }
        do {
            _ = try await api.register(email: cleanEmail, grade: grade.isEmpty ? nil : grade)
            UserDefaults.standard.set(grade, forKey: ConfigKeys.grade)
            // Grant all three — cross_border_transfer is required before any AI
            // call. Don't swallow failures: if a grant didn't land, advancing
            // would leave the app thinking it's consented while every AI call
            // 403s. Surface it and stay put so the user can retry.
            var failed: [ConsentType] = []
            for type in ConsentType.allCases {
                do { try await api.grantConsent(type) } catch { failed.append(type) }
            }
            guard failed.isEmpty else {
                banner = "Couldn't record consent. Check your connection and try again."
                return
            }
            UserDefaults.standard.set(true, forKey: ConfigKeys.consentGranted)
            stage = .byok
        } catch {
            banner = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func didSaveAPIKey() {
        hasAPIKey = true
        stage = .main
    }

    func signOut() async {
        await api.clearSession()
        UserDefaults.standard.set(false, forKey: ConfigKeys.consentGranted)
        hasAPIKey = false
        stage = .onboarding
    }
}

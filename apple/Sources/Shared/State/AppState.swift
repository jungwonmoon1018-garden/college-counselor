import SwiftUI

/// Drives top-level navigation and owns the calls that mutate session state.
/// Everything user-facing observes this; the network details live in APIClient.
@MainActor
final class AppState: ObservableObject {

    enum Stage { case launching, onboarding, byok, main }

    @Published var stage: Stage = .launching
    @Published var email: String = UserDefaults.standard.string(forKey: ConfigKeys.email) ?? ""
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
        // Verify the BYOK key status (best-effort; offline ⇒ assume present).
        if let status = try? await api.apiKeyStatus(), status.hasPersonalKey == true {
            hasAPIKey = true
            stage = .main
        } else {
            stage = .byok
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
            // Grant all three — cross_border_transfer is required for AI calls.
            for type in ConsentType.allCases {
                try? await api.grantConsent(type)
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

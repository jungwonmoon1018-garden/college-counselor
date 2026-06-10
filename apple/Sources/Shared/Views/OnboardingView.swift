import SwiftUI

/// Register + consent in one screen. Compliance rule: the consent copy must
/// NOT name any LLM/model — it describes "an AI system" generically.
struct OnboardingView: View {
    @EnvironmentObject var state: AppState

    @State private var consentAI = false
    @State private var consentData = false
    @State private var consentCrossBorder = false
    @State private var ageAttest = false
    @State private var working = false

    private var canContinue: Bool {
        state.email.contains("@") && consentAI && consentData && consentCrossBorder && ageAttest && !working
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header

                VStack(alignment: .leading, spacing: 12) {
                    field(LocalizedStringKey("onboarding.email"), text: $state.email)
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                        #endif
                        .disableAutocorrection(true)
                    field(LocalizedStringKey("onboarding.grade"), text: $state.grade)
                }
                .ccCard()

                VStack(alignment: .leading, spacing: 12) {
                    Text("onboarding.consent_title")
                        .font(.headline).foregroundStyle(Theme.textPrimary)
                    consentRow("consent.ai", $consentAI)
                    consentRow("consent.data", $consentData)
                    consentRow("consent.cross_border", $consentCrossBorder)
                    consentRow("consent.age", $ageAttest)
                }
                .ccCard()

                if let banner = state.banner {
                    Text(banner).font(.footnote).foregroundStyle(Theme.red)
                }

                Button(action: { Task { working = true; await state.completeOnboarding(); working = false } }) {
                    HStack {
                        if working { ProgressView().controlSize(.small) }
                        Text("onboarding.continue")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(!canContinue)

                Text("onboarding.disclaimer")
                    .font(.caption2).foregroundStyle(Theme.textMuted)
            }
            .padding(20)
            .frame(maxWidth: 520)
            .frame(maxWidth: .infinity)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("app.name").font(.largeTitle.bold()).foregroundStyle(Theme.textPrimary)
            Text("onboarding.subtitle").font(.subheadline).foregroundStyle(Theme.textSecondary)
        }
    }

    private func field(_ label: LocalizedStringKey, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption).foregroundStyle(Theme.textSecondary)
            TextField("", text: text)
                .textFieldStyle(.roundedBorder)
                .foregroundStyle(Theme.textPrimary)
        }
    }

    private func consentRow(_ key: LocalizedStringKey, _ bound: Binding<Bool>) -> some View {
        Toggle(isOn: bound) {
            Text(key).font(.footnote).foregroundStyle(Theme.textSecondary)
        }
        .toggleStyle(.switch)
    }
}

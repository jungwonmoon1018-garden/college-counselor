import SwiftUI

/// BYOK key entry. The key is write-only: it's never logged, echoed, or read
/// back from the server (the status endpoint returns presence only). The
/// consent/disclosure copy never names a model — provider names are fine here
/// because the student is explicitly choosing their own provider.
struct APIKeyView: View {
    var onSaved: () -> Void
    var isModal = false      // true when reached from Settings (shows a Cancel)

    @Environment(\.dismiss) private var dismiss
    @State private var providers: [Provider] = []
    @State private var selected: Provider?
    @State private var apiKey = ""
    @State private var baseUrl = ""
    @State private var small = ""
    @State private var medium = ""
    @State private var large = ""
    @State private var error: String?
    @State private var saving = false
    @State private var loading = true

    private var needsBaseUrl: Bool {
        let id = selected?.id ?? ""
        return id == "ollama" || id == "lmstudio" || id == "openai_compat" || (selected?.requiresBaseUrl ?? false)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("byok.title").font(.title2.bold()).foregroundStyle(Theme.textPrimary)
                    Text("byok.subtitle").font(.subheadline).foregroundStyle(Theme.textSecondary)
                }

                if loading {
                    ProgressView().frame(maxWidth: .infinity)
                } else {
                    providerPicker
                    keyFields
                }

                if let error {
                    Text(error).font(.footnote).foregroundStyle(Theme.red)
                }

                HStack {
                    if isModal {
                        Button("common.cancel") { dismiss() }.buttonStyle(.bordered)
                    }
                    Button(action: save) {
                        HStack {
                            if saving { ProgressView().controlSize(.small) }
                            Text("byok.save")
                        }.frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(saving || selected == nil || (apiKey.count < 12 && !needsBaseUrl))
                }

                Text("byok.privacy").font(.caption2).foregroundStyle(Theme.textMuted)
            }
            .padding(20)
            .frame(maxWidth: 520)
            .frame(maxWidth: .infinity)
        }
        .task { await load() }
    }

    private var providerPicker: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("byok.provider").font(.caption).foregroundStyle(Theme.textSecondary)
            Picker("byok.provider", selection: Binding(
                get: { selected?.id ?? providers.first?.id ?? "" },
                set: { id in applyProvider(providers.first { $0.id == id }) }
            )) {
                ForEach(providers) { p in Text(p.displayName).tag(p.id) }
            }
            .pickerStyle(.menu)
            .labelsHidden()
        }
        .ccCard()
    }

    private var keyFields: some View {
        VStack(alignment: .leading, spacing: 12) {
            labeled("byok.apikey") {
                SecureField("byok.apikey.placeholder", text: $apiKey)
                    .textFieldStyle(.roundedBorder)
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    #endif
                    .disableAutocorrection(true)
            }
            if needsBaseUrl {
                labeled("byok.baseurl") {
                    TextField("byok.baseurl.placeholder", text: $baseUrl)
                        .textFieldStyle(.roundedBorder)
                        .disableAutocorrection(true)
                }
            }
            DisclosureGroup("byok.models") {
                labeled("byok.tier.small") { tierField($small) }
                labeled("byok.tier.medium") { tierField($medium) }
                labeled("byok.tier.large") { tierField($large) }
            }
            .font(.footnote)
            .tint(Theme.textSecondary)
        }
        .ccCard()
    }

    private func tierField(_ b: Binding<String>) -> some View {
        TextField("", text: b)
            .textFieldStyle(.roundedBorder)
            .disableAutocorrection(true)
            .font(.system(.footnote, design: .monospaced))
    }

    private func labeled<C: View>(_ key: LocalizedStringKey, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(key).font(.caption).foregroundStyle(Theme.textSecondary)
            content()
        }
    }

    // ─── Data ────────────────────────────────────────────────────────────
    private func load() async {
        loading = true
        defer { loading = false }
        do {
            let catalog = try await APIClient.shared.providers()
            providers = catalog.providers
            applyProvider(providers.first { $0.id == "openrouter" } ?? providers.first)
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func applyProvider(_ p: Provider?) {
        selected = p
        small = p?.defaults?.small ?? ""
        medium = p?.defaults?.medium ?? ""
        large = p?.defaults?.large ?? ""
    }

    private func save() {
        guard let provider = selected else { return }
        error = nil
        saving = true
        Task {
            defer { saving = false }
            do {
                try await APIClient.shared.saveAPIKey(
                    provider: provider.id,
                    baseUrl: baseUrl.isEmpty ? nil : baseUrl,
                    models: TierModels(small: small, medium: medium, large: large),
                    apiKey: apiKey)
                apiKey = ""   // never keep the secret in memory after save
                if isModal { dismiss() } else { onSaved() }
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }
}

import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var state: AppState
    @State private var apiBase = AppConfig.apiBase
    @State private var locale = AppConfig.locale
    @State private var showAPIKeySheet = false
    @State private var saved = false
    @State private var health: HealthStatus?
    @State private var healthLoading = false
    @State private var healthError = false

    var body: some View {
        NavigationStack {
            Form {
                Section("settings.backend") {
                    TextField("settings.backend_url", text: $apiBase)
                        .disableAutocorrection(true)
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        #endif
                    Button("settings.save_backend") {
                        AppConfig.apiBase = apiBase
                        apiBase = AppConfig.apiBase
                        saved = true
                    }
                    if saved {
                        Text("settings.saved").font(.caption).foregroundStyle(Theme.green)
                    }
                }

                Section("settings.data_sources") {
                    HStack {
                        Text("settings.college_data")
                        Spacer()
                        dataStatusView
                    }
                    Button("settings.refresh_status") { Task { await loadHealth() } }
                        .disabled(healthLoading)
                    Text("settings.data_note")
                        .font(.caption).foregroundStyle(Theme.textMuted)
                }

                Section("settings.language") {
                    Picker("settings.language", selection: $locale) {
                        Text("English").tag("en-US")
                        Text("한국어").tag("ko")
                    }
                    .onChange(of: locale) { AppConfig.locale = $0 }
                }

                Section("settings.account") {
                    LabeledContent("settings.email", value: state.email)
                    Button("byok.update_key") { showAPIKeySheet = true }
                    Button("settings.sign_out", role: .destructive) {
                        Task { await state.signOut() }
                    }
                }

                Section {
                    Text("settings.privacy_note")
                        .font(.caption).foregroundStyle(Theme.textMuted)
                }
            }
            .navigationTitle("tab.settings")
            .task { await loadHealth() }
            .sheet(isPresented: $showAPIKeySheet) {
                APIKeyView(onSaved: {}, isModal: true)
                    .preferredColorScheme(.dark)
            }
        }
    }

    @ViewBuilder
    private var dataStatusView: some View {
        if healthLoading {
            ProgressView().controlSize(.small)
        } else if healthError {
            Label("settings.unreachable", systemImage: "exclamationmark.triangle.fill")
                .labelStyle(.titleAndIcon).font(.caption).foregroundStyle(Theme.red)
        } else if health?.scorecard == true {
            Label("settings.live", systemImage: "checkmark.circle.fill")
                .labelStyle(.titleAndIcon).font(.caption).foregroundStyle(Theme.green)
        } else {
            Label("settings.offline", systemImage: "circle.dashed")
                .labelStyle(.titleAndIcon).font(.caption).foregroundStyle(Theme.orange)
        }
    }

    private func loadHealth() async {
        healthLoading = true
        healthError = false
        defer { healthLoading = false }
        do { health = try await APIClient.shared.health() }
        catch { healthError = true }
    }
}

import SwiftUI

/// Operator-only, first-run deployment setup — the native counterpart to the
/// web `/setup.html`. Triggers server-side generation of the PII-vault
/// encryption key and saves the College Scorecard (IPEDS) data key, both via
/// the loopback + token-guarded `/api/setup/*` endpoints.
///
/// The vault key is generated ON THE SERVER; this screen only triggers it, so
/// the master secret never enters the app. It's only useful when this app runs
/// on the same host as the backend (the endpoint rejects non-loopback callers),
/// which is why it's surfaced on macOS.
struct SetupView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var status: SetupStatus?
    @State private var statusError: String?
    @State private var token = ""
    @State private var email = ""
    @State private var scorecard = ""
    @State private var busy: String?
    @State private var result: SetupResult?
    @State private var error: String?

    private var needsToken: Bool { token.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                statusCard
                tokenCard
                encryptionCard
                scorecardCard
                if let error {
                    Text(error).font(.footnote).foregroundStyle(Theme.red).ccCard()
                }
                if let result, result.ok == true {
                    resultCard(result)
                }
            }
            .padding(20)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.bg)
        .task { await loadStatus() }
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("common.close") { dismiss() } } }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("setup.title").font(.title2.bold()).foregroundStyle(Theme.textPrimary)
            Text("setup.subtitle").font(.footnote).foregroundStyle(Theme.textSecondary)
        }
    }

    private var statusCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("setup.status").font(.caption.weight(.semibold)).foregroundStyle(Theme.textMuted)
            if let statusError {
                Text("⚠ \(statusError)").font(.caption).foregroundStyle(Theme.red)
            } else if let status {
                row(status.encryptionKeyConfigured == true ? Theme.green : Theme.orange,
                    status.encryptionKeyConfigured == true ? "setup.enc_done" : "setup.enc_todo")
                row(status.scorecardConfigured == true ? Theme.green : Theme.orange,
                    status.scorecardConfigured == true ? "setup.score_done" : "setup.score_todo")
            } else {
                ProgressView().controlSize(.small)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .ccCard()
    }

    private var tokenCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("setup.token_label").font(.caption).foregroundStyle(Theme.textSecondary)
            SecureField("setup.token_ph", text: $token)
                .textFieldStyle(.roundedBorder)
                .disableAutocorrection(true)
        }
        .ccCard()
    }

    private var encryptionCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("setup.enc_title").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.textPrimary)
            Text("setup.enc_note").font(.caption).foregroundStyle(Theme.textSecondary)
            if status?.encryptionKeyConfigured == true {
                Text("setup.enc_done").font(.caption).foregroundStyle(Theme.green)
            } else {
                Button(action: { run("enc") { try await APIClient.shared.setupInitialize(token: token, generateEncryptionKey: true, scorecardApiKey: nil) } }) {
                    HStack { if busy == "enc" { ProgressView().controlSize(.small) }; Text("setup.enc_btn") }
                }
                .buttonStyle(.borderedProminent)
                .disabled(needsToken || busy != nil)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .ccCard()
    }

    private var scorecardCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("setup.score_title").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.textPrimary)
            Text("setup.score_note").font(.caption).foregroundStyle(Theme.textSecondary)
            TextField("setup.email_ph", text: $email).textFieldStyle(.roundedBorder).disableAutocorrection(true)
            Link("setup.score_signup", destination: URL(string: "https://api.data.gov/signup/")!)
                .font(.caption)
            TextField("setup.score_key_ph", text: $scorecard)
                .textFieldStyle(.roundedBorder).disableAutocorrection(true)
                .font(.system(.footnote, design: .monospaced))
            Button(action: { run("score") { try await APIClient.shared.setupInitialize(token: token, generateEncryptionKey: false, scorecardApiKey: scorecard.trimmingCharacters(in: .whitespaces)) } }) {
                HStack { if busy == "score" { ProgressView().controlSize(.small) }; Text("setup.score_btn") }
            }
            .buttonStyle(.borderedProminent)
            .disabled(needsToken || scorecard.trimmingCharacters(in: .whitespaces).isEmpty || busy != nil)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .ccCard()
    }

    private func resultCard(_ r: SetupResult) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("✓ \(r.message ?? "")").font(.caption).foregroundStyle(Theme.green)
            if let wrote = r.wrote, !wrote.isEmpty {
                Text("Wrote: \(wrote.joined(separator: ", "))").font(.caption2).foregroundStyle(Theme.textSecondary)
            }
            if r.promotedDevKey == true {
                Text("setup.promoted").font(.caption2).foregroundStyle(Theme.textSecondary)
            }
            Text("setup.restart").font(.caption2).foregroundStyle(Theme.orange)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .ccCard()
    }

    private func row(_ color: Color, _ key: LocalizedStringKey) -> some View {
        Text(key).font(.caption).foregroundStyle(color)
    }

    private func loadStatus() async {
        statusError = nil
        do { status = try await APIClient.shared.setupStatus() }
        catch { statusError = (error as? APIError)?.errorDescription ?? error.localizedDescription }
    }

    private func run(_ key: String, _ op: @escaping () async throws -> SetupResult) {
        error = nil; result = nil; busy = key
        Task {
            defer { busy = nil }
            do { result = try await op(); await loadStatus() }
            catch { self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription }
        }
    }
}

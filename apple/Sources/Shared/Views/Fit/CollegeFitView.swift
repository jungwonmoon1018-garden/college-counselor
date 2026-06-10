import SwiftUI

/// Look up a school + (optional) major and render the calibrated fit card.
struct CollegeFitView: View {
    @State private var school = ""
    @State private var major = ""
    @State private var result: Positioning?
    @State private var values: CollegeValues?
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    searchCard

                    if loading {
                        ProgressView().frame(maxWidth: .infinity).padding(.top, 24)
                    } else if let result {
                        FitCard(positioning: result, collegeValues: values)
                        if let values { coreValues(values) }
                    } else if let error {
                        Text(error).font(.footnote).foregroundStyle(Theme.red)
                    } else {
                        Text("fit.empty").font(.callout).foregroundStyle(Theme.textMuted)
                            .frame(maxWidth: .infinity).padding(.top, 24)
                    }
                }
                .padding(16)
                .frame(maxWidth: 600)
                .frame(maxWidth: .infinity)
            }
            .background(Theme.bg)
            .navigationTitle("tab.fit")
        }
    }

    private var searchCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            TextField("fit.school_placeholder", text: $school)
                .textFieldStyle(.roundedBorder)
                .disableAutocorrection(true)
                .onSubmit(run)
            TextField("fit.major_placeholder", text: $major)
                .textFieldStyle(.roundedBorder)
                .disableAutocorrection(true)
                .onSubmit(run)
            Button(action: run) {
                Text("fit.evaluate").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(school.trimmingCharacters(in: .whitespaces).isEmpty || loading)
        }
        .ccCard()
    }

    private func coreValues(_ v: CollegeValues) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("fit.core_values").font(.caption.weight(.semibold))
                .foregroundStyle(Theme.textMuted).textCase(.uppercase)
            ForEach(v.values ?? []) { value in
                let coverage = v.fit?.perValueCoverage?.first { $0.theme == value.theme }
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text(value.theme).font(.subheadline.weight(.semibold))
                            .foregroundStyle(Theme.textPrimary)
                        if let hits = coverage?.hits {
                            Text(hits > 0 ? "✓ \(hits)" : "—")
                                .font(.caption2)
                                .foregroundStyle(hits > 0 ? Theme.green : Theme.textMuted)
                        }
                    }
                    if let s = value.summary {
                        Text(s).font(.caption).foregroundStyle(Theme.textSecondary)
                    }
                }
                Divider().overlay(Theme.cardBorder)
            }
        }
        .ccCard()
    }

    private func run() {
        let name = school.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        loading = true
        error = nil
        result = nil
        values = nil
        Task {
            defer { loading = false }
            do {
                let resp = try await APIClient.shared.positioning(schoolName: name, major: major)
                result = resp.targets.first
                // College core values are a nice-to-have; failure is non-fatal.
                values = try? await APIClient.shared.collegeValues(collegeName: name)
                if result == nil { error = String(localized: "fit.no_data") }
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }
}

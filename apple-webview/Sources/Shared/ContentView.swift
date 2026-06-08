import SwiftUI

struct ContentView: View {
    @AppStorage("ccweb.frontendURL") private var urlString: String = defaultFrontendURL()
    @State private var isLoading = false
    @State private var loadError: String?
    @State private var showSettings = false
    @State private var draftURL = ""

    private var url: URL { URL(string: urlString) ?? URL(string: "about:blank")! }

    var body: some View {
        ZStack(alignment: .top) {
            WebView(url: url, isLoading: $isLoading, loadError: $loadError)
                .ignoresSafeArea()

            if isLoading {
                ProgressView().controlSize(.small).padding(8)
                    .background(.thinMaterial, in: Capsule())
                    .padding(.top, 6)
            }

            if let loadError {
                VStack(spacing: 10) {
                    Text("Couldn't load the app").font(.headline)
                    Text(loadError).font(.caption).foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    Text(urlString).font(.caption2.monospaced()).foregroundStyle(.secondary)
                    Button("Change URL") { draftURL = urlString; showSettings = true }
                        .buttonStyle(.borderedProminent)
                }
                .padding(24)
                .frame(maxWidth: 360)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
                .padding(.top, 60)
            }
        }
        .overlay(alignment: .bottomTrailing) {
            Button { draftURL = urlString; showSettings = true } label: {
                Image(systemName: "gearshape.fill")
            }
            .padding(12)
            .buttonStyle(.bordered)
        }
        .sheet(isPresented: $showSettings) { settingsSheet }
    }

    private var settingsSheet: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Frontend URL").font(.title3.bold())
            Text("Point this at the React app (Vite dev server, or your hosted deployment). The backend URL is configured inside the web app itself.")
                .font(.caption).foregroundStyle(.secondary)
            TextField("https://your-host", text: $draftURL)
                .textFieldStyle(.roundedBorder)
                .disableAutocorrection(true)
                #if os(iOS)
                .textInputAutocapitalization(.never)
                .keyboardType(.URL)
                #endif
            HStack {
                Button("Cancel") { showSettings = false }.buttonStyle(.bordered)
                Spacer()
                Button("Load") {
                    let trimmed = draftURL.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !trimmed.isEmpty { urlString = trimmed }
                    loadError = nil
                    showSettings = false
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(24)
        .frame(minWidth: 320)
    }
}

/// Default frontend URL: read the `CCFrontendURL` Info.plist key, falling back
/// to the Vite dev server.
func defaultFrontendURL() -> String {
    (Bundle.main.object(forInfoDictionaryKey: "CCFrontendURL") as? String) ?? "http://localhost:5173"
}

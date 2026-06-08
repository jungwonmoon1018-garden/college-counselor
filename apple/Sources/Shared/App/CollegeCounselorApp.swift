import SwiftUI

@main
struct CollegeCounselorApp: App {
    @StateObject private var state = AppState()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(state)
                .tint(Theme.green)
                .preferredColorScheme(.dark)
        }
        #if os(macOS)
        .defaultSize(width: 920, height: 680)
        #endif
    }
}

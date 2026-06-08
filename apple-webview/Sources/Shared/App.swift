import SwiftUI

@main
struct CollegeCounselorWebApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        #if os(macOS)
        .defaultSize(width: 980, height: 720)
        #endif
    }
}

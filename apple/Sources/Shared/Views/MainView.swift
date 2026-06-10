import SwiftUI

struct MainView: View {
    var body: some View {
        TabView {
            CollegeFitView()
                .tabItem { Label("tab.fit", systemImage: "scope") }
            ChatView()
                .tabItem { Label("tab.chat", systemImage: "bubble.left.and.bubble.right") }
            SettingsView()
                .tabItem { Label("tab.settings", systemImage: "gearshape") }
        }
    }
}

import SwiftUI

struct RootView: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            content
        }
        .task { await state.bootstrap() }
    }

    @ViewBuilder
    private var content: some View {
        switch state.stage {
        case .launching:
            ProgressView().controlSize(.large)
        case .onboarding:
            OnboardingView()
        case .byok:
            APIKeyView(onSaved: { state.didSaveAPIKey() })
        case .main:
            MainView()
        }
    }
}

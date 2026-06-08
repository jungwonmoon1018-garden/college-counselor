import SwiftUI

/// Shared palette — a calm dark theme matching the web client's tone.
/// Colors are platform-neutral SwiftUI `Color`s (no UIColor/NSColor) so the
/// same code compiles on iOS and macOS.
enum Theme {
    static let bg = Color(red: 0.07, green: 0.07, blue: 0.10)
    static let card = Color.white.opacity(0.04)
    static let cardBorder = Color.white.opacity(0.08)
    static let textPrimary = Color(red: 0.90, green: 0.92, blue: 0.95)
    static let textSecondary = Color(red: 0.63, green: 0.69, blue: 0.75)
    static let textMuted = Color(red: 0.42, green: 0.42, blue: 0.48)

    static let blue = Color(red: 0.39, green: 0.70, blue: 0.93)   // admissibility
    static let orange = Color(red: 0.96, green: 0.68, blue: 0.33) // competitiveness
    static let green = Color(red: 0.41, green: 0.83, blue: 0.57)  // fit / strong
    static let purple = Color(red: 0.62, green: 0.48, blue: 0.92) // confidence
    static let red = Color(red: 0.96, green: 0.41, blue: 0.41)    // high reach / flags

    /// Map a positioning label to its band color.
    static func bandColor(_ label: String?) -> Color {
        let l = (label ?? "").lowercased()
        if l.contains("highly competitive") { return green }
        if l.contains("high reach") { return red }
        if l.contains("reach") { return orange }
        if l.contains("competitive") { return blue }
        return textMuted
    }

    /// Map an evidence-confidence level to a color.
    static func confidenceColor(_ level: String?) -> Color {
        switch (level ?? "").lowercased() {
        case "high": return green
        case "medium": return orange
        default: return red
        }
    }
}

extension View {
    /// Standard card chrome used across the app.
    func ccCard() -> some View {
        self
            .padding(14)
            .background(Theme.card)
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.cardBorder, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

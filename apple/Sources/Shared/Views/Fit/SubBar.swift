import SwiftUI

/// One dimension of the fit read: a point estimate plus, when the server
/// supplied a `Band` with real width (low-confidence schools), an honest
/// uncertainty band behind the fill and a low–high label instead of an
/// over-precise single number. Mirrors the web client's SubBar exactly.
struct SubBar: View {
    let label: LocalizedStringKey
    let score: Double?
    let color: Color
    var range: Positioning.Band? = nil

    private var pct: Double { clamp(score ?? 0) }
    private var lo: Double? { range?.low.map(clamp) }
    private var hi: Double? { range?.high.map(clamp) }
    private var hasBand: Bool {
        guard let lo, let hi else { return false }
        return hi - lo >= 1
    }

    var body: some View {
        HStack(spacing: 8) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(Theme.textSecondary)
                .frame(width: 96, alignment: .leading)

            GeometryReader { geo in
                let w = geo.size.width
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.06))
                    if hasBand, let lo, let hi {
                        // faint uncertainty band
                        Rectangle()
                            .fill(color.opacity(0.22))
                            .frame(width: w * CGFloat((hi - lo) / 100))
                            .offset(x: w * CGFloat(lo / 100))
                    }
                    // point-estimate fill
                    Capsule()
                        .fill(color.opacity(hasBand ? 0.5 : 1))
                        .frame(width: w * CGFloat(pct / 100))
                    if hasBand {
                        // point marker
                        Rectangle().fill(color)
                            .frame(width: 2)
                            .offset(x: w * CGFloat(pct / 100) - 1)
                    }
                }
            }
            .frame(height: 6)
            .clipShape(Capsule())

            Text(hasBand ? "\(Int(lo!.rounded()))–\(Int(hi!.rounded()))" : "\(Int(pct.rounded()))")
                .font(.caption2)
                .foregroundStyle(Theme.textMuted)
                .frame(width: hasBand ? 52 : 30, alignment: .trailing)
        }
    }

    private func clamp(_ v: Double) -> Double { min(100, max(0, v)) }
}

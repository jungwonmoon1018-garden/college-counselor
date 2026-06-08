import SwiftUI

/// The calibrated College Fit card. Honesty is the brand: a label + four
/// independent sub-scores rendered as BANDS (not one merged number), an
/// evidence-confidence indicator, and a provenance/source line that flags
/// `cds_live` / `cds_web` data as "unverified". Never presents a
/// low-confidence number as authoritative.
struct FitCard: View {
    let positioning: Positioning
    var collegeValues: CollegeValues? = nil

    private var p: Positioning { positioning }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(collegeValues?.displayName ?? p.schoolName ?? "—")
                .font(.headline).foregroundStyle(Theme.textPrimary)

            // ── Calibrated label ──
            if let label = p.overallPositioningLabel {
                Text(label)
                    .font(.subheadline.bold())
                    .foregroundStyle(Theme.bandColor(label))
                    .padding(.horizontal, 10).padding(.vertical, 4)
                    .background(Theme.bandColor(label).opacity(0.12))
                    .overlay(Capsule().stroke(Theme.bandColor(label).opacity(0.35), lineWidth: 1))
                    .clipShape(Capsule())
            }

            // ── Four independent dimensions, as bands ──
            VStack(spacing: 6) {
                SubBar(label: "fit.admissibility",
                       score: p.admissibility?.academicReadinessScore,
                       color: Theme.blue, range: p.scoreRanges?.admissibility)
                SubBar(label: "fit.competitiveness",
                       score: p.competitiveness?.majorCompetitivenessScore,
                       color: Theme.orange, range: p.scoreRanges?.competitiveness)
                SubBar(label: "fit.fit",
                       score: p.fit?.institutionalPriorityFitScore,
                       color: Theme.green, range: p.scoreRanges?.fit)
                SubBar(label: "fit.confidence_dim",
                       score: p.confidence?.evidenceConfidenceScore,
                       color: Theme.purple)
            }

            if let summary = p.admissibility?.summary {
                Text(summary).font(.caption).foregroundStyle(Theme.textSecondary)
            }

            // ── Confidence indicator ──
            if let level = p.confidence?.evidenceConfidence {
                HStack(spacing: 4) {
                    Text("fit.confidence").font(.caption2).foregroundStyle(Theme.textMuted)
                    Text(level).font(.caption2.bold()).foregroundStyle(Theme.confidenceColor(level))
                }
            }

            // ── Provenance / source ──
            provenance

            // ── Red flags ──
            if let flags = p.mainRedFlags, !flags.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    Text("fit.redflags").font(.caption2.weight(.semibold))
                        .foregroundStyle(Theme.red).textCase(.uppercase)
                    ForEach(flags.prefix(3), id: \.self) { f in
                        Text("• \(f)").font(.caption2).foregroundStyle(Theme.textSecondary)
                    }
                }
            }

            if let strategy = p.recommendedPositioningStrategy {
                VStack(alignment: .leading, spacing: 2) {
                    Text("fit.strategy").font(.caption2).foregroundStyle(Theme.textMuted)
                    Text(strategy).font(.caption).foregroundStyle(Theme.green)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .ccCard()
    }

    @ViewBuilder
    private var provenance: some View {
        if let dp = p.dataProvenance, let line = provenanceLine(dp) {
            HStack(spacing: 4) {
                Text("fit.source").font(.caption2).foregroundStyle(Theme.textMuted)
                if let urlStr = dp.sourceUrl, let url = URL(string: urlStr) {
                    Link(destination: url) {
                        Text("↗ \(line)").font(.caption2).foregroundStyle(Theme.blue)
                    }
                } else {
                    Text(line).font(.caption2).foregroundStyle(Theme.blue)
                }
                if isUnverified(dp) {
                    Text("fit.unverified")
                        .font(.caption2.bold())
                        .foregroundStyle(Theme.orange)
                        .padding(.horizontal, 5).padding(.vertical, 1)
                        .background(Theme.orange.opacity(0.15))
                        .clipShape(Capsule())
                }
            }
        }
    }

    private func isUnverified(_ dp: Positioning.DataProvenance) -> Bool {
        dp.kind == "cds_live" || dp.kind == "cds_web" || dp.validated == false
    }

    /// Build the "CDS · validated · 2024 · admit 12%" style line.
    private func provenanceLine(_ dp: Positioning.DataProvenance) -> String? {
        var bits: [String] = []
        switch dp.kind {
        case "cds_web": bits.append("CDS · AI web-read")
        case "cds_store", "cds_live": bits.append(dp.validated == true ? "CDS · validated" : "CDS · unverified")
        case "baseline_only": bits.append("IPEDS baseline")
        default: break
        }
        if let y = dp.yearLabel { bits.append(y) } else if let y = dp.year { bits.append(String(y)) }
        if let r = dp.admitRatePercent { bits.append("admit \(trim(r))%") }
        if let ar = dp.admitRate, ar.source == "web", let pct = ar.admitRatePercent {
            bits.append("admit \(trim(pct))% (web\(ar.season.map { " · \($0)" } ?? ""))")
        }
        return bits.isEmpty ? nil : bits.joined(separator: " · ")
    }

    private func trim(_ v: Double) -> String {
        v == v.rounded() ? String(Int(v)) : String(format: "%.1f", v)
    }
}

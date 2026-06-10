import Foundation

// ═══════════════════════════════════════════════════════════════════════
// Codable models mirroring the College Counselor backend JSON contract.
// Fields are optional/lenient: the server omits keys when evidence is thin,
// and the UI must degrade gracefully rather than fail to decode.
// ═══════════════════════════════════════════════════════════════════════

// ─── Auth ────────────────────────────────────────────────────────────────
struct AuthResponse: Codable {
    var token: String?
    var studentId: String?
    var registered: Bool?
    var authenticated: Bool?
    var existing: Bool?
}

// ─── Consent ───────────────────────────────────────────────────────────────
/// The three consent types the web client grants at onboarding. The backend
/// requires `cross_border_transfer` before any AI call will succeed.
enum ConsentType: String, CaseIterable {
    case dataProcessing = "data_processing"
    case aiInteraction = "ai_interaction"
    case crossBorderTransfer = "cross_border_transfer"
}

// ─── Providers catalog (BYOK) ──────────────────────────────────────────────
struct ProvidersCatalog: Codable {
    var version: String?
    var providers: [Provider]
    var tierLabels: [String: String]?
}

struct Provider: Codable, Identifiable, Hashable {
    var id: String
    var label: String?
    var defaults: TierModels?
    var requiresBaseUrl: Bool?

    var displayName: String { label ?? id }
}

struct TierModels: Codable, Hashable {
    var small: String?
    var medium: String?
    var large: String?
}

// ─── Positioning (College Fit) ─────────────────────────────────────────────
struct PositioningResponse: Codable {
    var targets: [Positioning]
}

struct Positioning: Codable, Identifiable {
    var schoolName: String?
    var unitId: String?
    var overallPositioningLabel: String?
    var admissibility: Admissibility?
    var competitiveness: Competitiveness?
    var fit: FitDim?
    var confidence: Confidence?
    var scoreRanges: ScoreRanges?
    var dataProvenance: DataProvenance?
    var mainRedFlags: [String]?
    var recommendedPositioningStrategy: String?

    var id: String { (schoolName ?? "") + (unitId ?? "") }

    struct Admissibility: Codable {
        var academicReadinessScore: Double?
        var summary: String?
    }
    struct Competitiveness: Codable {
        var majorCompetitivenessScore: Double?
    }
    struct FitDim: Codable {
        var institutionalPriorityFitScore: Double?
    }
    struct Confidence: Codable {
        var evidenceConfidence: String?          // High | Medium | Low | Very Low
        var evidenceConfidenceScore: Double?
        var evidenceValidated: Bool?
    }
    struct ScoreRanges: Codable {
        var admissibility: Band?
        var competitiveness: Band?
        var fit: Band?
    }
    struct Band: Codable {
        var point: Double?
        var low: Double?
        var high: Double?
    }
    struct DataProvenance: Codable {
        var kind: String?            // cds_store | cds_live | cds_web | baseline_only
        var validated: Bool?
        var sourceUrl: String?
        var year: Int?
        var yearLabel: String?
        var admitRatePercent: Double?
        var admitRate: AdmitRate?
    }
    struct AdmitRate: Codable {
        var source: String?          // "web"
        var admitRatePercent: Double?
        var season: String?
        var sourceUrl: String?
    }
}

// ─── College core values ───────────────────────────────────────────────────
struct CollegeValues: Codable {
    var displayName: String?
    var sourceUrl: String?
    var values: [CoreValue]?
    var fit: ValuesFit?
    var cached: Bool?
    var extractedAt: String?
    var locale: String?

    struct CoreValue: Codable, Identifiable {
        var theme: String
        var summary: String?
        var evidence: String?
        var id: String { theme }
    }
    struct ValuesFit: Codable {
        var overall: Double?
        var perValueCoverage: [Coverage]?
    }
    struct Coverage: Codable {
        var theme: String
        var hits: Int?
    }
}

// ─── Chat ────────────────────────────────────────────────────────────────────
struct ChatMessage: Codable, Identifiable, Equatable {
    var role: String          // "user" | "assistant"
    var content: String
    var id = UUID()

    private enum CodingKeys: String, CodingKey { case role, content }
}

/// Normalized response: `content: [{ type, text }]`.
struct ChatResponse: Codable {
    var content: [ContentBlock]?
    var error: APIErrorBody?

    struct ContentBlock: Codable {
        var type: String?
        var text: String?
    }

    var firstText: String {
        (content ?? []).compactMap { $0.type == "text" ? $0.text : nil }.joined(separator: "\n")
    }
}

// ─── Error body ─────────────────────────────────────────────────────────────
/// The backend returns either `{ "error": "msg" }` or, for some upstream LLM
/// errors, `{ "error": { "message": "msg" } }`. Decode both.
struct APIErrorBody: Codable {
    var message: String?
    var error: String?
    var code: String?

    init(from decoder: Decoder) throws {
        // `error` may be a string or an object — try both.
        if let single = try? decoder.singleValueContainer(), let s = try? single.decode(String.self) {
            self.message = s
            return
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.message = try? c.decode(String.self, forKey: .message)
        self.code = try? c.decode(String.self, forKey: .code)
        if let nested = try? c.decode(APIErrorBody.self, forKey: .error) {
            self.error = nested.message
        } else {
            self.error = try? c.decode(String.self, forKey: .error)
        }
    }

    private enum CodingKeys: String, CodingKey { case message, error, code }

    var display: String { message ?? error ?? "Something went wrong." }
}

// ─── Health ─────────────────────────────────────────────────────────────────
/// Unauthenticated `GET /api/health`. `scorecard` reports whether the College
/// Scorecard / IPEDS data API key is configured server-side (live vs offline
/// baseline data). A successful response also implies the PII vault booted
/// (the server refuses to start in production without ENCRYPTION_KEY).
struct HealthStatus: Codable {
    var status: String?
    var scorecard: Bool?
    var retentionMode: String?
}

// ─── Operator setup (first-run) ──────────────────────────────────────────────
struct SetupStatus: Codable {
    var setupAvailable: Bool?
    var encryptionKeyConfigured: Bool?
    var scorecardConfigured: Bool?
    var nodeEnv: String?
    var needsRestartToApply: Bool?
}

struct SetupResult: Codable {
    var ok: Bool?
    var wrote: [String]?
    var promotedDevKey: Bool?
    var backup: String?
    var restartRequired: Bool?
    var message: String?
}

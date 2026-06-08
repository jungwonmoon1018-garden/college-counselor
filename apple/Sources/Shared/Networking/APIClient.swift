import Foundation

enum APIError: LocalizedError {
    case notConfigured
    case http(status: Int, body: APIErrorBody?)
    case decoding(Error)
    case transport(Error)
    case noToken

    var errorDescription: String? {
        switch self {
        case .notConfigured: return "Set the backend URL in Settings first."
        case .noToken: return "You're signed out. Please sign in again."
        case .http(let status, let body):
            // Pass the upstream message through verbatim — these are actionable
            // (e.g. "switch to a paid web-capable model", "out of credits").
            if let msg = body?.display, !msg.isEmpty { return msg }
            return "Request failed (HTTP \(status))."
        case .decoding: return "The server sent an unexpected response."
        case .transport(let e): return e.localizedDescription
        }
    }

    var status: Int? { if case .http(let s, _) = self { return s }; return nil }
}

/// Thin async client for the College Counselor backend. Handles locale
/// plumbing, Bearer auth, and a single transparent re-auth on 401.
actor APIClient {
    static let shared = APIClient()

    private let session: URLSession
    private var token: String?
    /// Email is kept in memory after sign-in so a 401 can silently re-auth.
    private var email: String?

    init(session: URLSession = .shared) {
        self.session = session
        self.token = Keychain.get(account: "token")
        self.email = UserDefaults.standard.string(forKey: ConfigKeys.email)
    }

    // ─── Session lifecycle ───────────────────────────────────────────────
    func setSession(token: String?, email: String?) {
        self.token = token
        self.email = email
        if let token { Keychain.set(token, account: "token") } else { Keychain.delete(account: "token") }
        if let email { UserDefaults.standard.set(email, forKey: ConfigKeys.email) }
    }

    func clearSession() {
        token = nil
        Keychain.delete(account: "token")
    }

    var hasToken: Bool { token != nil }

    // ─── Public endpoints ────────────────────────────────────────────────
    func register(email: String, grade: String?, isMinor: Bool = false) async throws -> AuthResponse {
        var body: [String: Any] = ["email": email, "isMinor": isMinor]
        if let grade, !grade.isEmpty { body["grade"] = grade }
        let resp: AuthResponse = try await request("/students/register", method: "POST", body: body, authed: false)
        if let t = resp.token { setSession(token: t, email: email) }
        return resp
    }

    func auth(email: String, isMinor: Bool = false) async throws -> AuthResponse {
        let resp: AuthResponse = try await request(
            "/students/auth", method: "POST",
            body: ["email": email, "isMinor": isMinor], authed: false)
        if let t = resp.token { setSession(token: t, email: email) }
        return resp
    }

    func grantConsent(_ type: ConsentType) async throws {
        let _: EmptyResponse = try await request(
            "/consent/grant", method: "POST",
            body: ["consentType": type.rawValue, "grantedBy": "student"])
    }

    func providers() async throws -> ProvidersCatalog {
        try await request("/llm/providers", method: "GET", authed: false)
    }

    func health() async throws -> HealthStatus {
        try await request("/health", method: "GET", authed: false)
    }

    func apiKeyStatus() async throws -> APIKeyStatus {
        try await request("/students/apikey", method: "GET")
    }

    func saveAPIKey(provider: String, baseUrl: String?, models: TierModels, apiKey: String) async throws {
        var tiers: [String: Any] = [:]
        if let s = models.small, !s.isEmpty { tiers["small"] = s }
        if let m = models.medium, !m.isEmpty { tiers["medium"] = m }
        if let l = models.large, !l.isEmpty { tiers["large"] = l }
        var body: [String: Any] = ["provider": provider, "apiKey": apiKey]
        if !tiers.isEmpty { body["defaultModels"] = tiers }
        if let baseUrl, !baseUrl.isEmpty { body["baseUrl"] = baseUrl }
        let _: EmptyResponse = try await request("/students/apikey", method: "PUT", body: body)
    }

    func positioning(schoolName: String, major: String?) async throws -> PositioningResponse {
        var body: [String: Any] = ["targets": [["schoolName": schoolName]]]
        if let major, !major.isEmpty { body["major"] = major }
        return try await request("/positioning/targets", method: "POST", body: body)
    }

    func collegeValues(collegeName: String) async throws -> CollegeValues {
        try await request("/colleges/values", method: "POST", body: ["collegeName": collegeName])
    }

    /// Provider-neutral chat that routes through the student's BYOK key.
    /// `tier` (small|medium|large) selects the model server-side, so the
    /// client never names a model — matching the compliance-UX rule and the
    /// fact that the personal key/model live server-side.
    func chat(messages: [ChatMessage], tier: String = "medium",
              system: String? = nil, maxTokens: Int = 1024) async throws -> ChatResponse {
        var body: [String: Any] = [
            "tier": tier,
            "max_tokens": maxTokens,
            "messages": messages.map { ["role": $0.role, "content": $0.content] },
        ]
        if let system { body["system"] = system }
        return try await request("/llm", method: "POST", body: body)
    }

    // ─── Core request with one-shot re-auth on 401 ───────────────────────
    private func request<T: Decodable>(
        _ path: String, method: String,
        body: [String: Any]? = nil, authed: Bool = true,
        isRetry: Bool = false
    ) async throws -> T {
        let base = AppConfig.apiBase
        guard !base.isEmpty else { throw APIError.notConfigured }

        let locale = AppConfig.locale
        var comps = URLComponents(string: base + path)
        comps?.queryItems = (comps?.queryItems ?? []) + [URLQueryItem(name: "locale", value: locale)]
        guard let url = comps?.url else { throw APIError.notConfigured }

        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue(locale, forHTTPHeaderField: "X-CollegeApp-Locale")
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        if authed {
            guard let token else { throw APIError.noToken }
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let data: Data, response: URLResponse
        do { (data, response) = try await session.data(for: req) }
        catch { throw APIError.transport(error) }

        guard let http = response as? HTTPURLResponse else {
            throw APIError.http(status: -1, body: nil)
        }

        if http.statusCode == 401, authed, !isRetry, let email {
            // Token expired — re-auth once and retry the original call.
            _ = try? await auth(email: email)
            if token != nil {
                return try await request(path, method: method, body: body, authed: authed, isRetry: true)
            }
        }

        guard (200..<300).contains(http.statusCode) else {
            let errBody = try? JSONDecoder().decode(APIErrorBody.self, from: data)
            throw APIError.http(status: http.statusCode, body: errBody)
        }

        if T.self == EmptyResponse.self { return EmptyResponse() as! T }
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw APIError.decoding(error) }
    }
}

struct EmptyResponse: Decodable {}

struct APIKeyStatus: Codable {
    var hasPersonalKey: Bool?
    var provider: String?
}

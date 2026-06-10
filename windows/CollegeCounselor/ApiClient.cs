using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace CollegeCounselor;

public sealed class ApiException : Exception
{
    public int StatusCode { get; }
    public ApiException(string message, int statusCode = 0) : base(message) => StatusCode = statusCode;
}

/// Thin async client for the College Counselor backend. Locale plumbing, Bearer
/// auth, one transparent re-auth on 401, upstream error pass-through. Mirrors
/// the Apple app's APIClient.
internal sealed class ApiClient
{
    public static readonly ApiClient Shared = new();

    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(30) };
    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };

    private string? _token;
    private string? _email;

    private ApiClient()
    {
        _token = TokenStore.Get("token");
        _email = TokenStore.Get("email");
    }

    public bool HasToken => _token != null;
    public string? Email => _email;

    private void SetSession(string? token, string? email)
    {
        _token = token;
        _email = email;
        if (token != null) TokenStore.Set("token", token); else TokenStore.Delete("token");
        if (email != null) TokenStore.Set("email", email);
    }

    public void ClearSession()
    {
        _token = null;
        _email = null;
        TokenStore.Delete("token");
        TokenStore.Delete("email");
    }

    // ─── Endpoints ───────────────────────────────────────────────────────
    public async Task<AuthResponse> RegisterAsync(string email, string? grade, bool isMinor = false)
    {
        var body = new Dictionary<string, object?> { ["email"] = email, ["isMinor"] = isMinor };
        if (!string.IsNullOrEmpty(grade)) body["grade"] = grade;
        var r = await RequestAsync<AuthResponse>("/students/register", HttpMethod.Post, body, authed: false);
        if (r.Token != null) SetSession(r.Token, email);
        return r;
    }

    public async Task<AuthResponse> AuthAsync(string email, bool isMinor = false)
    {
        var body = new Dictionary<string, object?> { ["email"] = email, ["isMinor"] = isMinor };
        var r = await RequestAsync<AuthResponse>("/students/auth", HttpMethod.Post, body, authed: false);
        if (r.Token != null) SetSession(r.Token, email);
        return r;
    }

    public Task GrantConsentAsync(string consentType) =>
        RequestRawAsync("/consent/grant", HttpMethod.Post,
            new Dictionary<string, object?> { ["consentType"] = consentType, ["grantedBy"] = "student" }, authed: true);

    public Task<ProvidersCatalog> ProvidersAsync() =>
        RequestAsync<ProvidersCatalog>("/llm/providers", HttpMethod.Get, null, authed: false);

    public Task<HealthStatus> HealthAsync() =>
        RequestAsync<HealthStatus>("/health", HttpMethod.Get, null, authed: false);

    public Task<ApiKeyStatus> ApiKeyStatusAsync() =>
        RequestAsync<ApiKeyStatus>("/students/apikey", HttpMethod.Get, null, authed: true);

    public Task SaveApiKeyAsync(string provider, string? baseUrl, TierModels models, string apiKey)
    {
        var tiers = new Dictionary<string, object?>();
        if (!string.IsNullOrWhiteSpace(models.Small)) tiers["small"] = models.Small;
        if (!string.IsNullOrWhiteSpace(models.Medium)) tiers["medium"] = models.Medium;
        if (!string.IsNullOrWhiteSpace(models.Large)) tiers["large"] = models.Large;
        var body = new Dictionary<string, object?> { ["provider"] = provider, ["apiKey"] = apiKey };
        if (tiers.Count > 0) body["defaultModels"] = tiers;
        if (!string.IsNullOrWhiteSpace(baseUrl)) body["baseUrl"] = baseUrl;
        return RequestRawAsync("/students/apikey", HttpMethod.Put, body, authed: true);
    }

    public Task<PositioningResponse> PositioningAsync(string schoolName, string? major)
    {
        var body = new Dictionary<string, object?>
        {
            ["targets"] = new[] { new Dictionary<string, object?> { ["schoolName"] = schoolName } },
        };
        if (!string.IsNullOrWhiteSpace(major)) body["major"] = major;
        return RequestAsync<PositioningResponse>("/positioning/targets", HttpMethod.Post, body, authed: true);
    }

    public Task<ChatResponse> ChatAsync(IEnumerable<(string role, string content)> messages, string tier = "medium", int maxTokens = 1024)
    {
        var body = new Dictionary<string, object?>
        {
            ["tier"] = tier,
            ["max_tokens"] = maxTokens,
            ["messages"] = messages.Select(m => new Dictionary<string, object?> { ["role"] = m.role, ["content"] = m.content }).ToList(),
        };
        return RequestAsync<ChatResponse>("/llm", HttpMethod.Post, body, authed: true);
    }

    // ─── Core ──────────────────────────────────────────────────────────────
    private async Task<T> RequestAsync<T>(string path, HttpMethod method, object? body, bool authed)
    {
        var text = await SendAsync(path, method, body, authed, isRetry: false);
        try { return JsonSerializer.Deserialize<T>(text, Json) ?? throw new ApiException("Empty response."); }
        catch (JsonException) { throw new ApiException("The server sent an unexpected response."); }
    }

    private async Task RequestRawAsync(string path, HttpMethod method, object? body, bool authed)
        => await SendAsync(path, method, body, authed, isRetry: false);

    private async Task<string> SendAsync(string path, HttpMethod method, object? body, bool authed, bool isRetry)
    {
        var baseUrl = AppConfig.ApiBase;
        if (string.IsNullOrEmpty(baseUrl)) throw new ApiException("Set the backend URL in Settings first.");
        var locale = AppConfig.Locale;
        var sep = path.Contains('?') ? "&" : "?";
        var url = $"{baseUrl}{path}{sep}locale={Uri.EscapeDataString(locale)}";

        using var req = new HttpRequestMessage(method, url);
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        req.Headers.TryAddWithoutValidation("X-CollegeApp-Locale", locale);
        if (authed)
        {
            if (_token == null) throw new ApiException("You're signed out. Please sign in again.");
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _token);
        }
        if (body != null)
            req.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

        HttpResponseMessage res;
        try { res = await Http.SendAsync(req); }
        catch (Exception e) { throw new ApiException(e.Message); }

        var text = await res.Content.ReadAsStringAsync();

        if (res.StatusCode == HttpStatusCode.Unauthorized && authed && !isRetry && _email != null)
        {
            try { await AuthAsync(_email); } catch { /* ignore */ }
            if (_token != null) return await SendAsync(path, method, body, authed, isRetry: true);
        }

        if (!res.IsSuccessStatusCode)
            throw new ApiException(ExtractError(text) ?? $"Request failed (HTTP {(int)res.StatusCode}).", (int)res.StatusCode);

        return text;
    }

    /// Pull an actionable message from `{error:"..."}` / `{error:{message:"..."}}` / `{message:"..."}`.
    private static string? ExtractError(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        try
        {
            using var doc = JsonDocument.Parse(text);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return null;
            if (root.TryGetProperty("error", out var err))
            {
                if (err.ValueKind == JsonValueKind.String) return err.GetString();
                if (err.ValueKind == JsonValueKind.Object && err.TryGetProperty("message", out var m)) return m.GetString();
            }
            if (root.TryGetProperty("message", out var msg) && msg.ValueKind == JsonValueKind.String) return msg.GetString();
        }
        catch { /* not JSON */ }
        return null;
    }
}

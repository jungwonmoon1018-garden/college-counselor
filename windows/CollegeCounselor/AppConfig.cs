using System.IO;
using System.Text.Json;

namespace CollegeCounselor;

/// User-tunable runtime config persisted to %APPDATA%\CollegeCounselor\config.json.
internal static class AppConfig
{
    private sealed class Data
    {
        public string? ApiBase { get; set; }
        public string? Locale { get; set; }
        public string? Grade { get; set; }
        public bool ConsentGranted { get; set; }
    }

    public const string DefaultApiBase = "http://localhost:3001/api";

    private static readonly string Dir =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "CollegeCounselor");
    private static readonly string FilePath = Path.Combine(Dir, "config.json");

    private static Data _data = Load();

    private static Data Load()
    {
        try
        {
            if (File.Exists(FilePath))
                return JsonSerializer.Deserialize<Data>(File.ReadAllText(FilePath)) ?? new Data();
        }
        catch { /* fall through to defaults */ }
        return new Data();
    }

    private static void Save()
    {
        try
        {
            Directory.CreateDirectory(Dir);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(_data));
        }
        catch { /* best-effort */ }
    }

    public static string ApiBase
    {
        get => Normalize(string.IsNullOrWhiteSpace(_data.ApiBase) ? DefaultApiBase : _data.ApiBase!);
        set { _data.ApiBase = Normalize(value); Save(); }
    }

    public static string Locale
    {
        get => string.IsNullOrWhiteSpace(_data.Locale)
            ? (System.Globalization.CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "ko" ? "ko" : "en-US")
            : _data.Locale!;
        set { _data.Locale = value; Save(); }
    }

    public static string Grade
    {
        get => _data.Grade ?? "";
        set { _data.Grade = value; Save(); }
    }

    public static bool ConsentGranted
    {
        get => _data.ConsentGranted;
        set { _data.ConsentGranted = value; Save(); }
    }

    /// Strip a trailing slash and an accidental /anthropic suffix.
    public static string Normalize(string raw)
    {
        var s = raw.Trim();
        if (s.EndsWith("/anthropic")) s = s[..^"/anthropic".Length];
        while (s.EndsWith("/")) s = s[..^1];
        return s;
    }
}

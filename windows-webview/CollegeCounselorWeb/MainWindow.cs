using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Microsoft.Web.WebView2.Wpf;

namespace CollegeCounselorWeb;

/// Thin WebView2 shell around the existing React SPA — the Windows parallel to
/// apple-webview/. Loads the real frontend (survey, full chat, all components),
/// so it stays in sync with frontend/ with no re-implementation. Off-host links
/// open in the system browser; the SPA's own navigation stays in-app.
public sealed class MainWindow : Window
{
    private readonly WebView2 _web = new();
    private readonly string _frontendUrl;

    public MainWindow()
    {
        Title = "College Counselor";
        Width = 1120;
        Height = 800;
        MinWidth = 640;
        MinHeight = 560;
        Background = new SolidColorBrush(Color.FromRgb(0x0A, 0x0E, 0x17));
        _frontendUrl = ResolveFrontendUrl();
        Content = _web;
        Loaded += async (_, _) => await InitAsync();
    }

    /// Priority: CC_FRONTEND_URL env var → %APPDATA%\CollegeCounselorWeb\frontend-url.txt
    /// → the Vite dev server default.
    private static string ResolveFrontendUrl()
    {
        var env = Environment.GetEnvironmentVariable("CC_FRONTEND_URL");
        if (!string.IsNullOrWhiteSpace(env)) return env.Trim();
        try
        {
            var cfg = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "CollegeCounselorWeb", "frontend-url.txt");
            if (File.Exists(cfg))
            {
                var v = File.ReadAllText(cfg).Trim();
                if (!string.IsNullOrWhiteSpace(v)) return v;
            }
        }
        catch { /* ignore */ }
        return "http://localhost:5173";
    }

    private async Task InitAsync()
    {
        try
        {
            await _web.EnsureCoreWebView2Async();
        }
        catch (Exception ex)
        {
            ShowError($"Couldn't start the WebView2 runtime.\n\n{ex.Message}\n\n" +
                      "Install the Microsoft Edge WebView2 Runtime (Evergreen), then relaunch.");
            return;
        }

        var core = _web.CoreWebView2;
        var appHost = SafeHost(_frontendUrl);

        // Pop-outs (target=_blank, OAuth windows) → system browser.
        core.NewWindowRequested += (_, e) => { e.Handled = true; OpenExternal(e.Uri); };

        // Keep same-host navigation in-app; send off-host http(s) to the browser.
        core.NavigationStarting += (_, e) =>
        {
            if (Uri.TryCreate(e.Uri, UriKind.Absolute, out var u))
            {
                var webScheme = u.Scheme is "http" or "https";
                if (webScheme && appHost != null && !u.Host.Equals(appHost, StringComparison.OrdinalIgnoreCase))
                {
                    e.Cancel = true;
                    OpenExternal(e.Uri);
                }
            }
        };

        core.NavigationCompleted += (_, e) =>
        {
            if (!e.IsSuccess)
                ShowError($"Couldn't load {_frontendUrl}.\n\n" +
                          "Make sure the frontend is running (cd frontend && npm run dev), or set " +
                          "CC_FRONTEND_URL to your hosted app, then relaunch.");
        };

        _web.Source = new Uri(_frontendUrl);
    }

    private void ShowError(string message)
    {
        Content = new Border
        {
            Background = new SolidColorBrush(Color.FromRgb(0x0A, 0x0E, 0x17)),
            Child = new TextBlock
            {
                Text = message,
                Foreground = new SolidColorBrush(Color.FromRgb(0xE2, 0xE8, 0xF0)),
                FontSize = 14,
                TextWrapping = TextWrapping.Wrap,
                MaxWidth = 460,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
                TextAlignment = TextAlignment.Center,
            },
        };
    }

    private static void OpenExternal(string uri)
    {
        try { Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true }); }
        catch { /* ignore */ }
    }

    private static string? SafeHost(string url)
        => Uri.TryCreate(url, UriKind.Absolute, out var u) ? u.Host : null;
}

using System.Windows;
using System.Windows.Controls;

namespace CollegeCounselor;

internal sealed class SettingsView : UserControl
{
    private readonly TextBox _apiBase = Theme.Input(AppConfig.ApiBase);
    private readonly ComboBox _locale = new() { Margin = new Thickness(0, 0, 0, 10), FontSize = 13 };
    private readonly TextBlock _saved = Theme.Label("", 12, Theme.Green);
    private readonly TextBlock _dataStatus = Theme.Label("Checking…", 12, Theme.TextMuted);

    public SettingsView()
    {
        var panel = new StackPanel { Margin = new Thickness(16), MaxWidth = 560, HorizontalAlignment = HorizontalAlignment.Center };

        var backend = new StackPanel();
        backend.Children.Add(Theme.Label("Backend URL"));
        backend.Children.Add(_apiBase);
        var saveBtn = Theme.Button("Save", Theme.Green);
        saveBtn.Click += (_, _) => { AppConfig.ApiBase = _apiBase.Text; _apiBase.Text = AppConfig.ApiBase; _saved.Text = "Saved."; };
        backend.Children.Add(saveBtn);
        backend.Children.Add(_saved);
        panel.Children.Add(Theme.Cardize(backend));

        var data = new StackPanel();
        data.Children.Add(Theme.Label("Data sources", 11, Theme.TextMuted, bold: true));
        data.Children.Add(_dataStatus);
        data.Children.Add(Theme.Label("“Live” means the backend's College Scorecard (IPEDS) key is configured. This key is a server-side setting, not entered here.", 11, Theme.TextMuted));
        panel.Children.Add(Theme.Cardize(data));

        var lang = new StackPanel();
        lang.Children.Add(Theme.Label("Language"));
        _locale.Items.Add("en-US");
        _locale.Items.Add("ko");
        _locale.SelectedItem = AppConfig.Locale == "ko" ? "ko" : "en-US";
        _locale.SelectionChanged += (_, _) => { if (_locale.SelectedItem is string l) AppConfig.Locale = l; };
        lang.Children.Add(_locale);
        panel.Children.Add(Theme.Cardize(lang));

        var account = new StackPanel();
        account.Children.Add(Theme.Label("Account", 11, Theme.TextMuted, bold: true));
        account.Children.Add(Theme.Label("Email: " + (ApiClient.Shared.Email ?? "—"), 12, Theme.TextSecondary));
        var signOut = Theme.Button("Sign out", Theme.Red);
        signOut.Click += (_, _) =>
        {
            ApiClient.Shared.ClearSession();
            AppConfig.ConsentGranted = false;
            MainWindow.Shell.ShowOnboarding();
        };
        account.Children.Add(signOut);
        panel.Children.Add(Theme.Cardize(account));

        panel.Children.Add(Theme.Label("Your profile data is PII. It's sent only over TLS to your backend and never used for analytics.", 11, Theme.TextMuted));

        Content = new ScrollViewer { Content = panel, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Background = Theme.Bg };
        _ = LoadHealthAsync();
    }

    private async Task LoadHealthAsync()
    {
        try
        {
            var h = await ApiClient.Shared.HealthAsync();
            if (h.Scorecard == true) { _dataStatus.Text = "College data: Live ✓"; _dataStatus.Foreground = Theme.Green; }
            else { _dataStatus.Text = "College data: Offline (baseline)"; _dataStatus.Foreground = Theme.Orange; }
        }
        catch { _dataStatus.Text = "Backend unreachable"; _dataStatus.Foreground = Theme.Red; }
    }
}

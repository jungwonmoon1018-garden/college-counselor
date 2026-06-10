using System.Windows;
using System.Windows.Controls;

namespace CollegeCounselor;

/// BYOK key entry. Write-only key field; never logged or echoed back.
internal sealed class ApiKeyView : UserControl
{
    private readonly ComboBox _provider = new() { Margin = new Thickness(0, 0, 0, 10), FontSize = 13 };
    private readonly PasswordBox _key = new() { Margin = new Thickness(0, 0, 0, 10), Padding = new Thickness(8, 6, 8, 6), FontSize = 13 };
    private readonly TextBox _baseUrl = Theme.Input();
    private readonly TextBox _small = Theme.Input();
    private readonly TextBox _medium = Theme.Input();
    private readonly TextBox _large = Theme.Input();
    private readonly TextBlock _error = Theme.Label("", 12, Theme.Red);
    private readonly Button _save = Theme.Button("Verify & save", Theme.Green);

    public ApiKeyView()
    {
        var panel = new StackPanel { Margin = new Thickness(24), MaxWidth = 520, HorizontalAlignment = HorizontalAlignment.Center };
        panel.Children.Add(new TextBlock { Text = "Connect your AI key", FontSize = 20, FontWeight = FontWeights.Bold, Foreground = Theme.TextPrimary, Margin = new Thickness(0, 0, 0, 4) });
        panel.Children.Add(Theme.Label("Your key is stored encrypted on the server and never shown again. You only pay your provider for what you use.", 13, Theme.TextSecondary));

        var prov = new StackPanel();
        prov.Children.Add(Theme.Label("Provider"));
        prov.Children.Add(_provider);
        panel.Children.Add(Theme.Cardize(prov));

        var keys = new StackPanel();
        keys.Children.Add(Theme.Label("API key"));
        keys.Children.Add(_key);
        keys.Children.Add(Theme.Label("Base URL (for local providers, optional)"));
        keys.Children.Add(_baseUrl);
        keys.Children.Add(Theme.Label("Model tiers (advanced)", 11, Theme.TextMuted));
        keys.Children.Add(Theme.Label("Small")); keys.Children.Add(_small);
        keys.Children.Add(Theme.Label("Medium")); keys.Children.Add(_medium);
        keys.Children.Add(Theme.Label("Large")); keys.Children.Add(_large);
        panel.Children.Add(Theme.Cardize(keys));

        panel.Children.Add(_error);
        _save.HorizontalAlignment = HorizontalAlignment.Stretch;
        _save.Click += OnSave;
        panel.Children.Add(_save);
        panel.Children.Add(Theme.Label("We never log or echo your key. It's verified once with your provider, then encrypted at rest.", 11, Theme.TextMuted));

        _provider.SelectionChanged += (_, _) => ApplyDefaults();

        Content = new ScrollViewer { Content = panel, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Background = Theme.Bg };
        _ = LoadAsync();
    }

    private async Task LoadAsync()
    {
        try
        {
            var catalog = await ApiClient.Shared.ProvidersAsync();
            _provider.ItemsSource = catalog.Providers;
            var def = catalog.Providers.FirstOrDefault(p => p.Id == "openrouter") ?? catalog.Providers.FirstOrDefault();
            if (def != null) _provider.SelectedItem = def;
        }
        catch (Exception ex) { _error.Text = ex.Message; }
    }

    private void ApplyDefaults()
    {
        if (_provider.SelectedItem is not Provider p) return;
        _small.Text = p.Defaults?.Small ?? "";
        _medium.Text = p.Defaults?.Medium ?? "";
        _large.Text = p.Defaults?.Large ?? "";
    }

    private async void OnSave(object sender, RoutedEventArgs e)
    {
        _error.Text = "";
        if (_provider.SelectedItem is not Provider p) { _error.Text = "Pick a provider."; return; }
        var apiKey = _key.Password.Trim();
        var needsBaseUrl = p.Id is "ollama" or "lmstudio" or "openai_compat";
        if (apiKey.Length < 12 && !needsBaseUrl) { _error.Text = "Enter your API key."; return; }

        _save.IsEnabled = false;
        try
        {
            var models = new TierModels { Small = _small.Text, Medium = _medium.Text, Large = _large.Text };
            await ApiClient.Shared.SaveApiKeyAsync(p.Id, _baseUrl.Text, models, apiKey);
            _key.Clear();
            MainWindow.Shell.ShowMain();
        }
        catch (Exception ex) { _error.Text = ex.Message; }
        finally { _save.IsEnabled = true; }
    }
}

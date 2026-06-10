using System.Windows;
using System.Windows.Controls;

namespace CollegeCounselor;

/// Root window + simple navigation host. Code-only (no XAML) to keep the blind
/// build predictable. Mirrors the SwiftUI RootView's stage machine.
public sealed class MainWindow : Window
{
    public static MainWindow Shell = null!;
    private readonly ContentControl _host = new();

    public MainWindow()
    {
        Shell = this;
        Title = "College Counselor";
        Width = 920;
        Height = 680;
        MinWidth = 560;
        MinHeight = 520;
        Background = Theme.Bg;
        Content = _host;

        var loading = new TextBlock
        {
            Text = "Loading…",
            Foreground = Theme.TextSecondary,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        _host.Content = loading;

        Loaded += async (_, _) => await BootstrapAsync();
    }

    public void Navigate(FrameworkElement view) => _host.Content = view;

    public void ShowOnboarding() => Navigate(new OnboardingView());
    public void ShowApiKey() => Navigate(new ApiKeyView());
    public void ShowMain() => Navigate(new MainTabs());

    private async Task BootstrapAsync()
    {
        if (!(ApiClient.Shared.HasToken && AppConfig.ConsentGranted))
        {
            ShowOnboarding();
            return;
        }
        try
        {
            var status = await ApiClient.Shared.ApiKeyStatusAsync();
            if (status.HasPersonalKey == true) ShowMain();
            else ShowApiKey();
        }
        catch
        {
            // Couldn't reach the backend — don't force key re-entry; the next
            // call surfaces any real auth/key problem.
            ShowMain();
        }
    }
}

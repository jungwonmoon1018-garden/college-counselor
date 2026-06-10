using System.Windows;
using System.Windows.Controls;

namespace CollegeCounselor;

/// Register + consent. Consent copy never names an AI model (compliance-UX rule).
internal sealed class OnboardingView : UserControl
{
    private readonly TextBox _email = Theme.Input(ApiClient.Shared.Email ?? "");
    private readonly TextBox _grade = Theme.Input(AppConfig.Grade);
    private readonly CheckBox _ai = Check("I understand I'm interacting with an AI system.");
    private readonly CheckBox _data = Check("I consent to processing of my profile data to generate guidance.");
    private readonly CheckBox _xborder = Check("I consent to cross-border transfer of my data for AI processing.");
    private readonly CheckBox _age = Check("I am 13+ (or a parent/guardian consents on my behalf).");
    private readonly TextBlock _error = Theme.Label("", 12, Theme.Red);
    private readonly Button _continue = Theme.Button("Create account", Theme.Green);

    public OnboardingView()
    {
        var panel = new StackPanel { Margin = new Thickness(24), MaxWidth = 520, HorizontalAlignment = HorizontalAlignment.Center };

        panel.Children.Add(new TextBlock { Text = "College Counselor", FontSize = 26, FontWeight = FontWeights.Bold, Foreground = Theme.TextPrimary, Margin = new Thickness(0, 0, 0, 4) });
        panel.Children.Add(Theme.Label("Honest, evidence-based guidance for your college applications.", 13, Theme.TextSecondary));

        var form = new StackPanel();
        form.Children.Add(Theme.Label("Email"));
        form.Children.Add(_email);
        form.Children.Add(Theme.Label("Grade (e.g. 11)"));
        form.Children.Add(_grade);
        panel.Children.Add(Theme.Cardize(form));

        var consent = new StackPanel();
        consent.Children.Add(Theme.Label("Before we start", 14, Theme.TextPrimary, bold: true));
        consent.Children.Add(_ai);
        consent.Children.Add(_data);
        consent.Children.Add(_xborder);
        consent.Children.Add(_age);
        panel.Children.Add(Theme.Cardize(consent));

        panel.Children.Add(_error);
        _continue.HorizontalAlignment = HorizontalAlignment.Stretch;
        _continue.Click += OnContinue;
        panel.Children.Add(_continue);

        panel.Children.Add(Theme.Label("AI-assisted advisory tool, not a substitute for a licensed counselor. Financial-aid guidance is informational only.", 11, Theme.TextMuted));

        Content = new ScrollViewer { Content = panel, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Background = Theme.Bg };
    }

    private static CheckBox Check(string text) => new()
    {
        Content = new TextBlock { Text = text, TextWrapping = TextWrapping.Wrap, Foreground = Theme.TextSecondary, FontSize = 13 },
        Margin = new Thickness(0, 4, 0, 4),
        Foreground = Theme.TextSecondary,
    };

    private async void OnContinue(object sender, RoutedEventArgs e)
    {
        _error.Text = "";
        var email = _email.Text.Trim().ToLowerInvariant();
        if (!email.Contains('@')) { _error.Text = "Enter a valid email."; return; }
        if (!(_ai.IsChecked == true && _data.IsChecked == true && _xborder.IsChecked == true && _age.IsChecked == true))
        { _error.Text = "Please acknowledge all four items to continue."; return; }

        _continue.IsEnabled = false;
        try
        {
            await ApiClient.Shared.RegisterAsync(email, string.IsNullOrWhiteSpace(_grade.Text) ? null : _grade.Text.Trim());
            AppConfig.Grade = _grade.Text.Trim();

            var consents = new[] { "data_processing", "ai_interaction", "cross_border_transfer" };
            foreach (var c in consents) await ApiClient.Shared.GrantConsentAsync(c);

            AppConfig.ConsentGranted = true;
            MainWindow.Shell.ShowApiKey();
        }
        catch (Exception ex)
        {
            _error.Text = ex.Message;
        }
        finally { _continue.IsEnabled = true; }
    }
}

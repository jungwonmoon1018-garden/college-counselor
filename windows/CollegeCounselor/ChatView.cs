using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace CollegeCounselor;

/// Minimal grounded chat. The backend does input screening, crisis detection,
/// PII redaction, and BYOK routing; the client sends turns and renders replies.
internal sealed class ChatView : UserControl
{
    private readonly StackPanel _messages = new() { Margin = new Thickness(16) };
    private readonly ScrollViewer _scroll;
    private readonly TextBox _input = Theme.Input();
    private readonly Button _send = Theme.Button("Send", Theme.Blue);
    private readonly List<(string role, string content)> _history = new();

    public ChatView()
    {
        _scroll = new ScrollViewer { Content = _messages, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Background = Theme.Bg };
        _messages.Children.Add(Theme.Label("Ask about your application, essays, schools, or deadlines.", 13, Theme.TextMuted));

        _input.Margin = new Thickness(0);
        _input.AcceptsReturn = false;
        _input.KeyDown += (_, e) => { if (e.Key == Key.Enter) { e.Handled = true; OnSend(this, new RoutedEventArgs()); } };
        _send.Margin = new Thickness(8, 0, 0, 0);
        _send.Click += OnSend;

        var inputRow = new DockPanel { Margin = new Thickness(12), LastChildFill = true };
        DockPanel.SetDock(_send, Dock.Right);
        inputRow.Children.Add(_send);
        inputRow.Children.Add(_input);

        var dock = new DockPanel { LastChildFill = true, Background = Theme.Bg };
        DockPanel.SetDock(inputRow, Dock.Bottom);
        dock.Children.Add(inputRow);
        dock.Children.Add(_scroll);
        Content = dock;
    }

    private async void OnSend(object sender, RoutedEventArgs e)
    {
        var text = _input.Text.Trim();
        if (text.Length == 0) return;
        _input.Clear();
        AddBubble(text, isUser: true);
        _history.Add(("user", text));
        _send.IsEnabled = false;
        try
        {
            var recent = _history.Count > 30 ? _history.GetRange(_history.Count - 30, 30) : _history;
            var resp = await ApiClient.Shared.ChatAsync(recent, "medium");
            var reply = resp.FirstText;
            if (string.IsNullOrWhiteSpace(reply)) reply = "(No response)";
            _history.Add(("assistant", reply));
            AddBubble(reply, isUser: false);
        }
        catch (Exception ex)
        {
            AddBubble(ex.Message, isUser: false, error: true);
        }
        finally { _send.IsEnabled = true; }
    }

    private void AddBubble(string text, bool isUser, bool error = false)
    {
        var bubble = new Border
        {
            Background = isUser ? Tint(Theme.Blue, 0.85) : Theme.Card,
            BorderBrush = Theme.CardBorder,
            BorderThickness = new Thickness(isUser ? 0 : 1),
            CornerRadius = new CornerRadius(12),
            Padding = new Thickness(12, 8, 12, 8),
            Margin = new Thickness(0, 5, 0, 5),
            MaxWidth = 460,
            HorizontalAlignment = isUser ? HorizontalAlignment.Right : HorizontalAlignment.Left,
            Child = new TextBlock
            {
                Text = text,
                TextWrapping = TextWrapping.Wrap,
                Foreground = error ? Theme.Red : (isUser ? Brushes.White : Theme.TextPrimary),
                FontSize = 13,
            },
        };
        _messages.Children.Add(bubble);
        _scroll.ScrollToEnd();
    }

    private static SolidColorBrush Tint(Brush b, double alpha)
    {
        var c = ((SolidColorBrush)b).Color;
        return new SolidColorBrush(Color.FromArgb((byte)(alpha * 255), c.R, c.G, c.B));
    }
}

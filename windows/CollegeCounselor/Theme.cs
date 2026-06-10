using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace CollegeCounselor;

/// Shared dark palette + small builders so the code-built views stay terse and
/// consistent. Mirrors the SwiftUI app's Theme.
internal static class Theme
{
    public static readonly Brush Bg = Frozen(0x12, 0x12, 0x19);
    public static readonly Brush Card = Frozen(0x1B, 0x1B, 0x24);
    public static readonly Brush CardBorder = Frozen(0x2A, 0x2A, 0x38);
    public static readonly Brush TextPrimary = Frozen(0xE5, 0xEA, 0xF0);
    public static readonly Brush TextSecondary = Frozen(0xA0, 0xAE, 0xC0);
    public static readonly Brush TextMuted = Frozen(0x6B, 0x6B, 0x7A);

    public static readonly Brush Blue = Frozen(0x63, 0xB3, 0xED);   // admissibility
    public static readonly Brush Orange = Frozen(0xF6, 0xAD, 0x55); // competitiveness
    public static readonly Brush Green = Frozen(0x68, 0xD3, 0x91);  // fit / strong
    public static readonly Brush Purple = Frozen(0x9F, 0x7A, 0xEA); // confidence
    public static readonly Brush Red = Frozen(0xF5, 0x65, 0x65);    // reach / flags

    private static SolidColorBrush Frozen(byte r, byte g, byte b)
    {
        var br = new SolidColorBrush(Color.FromRgb(r, g, b));
        br.Freeze();
        return br;
    }

    public static Brush BandColor(string? label)
    {
        var l = (label ?? string.Empty).ToLowerInvariant();
        if (l.Contains("highly competitive")) return Green;
        if (l.Contains("high reach")) return Red;
        if (l.Contains("reach")) return Orange;
        if (l.Contains("competitive")) return Blue;
        return TextMuted;
    }

    public static Brush ConfidenceColor(string? level) => (level ?? "").ToLowerInvariant() switch
    {
        "high" => Green,
        "medium" => Orange,
        _ => Red,
    };

    // ─── Builders ────────────────────────────────────────────────────────
    public static TextBlock Label(string text, double size = 12, Brush? color = null, bool bold = false) => new()
    {
        Text = text,
        FontSize = size,
        Foreground = color ?? TextSecondary,
        FontWeight = bold ? FontWeights.SemiBold : FontWeights.Normal,
        TextWrapping = TextWrapping.Wrap,
        Margin = new Thickness(0, 0, 0, 4),
    };

    public static TextBox Input(string? text = null) => new()
    {
        Text = text ?? "",
        Background = Frozen(0x0F, 0x0F, 0x16),
        Foreground = TextPrimary,
        BorderBrush = CardBorder,
        CaretBrush = TextPrimary,
        Padding = new Thickness(8, 6, 8, 6),
        Margin = new Thickness(0, 0, 0, 10),
        FontSize = 13,
    };

    public static Button Button(string text, Brush? bg = null)
    {
        var b = new Button
        {
            Content = text,
            Padding = new Thickness(14, 8, 14, 8),
            Margin = new Thickness(0, 2, 8, 2),
            Foreground = bg == null ? TextPrimary : Frozen(0x0A, 0x0E, 0x17),
            Background = bg ?? Card,
            BorderBrush = CardBorder,
            FontSize = 13,
            Cursor = System.Windows.Input.Cursors.Hand,
        };
        return b;
    }

    public static Border Cardize(UIElement child) => new()
    {
        Background = Card,
        BorderBrush = CardBorder,
        BorderThickness = new Thickness(1),
        CornerRadius = new CornerRadius(10),
        Padding = new Thickness(14),
        Margin = new Thickness(0, 0, 0, 14),
        Child = child,
    };
}

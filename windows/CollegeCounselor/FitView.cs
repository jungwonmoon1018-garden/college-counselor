using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace CollegeCounselor;

/// Calibrated College Fit: label + four independent sub-scores as bars (with an
/// honest range when the server supplies one), confidence, and a provenance
/// line that flags unvalidated (cds_live / cds_web) data.
internal sealed class FitView : UserControl
{
    private readonly TextBox _school = Theme.Input();
    private readonly TextBox _major = Theme.Input();
    private readonly Button _evaluate = Theme.Button("Evaluate fit", Theme.Green);
    private readonly StackPanel _results = new();

    public FitView()
    {
        var panel = new StackPanel { Margin = new Thickness(16), MaxWidth = 640, HorizontalAlignment = HorizontalAlignment.Center };

        var search = new StackPanel();
        search.Children.Add(Theme.Label("School name"));
        search.Children.Add(_school);
        search.Children.Add(Theme.Label("Intended major (optional)"));
        search.Children.Add(_major);
        _evaluate.Click += OnEvaluate;
        search.Children.Add(_evaluate);
        panel.Children.Add(Theme.Cardize(search));

        panel.Children.Add(_results);

        Content = new ScrollViewer { Content = panel, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Background = Theme.Bg };
    }

    private async void OnEvaluate(object sender, RoutedEventArgs e)
    {
        var name = _school.Text.Trim();
        if (name.Length == 0) return;
        _results.Children.Clear();
        _results.Children.Add(Theme.Label("Evaluating…", 13, Theme.TextMuted));
        _evaluate.IsEnabled = false;
        try
        {
            var resp = await ApiClient.Shared.PositioningAsync(name, _major.Text);
            _results.Children.Clear();
            var p = resp.Targets.FirstOrDefault();
            if (p == null || p.OverallPositioningLabel == null)
            {
                _results.Children.Add(Theme.Label("No positioning data available for this school yet.", 13, Theme.Orange));
                return;
            }
            _results.Children.Add(BuildCard(p));
        }
        catch (Exception ex)
        {
            _results.Children.Clear();
            _results.Children.Add(Theme.Label(ex.Message, 12, Theme.Red));
        }
        finally { _evaluate.IsEnabled = true; }
    }

    private static UIElement BuildCard(Positioning p)
    {
        var s = new StackPanel();
        s.Children.Add(new TextBlock { Text = p.SchoolName ?? "—", FontSize = 15, FontWeight = FontWeights.Bold, Foreground = Theme.TextPrimary, Margin = new Thickness(0, 0, 0, 8) });

        var band = Theme.BandColor(p.OverallPositioningLabel);
        s.Children.Add(new Border
        {
            Background = Tint(band, 0.14),
            BorderBrush = band,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(10),
            Padding = new Thickness(10, 3, 10, 3),
            HorizontalAlignment = HorizontalAlignment.Left,
            Margin = new Thickness(0, 0, 0, 10),
            Child = new TextBlock { Text = p.OverallPositioningLabel, Foreground = band, FontWeight = FontWeights.Bold, FontSize = 13 },
        });

        s.Children.Add(Bar("Admissibility", p.Admissibility?.AcademicReadinessScore, Theme.Blue, p.ScoreRanges?.Admissibility));
        s.Children.Add(Bar("Competitiveness", p.Competitiveness?.MajorCompetitivenessScore, Theme.Orange, p.ScoreRanges?.Competitiveness));
        s.Children.Add(Bar("Institutional fit", p.Fit?.InstitutionalPriorityFitScore, Theme.Green, p.ScoreRanges?.Fit));
        s.Children.Add(Bar("Evidence", p.Confidence?.EvidenceConfidenceScore, Theme.Purple, null));

        if (!string.IsNullOrWhiteSpace(p.Admissibility?.Summary))
            s.Children.Add(Theme.Label(p.Admissibility!.Summary!, 12, Theme.TextSecondary));

        if (!string.IsNullOrWhiteSpace(p.Confidence?.EvidenceConfidence))
        {
            var conf = new TextBlock { Margin = new Thickness(0, 4, 0, 0) };
            conf.Inlines.Add(new System.Windows.Documents.Run("Confidence: ") { Foreground = Theme.TextMuted, FontSize = 11 });
            conf.Inlines.Add(new System.Windows.Documents.Run(p.Confidence!.EvidenceConfidence) { Foreground = Theme.ConfidenceColor(p.Confidence.EvidenceConfidence), FontWeight = FontWeights.SemiBold, FontSize = 11 });
            s.Children.Add(conf);
        }

        var prov = ProvenanceLine(p.DataProvenance);
        if (prov != null) s.Children.Add(Theme.Label(prov, 11, Theme.Blue));

        if (p.MainRedFlags is { Count: > 0 })
        {
            s.Children.Add(Theme.Label("WATCH-OUTS", 10, Theme.Red, bold: true));
            foreach (var f in p.MainRedFlags.Take(3))
                s.Children.Add(Theme.Label("• " + f, 11, Theme.TextSecondary));
        }

        if (!string.IsNullOrWhiteSpace(p.RecommendedPositioningStrategy))
        {
            s.Children.Add(Theme.Label("Strategy", 11, Theme.TextMuted));
            s.Children.Add(Theme.Label(p.RecommendedPositioningStrategy!, 12, Theme.Green));
        }

        return Theme.Cardize(s);
    }

    /// One dimension: label + proportional fill bar + value/range text.
    private static UIElement Bar(string label, double? score, Brush color, Band? range)
    {
        double pct = Clamp(score ?? 0);
        double? lo = range?.Low is double l ? Clamp(l) : null;
        double? hi = range?.High is double h ? Clamp(h) : null;
        bool hasBand = lo != null && hi != null && hi - lo >= 1;

        var grid = new Grid { Margin = new Thickness(0, 3, 0, 3) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(110) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(56) });

        var lbl = new TextBlock { Text = label, Foreground = Theme.TextSecondary, FontSize = 11, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(lbl, 0);
        grid.Children.Add(lbl);

        // Track with a proportional fill via a 2-column star grid.
        var fillGrid = new Grid { Height = 8 };
        fillGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(pct, GridUnitType.Star) });
        fillGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(100 - pct, GridUnitType.Star) });
        var fill = new Border { Background = color, CornerRadius = new CornerRadius(4) };
        Grid.SetColumn(fill, 0);
        fillGrid.Children.Add(fill);

        var track = new Border
        {
            Height = 8,
            Background = new SolidColorBrush(Color.FromArgb(0x18, 0xFF, 0xFF, 0xFF)),
            CornerRadius = new CornerRadius(4),
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 0, 8, 0),
            Child = fillGrid,
        };
        Grid.SetColumn(track, 1);
        grid.Children.Add(track);

        var val = new TextBlock
        {
            Text = hasBand ? $"{System.Math.Round(lo!.Value)}–{System.Math.Round(hi!.Value)}" : $"{System.Math.Round(pct)}",
            Foreground = Theme.TextMuted,
            FontSize = 11,
            TextAlignment = TextAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(val, 2);
        grid.Children.Add(val);

        return grid;
    }

    private static string? ProvenanceLine(DataProvenance? dp)
    {
        if (dp == null) return null;
        var bits = new List<string>();
        switch (dp.Kind)
        {
            case "cds_web": bits.Add("CDS · AI web-read (unverified)"); break;
            case "cds_store":
            case "cds_live": bits.Add(dp.Validated == true ? "CDS · validated" : "CDS · unverified"); break;
            case "baseline_only": bits.Add("IPEDS baseline"); break;
        }
        if (!string.IsNullOrEmpty(dp.YearLabel)) bits.Add(dp.YearLabel!);
        else if (dp.Year is int y) bits.Add(y.ToString());
        if (dp.AdmitRatePercent is double r) bits.Add($"admit {r}%");
        return bits.Count == 0 ? null : "Source: " + string.Join(" · ", bits);
    }

    private static SolidColorBrush Tint(Brush b, double alpha)
    {
        var c = ((SolidColorBrush)b).Color;
        return new SolidColorBrush(Color.FromArgb((byte)(alpha * 255), c.R, c.G, c.B));
    }

    private static double Clamp(double v) => System.Math.Max(0, System.Math.Min(100, v));
}

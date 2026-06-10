namespace CollegeCounselor;

// Codable-style DTOs mirroring the College Counselor backend JSON. Fields are
// nullable/optional: the server omits keys when evidence is thin.

public sealed class AuthResponse
{
    public string? Token { get; set; }
    public string? StudentId { get; set; }
    public bool? Registered { get; set; }
    public bool? Authenticated { get; set; }
}

public sealed class ProvidersCatalog
{
    public List<Provider> Providers { get; set; } = new();
}

public sealed class Provider
{
    public string Id { get; set; } = "";
    public string? Label { get; set; }
    public TierModels? Defaults { get; set; }
    public string DisplayName => string.IsNullOrEmpty(Label) ? Id : Label!;
    public override string ToString() => DisplayName;
}

public sealed class TierModels
{
    public string? Small { get; set; }
    public string? Medium { get; set; }
    public string? Large { get; set; }
}

public sealed class ApiKeyStatus
{
    public bool? HasPersonalKey { get; set; }
    public string? Provider { get; set; }
}

public sealed class HealthStatus
{
    public string? Status { get; set; }
    public bool? Scorecard { get; set; }
}

public sealed class PositioningResponse
{
    public List<Positioning> Targets { get; set; } = new();
}

public sealed class Positioning
{
    public string? SchoolName { get; set; }
    public string? OverallPositioningLabel { get; set; }
    public Admissibility? Admissibility { get; set; }
    public Competitiveness? Competitiveness { get; set; }
    public FitDim? Fit { get; set; }
    public Confidence? Confidence { get; set; }
    public ScoreRanges? ScoreRanges { get; set; }
    public DataProvenance? DataProvenance { get; set; }
    public List<string>? MainRedFlags { get; set; }
    public string? RecommendedPositioningStrategy { get; set; }
}

public sealed class Admissibility
{
    public double? AcademicReadinessScore { get; set; }
    public string? Summary { get; set; }
}
public sealed class Competitiveness { public double? MajorCompetitivenessScore { get; set; } }
public sealed class FitDim { public double? InstitutionalPriorityFitScore { get; set; } }
public sealed class Confidence
{
    public string? EvidenceConfidence { get; set; }
    public double? EvidenceConfidenceScore { get; set; }
}
public sealed class ScoreRanges
{
    public Band? Admissibility { get; set; }
    public Band? Competitiveness { get; set; }
    public Band? Fit { get; set; }
}
public sealed class Band
{
    public double? Point { get; set; }
    public double? Low { get; set; }
    public double? High { get; set; }
}
public sealed class DataProvenance
{
    public string? Kind { get; set; }
    public bool? Validated { get; set; }
    public string? SourceUrl { get; set; }
    public int? Year { get; set; }
    public string? YearLabel { get; set; }
    public double? AdmitRatePercent { get; set; }
}

public sealed class ChatResponse
{
    public List<ContentBlock>? Content { get; set; }

    public string FirstText =>
        Content == null ? "" :
        string.Join("\n", Content.Where(c => c.Type == "text" && c.Text != null).Select(c => c.Text));
}
public sealed class ContentBlock
{
    public string? Type { get; set; }
    public string? Text { get; set; }
}

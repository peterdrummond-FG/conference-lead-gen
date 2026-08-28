using ConferenceLeadGen.Api.Models.Enums;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace ConferenceLeadGen.Api.Data.Converters;

// Shared by Contact.ExtractionConfidence and Contact.MatchConfidence. EF Core
// automatically wraps a converter for the non-nullable enum when it's applied
// to a nullable (ConfidenceLevel?) property, so one instance covers both.
public static class ConfidenceLevelConverter
{
    public static readonly ValueConverter<ConfidenceLevel, string> Instance = new(
        v => ToProviderValue(v),
        v => FromProviderValue(v));

    public static string ToProviderValue(ConfidenceLevel v) => v switch
    {
        ConfidenceLevel.High => "high",
        ConfidenceLevel.Medium => "medium",
        ConfidenceLevel.Low => "low",
        _ => throw new ArgumentOutOfRangeException(nameof(v), v, "Unmapped ConfidenceLevel value")
    };

    public static ConfidenceLevel FromProviderValue(string v) => v switch
    {
        "high" => ConfidenceLevel.High,
        "medium" => ConfidenceLevel.Medium,
        "low" => ConfidenceLevel.Low,
        _ => throw new ArgumentOutOfRangeException(nameof(v), v, "Unmapped confidence string")
    };
}

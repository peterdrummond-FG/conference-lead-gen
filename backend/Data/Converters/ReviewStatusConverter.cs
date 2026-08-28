using ConferenceLeadGen.Api.Models.Enums;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace ConferenceLeadGen.Api.Data.Converters;

public static class ReviewStatusConverter
{
    public static readonly ValueConverter<ReviewStatus, string> Instance = new(
        v => ToProviderValue(v),
        v => FromProviderValue(v));

    public static string ToProviderValue(ReviewStatus v) => v switch
    {
        ReviewStatus.Approved => "approved",
        ReviewStatus.NeedsReview => "needs_review",
        ReviewStatus.Rejected => "rejected",
        _ => throw new ArgumentOutOfRangeException(nameof(v), v, "Unmapped ReviewStatus value")
    };

    public static ReviewStatus FromProviderValue(string v) => v switch
    {
        "approved" => ReviewStatus.Approved,
        "needs_review" => ReviewStatus.NeedsReview,
        "rejected" => ReviewStatus.Rejected,
        _ => throw new ArgumentOutOfRangeException(nameof(v), v, "Unmapped review status string")
    };
}

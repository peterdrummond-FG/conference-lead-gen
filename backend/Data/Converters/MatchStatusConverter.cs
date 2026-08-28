using ConferenceLeadGen.Api.Models.Enums;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace ConferenceLeadGen.Api.Data.Converters;

public static class MatchStatusConverter
{
    public static readonly ValueConverter<MatchStatus, string> Instance = new(
        v => ToProviderValue(v),
        v => FromProviderValue(v));

    public static string ToProviderValue(MatchStatus v) => v switch
    {
        MatchStatus.Pending => "pending",
        MatchStatus.ExistingContact => "existing_contact",
        MatchStatus.NewContactExistingAccount => "new_contact_existing_account",
        MatchStatus.NewAccount => "new_account",
        MatchStatus.Ambiguous => "ambiguous",
        _ => throw new ArgumentOutOfRangeException(nameof(v), v, "Unmapped MatchStatus value")
    };

    public static MatchStatus FromProviderValue(string v) => v switch
    {
        "pending" => MatchStatus.Pending,
        "existing_contact" => MatchStatus.ExistingContact,
        "new_contact_existing_account" => MatchStatus.NewContactExistingAccount,
        "new_account" => MatchStatus.NewAccount,
        "ambiguous" => MatchStatus.Ambiguous,
        _ => throw new ArgumentOutOfRangeException(nameof(v), v, "Unmapped match status string")
    };
}

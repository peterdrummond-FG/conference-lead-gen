using ConferenceLeadGen.Api.Models.Enums;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace ConferenceLeadGen.Api.Data.Converters;

// Explicit mapping (not .HasConversion<string>()) so the stored text matches
// the architecture doc's snake_case values ("card_photo") rather than the
// C# enum member's own name ("CardPhoto"). The switch/throw logic lives in
// plain static methods, not inline in the lambdas, because ValueConverter's
// constructor takes Expression<Func<...>>, and expression trees can't contain
// switch expressions or throw expressions directly.
public static class ContactSourceConverter
{
    public static readonly ValueConverter<ContactSource, string> Instance = new(
        v => ToProviderValue(v),
        v => FromProviderValue(v));

    private static string ToProviderValue(ContactSource v) => v switch
    {
        ContactSource.Form => "form",
        ContactSource.CardPhoto => "card_photo",
        _ => throw new ArgumentOutOfRangeException(nameof(v), v, "Unmapped ContactSource value")
    };

    private static ContactSource FromProviderValue(string v) => v switch
    {
        "form" => ContactSource.Form,
        "card_photo" => ContactSource.CardPhoto,
        _ => throw new ArgumentOutOfRangeException(nameof(v), v, "Unmapped contact source string")
    };
}

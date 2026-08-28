using ConferenceLeadGen.Api.Data;
using ConferenceLeadGen.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace ConferenceLeadGen.Api.Services;

// Deliberately cheap and deterministic — exact case-insensitive match or
// create, scoped to the event's own state. Not the elaborate token-scoring
// match-contact does: this only has to satisfy Contact.SchoolDistrictId's
// required FK with *some* correct local row; research-contact and
// match-contact do the real fuzzy/authoritative resolution against Zoho
// afterward regardless of which local row got picked here.
public static class LocalDistrictResolution
{
    // A card with no legible institution text at all still needs a valid
    // FK — a shared per-state placeholder, easy for a reviewer to spot and
    // fix via the district picker on /review.
    private const string NoDistrictPlaceholder = "(none provided on card)";

    public static async Task<Guid> ResolveDistrictAsync(AppDbContext db, string state, string? districtNameRaw)
    {
        var name = string.IsNullOrWhiteSpace(districtNameRaw) ? NoDistrictPlaceholder : districtNameRaw.Trim();

        var existing = await db.SchoolDistricts
            .Where(d => d.State == state)
            .FirstOrDefaultAsync(d => EF.Functions.ILike(d.Name, name));
        if (existing is not null) return existing.Id;

        var district = new SchoolDistrict { Name = name, State = state, ZohoAccountId = null };
        db.SchoolDistricts.Add(district);
        await db.SaveChangesAsync();
        return district.Id;
    }

    public static async Task<Guid?> ResolveSchoolAsync(AppDbContext db, Guid districtId, string? schoolNameRaw)
    {
        if (string.IsNullOrWhiteSpace(schoolNameRaw)) return null;
        var name = schoolNameRaw.Trim();

        var existing = await db.Schools
            .Where(s => s.DistrictId == districtId)
            .FirstOrDefaultAsync(s => EF.Functions.ILike(s.Name, name));
        if (existing is not null) return existing.Id;

        var school = new School { DistrictId = districtId, Name = name, ZohoAccountId = null };
        db.Schools.Add(school);
        await db.SaveChangesAsync();
        return school.Id;
    }
}

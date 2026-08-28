using ConferenceLeadGen.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace ConferenceLeadGen.Api.Services;

// Local-only, deterministic, no Zoho/web dependency — runs synchronously
// inside POST /api/contacts, before the background matching pipeline ever
// starts. Deliberately simpler than the Claude skills' own fuzzy matching
// (abbreviation expansion, token scoring): this is a same-event,
// likely-exact-duplicate check (a card photographed twice, or form+card for
// the same person), not cross-referencing a large external dataset.
public static class DuplicateDetection
{
    public static async Task<Guid?> FindLocalDuplicateAsync(
        AppDbContext db, Guid eventId, string firstName, string lastName, Guid schoolDistrictId)
    {
        var normalizedFirst = firstName.Trim().ToLowerInvariant();
        var normalizedLast = lastName.Trim().ToLowerInvariant();

        return await db.Contacts
            .Where(c => c.EventId == eventId && c.SchoolDistrictId == schoolDistrictId)
            .Where(c => c.FirstName.ToLower() == normalizedFirst && c.LastName.ToLower() == normalizedLast)
            .Select(c => (Guid?)c.Id)
            .FirstOrDefaultAsync();
    }
}

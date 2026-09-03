using ConferenceLeadGen.Api.Data;
using ConferenceLeadGen.Api.Models;
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

    // Review-time comparison view for the "Resolve duplicate" dialog — the
    // FK set by FindLocalDuplicateAsync above only points forward (a newer
    // row -> the first match it found), so a third scan of the same badge
    // can end up pointing at either the original or an already-flagged
    // duplicate of it. This widens back out to the full group: the contact
    // itself, whatever it points at, and every other contact pointing at
    // either of those two ids.
    public static async Task<List<Contact>> FindDuplicateGroupAsync(AppDbContext db, Guid contactId)
    {
        var contact = await db.Contacts
            .Include(c => c.Event)
            .Include(c => c.SchoolDistrict)
            .Include(c => c.School)
            .FirstOrDefaultAsync(c => c.Id == contactId);

        if (contact is null)
        {
            return new List<Contact>();
        }

        var anchorIds = new HashSet<Guid> { contact.Id };
        if (contact.LocalDuplicateOfContactId is { } targetId)
        {
            anchorIds.Add(targetId);
        }

        var group = await db.Contacts
            .Include(c => c.Event)
            .Include(c => c.SchoolDistrict)
            .Include(c => c.School)
            .Include(c => c.LocalDuplicateOfContact)
            .Where(c => anchorIds.Contains(c.Id)
                || (c.LocalDuplicateOfContactId != null && anchorIds.Contains(c.LocalDuplicateOfContactId.Value)))
            .OrderBy(c => c.CreatedAt)
            .ToListAsync();

        return group;
    }
}

using System.Text.RegularExpressions;
using ConferenceLeadGen.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace ConferenceLeadGen.Api.Services;

// A human-typeable identifier a rep can create a Finder subfolder with by
// hand (e.g. "lansing-20260920"), so the card-photo watcher can resolve
// which Event a folder belongs to without ever trusting a client-supplied
// Guid — mirrors how POST /api/contacts never trusts a client EventId
// either, just via a different stable identifier.
public static class EventFolderCode
{
    public static async Task<string> GenerateAsync(AppDbContext db, string city, DateTimeOffset activatedAt)
    {
        var baseSlug = $"{Slugify(city)}-{activatedAt:yyyyMMdd}";
        var candidate = baseSlug;
        var suffix = 2;
        while (await db.Events.AnyAsync(e => e.FolderCode == candidate))
        {
            candidate = $"{baseSlug}-{suffix}";
            suffix++;
        }
        return candidate;
    }

    internal static string Slugify(string value)
    {
        var lowered = value.Trim().ToLowerInvariant();
        var slug = Regex.Replace(lowered, "[^a-z0-9]+", "-").Trim('-');
        return string.IsNullOrEmpty(slug) ? "event" : slug;
    }
}

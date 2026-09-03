using System.Text.Json;
using ConferenceLeadGen.Api.Data;
using ConferenceLeadGen.Api.Data.Converters;
using ConferenceLeadGen.Api.Models;
using ConferenceLeadGen.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace ConferenceLeadGen.Api.Tools;

// One-off backfill for contacts matched before match-contact snapshotted the
// matched Zoho contact's email/phone/title and checked the matched Account
// for an active opportunity. Re-runs match-contact directly (skipping
// research-contact — the district/school are already resolved on these
// rows) and only writes the five new fields; matchStatus/matchConfidence/
// matchedZoho* stay exactly as a reviewer already saw them, since this is a
// narrow data backfill, not a re-review.
public static class BackfillMatchDetails
{
    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    // Same shape match-contact expects as input — the output of
    // research-contact (see MatchingBackgroundService.ResearchOutput and
    // .claude/skills/match-contact/SKILL.md's Input section). AlternateDistrictNames
    // and ResearchNotes aren't persisted on Contact, so they go in empty —
    // the district/school are already resolved on these rows, so match-contact
    // doesn't need them to re-find the same leading Account.
    private sealed record MatchInput(
        string? ContactId, string FirstName, string LastName, string? Email, string? Phone,
        string? Title, string DistrictName, string? SchoolName, string EventState,
        string Source, string? ExtractionConfidence,
        List<string>? AlternateDistrictNames, string? ResearchConfidence, bool PersonVerified, string? ResearchNotes);

    private sealed record MatchOutput(
        string? ContactId, string? MatchStatus, string? MatchConfidence,
        string? MatchedZohoContactId, string? MatchedZohoContactName,
        string? MatchedZohoContactEmail, string? MatchedZohoContactPhone, string? MatchedZohoContactTitle,
        string? MatchedZohoAccountId, string? MatchedZohoAccountName,
        bool? HasActiveOpportunity, string? ActiveOpportunityName,
        List<CandidateMatch>? CandidateMatches, string? Notes);

    public static async Task RunAsync(AppDbContext db, ILogger logger, string repoRoot)
    {
        var contacts = await db.Contacts
            .Include(c => c.Event)
            .Include(c => c.SchoolDistrict)
            .Include(c => c.School)
            .Where(c => (c.MatchedZohoContactId != null || c.MatchedZohoAccountId != null)
                && c.MatchedZohoContactEmail == null
                && c.MatchedZohoContactPhone == null
                && c.MatchedZohoContactTitle == null
                && c.HasActiveOpportunity == null)
            .ToListAsync();

        if (contacts.Count == 0)
        {
            Console.WriteLine("Nothing to backfill — every matched contact already has opportunity/snapshot data.");
            return;
        }

        var updated = 0;
        var failed = 0;

        foreach (var contact in contacts)
        {
            var input = new MatchInput(
                contact.Id.ToString(),
                contact.FirstName,
                contact.LastName,
                contact.Email,
                contact.Phone,
                contact.Title,
                contact.SchoolDistrict.Name,
                contact.School?.Name,
                contact.Event.State,
                ContactSourceConverter.ToProviderValue(contact.Source),
                contact.ExtractionConfidence.HasValue ? ConfidenceLevelConverter.ToProviderValue(contact.ExtractionConfidence.Value) : null,
                null,
                contact.ResearchConfidence.HasValue ? ConfidenceLevelConverter.ToProviderValue(contact.ResearchConfidence.Value) : null,
                contact.PersonVerified ?? false,
                null);

            try
            {
                var element = await SkillRunner.RunSkillAsync("match-contact", input, repoRoot, logger);
                var output = JsonSerializer.Deserialize<MatchOutput>(element.GetRawText(), JsonOpts)
                    ?? throw new InvalidOperationException("match-contact output deserialized to null");

                contact.MatchedZohoContactEmail = output.MatchedZohoContactEmail;
                contact.MatchedZohoContactPhone = output.MatchedZohoContactPhone;
                contact.MatchedZohoContactTitle = output.MatchedZohoContactTitle;
                contact.HasActiveOpportunity = output.HasActiveOpportunity;
                contact.ActiveOpportunityName = output.ActiveOpportunityName;

                await db.SaveChangesAsync();
                updated++;
                Console.WriteLine($"{contact.FirstName} {contact.LastName}: hasActiveOpportunity={output.HasActiveOpportunity?.ToString() ?? "null"}");
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Backfill failed for contact {ContactId} ({Name})", contact.Id, $"{contact.FirstName} {contact.LastName}");
                failed++;
            }
        }

        Console.WriteLine($"Backfill complete. Updated: {updated}   Failed: {failed}");
    }
}

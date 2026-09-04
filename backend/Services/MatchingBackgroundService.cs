using System.Text.Json;
using ConferenceLeadGen.Api.Data;
using ConferenceLeadGen.Api.Data.Converters;
using ConferenceLeadGen.Api.Models;
using ConferenceLeadGen.Api.Models.Enums;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace ConferenceLeadGen.Api.Services;

// Where the two Claude Code skills get invoked. .claude/skills lives at the
// repo root, one level up from backend/ (this project's own content root).
public record MatchingOptions(string RepoRoot);

public class MatchingBackgroundService : BackgroundService
{
    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private readonly MatchingQueue _queue;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly MatchingOptions _options;
    private readonly ILogger<MatchingBackgroundService> _logger;

    public MatchingBackgroundService(
        MatchingQueue queue, IServiceScopeFactory scopeFactory, MatchingOptions options, ILogger<MatchingBackgroundService> logger)
    {
        _queue = queue;
        _scopeFactory = scopeFactory;
        _options = options;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var contactId in _queue.Reader.ReadAllAsync(stoppingToken))
        {
            try
            {
                await ProcessAsync(contactId, stoppingToken);
            }
            catch (Exception ex)
            {
                // A safety net for anything ProcessAsync's own handling didn't
                // anticipate (e.g. a malformed enum string) — log and move on
                // rather than letting one bad item kill the whole worker loop.
                // The contact is left exactly as it was before the throw
                // (nothing gets half-saved), so it just stays at Pending.
                _logger.LogError(ex, "Unhandled error processing contact {ContactId}", contactId);
            }
            finally
            {
                // Releases the in-flight marker regardless of which path
                // ProcessAsync took (success, early return, or the catch
                // above) — this is what makes MatchingQueue.Enqueue safe to
                // call again for this contact, e.g. from MatchingRetryScanner
                // or a manual retry.
                _queue.Complete(contactId);
            }
        }
    }

    private async Task ProcessAsync(Guid contactId, CancellationToken stoppingToken)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var contact = await db.Contacts
            .Include(c => c.Event)
            .Include(c => c.SchoolDistrict)
            .Include(c => c.School)
            .FirstOrDefaultAsync(c => c.Id == contactId, stoppingToken);

        if (contact is null)
        {
            _logger.LogWarning("Contact {ContactId} not found for matching", contactId);
            return;
        }

        // Recorded before the skills even run, and saved immediately, so a
        // subprocess crash or timeout still leaves a trail — MatchingRetryScanner
        // relies on this to find stuck Pending rows and to eventually stop
        // auto-retrying ones that keep failing.
        contact.MatchAttempts++;
        contact.LastMatchAttemptAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(stoppingToken);

        var researchInput = new ResearchInput(
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
            contact.ExtractionConfidence.HasValue ? ConfidenceLevelConverter.ToProviderValue(contact.ExtractionConfidence.Value) : null);

        JsonElement matchElement;
        try
        {
            var researchElement = await SkillRunner.RunSkillAsync("research-contact", researchInput, _options.RepoRoot, _logger);
            var researchOutput = JsonSerializer.Deserialize<ResearchOutput>(researchElement.GetRawText(), JsonOpts)
                ?? throw new InvalidOperationException("research-contact output deserialized to null");

            contact.ResearchConfidence = researchOutput.ResearchConfidence is null
                ? null
                : ConfidenceLevelConverter.FromProviderValue(researchOutput.ResearchConfidence);
            contact.PersonVerified = researchOutput.PersonVerified;
            contact.ResearchFindings = new ResearchFindings(
                researchOutput.AlternateDistrictNames,
                researchOutput.AlternateNameSpellings,
                researchOutput.NameCorrectionConfidence,
                researchOutput.InstitutionLevel,
                researchOutput.InstitutionLevelCampusName,
                researchOutput.InstitutionLevelConfidence,
                researchOutput.InstitutionLevelAsOfDate,
                researchOutput.TitleFinding,
                researchOutput.TitleFindingConfidence,
                researchOutput.TitleFindingAsOfDate,
                researchOutput.ResearchNotes);

            matchElement = await SkillRunner.RunSkillAsync("match-contact", researchOutput, _options.RepoRoot, _logger);
        }
        catch (Exception ex)
        {
            // Never fabricate a result — leave the contact at Pending and log
            // loudly. A human or a later retry can pick it up; a stuck Pending
            // row is visible (e.g. surfaced on /review), not silently wrong.
            _logger.LogError(ex, "Matching pipeline failed for contact {ContactId}; leaving at Pending", contactId);
            return;
        }

        var matchOutput = JsonSerializer.Deserialize<MatchOutput>(matchElement.GetRawText(), JsonOpts)
            ?? throw new InvalidOperationException("match-contact output deserialized to null");

        // match-contact's own contract guarantees matchStatus is never
        // "pending" — but if it ever violates that, treat it exactly like a
        // pipeline failure (leave the row at Pending, don't save a
        // fabricated result) rather than trusting it blindly. Without this,
        // a genuinely-processed row could silently revert to Pending and
        // re-enter the retry cycle with no error logged anywhere.
        if (matchOutput.MatchStatus == "pending")
        {
            _logger.LogError(
                "match-contact violated its contract and returned matchStatus=pending for contact {ContactId}; leaving at Pending",
                contactId);
            return;
        }

        contact.MatchStatus = MatchStatusConverter.FromProviderValue(matchOutput.MatchStatus);
        contact.MatchConfidence = matchOutput.MatchConfidence is null
            ? null
            : ConfidenceLevelConverter.FromProviderValue(matchOutput.MatchConfidence);
        contact.MatchedZohoContactId = matchOutput.MatchedZohoContactId;
        contact.MatchedZohoContactName = matchOutput.MatchedZohoContactName;
        contact.MatchedZohoContactEmail = matchOutput.MatchedZohoContactEmail;
        contact.MatchedZohoContactPhone = matchOutput.MatchedZohoContactPhone;
        contact.MatchedZohoContactTitle = matchOutput.MatchedZohoContactTitle;
        contact.MatchedZohoAccountId = matchOutput.MatchedZohoAccountId;
        contact.MatchedZohoAccountName = matchOutput.MatchedZohoAccountName;
        contact.HasActiveOpportunity = matchOutput.HasActiveOpportunity;
        contact.ActiveOpportunityName = matchOutput.ActiveOpportunityName;
        contact.CandidateMatches = matchOutput.CandidateMatches;
        contact.Notes = matchOutput.Notes;

        // Verbatim from the architecture doc's auto-approve rule. Guarded on
        // still being NeedsReview so a reviewer's manual action that landed
        // while this was mid-flight never gets clobbered.
        if (contact.ReviewStatus == ReviewStatus.NeedsReview
            && contact.LocalDuplicateOfContactId is null
            && contact.MatchConfidence == ConfidenceLevel.High
            && (contact.ExtractionConfidence is null || contact.ExtractionConfidence == ConfidenceLevel.High))
        {
            contact.ReviewStatus = ReviewStatus.Approved;
            contact.AutoApproved = true;
        }

        await db.SaveChangesAsync(stoppingToken);
        _logger.LogInformation(
            "Contact {ContactId} matched: {Status}/{Confidence}", contactId, contact.MatchStatus, contact.MatchConfidence);
    }

    private sealed record ResearchInput(
        string? ContactId, string FirstName, string LastName, string? Email, string? Phone,
        string? Title, string DistrictName, string? SchoolName, string EventState,
        string Source, string? ExtractionConfidence);

    private sealed record ResearchOutput(
        string? ContactId, string FirstName, string LastName, string? Email, string? Phone,
        string? Title, string DistrictName, string? SchoolName, string EventState,
        string Source, string? ExtractionConfidence,
        List<string>? AlternateDistrictNames, string? ResearchConfidence, bool PersonVerified, string? ResearchNotes,
        List<string>? AlternateNameSpellings, string? NameCorrectionConfidence,
        string? InstitutionLevel, string? InstitutionLevelCampusName,
        string? InstitutionLevelConfidence, string? InstitutionLevelAsOfDate,
        string? TitleFinding, string? TitleFindingConfidence, string? TitleFindingAsOfDate);

    private sealed record MatchOutput(
        string? ContactId, string MatchStatus, string? MatchConfidence,
        string? MatchedZohoContactId, string? MatchedZohoContactName,
        string? MatchedZohoContactEmail, string? MatchedZohoContactPhone, string? MatchedZohoContactTitle,
        string? MatchedZohoAccountId, string? MatchedZohoAccountName,
        bool? HasActiveOpportunity, string? ActiveOpportunityName,
        List<CandidateMatch>? CandidateMatches, string? Notes);
}

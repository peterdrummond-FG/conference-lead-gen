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

        contact.MatchStatus = MatchStatusConverter.FromProviderValue(matchOutput.MatchStatus);
        contact.MatchConfidence = matchOutput.MatchConfidence is null
            ? null
            : ConfidenceLevelConverter.FromProviderValue(matchOutput.MatchConfidence);
        contact.MatchedZohoContactId = matchOutput.MatchedZohoContactId;
        contact.MatchedZohoContactName = matchOutput.MatchedZohoContactName;
        contact.MatchedZohoAccountId = matchOutput.MatchedZohoAccountId;
        contact.MatchedZohoAccountName = matchOutput.MatchedZohoAccountName;
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
        List<string>? AlternateDistrictNames, string? ResearchConfidence, bool PersonVerified, string? ResearchNotes);

    private sealed record MatchOutput(
        string? ContactId, string MatchStatus, string? MatchConfidence,
        string? MatchedZohoContactId, string? MatchedZohoContactName,
        string? MatchedZohoAccountId, string? MatchedZohoAccountName,
        List<CandidateMatch>? CandidateMatches, string? Notes);
}

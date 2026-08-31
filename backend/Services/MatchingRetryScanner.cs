using ConferenceLeadGen.Api.Data;
using ConferenceLeadGen.Api.Models.Enums;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace ConferenceLeadGen.Api.Services;

// Self-healing sweep for Contacts stuck at MatchStatus = Pending: either the
// pipeline failed and MatchingBackgroundService left it exactly there (per
// its own comment, "a human or a later retry can pick it up"), or it was
// enqueued but the process restarted before MatchingQueue's in-memory
// channel ever delivered it. Both look identical from the database's point
// of view — Pending, with an attempt/creation timestamp older than the
// retry delay — so one query catches both.
public class MatchingRetryScanner : BackgroundService
{
    private static readonly TimeSpan SweepInterval = TimeSpan.FromMinutes(2);
    private static readonly TimeSpan RetryDelay = TimeSpan.FromMinutes(10);
    private const int MaxAutoAttempts = 3;

    private readonly MatchingQueue _queue;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<MatchingRetryScanner> _logger;

    public MatchingRetryScanner(MatchingQueue queue, IServiceScopeFactory scopeFactory, ILogger<MatchingRetryScanner> logger)
    {
        _queue = queue;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(SweepInterval);
        do
        {
            try
            {
                await SweepAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Matching retry sweep failed");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    private async Task SweepAsync(CancellationToken stoppingToken)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var cutoff = DateTimeOffset.UtcNow - RetryDelay;

        // Past MaxAutoAttempts, a contact needs a human via the manual
        // POST /api/contacts/{id}/retry-match endpoint instead — this sweep
        // stops touching it.
        var staleIds = await db.Contacts
            .Where(c => c.MatchStatus == MatchStatus.Pending && c.MatchAttempts < MaxAutoAttempts)
            .Where(c => (c.LastMatchAttemptAt ?? c.CreatedAt) < cutoff)
            .Select(c => c.Id)
            .ToListAsync(stoppingToken);

        foreach (var id in staleIds)
        {
            _logger.LogInformation("Retrying stuck contact {ContactId}", id);
            _queue.Enqueue(id);
        }
    }
}

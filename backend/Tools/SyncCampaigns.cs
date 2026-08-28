using System.Text.Json;
using ConferenceLeadGen.Api.Data;
using ConferenceLeadGen.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace ConferenceLeadGen.Api.Tools;

public static class SyncCampaigns
{
    // State/City are deliberately not modeled here — Zoho's Campaigns module
    // has no such fields (confirmed against all 671 real conference
    // campaigns). If the source JSON still carries null state/city values
    // from an earlier pull, System.Text.Json silently ignores unmapped
    // properties, which is exactly the right behavior here.
    private sealed record CampaignRecord(string ZohoCampaignId, string CampaignName);

    private sealed class Counts
    {
        public int Inserted;
        public int Updated;
        public int Unchanged;
        public int Total => Inserted + Updated + Unchanged;
    }

    public static async Task RunAsync(AppDbContext db, string jsonFilePath)
    {
        var fullPath = Path.GetFullPath(jsonFilePath);
        if (!File.Exists(fullPath))
        {
            throw new FileNotFoundException($"Sync file not found: {fullPath}");
        }

        var json = await File.ReadAllTextAsync(fullPath);
        var jsonOpts = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
        var records = JsonSerializer.Deserialize<List<CampaignRecord>>(json, jsonOpts)
            ?? throw new InvalidOperationException($"Sync file deserialized to null: {fullPath}");

        Validate(records);

        db.ChangeTracker.AutoDetectChangesEnabled = false;
        await using var transaction = await db.Database.BeginTransactionAsync();

        var counts = new Counts();
        await UpsertCampaignsAsync(db, records, counts);
        db.ChangeTracker.DetectChanges();
        await db.SaveChangesAsync();

        await transaction.CommitAsync();

        Console.WriteLine($"Sync file: {jsonFilePath} ({records.Count} records)");
        Console.WriteLine($"Campaigns   inserted: {counts.Inserted}   updated: {counts.Updated}   unchanged: {counts.Unchanged}   total: {counts.Total}");
    }

    // No FK-resolution case here (unlike SeedSchoolAccounts) — a bad row is
    // just a missing required field, so collect-then-throw is enough; there's
    // no partial-exclusion outcome to design for.
    private static void Validate(List<CampaignRecord> records)
    {
        var errors = new List<string>();

        for (var i = 0; i < records.Count; i++)
        {
            var r = records[i];
            if (string.IsNullOrWhiteSpace(r.ZohoCampaignId))
                errors.Add($"Row {i}: missing zohoCampaignId");
            if (string.IsNullOrWhiteSpace(r.CampaignName))
                errors.Add($"Row {i}: zohoCampaignId={r.ZohoCampaignId} missing campaignName");
        }

        if (errors.Count > 0)
        {
            throw new InvalidOperationException(
                $"Sync file failed validation with {errors.Count} bad row(s); no changes were made:\n  "
                + string.Join("\n  ", errors));
        }
    }

    private static async Task UpsertCampaignsAsync(AppDbContext db, List<CampaignRecord> records, Counts counts)
    {
        var existing = await db.Campaigns.ToDictionaryAsync(c => c.ZohoCampaignId);
        var now = DateTimeOffset.UtcNow;

        foreach (var r in records)
        {
            if (existing.TryGetValue(r.ZohoCampaignId, out var campaign))
            {
                if (campaign.Name != r.CampaignName)
                {
                    campaign.Name = r.CampaignName;
                    campaign.SyncedAt = now;
                    counts.Updated++;
                }
                else
                {
                    counts.Unchanged++;
                }
            }
            else
            {
                db.Campaigns.Add(new Campaign
                {
                    ZohoCampaignId = r.ZohoCampaignId,
                    Name = r.CampaignName,
                    SyncedAt = now
                });
                counts.Inserted++;
            }
        }
    }
}

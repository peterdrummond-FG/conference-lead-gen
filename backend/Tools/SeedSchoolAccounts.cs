using System.Text.Json;
using ConferenceLeadGen.Api.Data;
using ConferenceLeadGen.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace ConferenceLeadGen.Api.Tools;

public static class SeedSchoolAccounts
{
    private sealed record ZohoAccountRecord(
        string ZohoAccountId,
        string AccountName,
        string OrganizationLevel,
        string? State,
        string? ParentZohoAccountId);

    private sealed class Counts
    {
        public int Inserted;
        public int Updated;
        public int Unchanged;
        public int Total => Inserted + Updated + Unchanged;
    }

    private sealed record ExcludedRecord(
        string EntityType, string ZohoAccountId, string AccountName, string? ParentZohoAccountId, string Reason);

    public static async Task RunAsync(AppDbContext db, string jsonFilePath)
    {
        var fullPath = Path.GetFullPath(jsonFilePath);
        if (!File.Exists(fullPath))
        {
            throw new FileNotFoundException($"Seed file not found: {fullPath}");
        }

        var json = await File.ReadAllTextAsync(fullPath);
        var jsonOpts = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
        var records = JsonSerializer.Deserialize<List<ZohoAccountRecord>>(json, jsonOpts)
            ?? throw new InvalidOperationException($"Seed file deserialized to null: {fullPath}");

        Validate(records);

        db.ChangeTracker.AutoDetectChangesEnabled = false;
        await using var transaction = await db.Database.BeginTransactionAsync();

        var districtCounts = new Counts();
        var (districtsByZohoId, excludedDistricts) = await UpsertDistrictsAsync(db, records, districtCounts);
        db.ChangeTracker.DetectChanges();
        await db.SaveChangesAsync();

        // Only safe to read .Id here, after SaveChangesAsync: a newly-Add()ed
        // district's Id is Guid.Empty (server-generated via gen_random_uuid())
        // until the insert's RETURNING clause populates it.
        var districtIdByZohoId = districtsByZohoId.ToDictionary(kv => kv.Key, kv => kv.Value.Id);

        var schoolCounts = new Counts();
        var excludedSchools = await UpsertSchoolsAsync(db, records, districtIdByZohoId, schoolCounts);
        db.ChangeTracker.DetectChanges();
        await db.SaveChangesAsync();

        await transaction.CommitAsync();

        var excluded = excludedDistricts.Concat(excludedSchools).ToList();

        Console.WriteLine($"Seed file: {jsonFilePath} ({records.Count} records)");
        Console.WriteLine($"School Districts   inserted: {districtCounts.Inserted}   updated: {districtCounts.Updated}   unchanged: {districtCounts.Unchanged}   excluded: {excludedDistricts.Count}   total: {districtCounts.Total + excludedDistricts.Count}");
        Console.WriteLine($"Schools            inserted: {schoolCounts.Inserted}   updated: {schoolCounts.Updated}   unchanged: {schoolCounts.Unchanged}   excluded: {excludedSchools.Count}   total: {schoolCounts.Total + excludedSchools.Count}");

        if (excluded.Count > 0)
        {
            var reportPath = Path.Combine(
                Path.GetDirectoryName(fullPath) ?? ".",
                Path.GetFileNameWithoutExtension(fullPath) + ".excluded.json");
            await File.WriteAllTextAsync(reportPath, JsonSerializer.Serialize(excluded, jsonOpts));
            Console.WriteLine($"{excluded.Count} record(s) excluded total ({excludedDistricts.Count} district, {excludedSchools.Count} campus) — real Zoho data-tagging gaps, not seeded. Details written to {reportPath}");
        }
    }

    // A campus record whose organizationLevel isn't "district"/"campus" at all
    // indicates the upstream export logic changed — that's unexpected enough
    // to abort the whole run rather than guess. An unresolvable parent
    // district, in contrast, is a known real-world Zoho data-tagging gap (see
    // Stage 2 plan) — those are excluded per-row and reported, not aborted on.
    private static void Validate(List<ZohoAccountRecord> records)
    {
        var errors = new List<string>();

        for (var i = 0; i < records.Count; i++)
        {
            var r = records[i];
            if (r.OrganizationLevel is not ("district" or "campus"))
            {
                errors.Add($"Row {i}: zohoAccountId={r.ZohoAccountId} has unexpected organizationLevel '{r.OrganizationLevel}'");
            }
        }

        if (errors.Count > 0)
        {
            throw new InvalidOperationException(
                $"Seed file failed validation with {errors.Count} bad row(s); no changes were made:\n  "
                + string.Join("\n  ", errors));
        }
    }

    private static async Task<(Dictionary<string, SchoolDistrict>, List<ExcludedRecord>)> UpsertDistrictsAsync(
        AppDbContext db, List<ZohoAccountRecord> records, Counts counts)
    {
        var existing = await db.SchoolDistricts
            .Where(d => d.ZohoAccountId != null)
            .ToDictionaryAsync(d => d.ZohoAccountId!);

        var districtsByZohoId = new Dictionary<string, SchoolDistrict>();
        var excluded = new List<ExcludedRecord>();

        foreach (var r in records.Where(r => r.OrganizationLevel == "district"))
        {
            if (existing.TryGetValue(r.ZohoAccountId, out var district))
            {
                if (district.Name != r.AccountName || district.State != r.State)
                {
                    district.Name = r.AccountName;
                    district.State = r.State ?? district.State;
                    counts.Updated++;
                }
                else
                {
                    counts.Unchanged++;
                }

                districtsByZohoId[r.ZohoAccountId] = district;
                continue;
            }

            // A brand-new district with no state at all can't be inserted
            // (State is required) — a real Zoho data gap (e.g. "Severstal
            // NA"), not something to guess at. Exclude and report, same as
            // an unresolvable campus parent below.
            if (r.State is null)
            {
                excluded.Add(new ExcludedRecord("district", r.ZohoAccountId, r.AccountName, null, "no state set in Zoho"));
                continue;
            }

            district = new SchoolDistrict
            {
                ZohoAccountId = r.ZohoAccountId,
                Name = r.AccountName,
                State = r.State
            };
            db.SchoolDistricts.Add(district);
            counts.Inserted++;
            districtsByZohoId[r.ZohoAccountId] = district;
        }

        return (districtsByZohoId, excluded);
    }

    private static async Task<List<ExcludedRecord>> UpsertSchoolsAsync(
        AppDbContext db,
        List<ZohoAccountRecord> records,
        Dictionary<string, Guid> districtIdByZohoId,
        Counts counts)
    {
        var existing = await db.Schools
            .Where(s => s.ZohoAccountId != null)
            .ToDictionaryAsync(s => s.ZohoAccountId!);

        var excluded = new List<ExcludedRecord>();

        foreach (var r in records.Where(r => r.OrganizationLevel == "campus"))
        {
            if (r.ParentZohoAccountId is null)
            {
                excluded.Add(new ExcludedRecord("campus", r.ZohoAccountId, r.AccountName, null, "no parent set in Zoho"));
                continue;
            }

            if (!districtIdByZohoId.TryGetValue(r.ParentZohoAccountId, out var districtId))
            {
                excluded.Add(new ExcludedRecord(
                    "campus", r.ZohoAccountId, r.AccountName, r.ParentZohoAccountId,
                    "parent account is not tagged as a district"));
                continue;
            }

            if (existing.TryGetValue(r.ZohoAccountId, out var school))
            {
                if (school.Name != r.AccountName || school.DistrictId != districtId)
                {
                    school.Name = r.AccountName;
                    school.DistrictId = districtId;
                    counts.Updated++;
                }
                else
                {
                    counts.Unchanged++;
                }
            }
            else
            {
                db.Schools.Add(new School
                {
                    ZohoAccountId = r.ZohoAccountId,
                    Name = r.AccountName,
                    DistrictId = districtId
                });
                counts.Inserted++;
            }
        }

        return excluded;
    }
}

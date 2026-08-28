using System.Text;
using ConferenceLeadGen.Api.Data;
using ConferenceLeadGen.Api.Models;
using ConferenceLeadGen.Api.Models.Enums;
using Microsoft.EntityFrameworkCore;

namespace ConferenceLeadGen.Api.Endpoints;

public record ExportSummary(int ReadyToExport, int NeedsReview, int BlockedOnNewAccount);

public static class ExportEndpoints
{
    public static void MapExportEndpoints(this WebApplication app)
    {
        app.MapGet("/api/export/summary", async (AppDbContext db) =>
        {
            var readyToExport = await db.Contacts.CountAsync(IsReadyToExport());
            var needsReview = await db.Contacts.CountAsync(c => c.ReviewStatus == ReviewStatus.NeedsReview);
            var blockedOnNewAccount = await db.Contacts.CountAsync(
                c => c.ReviewStatus == ReviewStatus.Approved && c.MatchedZohoAccountId == null);

            return Results.Ok(new ExportSummary(readyToExport, needsReview, blockedOnNewAccount));
        });

        app.MapGet("/api/export", async (AppDbContext db) =>
        {
            var contacts = await db.Contacts
                .Include(c => c.Event)
                .Where(IsReadyToExport())
                .OrderBy(c => c.CreatedAt)
                .ToListAsync();

            var csv = new StringBuilder();
            csv.AppendLine("Salutation,First Name,Last Name,Email,Phone,Title,Account Name,Account Id,Lead Source,Description");

            foreach (var c in contacts)
            {
                var description = BuildDescription(c);
                csv.AppendLine(string.Join(",",
                    Csv(""), // Salutation — nothing in this pilot's intake captures it
                    Csv(c.FirstName),
                    Csv(c.LastName),
                    Csv(c.Email ?? ""),
                    Csv(c.Phone ?? ""),
                    Csv(c.Title ?? ""),
                    Csv(c.MatchedZohoAccountName ?? ""),
                    Csv(c.MatchedZohoAccountId ?? ""),
                    Csv(c.Event.Name),
                    Csv(description)));
            }

            var bytes = Encoding.UTF8.GetBytes(csv.ToString());
            return Results.File(bytes, "text/csv", "conference-leads.csv");
        });
    }

    // Approved isn't enough on its own — the CSV's Account Id column needs a
    // real Zoho id to write, so that's the actual inclusion gate. This also
    // naturally covers the doc's "a human later linked a fresh Account" case
    // for what started as new_account, without string-matching MatchStatus.
    private static System.Linq.Expressions.Expression<Func<Contact, bool>> IsReadyToExport() =>
        c => c.ReviewStatus == ReviewStatus.Approved && c.MatchedZohoAccountId != null;

    private static string BuildDescription(Contact c)
    {
        var parts = new List<string>();
        if (c.ExtractionConfidence.HasValue)
        {
            parts.Add($"Extraction confidence: {c.ExtractionConfidence.Value.ToString().ToLowerInvariant()}");
        }
        if (c.MatchConfidence.HasValue)
        {
            parts.Add($"Match confidence: {c.MatchConfidence.Value.ToString().ToLowerInvariant()}");
        }
        if (!string.IsNullOrWhiteSpace(c.Notes))
        {
            parts.Add(c.Notes);
        }
        return string.Join(" — ", parts);
    }

    private static string Csv(string value)
    {
        if (value.Contains(',') || value.Contains('"') || value.Contains('\n'))
        {
            return "\"" + value.Replace("\"", "\"\"") + "\"";
        }
        return value;
    }
}

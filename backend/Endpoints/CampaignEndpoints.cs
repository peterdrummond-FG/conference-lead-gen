using ConferenceLeadGen.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace ConferenceLeadGen.Api.Endpoints;

public record CampaignResponse(string ZohoCampaignId, string Name);

public static class CampaignEndpoints
{
    public static void MapCampaignEndpoints(this WebApplication app)
    {
        // Named /campaigns, not /events (the doc's original placeholder
        // route name) — now that the Zoho Campaign cache is its own entity,
        // separate from an *activated* Event, naming this route after Event
        // would be actively confusing since it never touches that table.
        app.MapGet("/api/campaigns", async (string? search, AppDbContext db) =>
        {
            var query = db.Campaigns.AsQueryable();
            if (!string.IsNullOrWhiteSpace(search))
            {
                query = query.Where(c => EF.Functions.ILike(c.Name, $"%{search}%"));
            }

            var results = await query
                .OrderBy(c => c.Name)
                .Take(20)
                .Select(c => new CampaignResponse(c.ZohoCampaignId, c.Name))
                .ToListAsync();

            return Results.Ok(results);
        });
    }
}

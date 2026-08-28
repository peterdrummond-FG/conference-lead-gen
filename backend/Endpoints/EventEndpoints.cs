using ConferenceLeadGen.Api.Data;
using ConferenceLeadGen.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace ConferenceLeadGen.Api.Endpoints;

// State/City come from the rep, not the Campaign — Zoho's Campaigns module
// has no such fields at all (confirmed against live data), so there's
// nothing to copy from. The person activating the table knows where they
// physically are.
public record ActivateEventRequest(string ZohoCampaignId, string State, string City);
public record EventResponse(Guid Id, string Name, string State, string City, DateTimeOffset ActivatedAt);

public static class EventEndpoints
{
    public static void MapEventEndpoints(this WebApplication app)
    {
        app.MapPost("/api/events", async (ActivateEventRequest req, AppDbContext db) =>
        {
            if (string.IsNullOrWhiteSpace(req.State) || string.IsNullOrWhiteSpace(req.City))
            {
                return Results.BadRequest(new { error = "Both state and city are required to activate an event." });
            }

            var campaign = await db.Campaigns.SingleOrDefaultAsync(c => c.ZohoCampaignId == req.ZohoCampaignId);
            if (campaign is null)
            {
                return Results.NotFound(new { error = $"No cached campaign with zohoCampaignId '{req.ZohoCampaignId}'. Run sync-campaigns if this is a new campaign." });
            }

            await using var transaction = await db.Database.BeginTransactionAsync();

            // Deactivate whatever's currently active first — the partial
            // unique index on IsActive would reject inserting a second true
            // row otherwise. Single-table pilot, so at most one row here.
            var currentlyActive = await db.Events.Where(e => e.IsActive).ToListAsync();
            foreach (var e in currentlyActive) e.IsActive = false;
            await db.SaveChangesAsync();

            var newEvent = new Event
            {
                ZohoCampaignId = campaign.ZohoCampaignId,
                Name = campaign.Name,
                State = req.State,
                City = req.City,
                ActivatedAt = DateTimeOffset.UtcNow,
                IsActive = true
            };
            db.Events.Add(newEvent);
            await db.SaveChangesAsync();

            await transaction.CommitAsync();

            var response = new EventResponse(newEvent.Id, newEvent.Name, newEvent.State, newEvent.City, newEvent.ActivatedAt);
            return Results.Created($"/api/events/{newEvent.Id}", response);
        });

        app.MapGet("/api/events/active", async (AppDbContext db) =>
        {
            var active = await db.Events.SingleOrDefaultAsync(e => e.IsActive);
            if (active is null)
            {
                return Results.NotFound();
            }

            return Results.Ok(new EventResponse(active.Id, active.Name, active.State, active.City, active.ActivatedAt));
        });
    }
}

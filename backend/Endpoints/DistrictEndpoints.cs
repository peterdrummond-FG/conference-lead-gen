using ConferenceLeadGen.Api.Data;
using ConferenceLeadGen.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace ConferenceLeadGen.Api.Endpoints;

public record DistrictOption(Guid Id, string Name);
public record CreateDistrictRequest(string Name, Guid? EventId);
public record DistrictResponse(Guid Id, string Name, string State);

public static class DistrictEndpoints
{
    public static void MapDistrictEndpoints(this WebApplication app)
    {
        app.MapGet("/api/districts", async (string state, string? search, AppDbContext db) =>
        {
            var query = db.SchoolDistricts.Where(d => d.State == state);
            if (!string.IsNullOrWhiteSpace(search))
            {
                query = query.Where(d => EF.Functions.ILike(d.Name, $"%{search}%"));
            }

            var results = await query
                .OrderBy(d => d.Name)
                .Take(20)
                .Select(d => new DistrictOption(d.Id, d.Name))
                .ToListAsync();

            return Results.Ok(results);
        });

        app.MapPost("/api/districts", async (CreateDistrictRequest req, AppDbContext db) =>
        {
            // State is derived from an event, never trusted from the client
            // — same reasoning as POST /api/contacts deriving EventId
            // server-side. Two callers, two ways to identify the event:
            // - The live intake form always means "today's active event"
            //   (EventId omitted).
            // - /review can be correcting a contact from an event that's no
            //   longer active (e.g. a card-photo contact reviewed after the
            //   next event was already activated) — it passes EventId
            //   explicitly so State resolves from *that* event, not
            //   whatever's active right now.
            Event? targetEvent;
            if (req.EventId is { } eventId)
            {
                targetEvent = await db.Events.FindAsync(eventId);
                if (targetEvent is null)
                {
                    return Results.NotFound(new { error = $"No event with id '{eventId}'." });
                }
            }
            else
            {
                targetEvent = await db.Events.SingleOrDefaultAsync(e => e.IsActive);
                if (targetEvent is null)
                {
                    return Results.Conflict(new { error = "No active event. Activate one via POST /api/events first." });
                }
            }

            var district = new SchoolDistrict
            {
                Name = req.Name,
                State = targetEvent.State,
                ZohoAccountId = null
            };
            db.SchoolDistricts.Add(district);
            await db.SaveChangesAsync();

            var response = new DistrictResponse(district.Id, district.Name, district.State);
            return Results.Created($"/api/districts/{district.Id}", response);
        });
    }
}

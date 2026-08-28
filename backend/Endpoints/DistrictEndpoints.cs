using ConferenceLeadGen.Api.Data;
using ConferenceLeadGen.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace ConferenceLeadGen.Api.Endpoints;

public record DistrictOption(Guid Id, string Name);
public record CreateDistrictRequest(string Name);
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
            // State is derived from the active event, never trusted from the
            // client — a district typed in at this event belongs to this
            // event's state, same reasoning as POST /api/contacts deriving
            // EventId server-side rather than accepting a client value.
            var activeEvent = await db.Events.SingleOrDefaultAsync(e => e.IsActive);
            if (activeEvent is null)
            {
                return Results.Conflict(new { error = "No active event. Activate one via POST /api/events first." });
            }

            var district = new SchoolDistrict
            {
                Name = req.Name,
                State = activeEvent.State,
                ZohoAccountId = null
            };
            db.SchoolDistricts.Add(district);
            await db.SaveChangesAsync();

            var response = new DistrictResponse(district.Id, district.Name, district.State);
            return Results.Created($"/api/districts/{district.Id}", response);
        });
    }
}

using ConferenceLeadGen.Api.Data;
using ConferenceLeadGen.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace ConferenceLeadGen.Api.Endpoints;

public record SchoolOption(Guid Id, string Name);
public record CreateSchoolRequest(Guid DistrictId, string Name);
public record SchoolResponse(Guid Id, string Name, Guid DistrictId);

public static class SchoolEndpoints
{
    public static void MapSchoolEndpoints(this WebApplication app)
    {
        app.MapGet("/api/schools", async (Guid districtId, string? search, AppDbContext db) =>
        {
            var query = db.Schools.Where(s => s.DistrictId == districtId);
            if (!string.IsNullOrWhiteSpace(search))
            {
                query = query.Where(s => EF.Functions.ILike(s.Name, $"%{search}%"));
            }

            var results = await query
                .OrderBy(s => s.Name)
                .Take(20)
                .Select(s => new SchoolOption(s.Id, s.Name))
                .ToListAsync();

            return Results.Ok(results);
        });

        app.MapPost("/api/schools", async (CreateSchoolRequest req, AppDbContext db) =>
        {
            var districtExists = await db.SchoolDistricts.AnyAsync(d => d.Id == req.DistrictId);
            if (!districtExists)
            {
                return Results.NotFound(new { error = $"No district with id '{req.DistrictId}'." });
            }

            var school = new School
            {
                DistrictId = req.DistrictId,
                Name = req.Name,
                ZohoAccountId = null
            };
            db.Schools.Add(school);
            await db.SaveChangesAsync();

            var response = new SchoolResponse(school.Id, school.Name, school.DistrictId);
            return Results.Created($"/api/schools/{school.Id}", response);
        });
    }
}

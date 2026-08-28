using ConferenceLeadGen.Api.Data;
using ConferenceLeadGen.Api.Models;
using ConferenceLeadGen.Api.Models.Enums;
using Microsoft.EntityFrameworkCore;

namespace ConferenceLeadGen.Api.Endpoints;

public record CreateContactRequest(
    string FirstName,
    string LastName,
    string? Email,
    string? Phone,
    string? Title,
    Guid SchoolDistrictId,
    Guid? SchoolId);

public record ContactResponse(Guid Id, DateTimeOffset CreatedAt);

public static class ContactEndpoints
{
    public static void MapContactEndpoints(this WebApplication app)
    {
        app.MapPost("/api/contacts", async (CreateContactRequest req, AppDbContext db) =>
        {
            // Server-side backstop for the frontend's own required-field
            // check — a captured lead with no way to reach them isn't
            // useful, so this isn't optional just because a client forgot.
            if (string.IsNullOrWhiteSpace(req.Email) && string.IsNullOrWhiteSpace(req.Phone))
            {
                return Results.BadRequest(new { error = "At least one of email or phone is required." });
            }

            // EventId is resolved server-side, never trusted from the
            // client — a kiosk submission belongs to whichever event this
            // machine currently has active, not whatever a client sends.
            var activeEvent = await db.Events.SingleOrDefaultAsync(e => e.IsActive);
            if (activeEvent is null)
            {
                return Results.Conflict(new { error = "No active event. Activate one via POST /api/events first." });
            }

            var districtExists = await db.SchoolDistricts.AnyAsync(d => d.Id == req.SchoolDistrictId);
            if (!districtExists)
            {
                return Results.NotFound(new { error = $"No district with id '{req.SchoolDistrictId}'." });
            }

            if (req.SchoolId is { } schoolId && !await db.Schools.AnyAsync(s => s.Id == schoolId))
            {
                return Results.NotFound(new { error = $"No school with id '{schoolId}'." });
            }

            var contact = new Contact
            {
                EventId = activeEvent.Id,
                Source = ContactSource.Form,
                FirstName = req.FirstName,
                LastName = req.LastName,
                Email = req.Email,
                Phone = req.Phone,
                Title = req.Title,
                SchoolDistrictId = req.SchoolDistrictId,
                SchoolId = req.SchoolId,
                MatchStatus = MatchStatus.Pending,
                ReviewStatus = ReviewStatus.NeedsReview,
                CreatedAt = DateTimeOffset.UtcNow
            };
            // Deliberately does not invoke research-contact/match-contact —
            // that wiring is a later stage. This row simply sits at Pending.
            db.Contacts.Add(contact);
            await db.SaveChangesAsync();

            var response = new ContactResponse(contact.Id, contact.CreatedAt);
            return Results.Created($"/api/contacts/{contact.Id}", response);
        });
    }
}

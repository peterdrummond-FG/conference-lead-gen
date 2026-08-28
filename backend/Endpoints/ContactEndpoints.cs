using ConferenceLeadGen.Api.Data;
using ConferenceLeadGen.Api.Models;
using ConferenceLeadGen.Api.Models.Enums;
using ConferenceLeadGen.Api.Services;
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

public record ContactListItem(
    Guid Id,
    string FirstName,
    string LastName,
    string? Email,
    string? Phone,
    string? Title,
    string Source,
    string EventName,
    string DistrictName,
    string? SchoolName,
    string? ExtractionConfidence,
    string MatchStatus,
    string? MatchConfidence,
    string? MatchedZohoContactId,
    string? MatchedZohoContactName,
    string? MatchedZohoAccountId,
    string? MatchedZohoAccountName,
    List<CandidateMatch>? CandidateMatches,
    Guid? LocalDuplicateOfContactId,
    string? LocalDuplicateOfContactName,
    string ReviewStatus,
    string? Notes,
    DateTimeOffset CreatedAt);

public record UpdateContactRequest(
    string? FirstName,
    string? LastName,
    string? Email,
    string? Phone,
    string? Title,
    Guid? SchoolDistrictId,
    Guid? SchoolId,
    string? MatchedZohoAccountId,
    string? MatchedZohoAccountName,
    string? MatchedZohoContactId,
    string? MatchedZohoContactName,
    string? MatchStatus,
    string? MatchConfidence,
    string? ReviewStatus);

public record BulkApproveRequest(List<Guid> Ids);
public record BulkApproveResult(List<Guid> Approved, List<BulkApproveSkip> Skipped);
public record BulkApproveSkip(Guid Id, string Reason);

public static class ContactEndpoints
{
    public static void MapContactEndpoints(this WebApplication app)
    {
        app.MapGet("/api/contacts", async (string? reviewStatus, string? matchStatus, AppDbContext db) =>
        {
            var query = db.Contacts
                .Include(c => c.Event)
                .Include(c => c.SchoolDistrict)
                .Include(c => c.School)
                .Include(c => c.LocalDuplicateOfContact)
                .AsQueryable();

            var status = ReviewStatus.NeedsReview;
            if (string.IsNullOrWhiteSpace(reviewStatus) || reviewStatus == "needs_review")
            {
                query = query.Where(c => c.ReviewStatus == status);
            }
            else
            {
                query = query.Where(c => c.ReviewStatus == Data.Converters.ReviewStatusConverter.FromProviderValue(reviewStatus));
            }

            if (!string.IsNullOrWhiteSpace(matchStatus))
            {
                var parsedMatchStatus = Data.Converters.MatchStatusConverter.FromProviderValue(matchStatus);
                query = query.Where(c => c.MatchStatus == parsedMatchStatus);
            }

            // Materialize first, then project — the converter calls below are
            // plain C# static methods, not EF-translatable SQL expressions,
            // so this must run as LINQ-to-Objects over already-fetched rows,
            // not as part of the IQueryable.
            var contacts = await query.OrderBy(c => c.CreatedAt).ToListAsync();

            var results = contacts.Select(c => new ContactListItem(
                c.Id, c.FirstName, c.LastName, c.Email, c.Phone, c.Title,
                Data.Converters.ContactSourceConverter.ToProviderValue(c.Source),
                c.Event.Name, c.SchoolDistrict.Name, c.School?.Name,
                c.ExtractionConfidence.HasValue ? Data.Converters.ConfidenceLevelConverter.ToProviderValue(c.ExtractionConfidence.Value) : null,
                Data.Converters.MatchStatusConverter.ToProviderValue(c.MatchStatus),
                c.MatchConfidence.HasValue ? Data.Converters.ConfidenceLevelConverter.ToProviderValue(c.MatchConfidence.Value) : null,
                c.MatchedZohoContactId, c.MatchedZohoContactName,
                c.MatchedZohoAccountId, c.MatchedZohoAccountName,
                c.CandidateMatches,
                c.LocalDuplicateOfContactId,
                c.LocalDuplicateOfContact != null ? $"{c.LocalDuplicateOfContact.FirstName} {c.LocalDuplicateOfContact.LastName}" : null,
                Data.Converters.ReviewStatusConverter.ToProviderValue(c.ReviewStatus),
                c.Notes,
                c.CreatedAt))
                .ToList();

            return Results.Ok(results);
        });

        app.MapPost("/api/contacts", async (CreateContactRequest req, AppDbContext db, MatchingQueue queue) =>
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

            // Local-only, synchronous, before anything reaches Zoho — cheap
            // enough to do inline, so there's no reason to defer it to the
            // background pipeline the way the Zoho-dependent matching is.
            var duplicateOfId = await DuplicateDetection.FindLocalDuplicateAsync(
                db, activeEvent.Id, req.FirstName, req.LastName, req.SchoolDistrictId);

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
                LocalDuplicateOfContactId = duplicateOfId,
                CreatedAt = DateTimeOffset.UtcNow
            };
            db.Contacts.Add(contact);
            await db.SaveChangesAsync();

            // Kicks off research-contact -> match-contact in the background;
            // the response below returns immediately regardless of how long
            // that takes — the kiosk never waits on Zoho or a web search.
            queue.Enqueue(contact.Id);

            var response = new ContactResponse(contact.Id, contact.CreatedAt);
            return Results.Created($"/api/contacts/{contact.Id}", response);
        });

        app.MapPatch("/api/contacts/{id:guid}", async (Guid id, UpdateContactRequest req, AppDbContext db) =>
        {
            var contact = await db.Contacts.FirstOrDefaultAsync(c => c.Id == id);
            if (contact is null)
            {
                return Results.NotFound(new { error = $"No contact with id '{id}'." });
            }

            // The doc's own rule: a still-Pending row can't reach Approved.
            // Cheap insurance against a stale UI regardless of what the
            // client thinks the row's state is.
            if (req.ReviewStatus == "approved" && contact.MatchStatus == MatchStatus.Pending)
            {
                return Results.BadRequest(new { error = "Cannot approve a contact while MatchStatus is still pending." });
            }

            if (req.SchoolDistrictId is { } districtId && !await db.SchoolDistricts.AnyAsync(d => d.Id == districtId))
            {
                return Results.NotFound(new { error = $"No district with id '{districtId}'." });
            }
            if (req.SchoolId is { } schoolId && !await db.Schools.AnyAsync(s => s.Id == schoolId))
            {
                return Results.NotFound(new { error = $"No school with id '{schoolId}'." });
            }

            if (req.FirstName is not null) contact.FirstName = req.FirstName;
            if (req.LastName is not null) contact.LastName = req.LastName;
            if (req.Email is not null) contact.Email = req.Email;
            if (req.Phone is not null) contact.Phone = req.Phone;
            if (req.Title is not null) contact.Title = req.Title;
            if (req.SchoolDistrictId is { } newDistrictId) contact.SchoolDistrictId = newDistrictId;
            if (req.SchoolId is { } newSchoolId) contact.SchoolId = newSchoolId;
            if (req.MatchedZohoAccountId is not null) contact.MatchedZohoAccountId = req.MatchedZohoAccountId;
            if (req.MatchedZohoAccountName is not null) contact.MatchedZohoAccountName = req.MatchedZohoAccountName;
            if (req.MatchedZohoContactId is not null) contact.MatchedZohoContactId = req.MatchedZohoContactId;
            if (req.MatchedZohoContactName is not null) contact.MatchedZohoContactName = req.MatchedZohoContactName;
            if (req.MatchStatus is not null) contact.MatchStatus = Data.Converters.MatchStatusConverter.FromProviderValue(req.MatchStatus);
            if (req.MatchConfidence is not null) contact.MatchConfidence = Data.Converters.ConfidenceLevelConverter.FromProviderValue(req.MatchConfidence);
            if (req.ReviewStatus is not null) contact.ReviewStatus = Data.Converters.ReviewStatusConverter.FromProviderValue(req.ReviewStatus);

            await db.SaveChangesAsync();
            return Results.Ok(new ContactResponse(contact.Id, contact.CreatedAt));
        });

        app.MapPost("/api/contacts/bulk-approve", async (BulkApproveRequest req, AppDbContext db) =>
        {
            var contacts = await db.Contacts.Where(c => req.Ids.Contains(c.Id)).ToListAsync();
            var approved = new List<Guid>();
            var skipped = new List<BulkApproveSkip>();

            foreach (var id in req.Ids)
            {
                var contact = contacts.FirstOrDefault(c => c.Id == id);
                if (contact is null)
                {
                    skipped.Add(new BulkApproveSkip(id, "not found"));
                    continue;
                }
                if (contact.MatchStatus == MatchStatus.Pending)
                {
                    skipped.Add(new BulkApproveSkip(id, "still pending"));
                    continue;
                }

                contact.ReviewStatus = ReviewStatus.Approved;
                approved.Add(id);
            }

            await db.SaveChangesAsync();
            return Results.Ok(new BulkApproveResult(approved, skipped));
        });
    }
}

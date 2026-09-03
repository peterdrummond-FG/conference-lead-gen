using ConferenceLeadGen.Api.Common;
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
    Guid EventId,
    string EventName,
    string EventState,
    Guid SchoolDistrictId,
    string DistrictName,
    Guid? SchoolId,
    string? SchoolName,
    string? ExtractionConfidence,
    string? ResearchConfidence,
    bool? PersonVerified,
    string MatchStatus,
    string? MatchConfidence,
    string? MatchedZohoContactId,
    string? MatchedZohoContactName,
    string? MatchedZohoContactEmail,
    string? MatchedZohoContactPhone,
    string? MatchedZohoContactTitle,
    string? MatchedZohoAccountId,
    string? MatchedZohoAccountName,
    bool? HasActiveOpportunity,
    string? ActiveOpportunityName,
    List<CandidateMatch>? CandidateMatches,
    Guid? LocalDuplicateOfContactId,
    string? LocalDuplicateOfContactName,
    string ReviewStatus,
    string? Notes,
    bool HasPhoto,
    bool HasCroppedPhoto,
    int MatchAttempts,
    DateTimeOffset? LastMatchAttemptAt,
    DateTimeOffset CreatedAt);

// Optional<T> (backend/Common/Optional.cs) distinguishes "key omitted"
// (leave the field alone — e.g. ReviewPage.vue's single-field PATCHes like
// { reviewStatus: 'approved' }) from "key present with value null" (clear
// it — e.g. ReviewContactCard.vue's full-draft save sending
// schoolId: draft.school?.id ?? null). A plain nullable type can't tell
// those apart, since both bind to the same C# null.
public record UpdateContactRequest(
    Optional<string> FirstName,
    Optional<string> LastName,
    Optional<string?> Email,
    Optional<string?> Phone,
    Optional<string?> Title,
    Optional<Guid> SchoolDistrictId,
    Optional<Guid?> SchoolId,
    Optional<string?> MatchedZohoAccountId,
    Optional<string?> MatchedZohoAccountName,
    Optional<string?> MatchedZohoContactId,
    Optional<string?> MatchedZohoContactName,
    Optional<string?> MatchedZohoContactEmail,
    Optional<string?> MatchedZohoContactPhone,
    Optional<string?> MatchedZohoContactTitle,
    Optional<string> MatchStatus,
    Optional<string?> MatchConfidence,
    Optional<string> ReviewStatus);

public record MergeDuplicatesRequest(
    string FirstName,
    string LastName,
    string? Email,
    string? Phone,
    string? Title,
    Guid SchoolDistrictId,
    Guid? SchoolId,
    List<Guid> DiscardContactIds);

public record BulkApproveRequest(List<Guid> Ids);
public record BulkApproveResult(List<Guid> Approved, List<BulkApproveSkip> Skipped);
public record BulkApproveSkip(Guid Id, string Reason);

public record BulkDeleteRequest(List<Guid> Ids);
public record BulkDeleteResult(List<Guid> Deleted, List<BulkDeleteSkip> Skipped);
public record BulkDeleteSkip(Guid Id, string Reason);

public record CreateContactFromOcrRequest(
    string EventFolderCode,
    string FirstName,
    string LastName,
    string? Email,
    string? Phone,
    string? Title,
    string? DistrictName,
    string? SchoolName,
    string ExtractionConfidence,
    string SourceImageHash,
    string SourceImagePath,
    string? CroppedImagePath = null);

public record CreateContactFromOcrResult(Guid Id, bool AlreadyProcessed, DateTimeOffset CreatedAt);

public static class ContactEndpoints
{
    // Shared by GET /api/contacts and GET /api/contacts/{id}/duplicates —
    // both need the same Contact -> ContactListItem shape, including the
    // converter calls that force LINQ-to-Objects (see the comment at the
    // GET /api/contacts callsite).
    private static ContactListItem ToListItem(Contact c) => new ContactListItem(
        c.Id, c.FirstName, c.LastName, c.Email, c.Phone, c.Title,
        Data.Converters.ContactSourceConverter.ToProviderValue(c.Source),
        c.EventId, c.Event.Name, c.Event.State,
        c.SchoolDistrictId, c.SchoolDistrict.Name,
        c.SchoolId, c.School?.Name,
        c.ExtractionConfidence.HasValue ? Data.Converters.ConfidenceLevelConverter.ToProviderValue(c.ExtractionConfidence.Value) : null,
        c.ResearchConfidence.HasValue ? Data.Converters.ConfidenceLevelConverter.ToProviderValue(c.ResearchConfidence.Value) : null,
        c.PersonVerified,
        Data.Converters.MatchStatusConverter.ToProviderValue(c.MatchStatus),
        c.MatchConfidence.HasValue ? Data.Converters.ConfidenceLevelConverter.ToProviderValue(c.MatchConfidence.Value) : null,
        c.MatchedZohoContactId, c.MatchedZohoContactName,
        c.MatchedZohoContactEmail, c.MatchedZohoContactPhone, c.MatchedZohoContactTitle,
        c.MatchedZohoAccountId, c.MatchedZohoAccountName,
        c.HasActiveOpportunity, c.ActiveOpportunityName,
        c.CandidateMatches,
        c.LocalDuplicateOfContactId,
        c.LocalDuplicateOfContact != null ? $"{c.LocalDuplicateOfContact.FirstName} {c.LocalDuplicateOfContact.LastName}" : null,
        Data.Converters.ReviewStatusConverter.ToProviderValue(c.ReviewStatus),
        c.Notes,
        !string.IsNullOrEmpty(c.SourceImagePath),
        !string.IsNullOrEmpty(c.CroppedImagePath),
        c.MatchAttempts,
        c.LastMatchAttemptAt,
        c.CreatedAt);

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

            // Materialize first, then project — ToListItem's converter calls
            // are plain C# static methods, not EF-translatable SQL
            // expressions, so this must run as LINQ-to-Objects over
            // already-fetched rows, not as part of the IQueryable.
            var contacts = await query.OrderBy(c => c.CreatedAt).ToListAsync();

            var results = contacts.Select(ToListItem).ToList();

            return Results.Ok(results);
        });

        app.MapGet("/api/contacts/{id:guid}/duplicates", async (Guid id, AppDbContext db) =>
        {
            var group = await DuplicateDetection.FindDuplicateGroupAsync(db, id);
            if (group.Count == 0)
            {
                return Results.NotFound(new { error = $"No contact with id '{id}'." });
            }

            return Results.Ok(group.Select(ToListItem).ToList());
        });

        app.MapPost("/api/contacts", async (CreateContactRequest req, AppDbContext db, MatchingQueue queue) =>
        {
            // Server-side backstop for the frontend's own required-field
            // check — a captured lead with no way to reach them isn't
            // useful, so this isn't optional just because a client forgot.
            // (Card-photo submissions, below, deliberately do NOT enforce
            // this — a photographed business card routinely has neither
            // legible, and there's no kiosk user to push back on it.)
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

        app.MapPost("/api/contacts/from-ocr", async (CreateContactFromOcrRequest req, AppDbContext db, MatchingQueue queue) =>
        {
            if (string.IsNullOrWhiteSpace(req.FirstName) || string.IsNullOrWhiteSpace(req.LastName))
            {
                return Results.BadRequest(new { error = "firstName and lastName are required." });
            }

            // Folder code, never a client-trusted EventId — cards are
            // processed after the event, possibly once a different one is
            // already active, so this can't resolve from IsActive the way
            // the form path does; the folder code is the stable identifier
            // instead.
            var targetEvent = await db.Events.SingleOrDefaultAsync(e => e.FolderCode == req.EventFolderCode);
            if (targetEvent is null)
            {
                return Results.NotFound(new { error = $"No event with folder code '{req.EventFolderCode}'." });
            }

            // Per the doc: "a repeat is a no-op, not a duplicate contact."
            // The watcher's own archive-folder check already avoids
            // invoking Claude at all for a re-dropped photo — this is the
            // defense-in-depth layer for when that local check can't be
            // trusted (e.g. the archive was cleared, or something else POSTs
            // the same photo again).
            var existingByHash = await db.Contacts.FirstOrDefaultAsync(c => c.SourceImageHash == req.SourceImageHash);
            if (existingByHash is not null)
            {
                return Results.Ok(new CreateContactFromOcrResult(existingByHash.Id, true, existingByHash.CreatedAt));
            }

            var extractionConfidence = Data.Converters.ConfidenceLevelConverter.FromProviderValue(req.ExtractionConfidence);

            var districtId = await LocalDistrictResolution.ResolveDistrictAsync(db, targetEvent.State, req.DistrictName);
            var schoolId = await LocalDistrictResolution.ResolveSchoolAsync(db, districtId, req.SchoolName);

            var duplicateOfId = await DuplicateDetection.FindLocalDuplicateAsync(
                db, targetEvent.Id, req.FirstName, req.LastName, districtId);

            var contact = new Contact
            {
                EventId = targetEvent.Id,
                Source = ContactSource.CardPhoto,
                FirstName = req.FirstName,
                LastName = req.LastName,
                // Deliberately not enforced here the way POST /api/contacts
                // enforces it — a photographed card routinely has neither
                // legible, and there's no one at a kiosk to push back on it.
                Email = string.IsNullOrWhiteSpace(req.Email) ? null : req.Email,
                Phone = string.IsNullOrWhiteSpace(req.Phone) ? null : req.Phone,
                Title = req.Title,
                SchoolDistrictId = districtId,
                SchoolId = schoolId,
                ExtractionConfidence = extractionConfidence,
                MatchStatus = MatchStatus.Pending,
                ReviewStatus = ReviewStatus.NeedsReview,
                LocalDuplicateOfContactId = duplicateOfId,
                SourceImagePath = req.SourceImagePath,
                SourceImageHash = req.SourceImageHash,
                CroppedImagePath = string.IsNullOrWhiteSpace(req.CroppedImagePath) ? null : req.CroppedImagePath,
                CreatedAt = DateTimeOffset.UtcNow
            };
            db.Contacts.Add(contact);
            await db.SaveChangesAsync();

            // Same MatchingQueue singleton the form path uses — research
            // -contact -> match-contact runs identically regardless of
            // Source. No changes needed to MatchingBackgroundService.
            queue.Enqueue(contact.Id);

            return Results.Created($"/api/contacts/{contact.Id}",
                new CreateContactFromOcrResult(contact.Id, false, contact.CreatedAt));
        });

        app.MapGet("/api/contacts/{id:guid}/photo", async (Guid id, bool? full, AppDbContext db) =>
        {
            var contact = await db.Contacts.FirstOrDefaultAsync(c => c.Id == id);
            if (contact is null || string.IsNullOrEmpty(contact.SourceImagePath))
            {
                return Results.NotFound();
            }

            // A shared multi-card sheet photo has one cropped file per
            // contact — that's the default thumbnail. ?full=true (or no
            // crop yet, e.g. a genuine single-card photo, or a row not yet
            // backfilled) falls back to the original sheet, unchanged from
            // this endpoint's original behavior.
            var imagePath = (full != true && !string.IsNullOrEmpty(contact.CroppedImagePath))
                ? contact.CroppedImagePath
                : contact.SourceImagePath;

            if (!File.Exists(imagePath))
            {
                return Results.NotFound(new { error = "Source image file is missing on disk." });
            }

            var contentType = Path.GetExtension(imagePath).ToLowerInvariant() switch
            {
                ".jpg" or ".jpeg" => "image/jpeg",
                ".png" => "image/png",
                ".heic" or ".heif" => "image/heic", // practically unreachable — HEIC is always converted before archiving
                _ => "application/octet-stream"
            };

            return Results.File(imagePath, contentType);
        });

        app.MapPost("/api/contacts/{id:guid}/retry-match", async (Guid id, AppDbContext db, MatchingQueue queue) =>
        {
            var contact = await db.Contacts.FirstOrDefaultAsync(c => c.Id == id);
            if (contact is null)
            {
                return Results.NotFound(new { error = $"No contact with id '{id}'." });
            }
            if (contact.MatchStatus != MatchStatus.Pending)
            {
                return Results.BadRequest(new { error = "Contact is not pending — nothing to retry." });
            }

            // Works even past MatchingRetryScanner's own auto-retry cap —
            // this is the manual escape hatch for a row it's given up on.
            queue.Enqueue(contact.Id);
            return Results.Ok(new ContactResponse(contact.Id, contact.CreatedAt));
        });

        app.MapPatch("/api/contacts/{id:guid}", async (Guid id, UpdateContactRequest req, AppDbContext db) =>
        {
            var contact = await db.Contacts.FirstOrDefaultAsync(c => c.Id == id);
            if (contact is null)
            {
                return Results.NotFound(new { error = $"No contact with id '{id}'." });
            }

            // These fields have no valid "cleared" state in the domain model
            // (a contact always has a name/matchStatus/reviewStatus) — reject
            // an explicit null rather than silently accepting or ignoring it.
            if (req.FirstName is { HasValue: true, Value: null } ||
                req.LastName is { HasValue: true, Value: null } ||
                req.MatchStatus is { HasValue: true, Value: null } ||
                req.ReviewStatus is { HasValue: true, Value: null })
            {
                return Results.BadRequest(new { error = "firstName, lastName, matchStatus and reviewStatus cannot be explicitly cleared." });
            }

            if (req.SchoolDistrictId.HasValue && req.SchoolDistrictId.Value is { } districtId
                && !await db.SchoolDistricts.AnyAsync(d => d.Id == districtId))
            {
                return Results.NotFound(new { error = $"No district with id '{districtId}'." });
            }
            if (req.SchoolId.HasValue && req.SchoolId.Value is { } schoolId
                && !await db.Schools.AnyAsync(s => s.Id == schoolId))
            {
                return Results.NotFound(new { error = $"No school with id '{schoolId}'." });
            }

            if (req.FirstName.HasValue) contact.FirstName = req.FirstName.Value!;
            if (req.LastName.HasValue) contact.LastName = req.LastName.Value!;
            if (req.Email.HasValue) contact.Email = req.Email.Value;
            if (req.Phone.HasValue) contact.Phone = req.Phone.Value;
            if (req.Title.HasValue) contact.Title = req.Title.Value;
            if (req.SchoolDistrictId.HasValue) contact.SchoolDistrictId = req.SchoolDistrictId.Value;
            if (req.SchoolId.HasValue) contact.SchoolId = req.SchoolId.Value;
            if (req.MatchedZohoAccountId.HasValue) contact.MatchedZohoAccountId = req.MatchedZohoAccountId.Value;
            if (req.MatchedZohoAccountName.HasValue) contact.MatchedZohoAccountName = req.MatchedZohoAccountName.Value;
            if (req.MatchedZohoContactId.HasValue) contact.MatchedZohoContactId = req.MatchedZohoContactId.Value;
            if (req.MatchedZohoContactName.HasValue) contact.MatchedZohoContactName = req.MatchedZohoContactName.Value;
            if (req.MatchedZohoContactEmail.HasValue) contact.MatchedZohoContactEmail = req.MatchedZohoContactEmail.Value;
            if (req.MatchedZohoContactPhone.HasValue) contact.MatchedZohoContactPhone = req.MatchedZohoContactPhone.Value;
            if (req.MatchedZohoContactTitle.HasValue) contact.MatchedZohoContactTitle = req.MatchedZohoContactTitle.Value;
            if (req.MatchStatus.HasValue) contact.MatchStatus = Data.Converters.MatchStatusConverter.FromProviderValue(req.MatchStatus.Value!);
            if (req.MatchConfidence.HasValue) contact.MatchConfidence = req.MatchConfidence.Value is null ? null : Data.Converters.ConfidenceLevelConverter.FromProviderValue(req.MatchConfidence.Value);
            // Any explicit ReviewStatus change here is a human decision (the
            // Approve/Reject buttons, or "Confirm match") — never something
            // merge-duplicates should later treat as safe to auto-undo.
            if (req.ReviewStatus.HasValue)
            {
                contact.ReviewStatus = Data.Converters.ReviewStatusConverter.FromProviderValue(req.ReviewStatus.Value!);
                contact.AutoApproved = false;
            }

            // The doc's own rule: a still-Pending row can't reach Approved.
            // Reads contact.MatchStatus AFTER the assignments above so a
            // single PATCH that both resolves MatchStatus and approves in
            // the same call is judged on its effective value, not whatever
            // was in the DB before this request.
            if (req.ReviewStatus.HasValue && req.ReviewStatus.Value == "approved" && contact.MatchStatus == MatchStatus.Pending)
            {
                return Results.BadRequest(new { error = "Cannot approve a contact while MatchStatus is still pending." });
            }

            await db.SaveChangesAsync();
            return Results.Ok(new ContactResponse(contact.Id, contact.CreatedAt));
        });

        // Resolves a "possible duplicate" group down to one row. The keeper
        // (id) gets the reviewer's edited field values; the rest are soft-
        // rejected (not deleted — same audit-trail rule as the plain Reject
        // button) with a note explaining why. Deliberately leaves the
        // keeper's own match fields untouched — the reviewer resolves
        // duplicates first, then separately confirms/retries the match on
        // whichever row survives.
        app.MapPost("/api/contacts/{id:guid}/merge-duplicates", async (Guid id, MergeDuplicatesRequest req, AppDbContext db) =>
        {
            var group = await DuplicateDetection.FindDuplicateGroupAsync(db, id);
            var keeper = group.FirstOrDefault(c => c.Id == id);
            if (keeper is null)
            {
                return Results.NotFound(new { error = $"No contact with id '{id}'." });
            }

            var groupIds = group.Select(c => c.Id).ToHashSet();
            var badDiscardId = req.DiscardContactIds.FirstOrDefault(discardId => !groupIds.Contains(discardId));
            if (badDiscardId != default)
            {
                return Results.BadRequest(new { error = $"Contact '{badDiscardId}' is not part of this duplicate group." });
            }
            if (req.DiscardContactIds.Contains(id))
            {
                return Results.BadRequest(new { error = "Cannot discard the contact being kept." });
            }

            if (!await db.SchoolDistricts.AnyAsync(d => d.Id == req.SchoolDistrictId))
            {
                return Results.NotFound(new { error = $"No district with id '{req.SchoolDistrictId}'." });
            }
            if (req.SchoolId is { } schoolId && !await db.Schools.AnyAsync(s => s.Id == schoolId))
            {
                return Results.NotFound(new { error = $"No school with id '{schoolId}'." });
            }

            keeper.FirstName = req.FirstName;
            keeper.LastName = req.LastName;
            keeper.Email = req.Email;
            keeper.Phone = req.Phone;
            keeper.Title = req.Title;
            keeper.SchoolDistrictId = req.SchoolDistrictId;
            keeper.SchoolId = req.SchoolId;
            keeper.LocalDuplicateOfContactId = null;

            // The pipeline's own auto-approve rule only ever looks at a
            // contact's own row — it can't know a *later* card will turn out
            // to be a duplicate of this one, so it can approve a contact
            // before the duplicate is ever spotted. That's fine to undo
            // automatically (nothing about resolving the duplicate confirmed
            // the Zoho match). A reviewer's own explicit Approve is never
            // touched here — AutoApproved is false the moment a human sets
            // ReviewStatus themselves.
            if (keeper.ReviewStatus == ReviewStatus.Approved && keeper.AutoApproved)
            {
                keeper.ReviewStatus = ReviewStatus.NeedsReview;
                keeper.AutoApproved = false;
            }

            var discarded = group.Where(c => req.DiscardContactIds.Contains(c.Id)).ToList();
            foreach (var contact in discarded)
            {
                contact.ReviewStatus = ReviewStatus.Rejected;
                var mergeNote = $"Merged as duplicate of {keeper.FirstName} {keeper.LastName}.";
                contact.Notes = string.IsNullOrWhiteSpace(contact.Notes) ? mergeNote : $"{contact.Notes} {mergeNote}";
            }

            await db.SaveChangesAsync();
            return Results.Ok(new ContactResponse(keeper.Id, keeper.CreatedAt));
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
                contact.AutoApproved = false;
                approved.Add(id);
            }

            await db.SaveChangesAsync();
            return Results.Ok(new BulkApproveResult(approved, skipped));
        });

        // Permanently removes rejected rows — a deliberate exception to the
        // usual "rejected rows are kept as an audit trail" rule, for
        // clearing out junk/duplicate OCR entries the reviewer never wants
        // to see again. Scoped to ReviewStatus.Rejected server-side (not
        // just enforced by the UI only showing this on the Rejected tab) so
        // a stale client selection can never delete a live row.
        app.MapPost("/api/contacts/bulk-delete", async (BulkDeleteRequest req, AppDbContext db) =>
        {
            var contacts = await db.Contacts.Where(c => req.Ids.Contains(c.Id)).ToListAsync();
            var deleted = new List<Guid>();
            var skipped = new List<BulkDeleteSkip>();

            foreach (var id in req.Ids)
            {
                var contact = contacts.FirstOrDefault(c => c.Id == id);
                if (contact is null)
                {
                    skipped.Add(new BulkDeleteSkip(id, "not found"));
                    continue;
                }
                if (contact.ReviewStatus != ReviewStatus.Rejected)
                {
                    skipped.Add(new BulkDeleteSkip(id, "not rejected"));
                    continue;
                }

                db.Contacts.Remove(contact);
                deleted.Add(id);
            }

            await db.SaveChangesAsync();
            return Results.Ok(new BulkDeleteResult(deleted, skipped));
        });
    }
}

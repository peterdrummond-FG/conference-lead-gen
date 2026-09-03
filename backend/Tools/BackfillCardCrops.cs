using System.Text.Json;
using ConferenceLeadGen.Api.Data;
using ConferenceLeadGen.Api.Models.Enums;
using ConferenceLeadGen.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace ConferenceLeadGen.Api.Tools;

// One-off backfill for card_photo contacts that predate multi-card support
// in process-cards — they share a whole-sheet SourceImagePath with several
// other contacts and have no CroppedImagePath. Batches by distinct photo
// (not by contact) so the locate-cards skill sees every known contact on a
// sheet in one call, letting it disambiguate similarly-named people on the
// same sheet — something running it once per contact couldn't do.
public static class BackfillCardCrops
{
    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private sealed record ContactSummary(Guid Id, string FirstName, string LastName, string? Email, string? Phone, string? Title);
    private sealed record LocateInput(string PhotoPath, List<ContactSummary> Contacts);
    private sealed record LocateResultItem(string ContactId, string? CroppedImagePath, bool? NotFound);
    private sealed record LocateOutput(List<LocateResultItem> Results);

    public static async Task RunAsync(AppDbContext db, ILogger logger, string repoRoot)
    {
        var photoPaths = await db.Contacts
            .Where(c => c.Source == ContactSource.CardPhoto
                && c.SourceImagePath != null && c.SourceImagePath != ""
                && c.CroppedImagePath == null)
            .Select(c => c.SourceImagePath!)
            .Distinct()
            .ToListAsync();

        if (photoPaths.Count == 0)
        {
            Console.WriteLine("Nothing to backfill — every card-photo contact already has a crop (or has no photo at all).");
            return;
        }

        var placed = 0;
        var unplaced = 0;
        var photosProcessed = 0;

        foreach (var photoPath in photoPaths)
        {
            var contacts = await db.Contacts
                .Where(c => c.Source == ContactSource.CardPhoto && c.SourceImagePath == photoPath && c.CroppedImagePath == null)
                .ToListAsync();

            // A genuine single-card photo — the whole photo already is the
            // card, nothing to crop. Not a failure, just not applicable;
            // leave CroppedImagePath null forever for these, same as a
            // freshly-processed single-card photo today.
            if (contacts.Count <= 1)
            {
                continue;
            }

            if (!File.Exists(photoPath))
            {
                logger.LogWarning("Skipping missing photo file: {Path} ({Count} contacts affected)", photoPath, contacts.Count);
                unplaced += contacts.Count;
                continue;
            }

            var input = new LocateInput(
                photoPath,
                contacts.Select(c => new ContactSummary(c.Id, c.FirstName, c.LastName, c.Email, c.Phone, c.Title)).ToList());

            JsonElement resultElement;
            try
            {
                // A sheet can carry 15+ cards, each needing its own
                // read-and-crop reasoning — well past SkillRunner's default
                // 180s budget (tuned for research-contact/match-contact's
                // much lighter single-contact workload).
                resultElement = await SkillRunner.RunSkillAsync(
                    "locate-cards", input, repoRoot, logger, timeout: TimeSpan.FromMinutes(15));
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "locate-cards failed for {Path}; leaving its {Count} contacts uncropped", photoPath, contacts.Count);
                unplaced += contacts.Count;
                continue;
            }

            var output = JsonSerializer.Deserialize<LocateOutput>(resultElement.GetRawText(), JsonOpts)
                ?? throw new InvalidOperationException("locate-cards output deserialized to null");

            var byId = contacts.ToDictionary(c => c.Id.ToString());
            var placedThisPhoto = 0;

            foreach (var result in output.Results)
            {
                if (!byId.TryGetValue(result.ContactId, out var contact))
                {
                    logger.LogWarning("locate-cards returned an unknown contactId {Id} for {Path}", result.ContactId, photoPath);
                    continue;
                }

                if (result.NotFound == true || string.IsNullOrWhiteSpace(result.CroppedImagePath))
                {
                    unplaced++;
                    continue;
                }

                contact.CroppedImagePath = result.CroppedImagePath;
                placed++;
                placedThisPhoto++;
            }

            // Saved per-photo, not batched at the end — a later photo's
            // failure (or an interrupted run) never loses progress already
            // made on earlier ones. The initial query already re-scopes to
            // exactly what's left undone, so a re-run just picks up where
            // this one stopped.
            await db.SaveChangesAsync();
            photosProcessed++;
            Console.WriteLine($"{Path.GetFileName(photoPath)}: {contacts.Count} contacts, {placedThisPhoto} placed");
        }

        Console.WriteLine($"Backfill complete. Photos processed: {photosProcessed}   Placed: {placed}   Unplaced: {unplaced}");
    }
}

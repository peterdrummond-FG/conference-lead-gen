using ConferenceLeadGen.Api.Data;
using ConferenceLeadGen.Api.Data.Configurations;
using ConferenceLeadGen.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace ConferenceLeadGen.Api.Endpoints;

public record VerifyPinRequest(string Pin);
public record ChangePinRequest(string CurrentPin, string NewPin);

public static class KioskEndpoints
{
    public static void MapKioskEndpoints(this WebApplication app)
    {
        app.MapPost("/api/kiosk/verify-pin", async (VerifyPinRequest req, AppDbContext db) =>
        {
            var settings = await GetOrCreateAsync(db);
            return Results.Ok(new { valid = settings.Pin == req.Pin });
        });

        app.MapPut("/api/kiosk/pin", async (ChangePinRequest req, AppDbContext db) =>
        {
            if (string.IsNullOrWhiteSpace(req.NewPin))
            {
                return Results.BadRequest(new { error = "New PIN can't be empty." });
            }

            var settings = await GetOrCreateAsync(db);
            if (settings.Pin != req.CurrentPin)
            {
                return Results.BadRequest(new { error = "Current PIN is incorrect." });
            }

            settings.Pin = req.NewPin;
            await db.SaveChangesAsync();
            return Results.Ok();
        });
    }

    // The seeded singleton row (see KioskSettingsConfiguration) covers a
    // freshly-migrated database, but falls back to creating it here too in
    // case an older database was migrated before the seed existed.
    private static async Task<KioskSettings> GetOrCreateAsync(AppDbContext db)
    {
        var settings = await db.KioskSettings.SingleOrDefaultAsync();
        if (settings is not null) return settings;

        settings = new KioskSettings { Id = KioskSettingsConfiguration.SingletonId };
        db.KioskSettings.Add(settings);
        await db.SaveChangesAsync();
        return settings;
    }
}

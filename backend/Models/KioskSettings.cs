namespace ConferenceLeadGen.Api.Models;

// Single-row table (Id is always the same fixed Guid — see KioskSettingsConfiguration)
// holding the shared PIN that unlocks the kiosk laptop out of the Intake-only
// screen. There's no per-user auth anywhere else in this pilot app, so this
// intentionally isn't either — it's a shared shop-floor PIN, not a credential.
public class KioskSettings
{
    public Guid Id { get; set; }
    public string Pin { get; set; } = "1234";
}

namespace ConferenceLeadGen.Api.Models;

// A cached Zoho Campaign (Type = conference), synced periodically. Distinct
// from Event, which represents an *activated* local event for the day.
//
// No State/City here: Zoho's Campaigns module has no such fields at all
// (confirmed against live data — all 671 real conference campaigns have
// none, and no related field carries it either). The rep supplies
// State/City directly when activating an Event; see EventEndpoints.cs.
public class Campaign
{
    public Guid Id { get; set; }
    public string ZohoCampaignId { get; set; } = null!;
    public string Name { get; set; } = null!;
    public DateTimeOffset SyncedAt { get; set; }
}

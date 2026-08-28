namespace ConferenceLeadGen.Api.Models;

public class Event
{
    public Guid Id { get; set; }
    public string ZohoCampaignId { get; set; } = null!;
    public string Name { get; set; } = null!;
    public string State { get; set; } = null!;
    public string City { get; set; } = null!;
    public DateTimeOffset ActivatedAt { get; set; }
    public bool IsActive { get; set; }

    // Human-typeable identifier (e.g. "lansing-20260920") a rep can create a
    // Finder subfolder with by hand for the card-photo watcher — resolved
    // server-side from this, never a client-trusted Guid, since cards are
    // processed after the event, possibly once a different one is active.
    public string? FolderCode { get; set; }

    public ICollection<Contact> Contacts { get; set; } = new List<Contact>();
}

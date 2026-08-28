namespace ConferenceLeadGen.Api.Models;

public class Event
{
    public Guid Id { get; set; }
    public string ZohoCampaignId { get; set; } = null!;
    public string Name { get; set; } = null!;
    public string State { get; set; } = null!;
    public string City { get; set; } = null!;
    public DateTimeOffset ActivatedAt { get; set; }

    public ICollection<Contact> Contacts { get; set; } = new List<Contact>();
}

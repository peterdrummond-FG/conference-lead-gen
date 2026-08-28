namespace ConferenceLeadGen.Api.Models;

public class SchoolDistrict
{
    public Guid Id { get; set; }
    public string State { get; set; } = null!;
    public string Name { get; set; } = null!;

    public ICollection<School> Schools { get; set; } = new List<School>();
}

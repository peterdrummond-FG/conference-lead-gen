namespace ConferenceLeadGen.Api.Models;

public class School
{
    public Guid Id { get; set; }
    public Guid DistrictId { get; set; }
    public string Name { get; set; } = null!;

    public SchoolDistrict District { get; set; } = null!;
}

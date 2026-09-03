using ConferenceLeadGen.Api.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ConferenceLeadGen.Api.Data.Configurations;

public class KioskSettingsConfiguration : IEntityTypeConfiguration<KioskSettings>
{
    // Fixed, well-known id — this table only ever has the one row.
    public static readonly Guid SingletonId = Guid.Parse("00000000-0000-0000-0000-000000000001");

    public void Configure(EntityTypeBuilder<KioskSettings> builder)
    {
        builder.Property(s => s.Pin).IsRequired();

        builder.HasData(new KioskSettings { Id = SingletonId, Pin = "1234" });
    }
}

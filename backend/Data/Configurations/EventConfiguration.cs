using ConferenceLeadGen.Api.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ConferenceLeadGen.Api.Data.Configurations;

public class EventConfiguration : IEntityTypeConfiguration<Event>
{
    public void Configure(EntityTypeBuilder<Event> builder)
    {
        builder.Property(e => e.Id)
            .HasDefaultValueSql("gen_random_uuid()")
            .ValueGeneratedOnAdd();

        builder.Property(e => e.ZohoCampaignId).IsRequired();
        builder.Property(e => e.Name).IsRequired();
        builder.Property(e => e.State).IsRequired();
        builder.Property(e => e.City).IsRequired();
    }
}

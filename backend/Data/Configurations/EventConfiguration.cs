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

        // At most one active event at a time, enforced at the DB level, not
        // just in application logic (POST /api/events deactivates the
        // current one before activating the next inside one transaction).
        builder.HasIndex(e => e.IsActive)
            .IsUnique()
            .HasFilter("is_active");

        builder.HasIndex(e => e.FolderCode)
            .IsUnique()
            .HasFilter("folder_code IS NOT NULL");
    }
}

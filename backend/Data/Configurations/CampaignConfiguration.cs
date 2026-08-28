using ConferenceLeadGen.Api.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ConferenceLeadGen.Api.Data.Configurations;

public class CampaignConfiguration : IEntityTypeConfiguration<Campaign>
{
    public void Configure(EntityTypeBuilder<Campaign> builder)
    {
        builder.Property(c => c.Id)
            .HasDefaultValueSql("gen_random_uuid()")
            .ValueGeneratedOnAdd();

        builder.Property(c => c.ZohoCampaignId).IsRequired();
        builder.Property(c => c.Name).IsRequired();

        builder.HasIndex(c => c.ZohoCampaignId).IsUnique();
    }
}

using ConferenceLeadGen.Api.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ConferenceLeadGen.Api.Data.Configurations;

public class SchoolDistrictConfiguration : IEntityTypeConfiguration<SchoolDistrict>
{
    public void Configure(EntityTypeBuilder<SchoolDistrict> builder)
    {
        builder.Property(d => d.Id)
            .HasDefaultValueSql("gen_random_uuid()")
            .ValueGeneratedOnAdd();

        builder.Property(d => d.State).IsRequired();
        builder.Property(d => d.Name).IsRequired();

        // Set only on rows seeded from Zoho; nullable so locally "+ add new"
        // districts (a later stage) are still valid without one.
        builder.HasIndex(d => d.ZohoAccountId)
            .IsUnique()
            .HasFilter("zoho_account_id IS NOT NULL");
    }
}

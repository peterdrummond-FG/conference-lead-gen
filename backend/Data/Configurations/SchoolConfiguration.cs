using ConferenceLeadGen.Api.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ConferenceLeadGen.Api.Data.Configurations;

public class SchoolConfiguration : IEntityTypeConfiguration<School>
{
    public void Configure(EntityTypeBuilder<School> builder)
    {
        builder.Property(s => s.Id)
            .HasDefaultValueSql("gen_random_uuid()")
            .ValueGeneratedOnAdd();

        builder.Property(s => s.Name).IsRequired();

        // Reference data: a district's schools shouldn't vanish just because
        // the district row is deleted by hand — no deletion UI is planned for
        // either (section 3: they only grow via "+ add new"), but fail loudly
        // rather than cascade silently if that ever happens.
        builder.HasOne(s => s.District)
            .WithMany(d => d.Schools)
            .HasForeignKey(s => s.DistrictId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

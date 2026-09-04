using System.Text.Json;
using ConferenceLeadGen.Api.Data.Converters;
using ConferenceLeadGen.Api.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ConferenceLeadGen.Api.Data.Configurations;

public class ContactConfiguration : IEntityTypeConfiguration<Contact>
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public void Configure(EntityTypeBuilder<Contact> builder)
    {
        builder.Property(c => c.Id)
            .HasDefaultValueSql("gen_random_uuid()")
            .ValueGeneratedOnAdd();

        builder.Property(c => c.FirstName).IsRequired();
        builder.Property(c => c.LastName).IsRequired();

        builder.Property(c => c.Source).HasConversion(ContactSourceConverter.Instance);
        builder.Property(c => c.MatchStatus).HasConversion(MatchStatusConverter.Instance);
        builder.Property(c => c.ReviewStatus).HasConversion(ReviewStatusConverter.Instance);

        // Nullable enum properties: EF Core automatically wraps a
        // non-nullable converter with null-handling when applied here.
        builder.Property(c => c.ExtractionConfidence).HasConversion(ConfidenceLevelConverter.Instance);
        builder.Property(c => c.MatchConfidence).HasConversion(ConfidenceLevelConverter.Instance);
        builder.Property(c => c.ResearchConfidence).HasConversion(ConfidenceLevelConverter.Instance);

        // jsonb: on-disk keys use camelCase ({type, zohoId, name, score}) to
        // match the architecture doc's shape, not the C# record's PascalCase
        // property names.
        builder.Property(c => c.CandidateMatches)
            .HasColumnType("jsonb")
            .HasConversion(
                v => JsonSerializer.Serialize(v, JsonOpts),
                v => JsonSerializer.Deserialize<List<CandidateMatch>>(v, JsonOpts))
            .Metadata.SetValueComparer(new ValueComparer<List<CandidateMatch>?>(
                (a, b) => (a ?? new List<CandidateMatch>()).SequenceEqual(b ?? new List<CandidateMatch>()),
                v => (v ?? new List<CandidateMatch>()).Aggregate(0, (hash, x) => HashCode.Combine(hash, x)),
                v => v == null ? null : v.ToList()));

        // jsonb, same rationale as CandidateMatches above. Equality/hashing
        // via the serialized form rather than hand-writing record+list
        // structural comparisons for every property.
        builder.Property(c => c.ResearchFindings)
            .HasColumnType("jsonb")
            .HasConversion(
                v => JsonSerializer.Serialize(v, JsonOpts),
                v => JsonSerializer.Deserialize<ResearchFindings>(v, JsonOpts))
            .Metadata.SetValueComparer(new ValueComparer<ResearchFindings?>(
                (a, b) => JsonSerializer.Serialize(a, JsonOpts) == JsonSerializer.Serialize(b, JsonOpts),
                v => v == null ? 0 : JsonSerializer.Serialize(v, JsonOpts).GetHashCode(),
                v => v));

        // Content hash for card-photo dedup: a re-dropped/re-processed photo
        // is a no-op, not a duplicate contact. Unique only where not null,
        // since form submissions never populate it.
        builder.HasIndex(c => c.SourceImageHash)
            .IsUnique()
            .HasFilter("source_image_hash IS NOT NULL");

        // The most valuable data in the app — never let deleting a parent
        // row silently wipe out the contacts captured under it.
        builder.HasOne(c => c.Event)
            .WithMany(e => e.Contacts)
            .HasForeignKey(c => c.EventId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(c => c.SchoolDistrict)
            .WithMany()
            .HasForeignKey(c => c.SchoolDistrictId)
            .OnDelete(DeleteBehavior.Restrict);

        // Nullable FK: EF Core's default (ClientSetNull) only nulls out for
        // rows already tracked in-memory and is otherwise NO ACTION at the DB
        // level — Restrict, set explicitly, makes the real behavior match
        // what the name implies instead of depending on what's loaded.
        builder.HasOne(c => c.School)
            .WithMany()
            .HasForeignKey(c => c.SchoolId)
            .OnDelete(DeleteBehavior.Restrict);

        // Self-referencing FK: the one place a true null-out is correct — if
        // the contact this row was flagged as a duplicate of gets deleted,
        // clear the pointer rather than blocking the delete. Forward
        // navigation only (for displaying "possible duplicate of [name]" on
        // /review) — no reverse collection; nothing needs "contacts that
        // point at me."
        builder.HasOne(c => c.LocalDuplicateOfContact)
            .WithMany()
            .HasForeignKey(c => c.LocalDuplicateOfContactId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}

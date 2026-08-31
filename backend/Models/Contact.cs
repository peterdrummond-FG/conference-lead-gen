using ConferenceLeadGen.Api.Models.Enums;

namespace ConferenceLeadGen.Api.Models;

public class Contact
{
    public Guid Id { get; set; }

    public Guid EventId { get; set; }
    public Event Event { get; set; } = null!;

    public ContactSource Source { get; set; }

    public string FirstName { get; set; } = null!;
    public string LastName { get; set; } = null!;
    public string? Email { get; set; }
    public string? Phone { get; set; }

    public Guid SchoolDistrictId { get; set; }
    public SchoolDistrict SchoolDistrict { get; set; } = null!;

    public Guid? SchoolId { get; set; }
    public School? School { get; set; }

    public string? Title { get; set; }

    // OCR/research certainty about the field values themselves; null for form entries.
    public ConfidenceLevel? ExtractionConfidence { get; set; }

    public MatchStatus MatchStatus { get; set; } = MatchStatus.Pending;

    // Certainty of the Zoho lookup itself, separate from ExtractionConfidence.
    // Nullable: a `pending` row hasn't been matched yet, so there's nothing to rate.
    public ConfidenceLevel? MatchConfidence { get; set; }

    public string? MatchedZohoContactId { get; set; }
    public string? MatchedZohoContactName { get; set; }
    public string? MatchedZohoAccountId { get; set; }
    public string? MatchedZohoAccountName { get; set; }

    public List<CandidateMatch>? CandidateMatches { get; set; }

    public Guid? LocalDuplicateOfContactId { get; set; }
    public Contact? LocalDuplicateOfContact { get; set; }

    public ReviewStatus ReviewStatus { get; set; } = ReviewStatus.NeedsReview;

    public string? Notes { get; set; }

    public string? SourceImagePath { get; set; }
    public string? SourceImageHash { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    // How many times the matching pipeline has been attempted on this
    // contact, and when the most recent attempt started — drives
    // MatchingRetryScanner's stuck-Pending sweep. Null until the first
    // attempt, so a brand-new row is never mistaken for a stale one.
    public int MatchAttempts { get; set; }
    public DateTimeOffset? LastMatchAttemptAt { get; set; }
}

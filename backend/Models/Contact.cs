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

    // research-contact's own confidence in the institution/person resolution
    // it performed via web search — separate from ExtractionConfidence (OCR)
    // and MatchConfidence (the Zoho lookup). Null until the pipeline has run.
    public ConfidenceLevel? ResearchConfidence { get; set; }

    // Whether research-contact found independent corroboration (a staff
    // directory, news article, etc.) that this person holds the stated title
    // at this institution. Null until the pipeline has run.
    public bool? PersonVerified { get; set; }

    // The rest of research-contact's output beyond ResearchConfidence/
    // PersonVerified: proposed name/district spelling corrections, the
    // central-office-vs-campus determination, and an as-of-dated title
    // finding. Persisted verbatim (even though match-contact only ever sees
    // these in-memory as they flow through) so a correction research found
    // isn't silently lost the way it was before this field existed — see
    // match-contact's Notes for the reviewer-facing summary of the same data.
    public ResearchFindings? ResearchFindings { get; set; }

    public MatchStatus MatchStatus { get; set; } = MatchStatus.Pending;

    // Certainty of the Zoho lookup itself, separate from ExtractionConfidence.
    // Nullable: a `pending` row hasn't been matched yet, so there's nothing to rate.
    public ConfidenceLevel? MatchConfidence { get; set; }

    public string? MatchedZohoContactId { get; set; }
    public string? MatchedZohoContactName { get; set; }
    public string? MatchedZohoContactEmail { get; set; }
    public string? MatchedZohoContactPhone { get; set; }
    public string? MatchedZohoContactTitle { get; set; }
    public string? MatchedZohoAccountId { get; set; }
    public string? MatchedZohoAccountName { get; set; }

    // Whether the matched Account has any Deal not in a Closed-Lost stage.
    // Null = no account matched yet, or not applicable (e.g. new_account).
    public bool? HasActiveOpportunity { get; set; }
    public string? ActiveOpportunityName { get; set; }

    public List<CandidateMatch>? CandidateMatches { get; set; }

    public Guid? LocalDuplicateOfContactId { get; set; }
    public Contact? LocalDuplicateOfContact { get; set; }

    public ReviewStatus ReviewStatus { get; set; } = ReviewStatus.NeedsReview;

    // True only when ReviewStatus became Approved via MatchingBackgroundService's
    // own high-confidence rule, never via a human clicking Approve/bulk-approve —
    // those always clear it. Lets merge-duplicates tell "the pipeline approved
    // this before anyone knew about the duplicate" (safe to undo) apart from
    // "a reviewer deliberately approved it" (never overridden automatically).
    public bool AutoApproved { get; set; }

    public string? Notes { get; set; }

    public string? SourceImagePath { get; set; }
    public string? SourceImageHash { get; set; }

    // A photo can contain several cards laid out together (SourceImagePath
    // then points at the whole sheet, shared across every contact on it) —
    // this is that one contact's own card, cropped out of the sheet by
    // process-cards/locate-cards via `sips`. Null for a genuine single-card
    // photo (the whole photo already is the card, nothing to crop), or a
    // row not yet backfilled.
    public string? CroppedImagePath { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    // How many times the matching pipeline has been attempted on this
    // contact, and when the most recent attempt started — drives
    // MatchingRetryScanner's stuck-Pending sweep. Null until the first
    // attempt, so a brand-new row is never mistaken for a stale one.
    public int MatchAttempts { get; set; }
    public DateTimeOffset? LastMatchAttemptAt { get; set; }
}

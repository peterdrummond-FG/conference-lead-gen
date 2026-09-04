namespace ConferenceLeadGen.Api.Models;

// Structured research-contact output beyond ResearchConfidence/PersonVerified
// (which keep their own typed columns since match-contact and the
// auto-approve rule already key off them). Stored as jsonb on Contact;
// on-disk keys are camelCase to match research-contact's own SKILL.md
// schema, not these PascalCase property names — see ContactConfiguration.
public record ResearchFindings(
    List<string>? AlternateDistrictNames,
    List<string>? AlternateNameSpellings,
    string? NameCorrectionConfidence,
    string? InstitutionLevel,
    string? InstitutionLevelCampusName,
    string? InstitutionLevelConfidence,
    string? InstitutionLevelAsOfDate,
    string? TitleFinding,
    string? TitleFindingConfidence,
    string? TitleFindingAsOfDate,
    string? ResearchNotes
);

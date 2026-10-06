// Output contracts for every skill, enforced before anything is persisted
// (audit A6).
//
// Model output reaches CRM-bound columns: contacts.match_* feeds the Zoho
// export CSV, contacts.interaction_notes feeds the
// review card, and match_confidence='high' used to AUTO-APPROVE a contact for
// export with no human ever seeing it (removed 2026-10-06: reps always confirm; see
// scripts/check-no-auto-confirm.mjs). It still has to be true, because it is
// shown to the person deciding. Before this file, two fields were checked
// (matchStatus !== 'pending', and a Zoho-id regex) and the other ~14 went
// straight through.
//
// Those two checks existed because the failure already happened in production:
// a run whose prose reasoning concluded no account existed emitted structured
// fields claiming a "high confidence" match against a fabricated id ("ase")
// and name ("asdf") anyway. The right lesson from that is not "validate the
// two fields that were wrong that time" — it is "the model's output is an
// untrusted payload, validate the contract".
//
// A validation failure throws inside runSkill, which retries and then leaves
// the row pending for a human. Never fabricate, never half-persist.
import { z } from 'zod';

const confidence = z.enum(['high', 'medium', 'low']);

// Real Zoho record ids in this org are long numeric strings, e.g.
// "3001271000007193584" — the same rule the ad-hoc check enforced, now applied
// to every id-bearing field rather than the two that happened to break once.
const zohoId = z.string().regex(/^\d{15,}$/, 'must be a Zoho record id (15+ digits)');

// Skills are told to emit "" rather than null for absent text; the pipeline
// treats blank as absent. Accept either and normalise to null so downstream
// code has one shape to reason about.
const blankToNull = (max) =>
  z.union([z.string().max(max), z.null()])
    .transform((v) => (v === null || v.trim() === '' ? null : v.trim()))
    .nullable();

export const MatchOutput = z.object({
  // 'pending' is deliberately absent: match-contact's own contract says it
  // must never return it, and a row stuck pending is a silent pipeline stall.
  matchStatus: z.enum(['existing_contact', 'new_contact_existing_account', 'new_account', 'ambiguous']),
  matchConfidence: confidence.nullable().default(null),
  matchedZohoContactId: zohoId.nullable().default(null),
  matchedZohoContactName: blankToNull(300).default(null),
  matchedZohoContactEmail: blankToNull(320).default(null),
  matchedZohoContactPhone: blankToNull(64).default(null),
  matchedZohoContactTitle: blankToNull(300).default(null),
  matchedZohoAccountId: zohoId.nullable().default(null),
  matchedZohoAccountName: blankToNull(300).default(null),
  matchedZohoAccountLevel: z.enum(['district', 'school']).nullable().default(null),
  hasActiveOpportunity: z.boolean().nullable().default(null),
  activeOpportunityName: blankToNull(300).default(null),
  candidateMatches: z
    .array(
      z.object({
        type: z.enum(['account', 'contact']).optional(),
        zohoId: zohoId.optional(),
        name: z.string().max(300).optional(),
        score: z.number().optional(),
        level: z.enum(['district', 'school']).optional(),
      }).passthrough(),
    )
    .max(50)
    .nullable()
    .default(null),
  notes: blankToNull(4000).default(null),
  glanceSummary: blankToNull(400).default(null),
})
  .passthrough()
  // The skill's own documented null-together rules, enforced rather than
  // trusted. An id without a name (or vice versa) is exactly the shape the
  // fabricated-match incident produced.
  .refine((o) => (o.matchedZohoAccountId === null) === (o.matchedZohoAccountName === null), {
    message: 'matchedZohoAccountId and matchedZohoAccountName must be set together or null together',
  })
  .refine((o) => (o.matchedZohoAccountId === null) === (o.matchedZohoAccountLevel === null), {
    message: 'matchedZohoAccountLevel must be set/null together with matchedZohoAccountId',
  })
  .refine((o) => (o.matchedZohoContactId === null) === (o.matchedZohoContactName === null), {
    message: 'matchedZohoContactId and matchedZohoContactName must be set together or null together',
  })
  // Self-contradictions: the classification claims something the fields don't
  // support. Same class of prose-vs-fields disagreement as the incident.
  .refine((o) => o.matchStatus !== 'existing_contact' || o.matchedZohoContactId !== null, {
    message: 'matchStatus=existing_contact requires a matchedZohoContactId',
  })
  .refine((o) => o.matchStatus !== 'new_contact_existing_account' || o.matchedZohoAccountId !== null, {
    message: 'matchStatus=new_contact_existing_account requires a matchedZohoAccountId',
  })
  // The 'high' trap: a 'high' label with no account behind it is a fabrication a
  // reviewer would trust (it used to auto-approve the lead too; nothing does now),
  // so it must be backed by an actual matched account.
  .refine((o) => o.matchConfidence !== 'high' || o.matchedZohoAccountId !== null, {
    message: 'matchConfidence=high requires a matched account — refusing to auto-approve an unmatched contact',
  });

// A school district the research step found for a contact who gave a school and NO
// district (2026-10-06; research-contact SKILL.md step 5b). It is the one thing the
// skill may report about a district, and it never replaces one that was given: the
// caller writes it only if the lead still has no district at write time, and only
// into OUR school_districts when the name matches one (finalize_contact_match).
// Untrusted model output that ends up on a lead a person then confirms, so the whole
// contract is checked, not one field: a real http(s) address as evidence (a page the
// search returned, not something composed), a name with no control characters (it is
// copied into notes and the Zoho CSV), and confidence high or medium only -- "less sure
// than medium" is null, not a low-confidence guess a rep might trust.
const NO_CONTROL_CHARS = /^[^\u0000-\u001f\u007f]+$/;
const ResolvedDistrict = z
  .object({
    name: z.string().trim().min(2).max(200).regex(NO_CONTROL_CHARS, 'must not contain control characters'),
    evidenceUrl: z
      .string()
      .trim()
      .max(500)
      .regex(/^\S+$/, 'must not contain whitespace')
      .refine((u) => {
        try {
          const p = new URL(u);
          return p.protocol === 'https:' || p.protocol === 'http:';
        } catch {
          return false;
        }
      }, 'must be an http(s) address'),
    confidence: z.enum(['high', 'medium']),
  })
  .strict();

export const ResearchOutput = z
  .object({
    firstName: z.string(),
    lastName: z.string(),
    alternateDistrictNames: z.array(z.string().max(300)).max(20).default([]),
    resolvedDistrict: ResolvedDistrict.nullable().default(null),
    alternateNameSpellings: z.array(z.string().max(200)).max(20).default([]),
    nameCorrectionConfidence: confidence.nullable().default(null),
    institutionLevel: z.enum(['central_office', 'specific_campus', 'unknown']).default('unknown'),
    institutionLevelCampusName: blankToNull(300).default(null),
    institutionLevelConfidence: confidence.default('low'),
    institutionLevelAsOfDate: blankToNull(40).default(null),
    titleFinding: blankToNull(300).default(null),
    titleFindingConfidence: confidence.nullable().default(null),
    titleFindingAsOfDate: blankToNull(40).default(null),
    researchConfidence: confidence,
    personVerified: z.boolean(),
    researchNotes: blankToNull(4000).default(null),
  })
  // Every input field is passed through unchanged so match-contact's input is
  // just this skill's output in full — passthrough keeps them.
  .passthrough();

// Same field shape as NoteExtractionOutput.contacts[] below — reused rather
// than invented, since this is the same "extract a contact from raw text"
// judgment, just sourced from a transcript instead of a pasted note.
const ExtractedVoiceMemoContact = z
  .object({
    firstName: z.string().min(1).max(100),
    lastName: z.string().max(100).default(''),
    email: z.string().max(320).default(''),
    phone: z.string().max(40).default(''),
    title: z.string().max(200).default(''),
    districtName: z.string().max(200).default(''),
    schoolName: z.string().max(200).default(''),
    interactionNotes: z.string().max(4000).default(''),
    extractionConfidence: confidence,
  })
  // Backstop behind the SKILL.md sufficiency rule (Step 7): a name alone,
  // with nothing to independently place the person at a school/district or
  // in a role, is exactly the "not enough to stand alone" case the skill is
  // told to leave out — enforced here rather than trusted, same reasoning
  // as every other refine in this file.
  .refine((c) => Boolean(c.title.trim() || c.districtName.trim() || c.schoolName.trim()), {
    message: 'extractedContact requires a title, districtName, or schoolName',
  });

// A person the rep met who matches NO captured contact, returned only when the
// memo did attribute to at least one candidate (SKILL.md Step 8). On
// 2026-09-29 a memo named two people without cards and both vanished, because a
// memo that matched anyone was marked linked and never looked at again. But a
// NAME is not evidence the rep met someone ("he knows Kaitlyn" is a note about
// the lead, not a new lead), so creation needs both a conversation and
// something said about the person. No title/district/school is required: how it
// went, or how interested they were, is enough.
//
// spokeWithRep/detailsStated are z.literal(true), not booleans: the model has to
// assert both, and a person it can't honestly assert them for has no valid
// shape to be returned in. That forces the claim; it can't verify it, which is
// why the refine below also demands a non-empty verbatim span the caller stores.
const UnplacedVoiceMemoContact = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().max(100).default(''),
  email: z.string().max(320).default(''),
  phone: z.string().max(40).default(''),
  title: z.string().max(200).default(''),
  districtName: z.string().max(200).default(''),
  schoolName: z.string().max(200).default(''),
  interactionNotes: z.string().max(4000).default(''),
  spokeWithRep: z.literal(true),
  detailsStated: z.literal(true),
  extractionConfidence: confidence,
}).refine((c) => c.interactionNotes.trim().length > 0, {
  message: 'unplacedContacts needs the verbatim span the rep said about this person',
});

// One memo must not be able to queue unbounded downstream LLM work: every
// contact created enters matching, which is two LLM calls apiece.
export const MAX_UNPLACED_PER_MEMO = 10;

export const AttributionOutput = z.object({
  results: z
    .array(
      z
        .object({
          contactId: z.string().uuid(),
          excerpt: z.string().max(8000).optional(),
          notFound: z.literal(true).optional(),
        })
        .refine((r) => (r.excerpt === undefined) !== (r.notFound === undefined), {
          message: 'each result needs exactly one of excerpt or notFound',
        }),
    )
    .max(200)
    .default([]),
  // Only ever populated when the caller set extractFallbackContact: true and
  // the transcript qualified — see SKILL.md Step 7. Omitted (not null)
  // otherwise.
  extractedContact: ExtractedVoiceMemoContact.optional(),
  unplacedContacts: z.array(UnplacedVoiceMemoContact).max(MAX_UNPLACED_PER_MEMO).default([]),
});

// One paste must not be able to queue unbounded downstream LLM work: every
// contact created enters matchingLoop, which is two `claude -p` calls with
// live web search apiece. notes-submit caps the INPUT at 20k chars; this caps
// the output.
export const MAX_CONTACTS_PER_NOTE = 50;

export const NoteExtractionOutput = z.object({
  contacts: z
    .array(
      z.object({
        firstName: z.string().min(1).max(100),
        // Deliberately allowed to be empty: "talked to Marcus" is still a
        // person worth reviewing — see contacts-from-note.
        lastName: z.string().max(100),
        email: z.string().max(320).default(''),
        phone: z.string().max(40).default(''),
        title: z.string().max(200).default(''),
        districtName: z.string().max(200).default(''),
        schoolName: z.string().max(200).default(''),
        // Written to contacts.interaction_notes, which renders on the review
        // card. Uncapped,
        // this is both a cost multiplier and the most convenient carrier for
        // injected text.
        interactionNotes: z.string().max(4000).default(''),
        extractionConfidence: confidence,
      }),
    )
    .max(
      MAX_CONTACTS_PER_NOTE,
      `a single note may not produce more than ${MAX_CONTACTS_PER_NOTE} contacts — split it into smaller pieces`,
    ),
  skipped: z.array(z.string().max(300)).max(50).default([]),
});

// process-cards used to POST to contacts-from-ocr itself, using the
// service-role key handed to it as a shell env var. It now returns this and
// the caller does the writing (audit A2) -- so a card printed with
// instruction-like text has no credential within reach even in the worst case.
// Added after the 2026-09-21 TN TOSS conference: reps photographing pages of
// a printed attendee directory (several people per page under a shared
// district/county header) got "no legible business card detected" or a
// process-cards timeout on every single photo, because the skill only knew
// how to look for laid-out physical cards. The fields are identical either
// way -- contacts-from-ocr and everything downstream doesn't care -- so this
// is purely a provenance tag (-> contacts.source) letting a reviewer see
// "this came off a roster page, not a card the person handed the rep."
export const CardExtractionSourceType = z.enum(['business_card', 'directory_listing']);

export const CardExtractionOutput = z
  .object({
    status: z.enum(['ok', 'no_card_detected']),
    sourceImageHash: z.string().max(200).optional(),
    sourceType: CardExtractionSourceType.default('business_card'),
    cards: z
      .array(
        z.object({
          // Reading-order index, 1-based. Load-bearing: it is what makes the
          // per-card sourceImageHash suffix deterministic, which is what makes
          // a retry of a partially-failed photo dedup correctly instead of
          // creating duplicates. See process-cards SKILL.md Step 4.
          index: z.number().int().min(1).max(50),
          firstName: z.string().min(1).max(100),
          lastName: z.string().min(1).max(100),
          email: z.string().max(320).default(''),
          phone: z.string().max(40).default(''),
          title: z.string().max(200).default(''),
          districtName: z.string().max(200).default(''),
          schoolName: z.string().max(200).default(''),
          extractionConfidence: confidence,
          // Basename only -- the caller derives the Storage key. A path
          // separator here would let the model choose where the crop lands.
          cropFileName: z
            .string()
            .max(200)
            .regex(/^[A-Za-z0-9._-]+$/, 'must be a bare filename, no path separators')
            .nullable()
            .default(null),
        }),
      )
      .max(50),
  })
  .refine((o) => o.status === 'no_card_detected' || o.cards.length > 0, {
    message: 'status=ok requires at least one card',
  });

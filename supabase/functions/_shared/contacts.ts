// Shared helpers for every contacts-* Edge Function — direct ports of
// ContactEndpoints.cs's ToListItem, DuplicateDetection.cs, and
// LocalDistrictResolution.cs.

// No embed for local_duplicate_of_contact_id: PostgREST can't disambiguate
// a self-referencing FK's direction from a column-name hint alone — it
// resolved `contacts!local_duplicate_of_contact_id(...)` as the *reverse*
// (one-to-many, "who points at me") relationship, always empty for a
// leaf row, not the forward (many-to-one, "who I point at") lookup this
// needs. Confirmed via a throwaway debug function rather than assumed.
// A plain follow-up query (attachDuplicateNames below) sidesteps the
// ambiguity entirely.
export const CONTACT_SELECT =
  "*, event:events(name), school_district:school_districts(name), school:schools(name)";

// deno-lint-ignore no-explicit-any
export function toListItem(c: any, duplicateNames?: Record<string, DuplicateContext>) {
  return {
    id: c.id,
    firstName: c.first_name,
    lastName: c.last_name,
    email: c.email,
    phone: c.phone,
    title: c.title,
    source: c.source,
    eventId: c.event_id,
    eventName: c.event?.name ?? null,
    state: c.state ?? null,
    schoolDistrictId: c.school_district_id,
    districtName: c.school_district?.name ?? null,
    schoolDistrictNameRaw: c.school_district_name_raw ?? null,
    schoolId: c.school_id,
    schoolName: c.school?.name ?? null,
    schoolNameRaw: c.school_name_raw ?? null,
    extractionConfidence: c.extraction_confidence,
    researchConfidence: c.research_confidence,
    personVerified: c.person_verified,
    matchStatus: c.match_status,
    matchConfidence: c.match_confidence,
    matchedZohoContactId: c.matched_zoho_contact_id,
    matchedZohoContactName: c.matched_zoho_contact_name,
    matchedZohoContactEmail: c.matched_zoho_contact_email,
    matchedZohoContactPhone: c.matched_zoho_contact_phone,
    matchedZohoContactTitle: c.matched_zoho_contact_title,
    matchedZohoAccountId: c.matched_zoho_account_id,
    matchedZohoAccountName: c.matched_zoho_account_name,
    matchedZohoAccountLevel: c.matched_zoho_account_level,
    hasActiveOpportunity: c.has_active_opportunity,
    activeOpportunityName: c.active_opportunity_name,
    candidateMatches: c.candidate_matches,
    localDuplicateOfContactId: c.local_duplicate_of_contact_id,
    localDuplicateOfContactName: c.local_duplicate_of_contact_id
      ? duplicateNames?.[c.local_duplicate_of_contact_id]?.name ?? null
      : null,
    localDuplicateOfContactContext: c.local_duplicate_of_contact_id
      ? duplicateNames?.[c.local_duplicate_of_contact_id]?.context ?? null
      : null,
    reviewStatus: c.review_status,
    notes: c.notes,
    interactionNotes: c.interaction_notes ?? null,
    hasPhoto: !!c.source_image_path,
    hasCroppedPhoto: !!c.cropped_image_path,
    matchAttempts: c.match_attempts,
    lastMatchAttemptAt: c.last_match_attempt_at,
    createdAt: c.created_at,
  };
}

export interface DuplicateContext {
  name: string;
  context: string;
}

// deno-lint-ignore no-explicit-any
export async function attachDuplicateNames(supabase: any, rows: any[]): Promise<Record<string, DuplicateContext>> {
  const ids = [...new Set(rows.map((r) => r.local_duplicate_of_contact_id).filter(Boolean))];
  if (ids.length === 0) return {};

  const { data, error } = await supabase
    .from("contacts")
    .select("id, first_name, last_name, state, school_district:school_districts(name), school_district_name_raw, event:events(name)")
    .in("id", ids);
  if (error) throw error;

  const map: Record<string, DuplicateContext> = {};
  for (const d of data ?? []) {
    const district = d.school_district?.name ?? d.school_district_name_raw ?? "no district on file";
    const event = d.event?.name ?? "unknown event";
    const state = d.state ?? "unknown state";
    map[d.id] = { name: `${d.first_name} ${d.last_name}`, context: `${district} · ${event} (${state})` };
  }
  return map;
}

export interface DistrictResolution {
  id: string | null;
  state: string | null;
  raw: string | null;
}

// Card photos have no reliable state of their own (OCR doesn't extract one —
// see process-cards's SKILL.md), so conferenceState (the event's "conference
// location", a soft fallback signal, not a filter) is tried first as a
// disambiguator, then an unscoped name match, in case two states happen to
// share an identically-named district. A typed name that doesn't resolve to
// exactly one district is kept as plain text (raw) rather than guessed at or
// inserted as a new row — that insert-on-miss behavior (including the old
// "(none provided on card)" placeholder) is what created the free-text junk
// this schema replaced.
// deno-lint-ignore no-explicit-any
export async function resolveDistrict(
  supabase: any,
  conferenceState: string | null,
  districtNameRaw: string | null | undefined,
): Promise<DistrictResolution> {
  const name = districtNameRaw?.trim();
  if (!name) return { id: null, state: null, raw: null };

  if (conferenceState) {
    const { data: scoped } = await supabase
      .from("school_districts")
      .select("id, state")
      .eq("state", conferenceState)
      .ilike("name", name)
      .maybeSingle();
    if (scoped) return { id: scoped.id, state: scoped.state, raw: null };
  }

  const { data: matches } = await supabase
    .from("school_districts")
    .select("id, state")
    .ilike("name", name);
  if (matches?.length === 1) return { id: matches[0].id, state: matches[0].state, raw: null };

  return { id: null, state: null, raw: name };
}

// Port of DuplicateDetection.FindDuplicateGroupAsync — widens a single
// contact back out to its full duplicate group: itself, whatever it points
// at via local_duplicate_of_contact_id, and every other contact pointing
// at either of those two ids (a third scan of the same badge can end up
// pointing at either the original or an already-flagged duplicate of it).
// deno-lint-ignore no-explicit-any
export async function findDuplicateGroup(supabase: any, contactId: string) {
  const { data: contact, error } = await supabase
    .from("contacts")
    .select("id, local_duplicate_of_contact_id")
    .eq("id", contactId)
    .maybeSingle();
  if (error) throw error;
  if (!contact) return [];

  const anchorIds = [contact.id, ...(contact.local_duplicate_of_contact_id ? [contact.local_duplicate_of_contact_id] : [])];

  const { data: group, error: groupError } = await supabase
    .from("contacts")
    .select(CONTACT_SELECT)
    .or(`id.in.(${anchorIds.join(",")}),local_duplicate_of_contact_id.in.(${anchorIds.join(",")})`)
    .order("created_at");
  if (groupError) throw groupError;
  return group ?? [];
}

export interface SchoolResolution {
  id: string | null;
  raw: string | null;
}

// deno-lint-ignore no-explicit-any
export async function resolveSchool(
  supabase: any,
  districtId: string,
  schoolNameRaw: string | null | undefined,
): Promise<SchoolResolution> {
  const name = schoolNameRaw?.trim();
  if (!name) return { id: null, raw: null };
  const { data: existing } = await supabase
    .from("schools")
    .select("id")
    .eq("district_id", districtId)
    .ilike("name", name)
    .maybeSingle();
  if (existing) return { id: existing.id, raw: null };
  return { id: null, raw: name };
}

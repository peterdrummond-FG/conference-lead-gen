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
  "*, event:events(name,state), school_district:school_districts(name), school:schools(name)";

// deno-lint-ignore no-explicit-any
export function toListItem(c: any, duplicateNames?: Record<string, string>) {
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
    eventState: c.event?.state ?? null,
    schoolDistrictId: c.school_district_id,
    districtName: c.school_district?.name ?? null,
    schoolId: c.school_id,
    schoolName: c.school?.name ?? null,
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
    hasActiveOpportunity: c.has_active_opportunity,
    activeOpportunityName: c.active_opportunity_name,
    candidateMatches: c.candidate_matches,
    localDuplicateOfContactId: c.local_duplicate_of_contact_id,
    localDuplicateOfContactName: c.local_duplicate_of_contact_id
      ? duplicateNames?.[c.local_duplicate_of_contact_id] ?? null
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

// deno-lint-ignore no-explicit-any
export async function attachDuplicateNames(supabase: any, rows: any[]): Promise<Record<string, string>> {
  const ids = [...new Set(rows.map((r) => r.local_duplicate_of_contact_id).filter(Boolean))];
  if (ids.length === 0) return {};

  const { data, error } = await supabase.from("contacts").select("id, first_name, last_name").in("id", ids);
  if (error) throw error;

  const map: Record<string, string> = {};
  for (const d of data ?? []) map[d.id] = `${d.first_name} ${d.last_name}`;
  return map;
}

// deno-lint-ignore no-explicit-any
export async function findLocalDuplicate(
  supabase: any,
  eventId: string,
  firstName: string,
  lastName: string,
  districtId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("contacts")
    .select("id")
    .eq("event_id", eventId)
    .eq("school_district_id", districtId)
    .ilike("first_name", firstName.trim())
    .ilike("last_name", lastName.trim())
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

const NO_DISTRICT_PLACEHOLDER = "(none provided on card)";

// deno-lint-ignore no-explicit-any
export async function resolveDistrict(
  supabase: any,
  state: string,
  districtNameRaw: string | null | undefined,
): Promise<string> {
  const name = districtNameRaw?.trim() || NO_DISTRICT_PLACEHOLDER;
  const { data: existing } = await supabase
    .from("school_districts")
    .select("id")
    .eq("state", state)
    .ilike("name", name)
    .maybeSingle();
  if (existing) return existing.id;

  const { data, error } = await supabase
    .from("school_districts")
    .insert({ name, state })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
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

// deno-lint-ignore no-explicit-any
export async function resolveSchool(
  supabase: any,
  districtId: string,
  schoolNameRaw: string | null | undefined,
): Promise<string | null> {
  if (!schoolNameRaw?.trim()) return null;
  const name = schoolNameRaw.trim();
  const { data: existing } = await supabase
    .from("schools")
    .select("id")
    .eq("district_id", districtId)
    .ilike("name", name)
    .maybeSingle();
  if (existing) return existing.id;

  const { data, error } = await supabase
    .from("schools")
    .insert({ name, district_id: districtId })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

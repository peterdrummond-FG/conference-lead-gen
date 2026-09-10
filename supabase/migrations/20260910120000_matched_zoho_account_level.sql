-- Adds the matched Zoho Account's org level (district vs. school) alongside
-- its id/name. Without this, the review UI's "existing school" vs "existing
-- district" wording was guessed from the CONTACT's own school field, unrelated
-- to what was actually matched -- a school-level match could be labeled
-- "existing district" and vice versa. match-contact already determines this
-- (it queries Accounts by Organization_Level) -- this just gives it somewhere
-- to persist that answer.
alter table public.contacts add column matched_zoho_account_level text;

drop function if exists public.finalize_contact_match(
  uuid, text, text, text, text, text, text, text, text, text, boolean, text, jsonb, text, text, boolean, boolean
);

create function public.finalize_contact_match(
  p_contact_id uuid,
  p_match_status text,
  p_match_confidence text,
  p_matched_zoho_contact_id text,
  p_matched_zoho_contact_name text,
  p_matched_zoho_contact_email text,
  p_matched_zoho_contact_phone text,
  p_matched_zoho_contact_title text,
  p_matched_zoho_account_id text,
  p_matched_zoho_account_name text,
  p_matched_zoho_account_level text,
  p_has_active_opportunity boolean,
  p_active_opportunity_name text,
  p_candidate_matches jsonb,
  p_notes text,
  p_research_confidence text,
  p_person_verified boolean,
  p_extraction_ok boolean
) returns public.contacts
language sql
set search_path = public
as $$
  update public.contacts
  set research_confidence = p_research_confidence,
      person_verified = p_person_verified,
      match_status = p_match_status,
      match_confidence = p_match_confidence,
      matched_zoho_contact_id = p_matched_zoho_contact_id,
      matched_zoho_contact_name = p_matched_zoho_contact_name,
      matched_zoho_contact_email = p_matched_zoho_contact_email,
      matched_zoho_contact_phone = p_matched_zoho_contact_phone,
      matched_zoho_contact_title = p_matched_zoho_contact_title,
      matched_zoho_account_id = p_matched_zoho_account_id,
      matched_zoho_account_name = p_matched_zoho_account_name,
      matched_zoho_account_level = p_matched_zoho_account_level,
      has_active_opportunity = p_has_active_opportunity,
      active_opportunity_name = p_active_opportunity_name,
      candidate_matches = p_candidate_matches,
      notes = p_notes,
      review_status = case
        when review_status = 'needs_review'
          and local_duplicate_of_contact_id is null
          and p_match_confidence = 'high'
          and p_extraction_ok
        then 'approved'
        else review_status
      end,
      auto_approved = case
        when review_status = 'needs_review'
          and local_duplicate_of_contact_id is null
          and p_match_confidence = 'high'
          and p_extraction_ok
        then true
        else auto_approved
      end
  where id = p_contact_id
  returning *;
$$;

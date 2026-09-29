-- APPLIED 2026-09-25 at n8n cutover.
--
-- finalize_contact_match wrote a match result onto the contact regardless of
-- what had happened to the row since it was claimed. research-contact and
-- match-contact can each take minutes, and a reviewer can set match_status by
-- hand in that window (contacts-patch) -- the result then silently overwrote
-- the reviewer's decision. The auto-approve CASE already re-read review_status
-- at write time; match_status itself was never re-asserted.
--
-- The only callers (local-agent processContact and n8n pipeline-match-contact)
-- call this straight after claiming a 'pending' row, so requiring 'pending'
-- here changes nothing for a normal run. A run that lost the row to a human
-- now writes nothing: the function returns an all-null row (RETURNS contacts,
-- zero rows matched), which callers treat as "superseded", not as an error.
--
-- Everything else is byte-for-byte the live definition (pg_get_functiondef,
-- 2026-09-25), i.e. 20260923180000_finalize_contact_match_account_level_and_glance_summary.sql.
create or replace function public.finalize_contact_match(
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
  p_glance_summary text,
  p_research_confidence text,
  p_person_verified boolean,
  p_extraction_ok boolean
)
returns public.contacts
language sql
set search_path to 'public'
as $function$
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
      glance_summary = p_glance_summary,
      review_status = case
        when review_status = 'needs_review'
          and local_duplicate_of_contact_id is null
          and p_match_confidence = 'high'
          and p_extraction_ok
          and p_matched_zoho_account_id is not null
          and coalesce(p_research_confidence, 'low') <> 'low'
        then 'approved'
        else review_status
      end,
      auto_approved = case
        when review_status = 'needs_review'
          and local_duplicate_of_contact_id is null
          and p_match_confidence = 'high'
          and p_extraction_ok
          and p_matched_zoho_account_id is not null
          and coalesce(p_research_confidence, 'low') <> 'low'
        then true
        else auto_approved
      end
  where id = p_contact_id
    and match_status = 'pending'
  returning *;
$function$;

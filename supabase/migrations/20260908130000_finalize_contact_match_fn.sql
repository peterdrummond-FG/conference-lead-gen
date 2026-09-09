-- Closes a race between local-agent's matchingLoop (which can take several
-- minutes per contact across two `claude -p` calls) and a reviewer acting on
-- the same contact in /review while that run is still in flight. The old
-- approach (agent.mjs reading review_status once at claim time, then doing a
-- plain UPDATE at the end with no WHERE guard) could silently overwrite a
-- reviewer's manual rejection with an auto-approve. Folding the whole
-- decision into one UPDATE means review_status/local_duplicate_of_contact_id
-- are read at write time, atomically, from the same row being written --
-- there is no window for a concurrent write to be missed.
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
  p_has_active_opportunity boolean,
  p_active_opportunity_name text,
  p_candidate_matches jsonb,
  p_notes text,
  p_research_confidence text,
  p_person_verified boolean,
  p_extraction_ok boolean
) returns public.contacts
language sql
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

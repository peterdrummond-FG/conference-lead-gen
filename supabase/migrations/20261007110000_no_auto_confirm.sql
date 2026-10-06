-- Nothing is ever auto-confirmed (decision: Peter, 2026-10-06).
--
-- finalize_contact_match used to set review_status = 'approved' (and
-- auto_approved = true) when a match came back high-confidence with a real Zoho
-- account, research wasn't low, extraction was fine and there was no possible
-- duplicate (migrations 20260915060514_auto_approve_requires_matched_account,
-- ...20260923180000, ...20260925221637). Such a lead reached the Zoho export with
-- no person ever looking at it, resting on model output (docs/ENGINEERING-LESSONS.md
-- 2: a run once emitted a fabricated account id beside a "high" confidence).
-- Reps always confirm now. A match result leaves the lead in needs_review, and the
-- ONLY writers of 'approved' are human actions: a lead's Confirm (contacts-patch),
-- "Confirm all N" (contacts-bulk-approve), and Undo/restore. scripts/check-no-auto-confirm.mjs
-- fails CI if anything else starts writing it.
--
-- Same signature as before on purpose, so the n8n pipeline and local-agent keep
-- calling it unchanged and nothing needs redeploying with this: p_extraction_ok and
-- p_research_confidence are still accepted (research_confidence is still stored)
-- but p_extraction_ok no longer decides anything. Everything else is the live
-- definition (pg_get_functiondef, 2026-10-06): the match fields, glance_summary,
-- and the pending guard, so a run that lost the row to a reviewer's edit writes
-- nothing and returns an all-null row ("superseded", not an error).
--
-- Leads already approved are left as they are. auto_approved stays as a column
-- (history; contacts-patch and contacts-bulk-approve still clear it) but can no
-- longer be true: the constraint below makes "something auto-confirmed this" a
-- runtime error rather than a promise. No row has it true today (checked
-- 2026-10-06), which is why the constraint can be added without touching data.
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
      glance_summary = p_glance_summary
  where id = p_contact_id
    and match_status = 'pending'
  returning *;
$function$;

alter table public.contacts
  add constraint contacts_never_auto_approved check (auto_approved is not true);

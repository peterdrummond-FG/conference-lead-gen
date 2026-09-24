-- Backfills migration history for finalize_contact_match(), found stale
-- while building the n8n migration's Stage 5 (match-contact pipeline): the
-- committed 20260908130000_finalize_contact_match_fn.sql migration does NOT
-- match the live function. Confirmed via pg_get_functiondef against the live
-- project (yrvppufkerbjpvrxniot). This is the same class of gap Stage 0's
-- backfill migration closed for five other functions -- this one is more
-- consequential, since the thing that drifted is the auto-approve guard on
-- the single field this project's one documented production incident (the
-- fabricated Zoho match id) is about.
--
-- Two real differences from the committed file, both already live:
--
-- 1. Two parameters the committed file is simply missing:
--    p_matched_zoho_account_level and p_glance_summary. Both are actually
--    passed by local-agent/agent.mjs's processContact today (see
--    matched_zoho_account_level's own migration,
--    20260910120000_matched_zoho_account_level.sql, and glance_summary's,
--    20260910130000_glance_summary.sql -- both landed after
--    finalize_contact_match_fn.sql but evidently never got a matching
--    CREATE OR REPLACE committed alongside them).
--
-- 2. The auto-approve CASE condition has two additional guards live that
--    the committed file does not have:
--      and p_matched_zoho_account_id is not null
--      and coalesce(p_research_confidence, 'low') <> 'low'
--    Both make auto-approve STRICTER than what's committed, not looser --
--    this is a real, currently-enforced safety improvement (never
--    auto-approve a match with no matched account at all, and never
--    auto-approve when research-contact itself had low confidence) that the
--    repo's own migration history simply never recorded. Whoever added it
--    did so directly against the live project rather than through a
--    committed migration -- exactly the "prose is not a control, and
--    neither is an unrecorded change" gap this project's own conventions
--    exist to prevent. This migration closes that gap by recording what is
--    already true in production, not by changing behavior.
--
-- Applying this migration is a no-op against current behavior -- every
-- clause below is byte-for-byte what's already deployed.
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
  returning *;
$function$;

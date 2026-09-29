-- Two writes the n8n rebuild (see n8n/README.md) needs that PostgREST can't
-- express safely on its own. Both used to be guarded by putting the contact's
-- full interaction_notes into the request URL as an `eq.` filter ("only write
-- if the notes are still exactly what I read"). That works at normal sizes but
-- turns into a 414 -- a failed write -- once a contact's notes grow long, and
-- appended voice-memo excerpts only ever make them longer. Here the notes
-- travel in the request body and the comparison happens in the database.
--
-- Nothing calls these yet: local-agent keeps its own writes until cutover, so
-- applying this ahead of the n8n pipelines changes no current behavior.

-- Appends one voice-memo excerpt to a contact's notes, atomically and
-- idempotently. Replaces a read-modify-write (read notes, concatenate, write
-- back guarded on the old value) that could lose a reviewer's concurrent edit
-- or fail on length; a single UPDATE can do neither. An excerpt already present
-- is left alone, so a retried attribution never duplicates text -- and the row
-- is not rewritten at all in that case, so the no-op fires no triggers.
--
-- Returns the contact (id only is needed) whether or not it changed, so the
-- caller can tell "already attached" (a row) from "no such contact" (nothing).
create or replace function public.append_contact_interaction_notes(
  p_contact_id uuid,
  p_excerpt text
)
returns setof public.contacts
language plpgsql
set search_path to 'public'
as $function$
begin
  -- Same bound as attribution.schema.json's excerpt maxLength. The schema is
  -- the first check; this is the one that holds if a caller skips it.
  if p_excerpt is null or length(btrim(p_excerpt)) = 0 or length(p_excerpt) > 8000 then
    raise exception 'append_contact_interaction_notes: excerpt must be 1-8000 characters';
  end if;

  return query
    update public.contacts
    set interaction_notes = case
          when coalesce(interaction_notes, '') = '' then p_excerpt
          else interaction_notes || E'\n\n' || p_excerpt
        end
    where id = p_contact_id
      and (interaction_notes is null or strpos(interaction_notes, p_excerpt) = 0)
    returning *;

  if not found then
    return query select * from public.contacts where id = p_contact_id;
  end if;
end;
$function$;

-- Writes a classify-contact-intent result only if it is still current: no
-- reviewer has set intent by hand, and interaction_notes is still exactly the
-- text that was classified. Either changing mid-flight turns this into a
-- no-op (zero rows), and a duplicate run writes the same value.
create or replace function public.set_contact_intent_if_current(
  p_contact_id uuid,
  p_contact_intent text,
  p_classified_notes text
)
returns setof public.contacts
language sql
set search_path to 'public'
as $function$
  update public.contacts
  set contact_intent = p_contact_intent,
      contact_intent_classified_notes = p_classified_notes
  where id = p_contact_id
    and contact_intent_is_manual = false
    and interaction_notes = p_classified_notes
  returning *;
$function$;

-- Service role only. This project's default privileges grant EXECUTE on new
-- public functions to anon and authenticated, and revoking from PUBLIC doesn't
-- cover them (see 20260914190100_restrict_verify_cron_secret_execute.sql).
revoke execute on function public.append_contact_interaction_notes(uuid, text) from public, anon, authenticated;
revoke execute on function public.set_contact_intent_if_current(uuid, text, text) from public, anon, authenticated;

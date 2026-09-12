-- Atomically selects the exportable contacts (approved + matched to a real
-- Zoho account + not already synced) and marks them synced_at = now() in
-- one statement, returning just their ids -- export-csv re-selects those
-- exact ids (with the event:events(name) embed it needs for the CSV) right
-- after, so the same request that builds the CSV is guaranteed to be
-- exactly the set that just got marked. The `for update` lock means two
-- concurrent export clicks can't both grab and mark the same rows.
create or replace function public.export_and_mark_synced()
returns setof uuid
language plpgsql
set search_path = public
as $$
begin
  return query
  with to_sync as (
    select id
    from public.contacts
    where review_status = 'approved'
      and matched_zoho_account_id is not null
      and synced_at is null
    for update
  )
  update public.contacts c
  set synced_at = now()
  from to_sync
  where c.id = to_sync.id
  returning c.id;
end;
$$;

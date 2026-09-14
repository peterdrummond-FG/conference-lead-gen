-- Approved contacts with no matched Zoho Account yet ("new_account" leads --
-- a school/district that doesn't exist in Zoho) are real new business, not
-- an error state -- this app exists specifically to surface leads Zoho
-- doesn't already have. They must still reach the export CSV, flagged for
-- manual Account creation, rather than sitting excluded forever waiting for
-- someone to create the Account by hand first (which required going back
-- into this app to link it before the lead could ever leave). export-csv
-- flags these rows in its own output (see its "Account Status" column).
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

-- Atomic "deactivate current + insert new" for events-activate Edge Function.
-- Edge Functions calling Postgres via supabase-js don't get automatic
-- multi-statement transactions the way EF Core's BeginTransactionAsync did,
-- so this atomicity lives in the database instead of two sequential awaits.
create or replace function public.events_activate(
  p_zoho_campaign_id text,
  p_name text,
  p_state text,
  p_city text
) returns public.events
language plpgsql
as $$
declare
  v_base text;
  v_folder_code text;
  v_suffix int := 0;
  v_event public.events;
begin
  update public.events set is_active = false where is_active;

  v_base := lower(regexp_replace(trim(p_city), '[^a-zA-Z0-9]+', '-', 'g')) || '-' || to_char(now(), 'YYYYMMDD');
  v_folder_code := v_base;
  while exists (select 1 from public.events where folder_code = v_folder_code) loop
    v_suffix := v_suffix + 1;
    v_folder_code := v_base || '-' || v_suffix;
  end loop;

  insert into public.events (zoho_campaign_id, name, state, city, activated_at, is_active, folder_code)
  values (p_zoho_campaign_id, p_name, p_state, p_city, now(), true, v_folder_code)
  returning * into v_event;

  return v_event;
end;
$$;

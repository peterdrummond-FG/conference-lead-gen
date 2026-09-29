-- Local Zoho Accounts lookup for match-contact's fallback path.
--
-- school_districts / schools are a copy of Zoho Accounts (id, name, state,
-- zoho_account_id). match-contact normally asks Zoho's MCP connector; when that
-- endpoint URL is missing or unusable (2026-09-29: n8n_config held a masked
-- placeholder, Zoho answered "APIKey parsing Exception", and the first two
-- post-cutover contacts burned all three attempts) the skill can still answer
-- the Account half of its job from this copy. It cannot answer the Contact or
-- Deal half -- those tables are not copied -- and the skill workflow says so.
--
-- The lookup is a function, not a PostgREST filter, for two reasons. The caller
-- is an n8n pipeline that holds the service-role credential; the skill session
-- that reads attacker-supplied card text must not (CLAUDE.md rule 2), so the
-- pipeline fetches candidates and hands the skill a list. And PostgREST's
-- `or=(...)` syntax would need the tokens hand-escaped; here they are array
-- parameters, reduced to [a-z0-9] before they touch a LIKE pattern, so no
-- token can carry a wildcard or change the query's shape.
--
-- Names are compared with punctuation folded the same way the skill's
-- normalisation folds it (apostrophes dropped, other punctuation to a space),
-- so a token "oconnor" finds "O'Connor ISD" and "smith" finds "Smith-Jones".
--
-- Rows with a null zoho_account_id (88 districts at time of writing) are never
-- returned: a candidate the export cannot link to a real Account is not a match.
create or replace function public.match_candidate_accounts(
  p_states text[],
  p_district_tokens text[],
  p_school_tokens text[],
  p_limit integer default 40
)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  with params as (
    select
      coalesce((select array_agg(distinct lower(btrim(s)))
                from unnest(p_states) s where btrim(s) <> ''), '{}') as states,
      coalesce((select array_agg(distinct t) from (
                  select regexp_replace(lower(x), '[^a-z0-9]', '', 'g') as t
                  from unnest(p_district_tokens) x) q where length(t) >= 3), '{}') as d_tokens,
      coalesce((select array_agg(distinct t) from (
                  select regexp_replace(lower(x), '[^a-z0-9]', '', 'g') as t
                  from unnest(p_school_tokens) x) q where length(t) >= 3), '{}') as s_tokens,
      least(greatest(coalesce(p_limit, 40), 1), 100) as lim
  ),
  d as (
    select sd.name, sd.state, sd.zoho_account_id,
           (select count(*) from unnest(p.d_tokens) t
             where regexp_replace(regexp_replace(lower(sd.name), '[''’]', '', 'g'), '[^a-z0-9]+', ' ', 'g')
                   like '%' || t || '%') as hits
    from public.school_districts sd, params p
    where sd.zoho_account_id is not null
      and lower(sd.state) = any (p.states)
  ),
  s as (
    select sc.name, sc.zoho_account_id,
           sd.name as district_name, sd.state, sd.zoho_account_id as district_zoho_account_id,
           (select count(*) from unnest(p.s_tokens) t
             where regexp_replace(regexp_replace(lower(sc.name), '[''’]', '', 'g'), '[^a-z0-9]+', ' ', 'g')
                   like '%' || t || '%') as hits
    from public.schools sc
    join public.school_districts sd on sd.id = sc.district_id, params p
    where sc.zoho_account_id is not null
      and lower(sd.state) = any (p.states)
  )
  select jsonb_build_object(
    'districts', coalesce((select jsonb_agg(to_jsonb(x) - 'hits' order by x.hits desc, x.name)
                           from (select * from d where hits > 0
                                 order by hits desc, name limit (select lim from params)) x), '[]'::jsonb),
    'districts_total', (select count(*) from d where hits > 0),
    'schools', coalesce((select jsonb_agg(to_jsonb(x) - 'hits' order by x.hits desc, x.name)
                         from (select * from s where hits > 0
                               order by hits desc, name limit (select lim from params)) x), '[]'::jsonb),
    'schools_total', (select count(*) from s where hits > 0)
  );
$function$;

-- Service-role only. The tables are RLS-locked, but there is no reason for this
-- to be callable by anon/authenticated at all.
revoke all on function public.match_candidate_accounts(text[], text[], text[], integer) from public, anon, authenticated;
grant execute on function public.match_candidate_accounts(text[], text[], text[], integer) to service_role;

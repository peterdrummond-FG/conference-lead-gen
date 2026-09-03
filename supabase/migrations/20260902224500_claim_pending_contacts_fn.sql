-- Stage 11: replaces MatchingQueue's in-flight tracking (via FOR UPDATE SKIP
-- LOCKED) and MatchingRetryScanner's stuck-Pending sweep (via the
-- attempts/cooldown claim condition) with one mechanism. The local agent
-- calls this on a poll loop instead of consuming an in-memory channel.
create or replace function public.claim_pending_contacts(
  max_attempts int,
  retry_delay_minutes int,
  claim_limit int
) returns setof public.contacts
language sql
as $$
  update public.contacts
  set match_attempts = match_attempts + 1,
      last_match_attempt_at = now()
  where id in (
    select id from public.contacts
    where match_status = 'pending'
      and match_attempts < max_attempts
      and (last_match_attempt_at is null or last_match_attempt_at < now() - (retry_delay_minutes || ' minutes')::interval)
    order by created_at
    limit claim_limit
    for update skip locked
  )
  returning *;
$$;

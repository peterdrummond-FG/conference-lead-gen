-- Circuit breaker for the n8n migration (see the migration plan, "Circuit
-- breaker & observability").
--
-- local-agent/skill-runner.mjs's runClaudeRaw holds a single in-process
-- variable (claudeBlockedUntil) shared by all five poll loops: if the CLI's
-- output matches a usage-limit pattern, every loop backs off for 5 minutes
-- rather than continuing to hammer the API — added 2026-09-21 after a real
-- hour-long outage where all five loops retried every 20-30s regardless.
--
-- n8n workflow executions don't share process memory the way one Node
-- process did, so that choke point becomes a shared row every skill
-- sub-workflow checks/writes through instead — this table, plus the
-- n8n_circuit_breaker role below, which is intentionally narrow: BYPASSRLS
-- (every table in this project has RLS enabled with no policies by design,
-- see docs/ARCHITECTURE.md — a role without BYPASSRLS gets zero rows back
-- regardless of GRANTs) but GRANTed access to only this one table, nothing
-- else. This is the n8n-side analog of skillEnv()'s allowlist: broad enough
-- to do its one job, narrow enough that it can't do anything else.
--
-- This migration is purely additive — a new table and a new role — and
-- changes nothing about any existing table, function, or currently-running
-- process (local-agent and watch-cards.command are untouched by this).

create table public.circuit_breaker (
  -- Enforces exactly one row: id must be true, and true is the only allowed
  -- primary key value, so a second insert always violates the PK.
  id boolean primary key default true check (id),
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.circuit_breaker (id, blocked_until) values (true, null);

alter table public.circuit_breaker enable row level security;
-- Deliberately zero policies, consistent with every other table in this
-- project — access is gated by the role's GRANTs below, not by RLS policy,
-- same as service_role already works via BYPASSRLS.

-- LOGIN with no password set here — passwords are never committed to a
-- migration file. Set the real password directly against the live project
-- once, outside git history (e.g. via the Supabase SQL editor or
-- `ALTER ROLE n8n_circuit_breaker WITH PASSWORD '...'` run ad hoc), then
-- store it only in n8n's own credential store.
create role n8n_circuit_breaker with login bypassrls nosuperuser nocreatedb nocreaterole noinherit;

grant usage on schema public to n8n_circuit_breaker;
grant select, update on public.circuit_breaker to n8n_circuit_breaker;
-- Explicitly nothing else: no other table, no function execute grants. If a
-- future change needs this role to reach more, grant it there explicitly —
-- never widen this migration after the fact (migrations are append-only).

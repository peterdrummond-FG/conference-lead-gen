-- Stage 8: port of the EF Core model (backend/Data/Configurations/*.cs) to native
-- Postgres, for the Supabase Edge Functions rewrite. Enums are text + CHECK rather
-- than native Postgres enums, matching the existing HasConversion provider-string
-- convention and keeping future value additions a plain additive ALTER TABLE.
--
-- contacts.source_message_id is added as a plain column (no FK yet) in
-- 20260902204000_add_source_message_id_column.sql, ahead of Stage 13's
-- inbound_messages table; its FK constraint is added once that table exists.

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  zoho_campaign_id text not null unique,
  name text not null,
  synced_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  zoho_campaign_id text not null,
  name text not null,
  state text not null,
  city text not null,
  activated_at timestamptz not null,
  is_active boolean not null default false,
  folder_code text
);
create unique index events_one_active_idx on public.events (is_active) where is_active;
create unique index events_folder_code_idx on public.events (folder_code) where folder_code is not null;

create table public.school_districts (
  id uuid primary key default gen_random_uuid(),
  state text not null,
  name text not null,
  zoho_account_id text
);

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  district_id uuid not null references public.school_districts(id) on delete restrict,
  name text not null,
  zoho_account_id text
);

-- Singleton settings row. Fixed id, same pattern as the .NET
-- KioskSettingsConfiguration's fixed-GUID trick. staff_pin doubles as the
-- server-enforced staff-PIN gate (Stage 9) and the kiosk-unlock PIN, unified
-- rather than adding a second secret.
create table public.app_settings (
  id uuid primary key,
  staff_pin text not null default '1234'
);
insert into public.app_settings (id) values ('00000000-0000-0000-0000-000000000001');

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete restrict,
  source text not null check (source in ('form','card_photo')),
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  school_district_id uuid not null references public.school_districts(id) on delete restrict,
  school_id uuid references public.schools(id) on delete restrict,
  title text,
  extraction_confidence text check (extraction_confidence in ('high','medium','low')),
  research_confidence text check (research_confidence in ('high','medium','low')),
  person_verified boolean,
  match_status text not null default 'pending'
    check (match_status in ('pending','existing_contact','new_contact_existing_account','new_account','ambiguous')),
  match_confidence text check (match_confidence in ('high','medium','low')),
  matched_zoho_contact_id text,
  matched_zoho_contact_name text,
  matched_zoho_contact_email text,
  matched_zoho_contact_phone text,
  matched_zoho_contact_title text,
  matched_zoho_account_id text,
  matched_zoho_account_name text,
  has_active_opportunity boolean,
  active_opportunity_name text,
  candidate_matches jsonb,
  local_duplicate_of_contact_id uuid references public.contacts(id) on delete set null,
  review_status text not null default 'needs_review' check (review_status in ('approved','needs_review','rejected')),
  auto_approved boolean not null default false,
  notes text,             -- pipeline-owned (match-contact output only)
  interaction_notes text, -- Stage 14: reviewer-editable, voice-memo-derived
  source_image_path text,
  source_image_hash text,
  cropped_image_path text,
  created_at timestamptz not null default now(),
  match_attempts int not null default 0,
  last_match_attempt_at timestamptz
);
create unique index contacts_source_image_hash_idx on public.contacts (source_image_hash) where source_image_hash is not null;
create index contacts_match_status_idx on public.contacts (match_status) where match_status = 'pending';
create index contacts_review_status_idx on public.contacts (review_status);

-- No end-user auth model exists (staff-PIN is a shared secret, not a Supabase
-- Auth user) — RLS is enabled with zero policies (deny-all to anon/authenticated).
-- All reads/writes go through Edge Functions using the service-role key, which
-- bypasses RLS entirely. Standard pattern for backend-mediated-only access.
alter table public.campaigns enable row level security;
alter table public.events enable row level security;
alter table public.school_districts enable row level security;
alter table public.schools enable row level security;
alter table public.app_settings enable row level security;
alter table public.contacts enable row level security;

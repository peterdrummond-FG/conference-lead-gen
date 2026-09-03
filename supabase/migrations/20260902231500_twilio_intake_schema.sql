-- Stage 13 (prerequisite for Stage 14's transcription/correlation logic).
create table public.phone_event_bindings (
  phone_number text primary key,
  event_id uuid not null references public.events(id) on delete restrict,
  bound_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.inbound_messages (
  id uuid primary key default gen_random_uuid(),
  twilio_message_sid text not null unique,
  from_phone text not null,
  to_phone text not null,
  event_id uuid references public.events(id) on delete set null,
  kind text not null check (kind in ('folder_code_bind','photo','audio','unrecognized')),
  status text not null default 'received'
    check (status in ('received','pending_ocr','pending_transcription','processing','completed','failed')),
  body text,
  media_content_type text,
  storage_path text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text,
  transcript text,
  matched_contact_ids uuid[],
  attempts int not null default 0
);
create index inbound_messages_pending_photo_idx on public.inbound_messages (kind, status) where kind = 'photo' and status = 'pending_ocr';
create index inbound_messages_from_phone_idx on public.inbound_messages (from_phone, received_at);

alter table public.contacts
  add constraint contacts_source_message_id_fkey
  foreign key (source_message_id) references public.inbound_messages(id) on delete set null;

alter table public.phone_event_bindings enable row level security;
alter table public.inbound_messages enable row level security;

insert into storage.buckets (id, name, public)
values ('voice-memos', 'voice-memos', false)
on conflict (id) do nothing;

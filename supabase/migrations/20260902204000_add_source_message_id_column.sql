-- Added ahead of Stage 13's inbound_messages table so contacts-from-ocr can
-- accept an optional inboundMessageId now; the FK constraint back to
-- inbound_messages is added once that table exists (Stage 13 migration).
alter table public.contacts add column source_message_id uuid;

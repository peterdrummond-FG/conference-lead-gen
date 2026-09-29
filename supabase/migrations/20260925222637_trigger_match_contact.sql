-- APPLIED 2026-09-25. Apply at cutover of pipeline-match-contact (needs
-- 00_notify_n8n_function.sql first, and ZOHO_MCP_URL set in n8n_config).
-- Webhook path: ckh-match-contact.
--
-- New contacts only. Retries (attempts 2 and 3, after the 10-minute cooldown)
-- and a reviewer's retry-match reset come from the pipeline's
-- claim_pending_contacts backstop, not from this trigger.
create trigger contacts_notify_n8n_match
  after insert on public.contacts
  for each row
  when (new.match_status = 'pending')
  execute function public.notify_n8n('ckh-match-contact');

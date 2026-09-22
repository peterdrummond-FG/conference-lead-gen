// POST ?id=<inboundMessageId> -> { id, status }
// Staff escape hatch once reconcile_retryable_failed_inbound_messages
// (20260922110000_voice_memo_link_state_and_ocr_retry.sql) has given up --
// which for a 'terminal' failure (error_class='terminal', e.g. "no legible
// business card detected in photo") is immediately: that classification
// exists specifically so a card OCR genuinely can't read isn't retried
// automatically forever. A human might still want another attempt anyway
// (a re-crop, or just because the classifier guessed wrong), the same way
// contacts-retry-match is the human override once matchingLoop's own
// attempts/cooldown has given up on a contact.
//
// Resetting processing_attempts/status/error/error_class is the entire
// mechanism -- being pending_ocr (or pending_transcription) again with a
// fresh attempt count is sufficient for the local agent's own poll loop to
// pick it up on its next tick; there's no separate queue to enqueue onto
// (same pattern as contacts-retry-match).
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

const PENDING_STATUS_BY_KIND: Record<string, string> = {
  photo: "pending_ocr",
  audio: "pending_transcription",
};

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse(req, 405, "Method not allowed");
  const user = await requireUser(req);
  if (!user) return errorResponse(req, 401, "Unauthorized");

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return errorResponse(req, 400, "id query param is required");

  const supabase = serviceClient();
  const { data: message, error: fetchError } = await supabase
    .from("inbound_messages")
    .select("id, kind, status, from_phone")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) return errorResponse(req, 500, fetchError.message);
  if (!message) return errorResponse(req, 404, `No inbound message with id '${id}'.`);

  const pendingStatus = PENDING_STATUS_BY_KIND[message.kind];
  if (!pendingStatus) return errorResponse(req, 400, `Only a photo or audio message can be retried, not '${message.kind}'.`);
  if (message.status !== "failed") return errorResponse(req, 400, "Message is not failed — nothing to retry.");

  // Same ownership model as contacts-retry-match: a sales rep may retry only
  // their own submissions (matched by phone number, since inbound_messages
  // has no rep_id of its own), everyone else may retry anything.
  if (user.role === "sales") {
    const { data: profile } = await supabase
      .from("profiles")
      .select("phone_number")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile?.phone_number || profile.phone_number !== message.from_phone) {
      return errorResponse(req, 404, `No inbound message with id '${id}'.`);
    }
  }

  const { error } = await supabase
    .from("inbound_messages")
    .update({
      status: pendingStatus,
      processing_attempts: 0,
      last_processing_attempt_at: null,
      claimed_at: null,
      error: null,
      error_class: null,
    })
    .eq("id", id);
  if (error) return errorResponse(req, 500, error.message);

  return jsonResponse(req, { id: message.id, status: pendingStatus });
});

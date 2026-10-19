// GET ?id=<inboundMessageId> -> { url } a short-lived signed Storage URL for the
// memo's recording, for Contacts' play button. JSON, not a 302 like contacts-photo:
// an <audio> element cannot send the Authorization header, so the page asks here
// (with its token) and hands the signed URL to the element.
//
// Same ownership rule as every memo function: a sales rep reaches only memos sent
// from their own number; Admin / Solutions Success reach any. Audio is deleted
// from the voice-memos bucket 90 days after arrival (docs/DATA-RETENTION.md), so an
// old memo answers 404 "no longer available" and the page shows no player.
//
// What it signs is `playback_path`, the MP3 copy n8n's pipeline-voice-transcription
// saves after converting the phone's AMR (browsers cannot play AMR).
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

// Long enough to listen and replay a memo (they are under a few minutes), short
// enough that a link copied out of the network tab is useless soon after.
const URL_SECONDS = 300;

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return errorResponse(req, 405, "Method not allowed");
  const user = await requireUser(req);
  if (!user) return errorResponse(req, 401, "Unauthorized");

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return errorResponse(req, 400, "id query param is required");

  const supabase = serviceClient();
  const { data: message, error } = await supabase
    .from("inbound_messages")
    .select("kind, from_phone, storage_path, playback_path")
    .eq("id", id)
    .maybeSingle();
  if (error) return errorResponse(req, 500, error.message);
  if (!message || message.kind !== "audio") return errorResponse(req, 404, "Not found");

  if (user.role === "sales") {
    const { data: profile } = await supabase.from("profiles").select("phone_number").eq("id", user.id).maybeSingle();
    if (!profile?.phone_number || profile.phone_number !== message.from_phone) return errorResponse(req, 404, "Not found");
  }

  if (!message.storage_path && !message.playback_path) return errorResponse(req, 404, "This recording is no longer available.");
  // Sign the MP3 copy, never storage_path: that is the AMR exactly as Twilio sent it,
  // and Chrome / Firefox cannot decode AMR, so signing it made every memo answer
  // "Couldn't play this recording" (2026-10-15). A memo with no MP3 yet (its
  // conversion failed, or it predates the copy and has not been backfilled) says so
  // rather than handing the browser a file it cannot play.
  if (!message.playback_path) return errorResponse(req, 404, "This recording isn't ready to play yet. The transcript is below.");
  const { data: signed, error: signError } = await supabase.storage
    .from("voice-memos")
    .createSignedUrl(message.playback_path, URL_SECONDS);
  if (signError || !signed) return errorResponse(req, 404, "This recording is no longer available.");

  return jsonResponse(req, { url: signed.signedUrl });
});

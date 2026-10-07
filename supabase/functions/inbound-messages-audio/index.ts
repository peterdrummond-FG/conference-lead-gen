// GET ?id=<inboundMessageId> -> { url } a short-lived signed Storage URL for the
// memo's recording, for Contacts' play button. JSON, not a 302 like contacts-photo:
// an <audio> element cannot send the Authorization header, so the page asks here
// (with its token) and hands the signed URL to the element.
//
// Same ownership rule as every memo function: a sales rep reaches only memos sent
// from their own number; Admin / Solutions Success reach any. Audio is deleted
// from the voice-memos bucket 90 days after arrival (docs/DATA-RETENTION.md), so an
// old memo answers 404 "no longer available" and the page shows no player.
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
    .select("kind, from_phone, storage_path")
    .eq("id", id)
    .maybeSingle();
  if (error) return errorResponse(req, 500, error.message);
  if (!message || message.kind !== "audio") return errorResponse(req, 404, "Not found");

  if (user.role === "sales") {
    const { data: profile } = await supabase.from("profiles").select("phone_number").eq("id", user.id).maybeSingle();
    if (!profile?.phone_number || profile.phone_number !== message.from_phone) return errorResponse(req, 404, "Not found");
  }

  if (!message.storage_path) return errorResponse(req, 404, "This recording is no longer available.");
  const { data: signed, error: signError } = await supabase.storage
    .from("voice-memos")
    .createSignedUrl(message.storage_path, URL_SECONDS);
  if (signError || !signed) return errorResponse(req, 404, "This recording is no longer available.");

  return jsonResponse(req, { url: signed.signedUrl });
});

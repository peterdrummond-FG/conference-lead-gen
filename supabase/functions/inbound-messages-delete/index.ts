// POST ?id=<inboundMessageId> -> { deleted: id }
//
// Two kinds of row can be deleted here, both from Contacts' "Needs attention" section:
//   - an unmatched voice memo (audio, link_status unlinked / no_candidate_found);
//   - a photo or memo that FAILED to process (status='failed'): a blurry card, a
//     duplicate, a recording that won't transcribe. Nothing was made from it, so there
//     is nothing else to clean up beyond its stored file.
//
// Lets a human discard an unmatched voice memo from Review's unresolved-
// intake list (inbound-messages-unresolved-list) once they've read it and
// decided it's not worth keeping around for another 50 link_attempts (or a
// human to revisit later) -- e.g. a duplicate, a memo about someone the rep
// decides was never actually a lead, or a misdial.
//
// Scoped server-side to exactly the audio/unlinked rows the panel shows --
// same reasoning as contacts-bulk-delete restricting to review_status=
// 'rejected': a stale client selection (the list refreshed under the user,
// or a race with the auto-linker actually finding a match) must never delete
// a row that has since become real CRM data.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

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
  const { data: message, error: messageError } = await supabase
    .from("inbound_messages")
    .select("id, kind, status, link_status, from_phone, storage_path")
    .eq("id", id)
    .maybeSingle();
  if (messageError) return errorResponse(req, 500, messageError.message);
  const unmatchedMemo = message?.kind === "audio" && ["unlinked", "no_candidate_found"].includes(message.link_status);
  const failedItem = message?.status === "failed" && ["photo", "audio"].includes(message.kind);
  if (!message || !(unmatchedMemo || failedItem)) {
    return errorResponse(req, 404, `No unmatched or failed message with id '${id}'.`);
  }

  if (user.role === "sales") {
    const { data: profile } = await supabase
      .from("profiles")
      .select("phone_number")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile?.phone_number || profile.phone_number !== message.from_phone) {
      return errorResponse(req, 404, `No unmatched or failed message with id '${id}'.`);
    }
  }

  // A person's "Create contacts" is still running for this memo: deleting it now
  // would orphan the extraction (its contacts would point at a memo that is gone)
  // and throw away the transcript it is reading. It finishes in about a minute.
  const { data: inFlight, error: inFlightError } = await supabase
    .from("note_submissions")
    .select("id")
    .eq("source_message_id", id)
    .in("status", ["pending_extraction", "processing"])
    .limit(1)
    .maybeSingle();
  if (inFlightError) return errorResponse(req, 500, inFlightError.message);
  if (inFlight) return errorResponse(req, 409, "Contacts are still being created from this memo. Try again in a minute.");

  // Audit S12 pattern (see contacts-bulk-delete): remove the media before
  // the row, not after -- if Storage cleanup fails we still have the row to
  // retry from, whereas deleting the row first orphans the object with
  // nothing left pointing at it. A missing object is the desired end state
  // anyway, so a Storage error here is logged and non-fatal.
  if (message.storage_path) {
    // Photos live in contact-photos, memos in voice-memos (twilio-webhook picks the bucket by kind).
    const bucket = message.kind === "photo" ? "contact-photos" : "voice-memos";
    const { error: removeError } = await supabase.storage.from(bucket).remove([message.storage_path]);
    if (removeError) console.error("inbound media cleanup failed", removeError);
  }

  const { error: deleteError } = await supabase.from("inbound_messages").delete().eq("id", id);
  if (deleteError) return errorResponse(req, 500, deleteError.message);

  return jsonResponse(req, { deleted: id });
});

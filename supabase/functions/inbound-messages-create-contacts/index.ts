// POST ?id=<inboundMessageId> -> { id, status: 'working', alreadyWorking }
//
// Contacts' "Create contacts" on a voice memo nobody could match to a contact. The
// memo is about someone new (or several someones), and the person looking at it knows
// that. This records the transcript for the same extraction a pasted note gets
// (note_submissions -> extract-note-contacts -> contacts-from-note), so there is no
// new LLM path and nothing here calls a model: like notes-submit it only reserves
// the work and the agent / n8n pipeline does it. The submission carries the memo's id
// (source_message_id), which is how contacts-from-note files each person as
// source='voice_memo' and moves the memo out of the list once someone exists.
//
// Bounds, because this is the one cheap request that starts an expensive job:
//   - one in flight per memo (a double tap returns the run already going);
//   - MAX_ATTEMPTS per memo in total, so a memo that really names nobody cannot be
//     re-run forever (the sweep that reads "none found" keeps it listed for Assign
//     or Delete);
//   - the transcript is capped at the same size notes-submit allows.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

const MAX_ATTEMPTS = 3;
const MAX_TRANSCRIPT_CHARS = 20_000;

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse(req, 405, "Method not allowed");
  const user = await requireUser(req);
  if (!user) return errorResponse(req, 401, "Unauthorized");

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return errorResponse(req, 400, "id query param is required");

  const supabase = serviceClient();
  const { data: message, error: messageError } = await supabase
    .from("inbound_messages")
    .select("id, kind, link_status, transcript, from_phone, event_id")
    .eq("id", id)
    .maybeSingle();
  if (messageError) return errorResponse(req, 500, messageError.message);
  // Same allowlist as inbound-messages-delete / the list: only a memo that is still
  // waiting for a person. One that linked or already created contacts (a stale tab)
  // is not offered this and must not be extracted a second time.
  if (!message || message.kind !== "audio" || !["unlinked", "no_candidate_found"].includes(message.link_status)) {
    return errorResponse(req, 404, `No unmatched voice memo with id '${id}'.`);
  }

  if (user.role === "sales") {
    const { data: profile } = await supabase.from("profiles").select("phone_number").eq("id", user.id).maybeSingle();
    if (!profile?.phone_number || profile.phone_number !== message.from_phone) {
      return errorResponse(req, 404, `No unmatched voice memo with id '${id}'.`);
    }
  }

  const transcript = (message.transcript ?? "").trim();
  if (!transcript) return errorResponse(req, 400, "This memo has no transcript yet.");
  if (transcript.length > MAX_TRANSCRIPT_CHARS) return errorResponse(req, 400, "This memo's transcript is too long to read in one go.");
  if (!message.event_id) return errorResponse(req, 400, "This memo isn't tied to a conference, so there's nowhere to file the contacts.");

  const { data: prior, error: priorError } = await supabase
    .from("note_submissions")
    .select("id, status")
    .eq("source_message_id", id);
  if (priorError) return errorResponse(req, 500, priorError.message);
  const running = (prior ?? []).find((s) => ["pending_extraction", "processing"].includes(s.status));
  if (running) return jsonResponse(req, { id: running.id, status: "working", alreadyWorking: true });
  if ((prior ?? []).length >= MAX_ATTEMPTS) {
    return errorResponse(req, 409, "We've already tried to find people in this memo. Assign it to a contact or delete it.");
  }

  // from_phone, not submitted_by: the contacts are credited to the rep who SENT the
  // memo (contacts-from-note resolves that from the number), even when a manager is
  // the one tapping the button.
  const { data, error } = await supabase
    .from("note_submissions")
    .insert({ event_id: message.event_id, from_phone: message.from_phone, body: transcript, source_message_id: id })
    .select("id")
    .single();
  if (error) return errorResponse(req, 500, error.message);

  return jsonResponse(req, { id: data.id, status: "working", alreadyWorking: false }, 201);
});

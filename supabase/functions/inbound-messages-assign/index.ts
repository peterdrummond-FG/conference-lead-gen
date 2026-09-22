// POST ?id=<inboundMessageId>&contactId=<contactId> -> { id, contactId, linkStatus }
//
// Manual override for a voice memo attribute-voice-memo left unlinked (or
// gave up on -- link_status='no_candidate_found') -- the human-in-the-loop
// counterpart to relinkUnlinkedAudioMessages in local-agent/agent.mjs. Same
// write shape as that loop's attachExcerpts/recordLinkResult (see
// 20260922110000_voice_memo_link_state_and_ocr_retry.sql): append the
// transcript to the contact's interaction_notes, record the match, flip
// link_status to 'linked'. A human assigning by hand has already read the
// transcript and picked the right person, so there's no attribution call to
// make here -- unlike the automated pass, the whole transcript is what gets
// attached, not just an excerpt.
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
  const contactId = url.searchParams.get("contactId");
  if (!id || !contactId) return errorResponse(req, 400, "id and contactId query params are required");

  const supabase = serviceClient();
  const { data: message, error: messageError } = await supabase
    .from("inbound_messages")
    .select("id, kind, transcript, from_phone, matched_contact_ids")
    .eq("id", id)
    .maybeSingle();
  if (messageError) return errorResponse(req, 500, messageError.message);
  if (!message || message.kind !== "audio") return errorResponse(req, 404, `No audio message with id '${id}'.`);
  if (!message.transcript) return errorResponse(req, 400, "Message has no transcript yet.");

  if (user.role === "sales") {
    const { data: profile } = await supabase
      .from("profiles")
      .select("phone_number")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile?.phone_number || profile.phone_number !== message.from_phone) {
      return errorResponse(req, 404, `No audio message with id '${id}'.`);
    }
  }

  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .select("id, interaction_notes, rep_id")
    .eq("id", contactId)
    .maybeSingle();
  if (contactError) return errorResponse(req, 500, contactError.message);
  if (!contact) return errorResponse(req, 404, `No contact with id '${contactId}'.`);
  // Belt-and-suspenders on top of inbound-messages-link-candidates only ever
  // offering a sales rep their own contacts: reject a contactId a tampered
  // client sent for someone else's lead, the same ownership boundary as
  // every other write here.
  if (user.role === "sales" && contact.rep_id !== user.id) {
    return errorResponse(req, 404, `No contact with id '${contactId}'.`);
  }

  // Idempotent, same as attachExcerpts: assigning the same memo twice (a
  // double-click, or retrying after a network blip) must not duplicate the
  // note text.
  const alreadyAttached = contact.interaction_notes?.includes(message.transcript) ?? false;
  if (!alreadyAttached) {
    const merged = contact.interaction_notes
      ? `${contact.interaction_notes}\n\n${message.transcript}`
      : message.transcript;
    const { error: updateContactError } = await supabase
      .from("contacts")
      .update({ interaction_notes: merged })
      .eq("id", contactId);
    if (updateContactError) return errorResponse(req, 500, updateContactError.message);
  }

  const matchedContactIds = new Set(message.matched_contact_ids ?? []);
  matchedContactIds.add(contactId);
  const { error: updateMessageError } = await supabase
    .from("inbound_messages")
    .update({ matched_contact_ids: [...matchedContactIds], link_status: "linked" })
    .eq("id", id);
  if (updateMessageError) return errorResponse(req, 500, updateMessageError.message);

  return jsonResponse(req, { id, contactId, linkStatus: "linked" });
});

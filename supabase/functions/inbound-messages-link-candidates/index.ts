// GET ?id=<inboundMessageId> -> ContactOption[]
//
// Backs the manual "Assign to contact" action on an unmatched voice memo in
// Review (inbound-messages-unresolved-list's audio list) -- a human override
// for exactly the case linkTranscriptToContacts leaves alone on purpose (see
// 20260922110000_voice_memo_link_state_and_ocr_retry.sql and agent.mjs's
// findCandidateContacts): nobody the skill could confidently place, or the
// mentioned person's card genuinely never got photographed.
//
// Deliberately broader than findCandidateContacts' own candidate query: that
// one is scoped to VOICE_CANDIDATE_SOURCES (card_photo/directory_photo) so
// the *automated* pass never guesses across a form/note submission. A human
// picking a contact by name has no such failure mode, so every contact this
// rep captured at this event is a fair option -- otherwise a legitimate
// assignment (e.g. onto a contact typed in from paper notes) would have no
// way to happen at all.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return errorResponse(req, 405, "Method not allowed");
  const user = await requireUser(req);
  if (!user) return errorResponse(req, 401, "Unauthorized");

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return errorResponse(req, 400, "id query param is required");

  const supabase = serviceClient();
  const { data: message, error: messageError } = await supabase
    .from("inbound_messages")
    .select("id, kind, from_phone, event_id")
    .eq("id", id)
    .maybeSingle();
  if (messageError) return errorResponse(req, 500, messageError.message);
  if (!message || message.kind !== "audio") return errorResponse(req, 404, `No audio message with id '${id}'.`);

  // Same ownership model as inbound-messages-retry: a sales rep may only act
  // on their own submissions, matched by phone since inbound_messages has no
  // rep_id of its own.
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

  if (!message.event_id) return jsonResponse(req, []);

  // "Whoever captured this memo" is resolved the same way findCandidateContacts
  // does it -- from_phone -> profiles.phone_number -> that rep's own contacts
  // -- not every rep's contacts at the event, which would both be the wrong
  // scope for "who was this rep probably describing" and grow unboundedly
  // over a multi-rep event.
  const { data: rep, error: repError } = await supabase
    .from("profiles")
    .select("id")
    .eq("phone_number", message.from_phone)
    .maybeSingle();
  if (repError) return errorResponse(req, 500, repError.message);
  if (!rep) return jsonResponse(req, []);

  // "This rep's contacts" is two sets, not one. contacts.rep_id is only set for a
  // *sales* profile (contacts-from-note / contacts-from-ocr), so everything an admin
  // or manager captures by text has rep_id NULL -- filtering on rep_id alone made
  // the picker say "No contacts captured by this rep" while the contact sat in the
  // same conference, created from that same phone's earlier memo (Peter Drummond,
  // 2026-10-08). The other set is every contact whose source memo was texted from
  // this phone, which is the scope the automatic matcher already uses.
  const select = "id, first_name, last_name, email, title, rep_id, created_at";
  const { data: ownContacts, error: ownError } = await supabase
    .from("contacts")
    .select(select)
    .eq("event_id", message.event_id)
    .eq("rep_id", rep.id);
  if (ownError) return errorResponse(req, 500, ownError.message);

  const { data: phoneMessages, error: phoneError } = await supabase
    .from("inbound_messages")
    .select("id")
    .eq("from_phone", message.from_phone)
    .eq("event_id", message.event_id);
  if (phoneError) return errorResponse(req, 500, phoneError.message);
  const messageIds = (phoneMessages ?? []).map((m) => m.id);
  let textedContacts: typeof ownContacts = [];
  if (messageIds.length) {
    const { data, error } = await supabase
      .from("contacts")
      .select(select)
      .eq("event_id", message.event_id)
      .in("source_message_id", messageIds);
    if (error) return errorResponse(req, 500, error.message);
    textedContacts = data ?? [];
  }

  const byId = new Map<string, NonNullable<typeof ownContacts>[number]>();
  for (const c of [...(ownContacts ?? []), ...textedContacts]) byId.set(c.id, c);
  // A sales rep may only assign onto their own leads (inbound-messages-assign
  // enforces rep_id === user.id), so don't offer one it would then refuse.
  const contacts = [...byId.values()]
    .filter((c) => user.role !== "sales" || c.rep_id === user.id)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return jsonResponse(
    req,
    contacts.map((c) => ({
      id: c.id,
      firstName: c.first_name,
      lastName: c.last_name,
      email: c.email,
      title: c.title,
    })),
  );
});

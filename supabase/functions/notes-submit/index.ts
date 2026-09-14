// Stage 17 — POST { text } -> { id, eventName, alreadySubmitted }.
// The staff-facing half of pasted-note intake: a logged-in rep pastes a
// whole typed note (usually covering several people) and this records it
// for local-agent's noteLoop to extract. Extraction itself happens there,
// not here — every LLM call in this project runs through the local
// `claude -p` agent, never a metered API key inside an Edge Function.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

// A paste this big is a mis-paste (a whole document, a mail thread), not a
// day's conference notes. Rejecting it up front beats handing the extraction
// skill something it will spend 15 minutes failing to make sense of.
const MAX_NOTE_CHARS = 20_000;

// A rep double-tapping Send, or a flaky connection retrying the POST, should
// land on the submission they already made rather than extracting the same
// note twice into duplicate contacts. Deliberately narrow: an identical body
// from the same person that is *still in flight*. A rep who pastes a second,
// different note seconds later is doing something normal and isn't caught by
// this; a rep re-pasting the same text after a run finished is deliberately
// retrying it and gets a fresh submission rather than the old result served
// back. The window only stops a permanently-stuck 'processing' row from
// blocking that retry forever.
const IN_FLIGHT_WINDOW_MINUTES = 10;

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse(req, 405, "Method not allowed");

  const user = await requireUser(req);
  if (!user) return errorResponse(req, 401, "Unauthorized");

  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return errorResponse(req, 400, "Paste some notes first.");
  if (text.length > MAX_NOTE_CHARS) {
    return errorResponse(req, 400, `That note is ${text.length.toLocaleString()} characters — the limit is ${MAX_NOTE_CHARS.toLocaleString()}. Send it in a couple of pieces.`);
  }

  const supabase = serviceClient();

  // The rep's own linked event wins over whichever event happens to be
  // active: a rep writing up notes on the way home is still filing them
  // against the conference they were just at, even if someone has since
  // activated the next one. Falls back to the active event for staff who
  // don't keep a current_event_id (admin/Solutions Success). Never taken
  // from the client — the paste page shows the same resolution so the rep
  // can see where it's going, but it isn't what decides it.
  let eventId = user.currentEventId;
  if (!eventId) {
    const { data: activeEvent, error: activeError } = await supabase
      .from("events")
      .select("id")
      .eq("is_active", true)
      .maybeSingle();
    if (activeError) return errorResponse(req, 500, activeError.message);
    if (!activeEvent) {
      return errorResponse(req, 409, "You're not linked to an event and there's no active event — link yourself to one on the Review page first.");
    }
    eventId = activeEvent.id;
  }

  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("id, name")
    .eq("id", eventId)
    .maybeSingle();
  if (eventError) return errorResponse(req, 500, eventError.message);
  if (!event) return errorResponse(req, 409, "The event you're linked to no longer exists — re-link yourself on the Review page.");

  const windowStart = new Date(Date.now() - IN_FLIGHT_WINDOW_MINUTES * 60_000).toISOString();
  const { data: recent, error: recentError } = await supabase
    .from("note_submissions")
    .select("id")
    .eq("submitted_by", user.id)
    .eq("body", text)
    .in("status", ["pending_extraction", "processing"])
    .gte("created_at", windowStart)
    .limit(1)
    .maybeSingle();
  if (recentError) return errorResponse(req, 500, recentError.message);
  if (recent) {
    return jsonResponse(req, { id: recent.id, eventName: event.name, alreadySubmitted: true });
  }

  const { data, error } = await supabase
    .from("note_submissions")
    .insert({ event_id: event.id, submitted_by: user.id, body: text })
    .select("id")
    .single();
  if (error) return errorResponse(req, 500, error.message);

  return jsonResponse(req, { id: data.id, eventName: event.name, alreadySubmitted: false }, 201);
});

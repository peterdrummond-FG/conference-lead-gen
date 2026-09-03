// POST { name, eventId? } -> { id, name, state }, 201. Public.
// Fixed to match the real DistrictEndpoints.cs contract (caught during
// Stage 15's frontend wiring — the first version of this function
// incorrectly took `state` directly from the client and deduped by
// name+state, neither of which the original endpoint does).
//
// State is derived from an event server-side, never trusted from the
// client, same reasoning as contacts-create deriving eventId server-side:
// - Intake always means "today's active event" (eventId omitted).
// - /review can be correcting a contact from an event that's no longer
//   active (e.g. a card-photo contact reviewed after the next event was
//   already activated) — it passes eventId explicitly so state resolves
//   from *that* event, not whatever's active right now.
// No dedup-by-name here — the original endpoint always inserts a new row
// even if a same-named district already exists; that's deliberate (the
// real fuzzy/authoritative resolution happens downstream in
// research-contact/match-contact against Zoho, not here).
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse(req, 405, "Method not allowed");

  const body = await req.json().catch(() => null);
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    return errorResponse(req, 400, "name is required");
  }

  const supabase = serviceClient();

  let state: string;
  if (body.eventId) {
    const { data: event, error } = await supabase.from("events").select("state").eq("id", body.eventId).maybeSingle();
    if (error) return errorResponse(req, 500, error.message);
    if (!event) return errorResponse(req, 404, `No event with id '${body.eventId}'.`);
    state = event.state;
  } else {
    const { data: activeEvent, error } = await supabase.from("events").select("state").eq("is_active", true).maybeSingle();
    if (error) return errorResponse(req, 500, error.message);
    if (!activeEvent) return errorResponse(req, 409, "No active event. Activate one via events-activate first.");
    state = activeEvent.state;
  }

  const { data, error } = await supabase
    .from("school_districts")
    .insert({ name: body.name.trim(), state })
    .select("id, name, state")
    .single();
  if (error) return errorResponse(req, 500, error.message);

  return jsonResponse(req, { id: data.id, name: data.name, state: data.state }, 201);
});

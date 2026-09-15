// POST { eventId: string | null } -> the updated Profile. Any logged-in
// role -- a rep, or an admin/solutionsSuccess switching which concurrently
// active event they're administering (Setup's rep assignment and QR slides,
// and notes-submit's attribution), links themself to whichever event
// they're currently working. Always writes to the caller's own profile;
// never a body-supplied target (see profiles-assign-current-event for a
// manager acting on someone else's behalf).
//
// Was sales-only until 20260915 (see
// 20260915120000_event_slug_and_concurrent_events.sql) -- back when exactly
// one event could be active, an admin/solutionsSuccess had nothing to
// switch between. Opened up once events-activate started auto-linking the
// activating user with no way to switch back to a different already-active
// one.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse(req, 405, "Method not allowed");

  const user = await requireUser(req);
  if (!user) return errorResponse(req, 401, "Unauthorized");

  const body = await req.json().catch(() => null);
  if (!body || (body.eventId !== null && typeof body.eventId !== "string")) {
    return errorResponse(req, 400, "eventId must be a string or null");
  }

  const supabase = serviceClient();

  if (body.eventId) {
    const { data: event, error: eventError } = await supabase.from("events").select("id").eq("id", body.eventId).maybeSingle();
    if (eventError) return errorResponse(req, 500, eventError.message);
    if (!event) return errorResponse(req, 404, `No event with id '${body.eventId}'.`);
  }

  const { data, error } = await supabase
    .from("profiles")
    .update({ current_event_id: body.eventId })
    .eq("id", user.id)
    .select()
    .single();
  if (error) return errorResponse(req, 500, error.message);

  return jsonResponse(req, { id: data.id, currentEventId: data.current_event_id });
});

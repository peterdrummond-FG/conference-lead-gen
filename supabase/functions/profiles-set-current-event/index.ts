// POST { eventId: string | null } -> the updated Profile. sales only --
// a rep linking themself to whichever event they're currently working.
// Always writes to the caller's own profile; never a body-supplied target
// (see profiles-assign-current-event for a manager acting on someone
// else's behalf).
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse(req, 405, "Method not allowed");

  const user = await requireUser(req);
  if (!user) return errorResponse(req, 401, "Unauthorized");
  if (user.role !== "sales") return errorResponse(req, 403, "Forbidden");

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

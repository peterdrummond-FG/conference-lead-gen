// POST { repId, eventId: string | null } -> the updated Profile.
// admin/solutionsSuccess only -- a manager linking a rep to whichever
// event they're working, on that rep's behalf.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { hasRole, requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse(req, 405, "Method not allowed");

  const caller = await requireUser(req);
  if (!caller) return errorResponse(req, 401, "Unauthorized");
  if (!hasRole(caller, ["admin", "solutionsSuccess"])) return errorResponse(req, 403, "Forbidden");

  const body = await req.json().catch(() => null);
  if (!body || typeof body.repId !== "string" || (body.eventId !== null && typeof body.eventId !== "string")) {
    return errorResponse(req, 400, "repId is required and eventId must be a string or null");
  }

  const supabase = serviceClient();

  const { data: rep, error: repError } = await supabase.from("profiles").select("id, role").eq("id", body.repId).maybeSingle();
  if (repError) return errorResponse(req, 500, repError.message);
  if (!rep || rep.role !== "sales") return errorResponse(req, 404, `No sales rep with id '${body.repId}'.`);

  if (body.eventId) {
    const { data: event, error: eventError } = await supabase.from("events").select("id").eq("id", body.eventId).maybeSingle();
    if (eventError) return errorResponse(req, 500, eventError.message);
    if (!event) return errorResponse(req, 404, `No event with id '${body.eventId}'.`);
  }

  // Moves the rep's phone with them when it is already bound. A manager
  // reassigning a rep used to leave their texted cards landing in the old
  // conference until the rep texted SETUP again. See profile_set_current_event.
  const { error } = await supabase.rpc("profile_set_current_event", {
    p_profile_id: rep.id,
    p_event_id: body.eventId,
  });
  if (error) return errorResponse(req, error.code === "CKH01" ? 404 : 500, error.message);

  return jsonResponse(req, { id: rep.id, currentEventId: body.eventId });
});

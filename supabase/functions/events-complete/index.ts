// POST { eventId } -> the completed Event. Staff-gated (admin/solutionsSuccess,
// same as events-activate) -- ends a conference for everyone: events_complete()
// (see 20260928120000_events_complete_fn.sql) flips is_active off and clears
// current_event_id for every profile still linked to it in one transaction,
// which is what re-triggers each of those reps' "not linked to an event"
// state and routes them through Setup again next time.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { hasRole, requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";
import { isUuid } from "../_shared/validate.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse(req, 405, "Method not allowed");
  const user = await requireUser(req);
  if (!user) return errorResponse(req, 401, "Unauthorized");
  if (!hasRole(user, ["admin", "solutionsSuccess"])) return errorResponse(req, 403, "Forbidden");

  const body = await req.json().catch(() => null);
  if (!body || !isUuid(body.eventId)) {
    return errorResponse(req, 400, "eventId must be a valid event id");
  }

  const supabase = serviceClient();
  const { data, error } = await supabase.rpc("events_complete", { p_event_id: body.eventId });
  if (error) {
    // Same user-facing/internal split as events-activate: events_complete()
    // marks the exception it raises on purpose (no such event) with 'CKH01'.
    console.error("events_complete failed", error);
    const friendly = error.code === "CKH01"
      ? error.message
      : "Could not complete the event. Please try again or contact support.";
    return errorResponse(req, error.code === "CKH01" ? 404 : 500, friendly);
  }

  return jsonResponse(req, {
    id: data.id,
    name: data.name,
    state: data.state,
    slug: data.slug,
  });
});

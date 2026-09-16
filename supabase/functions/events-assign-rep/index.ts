// POST { eventId: string, repId: string, linked: boolean } -> { eventId, repId, linked }.
// Staff-gated (used by /setup's reps-by-event matrix, customerSuccess only
// client-side). Links or unlinks a sales rep to an event in event_reps —
// contacts-create revalidates a scanned QR's repId against this table before
// crediting a lead, and the frontend only shows a "download QR" button for a
// linked pair.
//
// Stage 19 rewrite: this used to set one of two single-slot columns
// (events.booth_rep_id/session_rep_id), assuming exactly one rep per channel
// per event. Reps now get their own per-event QR code, so arbitrarily many
// reps can be linked to one event — see
// 20260917100000_event_reps_and_activation_guard.sql.
//
// eventId is caller-supplied rather than resolved from "the active event" —
// multiple events can be active at once (see
// 20260915120000_event_slug_and_concurrent_events.sql), and the matrix shows
// every active event at once.
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
  if (!isUuid(body.repId)) {
    return errorResponse(req, 400, "repId must be a valid profile id");
  }
  if (typeof body.linked !== "boolean") {
    return errorResponse(req, 400, "linked must be true or false");
  }

  const supabase = serviceClient();

  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("id")
    .eq("id", body.eventId)
    .maybeSingle();
  if (eventError) return errorResponse(req, 500, eventError.message);
  if (!event) return errorResponse(req, 404, `No event with id '${body.eventId}'.`);

  const { data: rep, error: repError } = await supabase.from("profiles").select("id, role").eq("id", body.repId).maybeSingle();
  if (repError) return errorResponse(req, 500, repError.message);
  if (!rep || rep.role !== "sales") return errorResponse(req, 404, `No sales rep with id '${body.repId}'.`);

  if (body.linked) {
    const { error } = await supabase
      .from("event_reps")
      .upsert({ event_id: event.id, rep_id: rep.id }, { onConflict: "event_id,rep_id" });
    if (error) return errorResponse(req, 500, error.message);
  } else {
    const { error } = await supabase
      .from("event_reps")
      .delete()
      .eq("event_id", event.id)
      .eq("rep_id", rep.id);
    if (error) return errorResponse(req, 500, error.message);
  }

  return jsonResponse(req, { eventId: event.id, repId: rep.id, linked: body.linked });
});

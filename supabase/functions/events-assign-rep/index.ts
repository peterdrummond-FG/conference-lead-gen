// POST { channel: 'booth' | 'session', repId: string | null } -> the
// updated active Event. Staff-gated (used by /setup, customerSuccess only
// client-side). Assigns which rep is credited for that channel's leads on
// the currently active event — contacts-create reads this back off when a
// QR/form submission comes in tagged with the same channel.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { hasRole, requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse(req, 405, "Method not allowed");
  const user = await requireUser(req);
  if (!user) return errorResponse(req, 401, "Unauthorized");
  if (!hasRole(user, ["admin", "solutionsSuccess"])) return errorResponse(req, 403, "Forbidden");

  const body = await req.json().catch(() => null);
  if (!body || (body.channel !== "booth" && body.channel !== "session")) {
    return errorResponse(req, 400, "channel must be 'booth' or 'session'");
  }
  if (body.repId !== null && typeof body.repId !== "string") {
    return errorResponse(req, 400, "repId must be a string or null");
  }

  const supabase = serviceClient();

  const { data: activeEvent, error: eventError } = await supabase
    .from("events")
    .select("id")
    .eq("is_active", true)
    .maybeSingle();
  if (eventError) return errorResponse(req, 500, eventError.message);
  if (!activeEvent) return errorResponse(req, 409, "No active event. Activate one via events-activate first.");

  if (body.repId) {
    const { data: rep, error: repError } = await supabase.from("profiles").select("id, role").eq("id", body.repId).maybeSingle();
    if (repError) return errorResponse(req, 500, repError.message);
    if (!rep || rep.role !== "sales") return errorResponse(req, 404, `No sales rep with id '${body.repId}'.`);
  }

  const column = body.channel === "booth" ? "booth_rep_id" : "session_rep_id";
  const { data, error } = await supabase
    .from("events")
    .update({ [column]: body.repId })
    .eq("id", activeEvent.id)
    .select()
    .single();
  if (error) return errorResponse(req, 500, error.message);

  return jsonResponse(req, {
    id: data.id,
    boothRepId: data.booth_rep_id,
    sessionRepId: data.session_rep_id,
  });
});

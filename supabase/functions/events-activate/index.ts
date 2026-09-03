// POST { zohoCampaignId, name, state, city } -> the newly activated Event.
// Staff-gated (/setup). Atomicity ("deactivate current + insert new") lives
// in the events_activate Postgres function, not here.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireStaffPin } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";
import { VALID_EVENT_STATES } from "../_shared/usStates.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse(req, 405, "Method not allowed");
  if (!(await requireStaffPin(req))) return errorResponse(req, 401, "Unauthorized");

  const body = await req.json().catch(() => null);
  if (
    !body ||
    typeof body.zohoCampaignId !== "string" ||
    typeof body.name !== "string" ||
    typeof body.state !== "string" ||
    typeof body.city !== "string" ||
    !body.state.trim() ||
    !body.city.trim()
  ) {
    return errorResponse(req, 400, "zohoCampaignId, name, state, and city are required");
  }

  const state = body.state.trim();
  if (!VALID_EVENT_STATES.has(state)) {
    return errorResponse(req, 400, `state must be a full US state name (or "National"), got '${state}'`);
  }

  const supabase = serviceClient();
  const { data, error } = await supabase.rpc("events_activate", {
    p_zoho_campaign_id: body.zohoCampaignId,
    p_name: body.name,
    p_state: state,
    p_city: body.city.trim(),
  });
  if (error) return errorResponse(req, 500, error.message);

  return jsonResponse(req, {
    id: data.id,
    name: data.name,
    state: data.state,
    city: data.city,
    folderCode: data.folder_code,
  }, 201);
});

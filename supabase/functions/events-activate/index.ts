// POST { zohoCampaignId, name, state } -> the newly activated Event.
// Staff-gated (/setup). Slug generation and folder-code de-duplication live
// in the events_activate Postgres function, not here — see
// 20260915120000_event_slug_and_concurrent_events.sql (activating an event
// no longer deactivates any other; multiple conferences can run at once).
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { hasRole, requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";
import { VALID_US_STATES } from "../_shared/usStates.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse(req, 405, "Method not allowed");
  const user = await requireUser(req);
  if (!user) return errorResponse(req, 401, "Unauthorized");
  if (!hasRole(user, ["admin", "solutionsSuccess"])) return errorResponse(req, 403, "Forbidden");

  const body = await req.json().catch(() => null);
  if (
    !body ||
    typeof body.zohoCampaignId !== "string" ||
    typeof body.name !== "string" ||
    typeof body.state !== "string" ||
    !body.state.trim()
  ) {
    return errorResponse(req, 400, "zohoCampaignId, name, and state are required");
  }

  const state = body.state.trim();
  if (!VALID_US_STATES.has(state)) {
    return errorResponse(req, 400, `state must be a full US state name, got '${state}'`);
  }

  const supabase = serviceClient();
  const { data, error } = await supabase.rpc("events_activate", {
    p_zoho_campaign_id: body.zohoCampaignId,
    p_name: body.name,
    p_state: state,
  });
  if (error) return errorResponse(req, 500, error.message);

  // Concurrent conferences mean activating no longer implies "the" active
  // event (see 20260915120000_event_slug_and_concurrent_events.sql) -- the
  // activating rep is, by definition, working this one right now, so link
  // them the same way toggleMyCurrentEvent does, instead of leaving them to
  // click "Link myself to this event" separately for something they just
  // created themselves.
  const { error: linkError } = await supabase
    .from("profiles")
    .update({ current_event_id: data.id })
    .eq("id", user.id);
  if (linkError) console.error("failed to link activating user to new event", linkError);

  return jsonResponse(req, {
    id: data.id,
    name: data.name,
    state: data.state,
    slug: data.slug,
    folderCode: data.folder_code,
  }, 201);
});

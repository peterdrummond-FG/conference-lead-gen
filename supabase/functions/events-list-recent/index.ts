// GET -> the 5 most recently activated Events regardless of status, each
// tagged status: 'active' | 'completed'. Feeds Setup's "Reps & events" table
// alongside events-list-active (which stays active-only -- that function
// backs the personal "switch which conference I'm working" picker, where a
// completed event never belongs). Any logged-in user -- same non-sensitive
// shape as events-list-active (name/slug/state/activatedAt only, no
// folder_code).
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return errorResponse(req, 405, "Method not allowed");

  const user = await requireUser(req);
  if (!user) return errorResponse(req, 401, "Unauthorized");

  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("events")
    .select("id, name, slug, state, activated_at, is_active")
    .order("activated_at", { ascending: false })
    .limit(5);
  if (error) return errorResponse(req, 500, error.message);

  return jsonResponse(req, (data ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    slug: e.slug,
    state: e.state,
    activatedAt: e.activated_at,
    status: e.is_active ? "active" : "completed",
  })));
});

// GET -> every currently-active Event, most recently activated first.
// Staff-gated (admin/solutionsSuccess) -- feeds Setup's event switcher.
//
// Multiple conferences can be active at once (see
// 20260915120000_event_slug_and_concurrent_events.sql), so unlike
// events-active (which resolves to a single event) this lists all of them,
// letting an admin/solutionsSuccess switch which one they're administering
// via profiles-set-current-event instead of only ever seeing whichever one
// they personally activated.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { hasRole, requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return errorResponse(req, 405, "Method not allowed");

  const user = await requireUser(req);
  if (!user) return errorResponse(req, 401, "Unauthorized");
  if (!hasRole(user, ["admin", "solutionsSuccess"])) return errorResponse(req, 403, "Forbidden");

  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("events")
    .select("id, name, slug, state, activated_at, event_reps(rep_id)")
    .eq("is_active", true)
    .order("activated_at", { ascending: false });
  if (error) return errorResponse(req, 500, error.message);

  return jsonResponse(req, (data ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    slug: e.slug,
    state: e.state,
    activatedAt: e.activated_at,
    // deno-lint-ignore no-explicit-any
    repIds: ((e.event_reps ?? []) as any[]).map((r) => r.rep_id),
  })));
});

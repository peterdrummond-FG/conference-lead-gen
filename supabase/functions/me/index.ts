// GET -> { id, name, role, email, currentEventId, currentEventName }.
// Any logged-in user. The first call the frontend makes after login (or on
// app boot with an existing session) -- a Supabase Auth session alone only
// carries id/email, not this app's role/current-event state.
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

  const [{ data: authUser }, { data: event }] = await Promise.all([
    supabase.auth.admin.getUserById(user.id),
    user.currentEventId
      ? supabase.from("events").select("name").eq("id", user.currentEventId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return jsonResponse(req, {
    id: user.id,
    name: user.name,
    role: user.role,
    email: authUser?.user?.email ?? null,
    currentEventId: user.currentEventId,
    currentEventName: event?.name ?? null,
  });
});

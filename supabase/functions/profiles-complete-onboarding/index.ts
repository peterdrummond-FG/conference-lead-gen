// POST (no body) -> { ok: true }. Any logged-in staff role -- records that the
// caller has finished or skipped the first-time welcome tour. Always writes the
// caller's OWN profile (profiles.onboarded_at); there is deliberately no
// body-supplied target, so nobody can mark someone else's tour as seen.
//
// Idempotent: the first call stamps the time, later calls (a replayed tour
// being finished again) leave the original stamp alone.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse(req, 405, "Method not allowed");

  const user = await requireUser(req);
  if (!user) return errorResponse(req, 401, "Unauthorized");

  const supabase = serviceClient();
  const { error } = await supabase
    .from("profiles")
    .update({ onboarded_at: new Date().toISOString() })
    .eq("id", user.id)
    .is("onboarded_at", null);
  if (error) return errorResponse(req, 500, error.message);

  return jsonResponse(req, { ok: true });
});

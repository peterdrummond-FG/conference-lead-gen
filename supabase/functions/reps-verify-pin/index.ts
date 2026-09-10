// POST { repId, pin } -> { valid: boolean }. Staff-gated (used by /setup) --
// reaching this at all already requires the shared staff PIN that unlocks
// the kiosk; this is the extra check on top of that when the "Signed in
// as" picker switches to a specific rep, so one rep can't casually flip the
// demo into another rep's name. A plain string compare is fine for the
// same reason the shared staff PIN's is (see requireStaffPin) -- this
// isn't a real per-user auth boundary yet, just a placeholder ahead of
// building one.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireStaffPin } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse(req, 405, "Method not allowed");
  if (!(await requireStaffPin(req))) return errorResponse(req, 401, "Unauthorized");

  const body = await req.json().catch(() => null);
  if (!body || typeof body.repId !== "string" || typeof body.pin !== "string") {
    return errorResponse(req, 400, "repId and pin are required");
  }

  const supabase = serviceClient();
  const { data: rep, error } = await supabase.from("reps").select("pin").eq("id", body.repId).maybeSingle();
  if (error) return errorResponse(req, 500, error.message);

  const valid = !!rep?.pin && timingSafeEqual(body.pin, rep.pin);
  return jsonResponse(req, { valid });
});

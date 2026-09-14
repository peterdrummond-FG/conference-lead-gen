// POST { code: string } -> { ok: true }. Any logged-in staff role -- always
// sets the caller's OWN kiosk PIN (profiles.kiosk_pin), never a
// body-supplied target. Kept short and numeric-ish on purpose: it has to be
// quick to type on a shared device, unlike a real account password.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse(req, 405, "Method not allowed");

  const user = await requireUser(req);
  if (!user) return errorResponse(req, 401, "Unauthorized");

  const body = await req.json().catch(() => null);
  if (!body || typeof body.code !== "string" || body.code.length < 4) {
    return errorResponse(req, 400, "code must be a string of at least 4 characters");
  }

  const supabase = serviceClient();
  const { error } = await supabase
    .from("profiles")
    .update({ kiosk_pin: body.code })
    .eq("id", user.id);
  if (error) return errorResponse(req, 500, error.message);

  return jsonResponse(req, { ok: true });
});

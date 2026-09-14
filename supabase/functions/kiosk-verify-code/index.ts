// POST { code: string } -> { valid: boolean }. Any logged-in staff role may
// call this -- kiosk-locking never signs anyone out (the same account is
// still authenticated underneath), it just hides the app behind Intake on
// this physical device. Checks the caller's OWN kiosk PIN
// (profiles.kiosk_pin), a per-user code unrelated to their login password
// -- see kiosk-set-code for how each user changes their own.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse(req, 405, "Method not allowed");

  const user = await requireUser(req);
  if (!user) return errorResponse(req, 401, "Unauthorized");

  const body = await req.json().catch(() => null);
  if (!body || typeof body.code !== "string") {
    return errorResponse(req, 400, "code must be a string");
  }

  return jsonResponse(req, { valid: body.code === user.kioskPin });
});

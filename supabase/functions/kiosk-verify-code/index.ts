// POST { code: string } -> { valid: boolean }. Any logged-in staff role may
// call this -- kiosk-locking never signs anyone out (the same account is
// still authenticated underneath), it just hides the app behind Intake on
// this physical device. Checks the caller's OWN kiosk PIN
// (profiles.kiosk_pin), a per-user code unrelated to their login password
// -- see kiosk-set-code for how each user changes their own.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireUser, timingSafeEqual } from "../_shared/auth.ts";

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

  // Constant-time (audit S4) -- the same defect as isServiceRoleCall, repeated
  // here. Note this does NOT make the kiosk lock a security boundary: it is
  // still enforced client-side and still brute-forceable without a lockout.
  // See audit N2, deferred.
  return jsonResponse(req, { valid: await timingSafeEqual(body.code, user.kioskPin) });
});

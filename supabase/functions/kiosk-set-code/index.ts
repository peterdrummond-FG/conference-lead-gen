// POST { code: string } -> { ok: true }. admin/solutionsSuccess only --
// changes the single shared kiosk-unlock code (app_settings.kiosk_code).
// Kept short and numeric-ish on purpose: it has to be quick to hand to a
// rep verbally or type on a shared device, unlike a real account password.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireUser, hasRole } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

const APP_SETTINGS_ID = "00000000-0000-0000-0000-000000000001";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse(req, 405, "Method not allowed");

  const user = await requireUser(req);
  if (!user) return errorResponse(req, 401, "Unauthorized");
  if (!hasRole(user, ["admin", "solutionsSuccess"])) return errorResponse(req, 403, "Forbidden");

  const body = await req.json().catch(() => null);
  if (!body || typeof body.code !== "string" || body.code.length < 4) {
    return errorResponse(req, 400, "code must be a string of at least 4 characters");
  }

  const supabase = serviceClient();
  const { error } = await supabase
    .from("app_settings")
    .update({ kiosk_code: body.code })
    .eq("id", APP_SETTINGS_ID);
  if (error) return errorResponse(req, 500, error.message);

  return jsonResponse(req, { ok: true });
});

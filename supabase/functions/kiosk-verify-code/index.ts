// POST { code: string } -> { valid: boolean }. Any logged-in staff role may
// call this -- kiosk-locking never signs anyone out (the same account is
// still authenticated underneath), it just hides the app behind Intake on
// this physical device. The code itself is a single shared secret
// (app_settings.kiosk_code) unrelated to anyone's login password -- see
// kiosk-set-code for how admin/solutionsSuccess change it.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

const APP_SETTINGS_ID = "00000000-0000-0000-0000-000000000001";

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

  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("app_settings")
    .select("kiosk_code")
    .eq("id", APP_SETTINGS_ID)
    .single();
  if (error) return errorResponse(req, 500, error.message);

  return jsonResponse(req, { valid: body.code === data.kiosk_code });
});

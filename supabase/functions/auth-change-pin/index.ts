// PUT { currentPin: string, newPin: string } -> { success: true }
// Self-gated: requires the current PIN in the body rather than the
// x-staff-pin header check every other privileged function uses.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { APP_SETTINGS_ID } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "PUT") return errorResponse(req, 405, "Method not allowed");

  const body = await req.json().catch(() => null);
  if (!body || typeof body.currentPin !== "string" || typeof body.newPin !== "string" || body.newPin.length === 0) {
    return errorResponse(req, 400, "currentPin and newPin are required");
  }

  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("app_settings")
    .select("staff_pin")
    .eq("id", APP_SETTINGS_ID)
    .single();
  if (error || !data) return errorResponse(req, 500, "Could not load settings");
  if (data.staff_pin !== body.currentPin) {
    return errorResponse(req, 401, "Current PIN is incorrect");
  }

  const { error: updateError } = await supabase
    .from("app_settings")
    .update({ staff_pin: body.newPin })
    .eq("id", APP_SETTINGS_ID);
  if (updateError) return errorResponse(req, 500, "Could not update PIN");

  return jsonResponse(req, { success: true });
});

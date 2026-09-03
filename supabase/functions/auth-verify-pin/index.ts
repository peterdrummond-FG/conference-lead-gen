// POST { pin: string } -> { valid: boolean }
// Public (no PIN required to call this — you're calling it to find out if
// the PIN you have is right).
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { APP_SETTINGS_ID } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse(req, 405, "Method not allowed");

  const body = await req.json().catch(() => null);
  if (!body || typeof body.pin !== "string") {
    return errorResponse(req, 400, "pin is required");
  }

  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("app_settings")
    .select("staff_pin")
    .eq("id", APP_SETTINGS_ID)
    .single();
  if (error || !data) return errorResponse(req, 500, "Could not load settings");

  return jsonResponse(req, { valid: body.pin === data.staff_pin });
});

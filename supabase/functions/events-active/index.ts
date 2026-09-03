// GET -> the currently active Event, or null. Public — Intake needs this to
// show its fixed State/City context without a PIN.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return errorResponse(req, 405, "Method not allowed");

  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("is_active", true)
    .maybeSingle();
  if (error) return errorResponse(req, 500, error.message);
  if (!data) return jsonResponse(req, null);

  return jsonResponse(req, {
    id: data.id,
    name: data.name,
    state: data.state,
    city: data.city,
    activatedAt: data.activated_at,
    folderCode: data.folder_code,
  });
});

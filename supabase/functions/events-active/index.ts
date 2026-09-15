// GET -> the currently active Event, or null. Public — Intake needs this to
// know which event contacts are attached to without a PIN.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
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

  // Audit S11. folder_code is the SMS bind token: anyone holding it can text
  // the Twilio number, bind a phone to this event, and push photos and voice
  // memos into the intake pipeline. Intake itself never needs it -- it is for
  // the Setup page, which is staff-gated -- so it is returned only to a
  // logged-in caller. Same for the rep assignments.
  const user = await requireUser(req); // null for the public intake form
  return jsonResponse(req, {
    id: data.id,
    name: data.name,
    state: data.state,
    activatedAt: data.activated_at,
    ...(user
      ? {
        folderCode: data.folder_code,
        boothRepId: data.booth_rep_id,
        sessionRepId: data.session_rep_id,
      }
      : {}),
  });
});

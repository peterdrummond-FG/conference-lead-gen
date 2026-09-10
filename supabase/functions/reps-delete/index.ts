// POST { id } -> { deleted: true }. Staff-gated (used by /setup). Contacts
// and event channel assignments referencing this rep keep their row, with
// rep_id/booth_rep_id/session_rep_id set to null (on delete set null).
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireStaffPin } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse(req, 405, "Method not allowed");
  if (!(await requireStaffPin(req))) return errorResponse(req, 401, "Unauthorized");

  const body = await req.json().catch(() => null);
  if (!body || typeof body.id !== "string") return errorResponse(req, 400, "id is required");

  const supabase = serviceClient();
  const { error } = await supabase.from("reps").delete().eq("id", body.id);
  if (error) return errorResponse(req, 500, error.message);

  return jsonResponse(req, { deleted: true });
});

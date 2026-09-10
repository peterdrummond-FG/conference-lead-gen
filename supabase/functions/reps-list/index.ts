// GET -> Rep[]. Staff-gated (used by /setup).
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireStaffPin } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return errorResponse(req, 405, "Method not allowed");
  if (!(await requireStaffPin(req))) return errorResponse(req, 401, "Unauthorized");

  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("reps")
    .select("*")
    .order("name");
  if (error) return errorResponse(req, 500, error.message);

  return jsonResponse(
    req,
    data.map((r) => ({ id: r.id, name: r.name, phoneNumber: r.phone_number })),
  );
});

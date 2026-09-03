// GET ?districtId=&search=  -> School[]
// Public — used by both Intake's and /review's school typeahead.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return errorResponse(req, 405, "Method not allowed");

  const url = new URL(req.url);
  const districtId = url.searchParams.get("districtId")?.trim() ?? "";
  const search = url.searchParams.get("search")?.trim() ?? "";
  if (!districtId) return errorResponse(req, 400, "districtId is required");

  const supabase = serviceClient();
  let query = supabase.from("schools").select("*").eq("district_id", districtId).order("name").limit(50);
  if (search) query = query.ilike("name", `%${search}%`);

  const { data, error } = await query;
  if (error) return errorResponse(req, 500, error.message);

  return jsonResponse(
    req,
    data.map((s) => ({ id: s.id, name: s.name, districtId: s.district_id })),
  );
});

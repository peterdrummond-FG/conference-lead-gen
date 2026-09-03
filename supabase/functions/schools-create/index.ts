// POST { districtId, name } -> { id, name, districtId }, 201. Public.
// Fixed to match the real SchoolEndpoints.cs contract (caught during Stage
// 15's frontend wiring — the first version deduped by name, which the
// original endpoint doesn't do; it always inserts a new row).
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse(req, 405, "Method not allowed");

  const body = await req.json().catch(() => null);
  if (!body || typeof body.districtId !== "string" || typeof body.name !== "string" || !body.name.trim()) {
    return errorResponse(req, 400, "districtId and name are required");
  }

  const supabase = serviceClient();

  const { data: district, error: districtError } = await supabase
    .from("school_districts")
    .select("id")
    .eq("id", body.districtId)
    .maybeSingle();
  if (districtError) return errorResponse(req, 500, districtError.message);
  if (!district) return errorResponse(req, 404, `No district with id '${body.districtId}'.`);

  const { data, error } = await supabase
    .from("schools")
    .insert({ district_id: body.districtId, name: body.name.trim() })
    .select("id, name, district_id")
    .single();
  if (error) return errorResponse(req, 500, error.message);

  return jsonResponse(req, { id: data.id, name: data.name, districtId: data.district_id }, 201);
});

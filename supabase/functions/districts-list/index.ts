// GET ?search=&state=  -> SchoolDistrict[]
// Public — used by both Intake's and /review's district typeahead.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return errorResponse(req, 405, "Method not allowed");

  const url = new URL(req.url);
  const search = url.searchParams.get("search")?.trim() ?? "";
  const state = url.searchParams.get("state")?.trim() ?? "";

  const supabase = serviceClient();
  let query = supabase.from("school_districts").select("*").order("name").limit(50);
  if (search) query = query.ilike("name", `%${search}%`);
  // "National" means a nationwide conference with no single home state —
  // search across every district rather than filtering by one.
  if (state && state !== "National") query = query.eq("state", state);

  const { data, error } = await query;
  if (error) return errorResponse(req, 500, error.message);

  return jsonResponse(
    req,
    data.map((d) => ({ id: d.id, name: d.name, state: d.state })),
  );
});

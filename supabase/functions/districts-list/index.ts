// GET ?search=&state=  -> SchoolDistrict[]
// Public — used by both Intake's and /review's district typeahead.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { serviceClient } from "../_shared/supabase-client.ts";
import { escapeLike } from "../_shared/validate.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return errorResponse(req, 405, "Method not allowed");

  const url = new URL(req.url);
  const search = url.searchParams.get("search")?.trim() ?? "";
  const state = url.searchParams.get("state")?.trim() ?? "";

  const supabase = serviceClient();
  let query = supabase.from("school_districts").select("*").order("name").limit(50);
  // Audit S11. These are public (the attendee typeahead needs them without a
  // login), so: escape LIKE metacharacters, or a caller can turn a scoped
  // lookup into a full unanchored scan; and require two characters before
  // returning anything, so a bare call can't page the whole reference table.
  //
  // An empty result rather than a 400 for a short search: Quasar's QSelect
  // fires @filter with "" the moment the dropdown opens, and useTypeahead
  // treats a rejection as abort(). "Type two characters to search" is the
  // intended behaviour here, not an error.
  if (search.length < 2) return jsonResponse(req, []);
  query = query.ilike("name", `%${escapeLike(search)}%`);
  if (state) query = query.eq("state", state);

  const { data, error } = await query;
  if (error) return errorResponse(req, 500, error.message);

  return jsonResponse(
    req,
    data.map((d) => ({ id: d.id, name: d.name, state: d.state })),
  );
});

// GET ?search=&state=  -> SchoolDistrict[]   (search mode: up to 50 matches, 2+ characters)
// GET ?all=1&state=     -> { id, name }[]    (whole state, no search term; see below)
// Public — used by the District picker on the attendee form, /review and the merge dialog.
//
// all=1 returns every district in the state, in name order, so the picker can load the
// list once and filter it on the device: opening the field shows districts at once and
// every letter is instant, which is what a rep on conference wifi needs. Bounded
// (fetchAllPages refuses past 5,000 rows; Texas, the biggest, is 932 and ~88 KB) and
// browser-cacheable. A state is required: there is no "every district in the country".
// Equality on state, never a LIKE pattern, so there is nothing to escape.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { serviceClient } from "../_shared/supabase-client.ts";
import { escapeLike } from "../_shared/validate.ts";
import { cachedJson, fetchAllPages } from "../_shared/referenceLists.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return errorResponse(req, 405, "Method not allowed");

  const url = new URL(req.url);
  const search = url.searchParams.get("search")?.trim() ?? "";
  const state = url.searchParams.get("state")?.trim() ?? "";

  const supabase = serviceClient();

  if (url.searchParams.get("all") === "1") {
    if (!state) return errorResponse(req, 400, "state is required");
    try {
      const rows = await fetchAllPages<{ id: string; name: string }>((from, to) =>
        supabase.from("school_districts").select("id, name").eq("state", state)
          .order("name").order("id").range(from, to)
      );
      return cachedJson(req, rows);
    } catch (err) {
      return errorResponse(req, 500, err instanceof Error ? err.message : "Lookup failed");
    }
  }

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

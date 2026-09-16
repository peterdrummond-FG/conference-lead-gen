// GET ?search=  -> Campaign[]
// Staff-gated (used by /setup).
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { hasRole, requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";
import { escapeLike } from "../_shared/validate.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return errorResponse(req, 405, "Method not allowed");
  const user = await requireUser(req);
  if (!user) return errorResponse(req, 401, "Unauthorized");
  if (!hasRole(user, ["admin", "solutionsSuccess"])) return errorResponse(req, 403, "Forbidden");

  const url = new URL(req.url);
  const search = url.searchParams.get("search")?.trim() ?? "";

  const supabase = serviceClient();
  let query = supabase
    .from("campaigns")
    .select("*")
    .order("name", { ascending: false })
    .limit(50);
  // escapeLike: same ILIKE-metacharacter miss as districts-list/schools-list
  // used to have (audit S11) -- an unescaped `%`/`_` in a staff-typed search
  // could turn a scoped substring search into a wider scan than intended.
  if (search) query = query.ilike("name", `%${escapeLike(search)}%`);

  const { data, error } = await query;
  if (error) return errorResponse(req, 500, error.message);

  return jsonResponse(
    req,
    data.map((c) => ({
      id: c.id,
      zohoCampaignId: c.zoho_campaign_id,
      name: c.name,
    })),
  );
});

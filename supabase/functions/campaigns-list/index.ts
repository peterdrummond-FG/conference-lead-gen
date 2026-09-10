// GET ?search=  -> Campaign[]
// Staff-gated (used by /setup).
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireStaffPin } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return errorResponse(req, 405, "Method not allowed");
  if (!(await requireStaffPin(req))) return errorResponse(req, 401, "Unauthorized");

  const url = new URL(req.url);
  const search = url.searchParams.get("search")?.trim() ?? "";

  const supabase = serviceClient();
  let query = supabase
    .from("campaigns")
    .select("*")
    .order("name", { ascending: false })
    .limit(50);
  if (search) query = query.ilike("name", `%${search}%`);

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

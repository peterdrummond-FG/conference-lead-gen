// GET ?reviewStatus=&matchStatus=  -> ContactListItem[]
// Staff-gated (/review).
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireStaffPin } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";
import { attachDuplicateNames, CONTACT_SELECT, toListItem } from "../_shared/contacts.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return errorResponse(req, 405, "Method not allowed");
  if (!(await requireStaffPin(req))) return errorResponse(req, 401, "Unauthorized");

  const url = new URL(req.url);
  const reviewStatus = url.searchParams.get("reviewStatus")?.trim() ?? "";
  const matchStatus = url.searchParams.get("matchStatus")?.trim() ?? "";

  const supabase = serviceClient();
  let query = supabase.from("contacts").select(CONTACT_SELECT).order("created_at", { ascending: false });
  query = query.eq("review_status", reviewStatus || "needs_review");
  if (matchStatus) query = query.eq("match_status", matchStatus);

  const { data, error } = await query;
  if (error) return errorResponse(req, 500, error.message);

  const duplicateNames = await attachDuplicateNames(supabase, data);
  return jsonResponse(req, data.map((c) => toListItem(c, duplicateNames)));
});

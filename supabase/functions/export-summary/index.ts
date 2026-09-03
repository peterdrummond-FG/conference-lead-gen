// GET -> { readyToExport, needsReview, blockedOnNewAccount }. Staff-gated.
// Port of ExportEndpoints.cs's GET /api/export/summary — another Stage 10
// gap caught during Stage 15's frontend wiring.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireStaffPin } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return errorResponse(req, 405, "Method not allowed");
  if (!(await requireStaffPin(req))) return errorResponse(req, 401, "Unauthorized");

  const supabase = serviceClient();

  const [ready, needsReview, blocked] = await Promise.all([
    supabase.from("contacts").select("*", { count: "exact", head: true })
      .eq("review_status", "approved").not("matched_zoho_account_id", "is", null),
    supabase.from("contacts").select("*", { count: "exact", head: true })
      .eq("review_status", "needs_review"),
    supabase.from("contacts").select("*", { count: "exact", head: true })
      .eq("review_status", "approved").is("matched_zoho_account_id", null),
  ]);

  if (ready.error) return errorResponse(req, 500, ready.error.message);
  if (needsReview.error) return errorResponse(req, 500, needsReview.error.message);
  if (blocked.error) return errorResponse(req, 500, blocked.error.message);

  return jsonResponse(req, {
    readyToExport: ready.count ?? 0,
    needsReview: needsReview.count ?? 0,
    blockedOnNewAccount: blocked.count ?? 0,
  });
});

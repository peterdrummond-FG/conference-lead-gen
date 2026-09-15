// GET -> { readyToExport, newAccountsToExport, needsReview, autoApprovedToExport }.
// Staff-gated.
// Port of ExportEndpoints.cs's GET /api/export/summary — another Stage 10
// gap caught during Stage 15's frontend wiring.
//
// readyToExport and newAccountsToExport are both exported by the next
// export-csv click (see export_and_mark_synced) — the split just tells the
// admin how many rows will go out already matched to a real Zoho Account
// vs. flagged as a brand-new one to create.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { hasRole, requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return errorResponse(req, 405, "Method not allowed");
  const user = await requireUser(req);
  if (!user) return errorResponse(req, 401, "Unauthorized");
  if (!hasRole(user, ["admin", "solutionsSuccess"])) return errorResponse(req, 403, "Forbidden");

  const supabase = serviceClient();

  const [ready, needsReview, newAccounts, autoApproved] = await Promise.all([
    // Must match export_and_mark_synced's own selection criteria exactly —
    // otherwise this count would keep including contacts that a previous
    // export already sent and marked synced_at, even though the next
    // export-csv click won't actually pick them up again.
    supabase.from("contacts").select("*", { count: "exact", head: true })
      .eq("review_status", "approved").not("matched_zoho_account_id", "is", null).is("synced_at", null),
    supabase.from("contacts").select("*", { count: "exact", head: true })
      .eq("review_status", "needs_review"),
    supabase.from("contacts").select("*", { count: "exact", head: true })
      .eq("review_status", "approved").is("matched_zoho_account_id", null).is("synced_at", null),
    // Audit A10. Auto-approval sends a lead to Zoho with no human ever seeing
    // it, so how much of the pending export got there that way is worth
    // showing rather than inferring.
    supabase.from("contacts").select("*", { count: "exact", head: true })
      .eq("review_status", "approved").eq("auto_approved", true).is("synced_at", null),
  ]);

  if (ready.error) return errorResponse(req, 500, ready.error.message);
  if (needsReview.error) return errorResponse(req, 500, needsReview.error.message);
  if (newAccounts.error) return errorResponse(req, 500, newAccounts.error.message);
  if (autoApproved.error) return errorResponse(req, 500, autoApproved.error.message);

  return jsonResponse(req, {
    readyToExport: ready.count ?? 0,
    needsReview: needsReview.count ?? 0,
    newAccountsToExport: newAccounts.count ?? 0,
    autoApprovedToExport: autoApproved.count ?? 0,
  });
});

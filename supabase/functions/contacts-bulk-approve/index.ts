// POST { ids: string[] } -> { approved: string[], skipped: {id, reason}[] }
// (skip reasons: "not found", "still pending", "no longer waiting for confirmation")
// Who: any signed-in staff role (admin, solutionsSuccess, sales); a sales rep can act only
// on their own contacts (anyone else's id is reported as "not found").
// Writes: contacts.review_status = 'approved' (and auto_approved = false) for the ids a
// person selected, only for leads still 'needs_review' and whose match has finished. Called by "Confirm all N"
// on Contacts. This and contacts-patch (one lead's Confirm) are the ONLY writers of
// 'approved': nothing is ever auto-confirmed, and scripts/check-no-auto-confirm.mjs fails
// CI if any other code writes it.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";
import { planBulkApprove, REASON_NOT_WAITING } from "../_shared/bulkApprove.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse(req, 405, "Method not allowed");
  const user = await requireUser(req);
  if (!user) return errorResponse(req, 401, "Unauthorized");

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.ids)) return errorResponse(req, 400, "ids is required");

  const supabase = serviceClient();
  const { data: contacts, error: fetchError } = await supabase
    .from("contacts")
    .select("id, match_status, review_status, rep_id")
    .in("id", body.ids);
  if (fetchError) return errorResponse(req, 500, fetchError.message);

  // Only leads still waiting for confirmation are confirmed (see _shared/bulkApprove.ts:
  // a stale tab must not turn a rejected lead into a confirmed one).
  const { toApprove, skipped } = planBulkApprove(body.ids as string[], contacts, user);

  const approved: string[] = [];
  if (toApprove.length > 0) {
    // The same condition again in the write, so a lead rejected between the read above
    // and this update is left alone; .select() returns the rows really changed.
    const { data: updated, error } = await supabase
      .from("contacts")
      .update({ review_status: "approved", auto_approved: false })
      .in("id", toApprove)
      .eq("review_status", "needs_review")
      .select("id");
    if (error) return errorResponse(req, 500, error.message);
    const changed = new Set((updated ?? []).map((r: { id: string }) => r.id));
    for (const id of toApprove) {
      if (changed.has(id)) approved.push(id);
      else skipped.push({ id, reason: REASON_NOT_WAITING });
    }
  }

  return jsonResponse(req, { approved, skipped });
});

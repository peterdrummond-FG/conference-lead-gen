// POST ?id=<submissionId>  body { eventId, repId: string | null } -> { id, contactId }
// admin / solutionsSuccess only.
//
// Files one waiting submission under a conference Solutions Success chose. All of
// the real work is assign_unassigned_submission (20261006100000_unassigned_submissions.sql):
// one transaction that locks the row, re-checks that the conference is live NOW
// and the rep is a sales rep, creates the contact through the same
// insert_contact_with_duplicate_check path contacts-create uses (so duplicate
// detection and the n8n match trigger behave like a normal scan), and marks the
// row assigned. Two people assigning the same scan serialise on the row lock and
// the second is refused, so a lead can't be created twice.
//
// eventId and repId are the caller's choice and are re-validated in SQL; nothing
// here is trusted because the UI offered it.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { hasRole, requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";
import { isUuid } from "../_shared/validate.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse(req, 405, "Method not allowed");

  const user = await requireUser(req);
  if (!user) return errorResponse(req, 401, "Unauthorized");
  if (!hasRole(user, ["admin", "solutionsSuccess"])) return errorResponse(req, 403, "Forbidden");

  const id = new URL(req.url).searchParams.get("id");
  if (!isUuid(id)) return errorResponse(req, 400, "id must be a valid submission id");

  const body = await req.json().catch(() => null);
  if (!body || !isUuid(body.eventId)) return errorResponse(req, 400, "eventId must be a valid conference id");
  if (body.repId !== null && body.repId !== undefined && !isUuid(body.repId)) {
    return errorResponse(req, 400, "repId must be a valid rep id, or null for no rep");
  }

  const supabase = serviceClient();
  const { data, error } = await supabase
    .rpc("assign_unassigned_submission", {
      p_id: id,
      p_event_id: body.eventId,
      p_rep_id: body.repId ?? null,
      p_user: user.id,
    })
    .single();
  if (error) {
    // CKH01 messages are written to be read as-is ("Someone has already filed this
    // scan"); CKH02 is "not in the queue". Anything else is logged, not forwarded.
    if (error.code === "CKH01") return errorResponse(req, 409, error.message);
    if (error.code === "CKH02") return errorResponse(req, 404, error.message);
    console.error("assign_unassigned_submission failed", error);
    return errorResponse(req, 500, "Couldn't file this scan. Please try again.");
  }

  return jsonResponse(req, { id, contactId: (data as { id: string }).id });
});

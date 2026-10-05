// POST ?id=<submissionId> -> { id, discarded: true }. admin / solutionsSuccess only.
//
// For junk in the "needs a conference" queue, mainly a submission with no QR
// details from someone nobody can place. Only a pending row can be discarded; a
// scan someone already filed or discarded answers 409 so a stale panel can't
// quietly "discard" a real lead's record.
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

  const supabase = serviceClient();
  const { data, error } = await supabase.rpc("discard_unassigned_submission", { p_id: id, p_user: user.id });
  if (error) {
    console.error("discard_unassigned_submission failed", error);
    return errorResponse(req, 500, "Couldn't discard this scan. Please try again.");
  }
  if (data !== true) return errorResponse(req, 409, "That scan was already filed or discarded.");

  return jsonResponse(req, { id, discarded: true });
});

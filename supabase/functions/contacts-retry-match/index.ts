// POST ?id=<contactId> -> { id, createdAt }
// Staff-gated. Manual escape hatch once the local agent's own stuck-Pending
// retry cap (Stage 11) has given up. Resetting match_attempts/
// last_match_attempt_at is the entire mechanism — being 'pending' with a
// fresh attempt window is sufficient for the poller to pick it up on its
// next tick; there's no separate queue to enqueue onto.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse(req, 405, "Method not allowed");
  const user = await requireUser(req);
  if (!user) return errorResponse(req, 401, "Unauthorized");

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return errorResponse(req, 400, "id query param is required");

  const supabase = serviceClient();
  const { data: contact, error: fetchError } = await supabase
    .from("contacts")
    .select("id, match_status, created_at, rep_id")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) return errorResponse(req, 500, fetchError.message);
  if (!contact) return errorResponse(req, 404, `No contact with id '${id}'.`);
  if (user.role === "sales" && contact.rep_id !== user.id) return errorResponse(req, 404, `No contact with id '${id}'.`);
  if (contact.match_status !== "pending") {
    return errorResponse(req, 400, "Contact is not pending — nothing to retry.");
  }

  const { error } = await supabase
    .from("contacts")
    .update({ match_attempts: 0, last_match_attempt_at: null })
    .eq("id", id);
  if (error) return errorResponse(req, 500, error.message);

  return jsonResponse(req, { id: contact.id, createdAt: contact.created_at });
});

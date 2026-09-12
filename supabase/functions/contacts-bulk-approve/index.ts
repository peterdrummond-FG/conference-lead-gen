// POST { ids: string[] } -> { approved: string[], skipped: {id, reason}[] }
// Staff-gated.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

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
    .select("id, match_status, rep_id")
    .in("id", body.ids);
  if (fetchError) return errorResponse(req, 500, fetchError.message);

  const approved: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  const toApprove: string[] = [];

  for (const id of body.ids as string[]) {
    const contact = contacts.find((c) => c.id === id);
    if (!contact || (user.role === "sales" && contact.rep_id !== user.id)) {
      skipped.push({ id, reason: "not found" });
      continue;
    }
    if (contact.match_status === "pending") {
      skipped.push({ id, reason: "still pending" });
      continue;
    }
    toApprove.push(id);
    approved.push(id);
  }

  if (toApprove.length > 0) {
    const { error } = await supabase
      .from("contacts")
      .update({ review_status: "approved", auto_approved: false })
      .in("id", toApprove);
    if (error) return errorResponse(req, 500, error.message);
  }

  return jsonResponse(req, { approved, skipped });
});

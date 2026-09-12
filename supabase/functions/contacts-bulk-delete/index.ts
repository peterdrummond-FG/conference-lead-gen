// POST { ids: string[] } -> { deleted: string[], skipped: {id, reason}[] }
// Staff-gated. Scoped to review_status='rejected' server-side (not just the
// UI only showing this on the Rejected tab) so a stale client selection can
// never delete a live row.
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
    .select("id, review_status, rep_id")
    .in("id", body.ids);
  if (fetchError) return errorResponse(req, 500, fetchError.message);

  const deleted: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  const toDelete: string[] = [];

  for (const id of body.ids as string[]) {
    const contact = contacts.find((c) => c.id === id);
    if (!contact || (user.role === "sales" && contact.rep_id !== user.id)) {
      skipped.push({ id, reason: "not found" });
      continue;
    }
    if (contact.review_status !== "rejected") {
      skipped.push({ id, reason: "not rejected" });
      continue;
    }
    toDelete.push(id);
    deleted.push(id);
  }

  if (toDelete.length > 0) {
    const { error } = await supabase.from("contacts").delete().in("id", toDelete);
    if (error) return errorResponse(req, 500, error.message);
  }

  return jsonResponse(req, { deleted, skipped });
});

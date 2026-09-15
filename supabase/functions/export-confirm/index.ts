// POST { batchId } -> { marked: number }. Staff-gated, same roles as
// export-csv. Phase 2 of the two-phase export (audit Q2).
//
// export-csv reserves a batch and returns its id in X-Export-Batch-Id without
// stamping synced_at. The client calls this once the CSV blob is actually in
// the user's hands. Until it does, those contacts stay unsynced and come back
// on the next export -- which is the whole point: a dropped download used to
// lose the leads permanently, with no record of which ones.
//
// Idempotent by construction (export_confirm no-ops on an unknown or
// already-confirmed batch and returns 0), so a client retry after a dropped
// response cannot double-stamp.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { hasRole, requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse(req, 405, "Method not allowed");

  const user = await requireUser(req);
  if (!user || !hasRole(user, ["admin", "solutionsSuccess"])) {
    return errorResponse(req, 401, "Unauthorized");
  }

  const body = await req.json().catch(() => null);
  const batchId = typeof body?.batchId === "string" ? body.batchId.trim() : "";
  // Validate the shape before querying: an unvalidated id reaches Postgres as
  // a cast error and surfaces as an opaque 500 instead of a 400.
  if (!UUID_RE.test(batchId)) return errorResponse(req, 400, "batchId must be a UUID");

  const supabase = serviceClient();
  const { data, error } = await supabase.rpc("export_confirm", { p_batch_id: batchId });
  if (error) return errorResponse(req, 500, error.message);

  return jsonResponse(req, { marked: data ?? 0 });
});

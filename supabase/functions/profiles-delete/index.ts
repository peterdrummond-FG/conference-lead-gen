// POST { id } -> { deleted: true }. Same manage-hierarchy gating as
// profiles-update. Deletes the actual auth.users login (cascades to
// profiles via its FK), not just the profiles row, so the account can no
// longer sign in at all -- not just lose its profile.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { hasRole, requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

const MANAGEABLE_ROLES_BY_CALLER: Record<string, string[]> = {
  admin: ["solutionsSuccess", "sales"],
  solutionsSuccess: ["sales"],
};

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse(req, 405, "Method not allowed");

  const caller = await requireUser(req);
  if (!caller) return errorResponse(req, 401, "Unauthorized");
  if (!hasRole(caller, ["admin", "solutionsSuccess"])) return errorResponse(req, 403, "Forbidden");

  const body = await req.json().catch(() => null);
  if (!body || typeof body.id !== "string") return errorResponse(req, 400, "id is required");
  if (body.id === caller.id) return errorResponse(req, 403, "You may not delete your own account.");

  const manageableRoles = MANAGEABLE_ROLES_BY_CALLER[caller.role] ?? [];

  const supabase = serviceClient();
  const { data: target, error: targetError } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", body.id)
    .maybeSingle();
  if (targetError) return errorResponse(req, 500, targetError.message);
  if (!target || !manageableRoles.includes(target.role)) return errorResponse(req, 404, `No account with id '${body.id}'.`);

  const { error } = await supabase.auth.admin.deleteUser(body.id);
  if (error) return errorResponse(req, 500, error.message);

  return jsonResponse(req, { deleted: true });
});

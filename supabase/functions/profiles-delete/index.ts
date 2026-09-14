// POST { id } -> { deleted: true }. Deletes the actual auth.users login
// (cascades to profiles via its FK), not just the profiles row, so the
// account can no longer sign in at all -- not just lose its profile.
//
// The manage hierarchy here is deliberately wider than profiles-create /
// profiles-update: an admin may delete *any* account including another
// admin's, because the Manage Users list already shows admins every
// account and offering a delete button that always 404s is worse than the
// risk of one admin removing another. Deleting your own account is still
// refused below, so an org can never lock itself out of admin entirely.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { hasRole, requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

const DELETABLE_ROLES_BY_CALLER: Record<string, string[]> = {
  admin: ["admin", "solutionsSuccess", "sales"],
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

  const deletableRoles = DELETABLE_ROLES_BY_CALLER[caller.role] ?? [];

  const supabase = serviceClient();
  const { data: target, error: targetError } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", body.id)
    .maybeSingle();
  if (targetError) return errorResponse(req, 500, targetError.message);
  if (!target || !deletableRoles.includes(target.role)) return errorResponse(req, 404, `No account with id '${body.id}'.`);

  const { error } = await supabase.auth.admin.deleteUser(body.id);
  if (error) return errorResponse(req, 500, error.message);

  return jsonResponse(req, { deleted: true });
});

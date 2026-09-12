// POST { id, name?, phoneNumber?, role? } -> the updated Profile. Same
// manage-hierarchy gating as profiles-create, checked against BOTH the
// target's current role and (if changing) its new role -- and nobody may
// change their own role, to rule out self-escalation. Exception: a caller
// editing their own name/phone is always allowed even though their own
// role (e.g. 'admin') isn't in anyone's manageable-roles list -- that list
// is about managing *other* accounts, not editing your own non-role
// fields.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { hasRole, requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";
import { normalizeUsPhone } from "../_shared/phone.ts";

const MANAGEABLE_ROLES_BY_CALLER: Record<string, string[]> = {
  admin: ["solutionsSuccess", "sales"],
  solutionsSuccess: ["sales"],
};

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST" && req.method !== "PATCH") return errorResponse(req, 405, "Method not allowed");

  const caller = await requireUser(req);
  if (!caller) return errorResponse(req, 401, "Unauthorized");
  if (!hasRole(caller, ["admin", "solutionsSuccess"])) return errorResponse(req, 403, "Forbidden");

  const body = await req.json().catch(() => null);
  if (!body || typeof body.id !== "string") return errorResponse(req, 400, "id is required");

  const manageableRoles = MANAGEABLE_ROLES_BY_CALLER[caller.role] ?? [];
  const isSelf = body.id === caller.id;

  if (typeof body.role === "string" && isSelf) return errorResponse(req, 403, "You may not change your own role.");

  const supabase = serviceClient();
  const { data: target, error: targetError } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", body.id)
    .maybeSingle();
  if (targetError) return errorResponse(req, 500, targetError.message);
  if (!target) return errorResponse(req, 404, `No account with id '${body.id}'.`);
  if (!isSelf && !manageableRoles.includes(target.role)) return errorResponse(req, 404, `No account with id '${body.id}'.`);

  if (typeof body.role === "string" && body.role !== target.role) {
    if (!manageableRoles.includes(body.role)) return errorResponse(req, 403, `You may not set role '${body.role}'.`);
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) updates.name = body.name.trim();
  if (typeof body.role === "string") updates.role = body.role;
  if (body.phoneNumber !== undefined) {
    if (body.phoneNumber === null) {
      updates.phone_number = null;
    } else {
      const phoneNumber = normalizeUsPhone(body.phoneNumber);
      if (!phoneNumber) return errorResponse(req, 400, "phoneNumber must be a valid US phone number.");
      updates.phone_number = phoneNumber;
    }
  }

  const { data: updated, error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", body.id)
    .select()
    .single();
  if (error) return errorResponse(req, 500, error.message);

  return jsonResponse(req, {
    id: updated.id,
    name: updated.name,
    role: updated.role,
    phoneNumber: updated.phone_number,
    currentEventId: updated.current_event_id,
  });
});

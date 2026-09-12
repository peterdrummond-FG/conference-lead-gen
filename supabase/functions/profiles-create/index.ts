// POST { email, password, name, role, phoneNumber? } -> the created Profile.
// admin can create 'solutionsSuccess' or 'sales' accounts; solutionsSuccess
// can create 'sales' only. The admin/manager sets a temporary password
// directly here (no invite-email flow) -- the new user can change it later
// via the normal Supabase Auth password-reset flow.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { hasRole, requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";
import { normalizeUsPhone } from "../_shared/phone.ts";

const CREATABLE_ROLES_BY_CALLER: Record<string, string[]> = {
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
  if (
    !body ||
    typeof body.email !== "string" || !body.email.trim() ||
    typeof body.password !== "string" || body.password.length < 6 ||
    typeof body.name !== "string" || !body.name.trim() ||
    typeof body.role !== "string"
  ) {
    return errorResponse(req, 400, "email, password (6+ chars), name, and role are required.");
  }

  const allowedRoles = CREATABLE_ROLES_BY_CALLER[caller.role] ?? [];
  if (!allowedRoles.includes(body.role)) {
    return errorResponse(req, 403, `You may not create a '${body.role}' account.`);
  }

  let phoneNumber: string | null = null;
  if (body.phoneNumber) {
    phoneNumber = normalizeUsPhone(body.phoneNumber);
    if (!phoneNumber) return errorResponse(req, 400, "phoneNumber must be a valid US phone number.");
  }

  const supabase = serviceClient();

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: body.email.trim(),
    password: body.password,
    email_confirm: true,
  });
  if (createError || !created.user) return errorResponse(req, 500, createError?.message ?? "Could not create the account.");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .insert({
      id: created.user.id,
      name: body.name.trim(),
      role: body.role,
      phone_number: phoneNumber,
    })
    .select()
    .single();
  if (profileError) {
    // Don't leave a login with no matching profile behind -- requireUser
    // would 401 it forever with no way to fix it short of direct SQL.
    await supabase.auth.admin.deleteUser(created.user.id);
    return errorResponse(req, 500, profileError.message);
  }

  return jsonResponse(req, {
    id: profile.id,
    name: profile.name,
    role: profile.role,
    phoneNumber: profile.phone_number,
    currentEventId: profile.current_event_id,
    email: created.user.email,
  }, 201);
});

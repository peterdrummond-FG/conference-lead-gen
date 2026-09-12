// GET -> Profile[]. admin sees everyone; solutionsSuccess sees sales-role
// profiles only (the accounts they're allowed to manage). Used by Setup's
// user-management screen, the booth/session rep-assignment picker, and
// MainLayout's admin-only user switcher.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { hasRole, requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return errorResponse(req, 405, "Method not allowed");

  const user = await requireUser(req);
  if (!user) return errorResponse(req, 401, "Unauthorized");
  if (!hasRole(user, ["admin", "solutionsSuccess"])) return errorResponse(req, 403, "Forbidden");

  const supabase = serviceClient();
  let query = supabase
    .from("profiles")
    .select("id, name, role, phone_number, current_event_id")
    .order("name");
  if (user.role === "solutionsSuccess") query = query.eq("role", "sales");

  const { data: profiles, error } = await query;
  if (error) return errorResponse(req, 500, error.message);

  // profiles has no email column (auth.users.email is the source of truth)
  // -- listUsers() is the service-role way to read it in bulk rather than
  // one getUserById per row.
  const { data: usersPage, error: usersError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (usersError) return errorResponse(req, 500, usersError.message);
  const emailById = new Map(usersPage.users.map((u) => [u.id, u.email ?? null]));

  return jsonResponse(
    req,
    profiles.map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      phoneNumber: p.phone_number,
      currentEventId: p.current_event_id,
      email: emailById.get(p.id) ?? null,
    })),
  );
});

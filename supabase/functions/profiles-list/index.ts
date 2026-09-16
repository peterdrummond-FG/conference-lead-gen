// GET -> Profile[]. admin sees everyone; solutionsSuccess sees sales-role
// profiles only (the accounts they're allowed to manage). Used by Setup's
// user-management screen, the booth/session rep-assignment picker, and
// MainLayout's admin-only user switcher.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { hasRole, requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";
import { withUniqueRepSlug } from "../_shared/repSlug.ts";

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
    .select("id, name, role, phone_number, current_event_id, rep_slug")
    .order("name");
  if (user.role === "solutionsSuccess") query = query.eq("role", "sales");

  const { data: profiles, error } = await query;
  if (error) return errorResponse(req, 500, error.message);

  // Self-heals a sales profile with no rep_slug rather than leaving it
  // permanently QR-less. Found 2026-09-16: a rep created in the ~30-minute
  // window between the rep_slug migration's one-time backfill
  // (20260916212541_add_profiles_rep_slug.sql) and profiles-create picking
  // up the code that generates one at insert time fell through both --
  // nothing ever revisits an existing row, so it would have stayed null
  // forever. Any future gap of the same shape (a direct SQL insert, a
  // promotion path that skips profiles-update, a bug in either) self-heals
  // here instead of needing another one-off migration.
  await Promise.all(
    profiles
      .filter((p) => p.role === "sales" && !p.rep_slug)
      .map(async (p) => {
        const { data: healed } = await withUniqueRepSlug(p.name, (candidate) =>
          supabase
            .from("profiles")
            .update({ rep_slug: candidate })
            .eq("id", p.id)
            .eq("role", "sales")
            .is("rep_slug", null)
            .select("rep_slug")
            .single());
        if (healed) p.rep_slug = healed.rep_slug;
      }),
  );

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
      repSlug: p.rep_slug,
      email: emailById.get(p.id) ?? null,
    })),
  );
});

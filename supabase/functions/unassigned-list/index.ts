// GET -> { count, items: [...] }. admin / solutionsSuccess only.
//
// The "needs a conference" queue: public submissions contacts-create couldn't
// place (a rep with no conference, a deleted rep, a QR for a conference that has
// ended, no QR, a Kiosk tab with no conference) and held instead of losing. Review's
// panel lists them so Solutions Success can file each under a live conference
// (unassigned-assign) or discard it (unassigned-discard). Reps never see this: it
// holds other people's submissions, including ones with no rep at all.
//
// Newest first, like the rest of Review. Capped; `count` is the true number of
// pending rows so the banner never under-reports a long queue.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { hasRole, requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

const PAGE = 200;

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return errorResponse(req, 405, "Method not allowed");

  const user = await requireUser(req);
  if (!user) return errorResponse(req, 401, "Unauthorized");
  if (!hasRole(user, ["admin", "solutionsSuccess"])) return errorResponse(req, 403, "Forbidden");

  const supabase = serviceClient();
  const { data, error, count } = await supabase
    .from("unassigned_submissions")
    .select(
      "id, first_name, last_name, email, phone, title, state, school_district_name_raw, school_name_raw, " +
        "reason, rep_id, event_hint_id, created_at, rep:profiles!rep_id(name), event:events!event_hint_id(name)",
      { count: "exact" },
    )
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(PAGE);
  if (error) return errorResponse(req, 500, error.message);

  // deno-lint-ignore no-explicit-any
  const items = (data ?? []).map((r: any) => ({
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email,
    phone: r.phone,
    title: r.title,
    state: r.state,
    districtName: r.school_district_name_raw,
    schoolName: r.school_name_raw,
    reason: r.reason,
    repId: r.rep_id,
    repName: r.rep?.name ?? null,
    eventHintId: r.event_hint_id,
    eventHintName: r.event?.name ?? null,
    createdAt: r.created_at,
  }));

  return jsonResponse(req, { count: count ?? items.length, items });
});

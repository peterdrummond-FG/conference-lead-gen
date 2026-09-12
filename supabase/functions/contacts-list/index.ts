// GET ?reviewStatus=&matchStatus=  -> ContactListItem[]
// Any logged-in user, but what comes back is scoped by role:
//
// - admin/solutionsSuccess: unscoped (same as always), plus two optional
//   filters: ?repId= (slice Review down to one rep's leads — the existing
//   rep-filter dropdown) and ?synced=true|false (approved-but-not-yet-
//   exported vs. already-sent-to-Zoho, now that export is consequential).
// - sales: ALWAYS forced to their own contacts server-side (a rep's browser
//   must never receive another rep's rows over the wire, unlike the old
//   client-side-only filtering) via ?scope=current|past — see
//   scopedContactsForRep below.
//
// admin may ALSO pass ?viewAsRepId= (the "view as" user switcher) to see
// Review exactly as that sales rep would — same scope=current|past/synced
// semantics as a real sales caller, just resolved against the target
// rep's own current_event_id rather than the admin's. This never changes
// which credential is on the wire (still the admin's own JWT), so writes
// made while viewing as someone are still attributed to the admin, not the
// rep being previewed.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";
import { attachDuplicateNames, CONTACT_SELECT, toListItem } from "../_shared/contacts.ts";

// deno-lint-ignore no-explicit-any
async function scopedContactsForRep(
  supabase: any,
  params: { repId: string; currentEventId: string | null; scope: "current" | "past"; reviewStatus: string; matchStatus: string; synced: string | null },
) {
  if (params.scope === "current" && !params.currentEventId) return [];

  let query = supabase
    .from("contacts")
    .select(CONTACT_SELECT)
    .order("created_at", { ascending: false })
    .eq("rep_id", params.repId)
    .eq("review_status", params.reviewStatus);
  if (params.matchStatus) query = query.eq("match_status", params.matchStatus);

  if (params.scope === "current") {
    query = query.eq("event_id", params.currentEventId as string);
  } else {
    query = query.neq("event_id", params.currentEventId ?? "00000000-0000-0000-0000-000000000000");
    if (params.synced === "true") query = query.not("synced_at", "is", null);
    if (params.synced === "false") query = query.is("synced_at", null);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return errorResponse(req, 405, "Method not allowed");

  const user = await requireUser(req);
  if (!user) return errorResponse(req, 401, "Unauthorized");

  const url = new URL(req.url);
  const reviewStatus = url.searchParams.get("reviewStatus")?.trim() || "needs_review";
  const matchStatus = url.searchParams.get("matchStatus")?.trim() ?? "";
  const synced = url.searchParams.get("synced");

  const supabase = serviceClient();

  const viewAsRepId = user.role === "admin" ? url.searchParams.get("viewAsRepId") : null;

  if (user.role === "sales" || viewAsRepId) {
    const repId = viewAsRepId ?? user.id;
    let currentEventId = user.currentEventId;
    if (viewAsRepId) {
      const { data: target, error: targetError } = await supabase
        .from("profiles")
        .select("current_event_id, role")
        .eq("id", viewAsRepId)
        .maybeSingle();
      if (targetError) return errorResponse(req, 500, targetError.message);
      if (!target || target.role !== "sales") return errorResponse(req, 400, "viewAsRepId must be a sales rep.");
      currentEventId = target.current_event_id;
    }

    const scope = url.searchParams.get("scope") === "past" ? "past" : "current";
    let data: unknown[];
    try {
      data = await scopedContactsForRep(supabase, { repId, currentEventId, scope, reviewStatus, matchStatus, synced });
    } catch (error) {
      return errorResponse(req, 500, error instanceof Error ? error.message : String(error));
    }

    const duplicateNames = await attachDuplicateNames(supabase, data);
    return jsonResponse(req, data.map((c) => toListItem(c, duplicateNames)));
  }

  const repId = url.searchParams.get("repId");
  let query = supabase.from("contacts").select(CONTACT_SELECT).order("created_at", { ascending: false });
  query = query.eq("review_status", reviewStatus);
  if (matchStatus) query = query.eq("match_status", matchStatus);
  if (repId) query = query.eq("rep_id", repId);
  if (synced === "true") query = query.not("synced_at", "is", null);
  if (synced === "false") query = query.is("synced_at", null);

  const { data, error } = await query;
  if (error) return errorResponse(req, 500, error.message);

  const duplicateNames = await attachDuplicateNames(supabase, data);
  return jsonResponse(req, data.map((c) => toListItem(c, duplicateNames)));
});

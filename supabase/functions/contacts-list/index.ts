// GET ?reviewStatus=&matchStatus=  -> ContactListItem[]
// GET ?reviewStatus=&...&page=1[&pageSize=100] -> { items: ContactListItem[], page, pageSize, total }
//   Without `page` the whole list comes back as a plain array (what the app used before
//   paging), read page by page and refused past 5,000 rows rather than cut short at the
//   database's 1000-row limit. With `page`, just that page (100 rows by default) and the
//   total, newest first with the id as a tiebreak so pages do not overlap or skip. See
//   _shared/pageParams.ts. Writes nothing.
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
import { type PageRequest, parsePageRequest } from "../_shared/pageParams.ts";
import { ordered, readContacts } from "../_shared/contactsPaging.ts";

async function scopedContactsForRep(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  params: { repId: string; currentEventId: string | null; scope: "current" | "past"; reviewStatus: string; matchStatus: string; synced: string | null },
  pageRequest: PageRequest | null,
) {
  if (params.scope === "current" && !params.currentEventId) return { rows: [], total: 0 };

  return await readContacts((withCount) => {
    let query = ordered(
      supabase.from("contacts").select(CONTACT_SELECT, withCount ? { count: "exact" } : undefined),
    )
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
    return query;
  }, pageRequest);
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

  const parsed = parsePageRequest(url.searchParams);
  if (parsed && "error" in parsed) return errorResponse(req, 400, parsed.error);
  const pageRequest: PageRequest | null = parsed;

  const supabase = serviceClient();

  // One place that shapes the answer: a plain array without `page`, a page object with it.
  // deno-lint-ignore no-explicit-any
  async function respond(rows: any[], total: number) {
    const duplicateNames = await attachDuplicateNames(supabase, rows);
    const items = rows.map((c) => toListItem(c, duplicateNames));
    if (!pageRequest) return jsonResponse(req, items);
    return jsonResponse(req, { items, page: pageRequest.page, pageSize: pageRequest.pageSize, total });
  }

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
    try {
      const { rows, total } = await scopedContactsForRep(
        supabase,
        { repId, currentEventId, scope, reviewStatus, matchStatus, synced },
        pageRequest,
      );
      return await respond(rows, total);
    } catch (error) {
      return errorResponse(req, 500, error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error));
    }
  }

  const repId = url.searchParams.get("repId");
  try {
    const { rows, total } = await readContacts((withCount) => {
      let query = ordered(supabase.from("contacts").select(CONTACT_SELECT, withCount ? { count: "exact" } : undefined));
      query = query.eq("review_status", reviewStatus);
      if (matchStatus) query = query.eq("match_status", matchStatus);
      if (repId) query = query.eq("rep_id", repId);
      if (synced === "true") query = query.not("synced_at", "is", null);
      if (synced === "false") query = query.is("synced_at", null);
      return query;
    }, pageRequest);
    return await respond(rows, total);
  } catch (error) {
    return errorResponse(req, 500, error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error));
  }
});

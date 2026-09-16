// GET ?slug=<slug> -> the Event that slug belongs to, or null. GET
// ?repSlug=<repSlug> -> the event that sales rep is currently linked to
// (profiles.current_event_id), or null if they aren't linked to one right
// now. GET with neither -> the caller's own linked event, or (for staff with
// none linked) whichever event was activated most recently. Public — Intake
// needs this to know which event contacts are attached to without a PIN.
//
// Multiple conferences can be active at once (see
// 20260915120000_event_slug_and_concurrent_events.sql), so there is no
// longer a single "the active event" to fall back to blindly -- a bare GET
// with no slug/repSlug and no linked user picks *an* event, not necessarily
// the right one, which is why every real caller should be passing one of the
// others. IntakePage reads slug off a pre-Stage-20 per-event QR URL
// (/connect/<slug>/<repId>) and repSlug off a rep's own reusable QR
// (/connect/<repSlug> -- see 20260916212541_add_profiles_rep_slug.sql);
// SetupPage relies on the logged-in user's own current_event_id.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { hasRole, requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";
import { optionalString, LIMITS } from "../_shared/validate.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return errorResponse(req, 405, "Method not allowed");

  const url = new URL(req.url);
  const slug = optionalString(url.searchParams.get("slug"), LIMITS.name);
  if (slug === undefined) return errorResponse(req, 400, "slug is invalid.");
  const repSlug = optionalString(url.searchParams.get("repSlug"), LIMITS.name);
  if (repSlug === undefined) return errorResponse(req, 400, "repSlug is invalid.");

  const supabase = serviceClient();
  const user = await requireUser(req); // null for the public intake form

  let data;
  if (slug) {
    const { data: bySlug, error } = await supabase.from("events").select("*").eq("slug", slug).maybeSingle();
    if (error) return errorResponse(req, 500, error.message);
    data = bySlug;
  } else if (repSlug) {
    const { data: rep, error: repError } = await supabase
      .from("profiles")
      .select("current_event_id")
      .eq("rep_slug", repSlug)
      .eq("role", "sales")
      .maybeSingle();
    if (repError) return errorResponse(req, 500, repError.message);
    if (!rep?.current_event_id) {
      data = null;
    } else {
      const { data: linked, error } = await supabase.from("events").select("*").eq("id", rep.current_event_id).maybeSingle();
      if (error) return errorResponse(req, 500, error.message);
      data = linked;
    }
  } else if (user?.currentEventId) {
    const { data: linked, error } = await supabase.from("events").select("*").eq("id", user.currentEventId).maybeSingle();
    if (error) return errorResponse(req, 500, error.message);
    data = linked;
  } else {
    // Legacy fallback for a bare /setup or /intake with no slug and no
    // linked user -- picks whichever active event was activated last rather
    // than crashing now that more than one row can be is_active.
    const { data: mostRecent, error } = await supabase
      .from("events")
      .select("*")
      .eq("is_active", true)
      .order("activated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return errorResponse(req, 500, error.message);
    data = mostRecent;
  }
  if (!data) return jsonResponse(req, null);

  // Whether the logged-in caller is themself linked (event_reps) to this
  // event -- drives SetupPage's "Download my QR" button. Only meaningful for
  // an authenticated caller; the public intake form never needs it.
  let isLinkedRep = false;
  if (user) {
    const { data: link, error: linkError } = await supabase
      .from("event_reps")
      .select("rep_id")
      .eq("event_id", data.id)
      .eq("rep_id", user.id)
      .maybeSingle();
    if (linkError) return errorResponse(req, 500, linkError.message);
    isLinkedRep = !!link;
  }

  // Audit S11 (and its regression, found 2026-09-16): folder_code is the SMS
  // bind token -- anyone holding it can text the Twilio number, bind a phone
  // to this event, and push photos and voice memos into the intake pipeline.
  // "Returned only to a logged-in caller" was not the right boundary: with
  // multiple conferences active at once, ANY authenticated user (a sales rep
  // included) could pass a DIFFERENT event's public slug here and get that
  // event's folder_code -- e.g. a rep still logged into the SPA on a booth
  // device who opens another conference's /connect/<slug>/<repId> link. The
  // real boundary is staff, or a rep actually linked to *this* event -- both
  // already computed above. slug is not sensitive -- it's the whole point of
  // the QR code being public -- so it's returned either way; SetupPage needs
  // it to build the /connect/<slug>/<repId> URL.
  const canSeeFolderCode = !!user && (hasRole(user, ["admin", "solutionsSuccess"]) || isLinkedRep);
  return jsonResponse(req, {
    id: data.id,
    name: data.name,
    state: data.state,
    slug: data.slug,
    activatedAt: data.activated_at,
    ...(user ? { isLinkedRep } : {}),
    ...(canSeeFolderCode ? { folderCode: data.folder_code } : {}),
  });
});

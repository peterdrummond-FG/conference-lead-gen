// GET ?slug=<slug> -> the Event that slug belongs to, or null. GET with no
// slug -> the caller's own linked event (profiles.current_event_id), or (for
// staff with none linked) whichever event was activated most recently.
// Public — Intake needs this to know which event contacts are attached to
// without a PIN.
//
// Multiple conferences can be active at once (see
// 20260915120000_event_slug_and_concurrent_events.sql), so there is no
// longer a single "the active event" to fall back to blindly -- a bare GET
// with no slug and no linked user picks *an* event, not necessarily the
// right one, which is why every real caller should be passing one or the
// other. IntakePage reads the slug off the per-rep QR URL
// (/connect/<slug>/<repId>); SetupPage relies on the logged-in user's own
// current_event_id.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";
import { optionalString, LIMITS } from "../_shared/validate.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return errorResponse(req, 405, "Method not allowed");

  const url = new URL(req.url);
  const slug = optionalString(url.searchParams.get("slug"), LIMITS.name);
  if (slug === undefined) return errorResponse(req, 400, "slug is invalid.");

  const supabase = serviceClient();
  const user = await requireUser(req); // null for the public intake form

  let data;
  if (slug) {
    const { data: bySlug, error } = await supabase.from("events").select("*").eq("slug", slug).maybeSingle();
    if (error) return errorResponse(req, 500, error.message);
    data = bySlug;
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

  // Audit S11. folder_code is the SMS bind token: anyone holding it can text
  // the Twilio number, bind a phone to this event, and push photos and voice
  // memos into the intake pipeline. Intake itself never needs it -- it is for
  // the Setup page, which is staff-gated -- so it is returned only to a
  // logged-in caller. slug is not sensitive -- it's the whole point of the QR
  // code being public -- so it's returned either way; SetupPage needs it to
  // build the /connect/<slug>/<repId> URL.
  return jsonResponse(req, {
    id: data.id,
    name: data.name,
    state: data.state,
    slug: data.slug,
    activatedAt: data.activated_at,
    ...(user
      ? {
        folderCode: data.folder_code,
        isLinkedRep,
      }
      : {}),
  });
});

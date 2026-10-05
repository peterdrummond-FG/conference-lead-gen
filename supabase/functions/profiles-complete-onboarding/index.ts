// POST { event } -> { ok: true }. Any logged-in role. Records where the caller
// is in the first-time onboarding (splash, quick start, animated tour, the
// one-hour reminder). Always writes the caller's OWN profile; there is
// deliberately no body-supplied target, so nobody can mark someone else's
// onboarding as seen.
//
//   { event: 'seen' }                                  they chose something on the splash
//   { event: 'ended', path: 'quick'|'tour',
//     resumeFrom: <scene id> | null }                  they left it (Close, Text SETUP, Skip)
//   { event: 'reminder-shown' }                        the one-hour reminder was shown
//   { event: 'complete' }                              nothing left to see (tour finished)
//
// Idempotent, and every value is validated: the body comes from a browser, and
// resumeFrom later decides which scenes a person is shown, so it must be one of
// the scene ids the tour really has (tourFlow.ts; a test keeps the two lists the
// same). The ? replay button only ever sends 'complete'; 'seen' is stamped once
// and never rewritten, so a replay can't re-open the splash.
//
// Replaces the old body-less call that stamped profiles.onboarded_at (the first
// welcome tour). A body-less call is now a 400: an older cached tab finishing the
// old tour just fails quietly on its own, which is harmless.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

// The ids in frontend/src/components/tour/tourFlow.ts (TOUR_SCENES) plus the
// import-only half of "Send us leads". Keep in step; frontend test checks.
export const RESUME_IDS = ["setup", "send", "send-import", "qr", "review", "export", "admin"];

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse(req, 405, "Method not allowed");

  const user = await requireUser(req);
  if (!user) return errorResponse(req, 401, "Unauthorized");

  const body = await req.json().catch(() => null);
  if (!body || typeof body.event !== "string") {
    return errorResponse(req, 400, "event is required.");
  }

  const now = new Date().toISOString();
  const supabase = serviceClient();

  // First stamp wins: "seen" is the moment they first chose something, and
  // reminder-shown is "the reminder happened", neither is moved by a repeat.
  const stampOnce = async (column: string) => {
    const { error } = await supabase.from("profiles").update({ [column]: now }).eq("id", user.id).is(column, null);
    return error;
  };

  switch (body.event) {
    case "seen": {
      const error = await stampOnce("onboarding_v2_seen_at");
      if (error) return errorResponse(req, 500, error.message);
      break;
    }
    case "ended": {
      if (body.path !== "quick" && body.path !== "tour") {
        return errorResponse(req, 400, "path must be 'quick' or 'tour'.");
      }
      if (body.resumeFrom !== null && !RESUME_IDS.includes(body.resumeFrom)) {
        return errorResponse(req, 400, "resumeFrom must be a known scene id or null.");
      }
      // Leaving also means they have seen the splash. A new ending replaces the
      // old one and re-arms the reminder, because what is left may have changed.
      const { error } = await supabase
        .from("profiles")
        .update({
          onboarding_path: body.path,
          onboarding_ended_at: now,
          tour_resume_from: body.resumeFrom,
          onboarding_reminder_shown_at: null,
        })
        .eq("id", user.id);
      if (error) return errorResponse(req, 500, error.message);
      const seenError = await stampOnce("onboarding_v2_seen_at");
      if (seenError) return errorResponse(req, 500, seenError.message);
      break;
    }
    case "reminder-shown": {
      const error = await stampOnce("onboarding_reminder_shown_at");
      if (error) return errorResponse(req, 500, error.message);
      break;
    }
    case "complete": {
      // Nothing left to see. The path they took stays; a full replay from ?
      // by someone who never chose one counts as the tour.
      const { error } = await supabase
        .from("profiles")
        .update({ tour_resume_from: null })
        .eq("id", user.id);
      if (error) return errorResponse(req, 500, error.message);
      const seenError = await stampOnce("onboarding_v2_seen_at");
      if (seenError) return errorResponse(req, 500, seenError.message);
      const { error: pathError } = await supabase
        .from("profiles")
        .update({ onboarding_path: "tour" })
        .eq("id", user.id)
        .is("onboarding_path", null);
      if (pathError) return errorResponse(req, 500, pathError.message);
      break;
    }
    default:
      return errorResponse(req, 400, "Unknown event.");
  }

  return jsonResponse(req, { ok: true });
});

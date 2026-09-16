// POST { firstName, lastName, email?, phone?, title?, state?, schoolDistrictId?,
//        schoolDistrictNameRaw?, schoolId?, schoolNameRaw?, channel?, repId?,
//        eventSlug?, repSlug? } -> { id, createdAt }, 201. Public (kiosk form, no PIN).
//
// State/district/school are all attendee-optional. A typed value that didn't
// match an existing district/school row arrives as *NameRaw plain text
// instead of an id — it is never turned into a new school_districts/schools
// row here (that's what created the free-text junk this schema replaced).
//
// channel ('booth' | 'session', optional) is now a plain form field the
// attendee picks themselves — Stage 19 retired the old per-channel QR/rep
// slot (events.booth_rep_id/session_rep_id), so which physical QR was
// scanned no longer implies a channel. Still stored in contacts.qr_channel;
// only the source of the value changed.
//
// repId is the specific rep whose QR the attendee scanned
// (/connect/<slug>/<repId> — see routes.ts, pre-Stage-20). It is revalidated
// here against event_reps rather than trusted outright: a stale QR (the rep
// was unlinked), a bookmarked/typed URL, or a tampered param all just fail
// the lookup and fall back to no rep credited, the same forgiving treatment
// the old channel-based lookup got — which rep gets credit is a nice-to-have
// attribution, not something worth blocking a submission over.
//
// eventSlug is the specific event that QR's URL encoded
// (/connect/<slug>/<repId> — see routes.ts, pre-Stage-20). Multiple
// conferences can be active at once
// (20260915120000_event_slug_and_concurrent_events.sql), so this — not "the"
// active event — is what decides which event a submission belongs to. Falls
// back to the most-recently-activated active event only when no slug (and
// no repSlug) is present at all (a bare/legacy /intake link), which is
// ambiguous by construction once more than one event is active.
//
// repSlug (Stage 20 — 20260916212541_add_profiles_rep_slug.sql) is a rep's
// own permanent identifier (/connect/<repSlug>, one QR reused across every
// conference they work) and, unlike eventSlug/repId, is NOT optional
// attribution — it's the only signal this submission carries, so it has to
// resolve to both an event and a rep or the submission is rejected outright.
// The event is whatever that rep is currently linked to
// (profiles.current_event_id) at the moment of submission, not anything
// baked into the QR. Takes priority over eventSlug/repId when present (the
// two shapes are never both populated by a real QR — see routes.ts — but a
// tampered/combined request shouldn't get to pick the more permissive path).
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { serviceClient } from "../_shared/supabase-client.ts";
import { isUuid, LIMITS, optionalEmail, optionalString, requiredString } from "../_shared/validate.ts";
import { VALID_US_STATES } from "../_shared/usStates.ts";

// Generous on purpose: conference wifi is usually one NAT, so this has to
// bound automation without policing a booth queue. See audit S2 and
// check_submission_rate.
const RATE_MAX = Number(Deno.env.get("INTAKE_RATE_MAX") ?? 20);
const RATE_WINDOW_MINUTES = Number(Deno.env.get("INTAKE_RATE_WINDOW_MINUTES") ?? 10);

async function hashIp(ip: string): Promise<string> {
  const salt = Deno.env.get("IP_HASH_SALT") ?? "";
  const bytes = new TextEncoder().encode(ip + salt);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse(req, 405, "Method not allowed");

  const body = await req.json().catch(() => null);

  const firstName = requiredString(body?.firstName, LIMITS.name);
  const lastName = requiredString(body?.lastName, LIMITS.name);
  if (!firstName || !lastName) {
    return errorResponse(req, 400, `firstName and lastName are required and must be 1-${LIMITS.name} characters.`);
  }

  const email = optionalEmail(body.email);
  if (email === undefined) return errorResponse(req, 400, "email is not a valid address.");
  const phone = optionalString(body.phone, LIMITS.phone);
  if (phone === undefined) return errorResponse(req, 400, `phone must be under ${LIMITS.phone} characters.`);
  // A captured lead with no way to reach them isn't useful, so this isn't
  // optional just because a client forgot. Card-photo submissions
  // (contacts-from-ocr) deliberately do NOT enforce this.
  if (!email && !phone) {
    return errorResponse(req, 400, "At least one of email or phone is required.");
  }

  const title = optionalString(body.title, LIMITS.title);
  const districtRaw = optionalString(body.schoolDistrictNameRaw, LIMITS.institution);
  const schoolRaw = optionalString(body.schoolNameRaw, LIMITS.institution);
  if (title === undefined || districtRaw === undefined || schoolRaw === undefined) {
    return errorResponse(req, 400, `title, district and school must each be under ${LIMITS.institution} characters.`);
  }

  // VALID_US_STATES already existed for exactly this ("validating a contact's
  // own attendee-supplied state", per usStates.ts) and was simply never
  // applied here. An unvalidated state produces rows no district filter will
  // ever match.
  const state = optionalString(body.state, LIMITS.state);
  if (state === undefined) return errorResponse(req, 400, "state is too long.");
  if (state && !VALID_US_STATES.has(state)) {
    return errorResponse(req, 400, `state must be a full US state name, got '${state}'.`);
  }

  if (body.schoolId && !body.schoolDistrictId) {
    return errorResponse(req, 400, "schoolId requires schoolDistrictId — a school can't be picked without its district.");
  }

  // Honeypot: a field no human ever sees, so anything in it is automation.
  // Answer 201 rather than 400 -- a bot that learns it was detected just
  // adapts, and a real user can never trip this.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return jsonResponse(req, { id: crypto.randomUUID(), createdAt: new Date().toISOString() }, 201);
  }

  const qrChannel = body.channel === "booth" || body.channel === "session" ? body.channel : null;
  const eventSlug = optionalString(body.eventSlug, LIMITS.name);
  if (eventSlug === undefined) return errorResponse(req, 400, "eventSlug is invalid.");
  const repIdParam = isUuid(body.repId) ? body.repId : null;
  const repSlug = optionalString(body.repSlug, LIMITS.name);
  if (repSlug === undefined) return errorResponse(req, 400, "repSlug is invalid.");

  const supabase = serviceClient();

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { data: allowed, error: rateError } = await supabase.rpc("check_submission_rate", {
    p_ip_hash: await hashIp(ip),
    p_max: RATE_MAX,
    p_window_minutes: RATE_WINDOW_MINUTES,
  });
  // Fail open on a rate-limiter error: losing a real attendee's submission is
  // worse than missing one enforcement window.
  if (rateError) console.error("check_submission_rate failed", rateError);
  else if (allowed === false) {
    return errorResponse(req, 429, "Too many submissions from this network — please try again in a few minutes.");
  }

  let activeEvent;
  let repId: string | null = null;
  if (repSlug) {
    // A rep's reusable QR (see header comment) is the only signal this
    // submission carries, so — unlike the eventSlug/repId path below — a
    // rep that doesn't resolve, or one not currently linked to any event, is
    // a rejected submission, not a forgiving fallback: there is nothing else
    // to attribute this lead to.
    const { data: rep, error: repError } = await supabase
      .from("profiles")
      .select("id, current_event_id")
      .eq("rep_slug", repSlug)
      .eq("role", "sales")
      .maybeSingle();
    if (repError) return errorResponse(req, 500, repError.message);
    if (!rep) return errorResponse(req, 404, `No rep found for '${repSlug}'.`);
    if (!rep.current_event_id) {
      return errorResponse(req, 409, "This rep isn't linked to a conference right now — link them in Setup before sharing their QR.");
    }
    activeEvent = { id: rep.current_event_id };
    repId = rep.id;
  } else if (eventSlug) {
    // The event is resolved server-side by the slug the QR's URL carried,
    // never trusted as an id from the client. A slug that doesn't match any
    // event is a 404, not a silent fall-through — better than mis-attributing
    // a lead to the wrong conference.
    const { data: bySlug, error: eventError } = await supabase
      .from("events")
      .select("id")
      .eq("slug", eventSlug)
      .maybeSingle();
    if (eventError) return errorResponse(req, 500, eventError.message);
    if (!bySlug) return errorResponse(req, 404, `No event found for '${eventSlug}'.`);
    activeEvent = bySlug;

    // The rep whose QR was actually scanned, revalidated against event_reps —
    // a stale/unlinked/tampered repId just means no rep gets credited, not a
    // rejected submission (see header comment).
    if (repIdParam) {
      const { data: linkedRep, error: linkedRepError } = await supabase
        .from("event_reps")
        .select("rep_id")
        .eq("event_id", activeEvent.id)
        .eq("rep_id", repIdParam)
        .maybeSingle();
      if (linkedRepError) return errorResponse(req, 500, linkedRepError.message);
      repId = linkedRep?.rep_id ?? null;
    }
  } else {
    const { data: mostRecent, error: eventError } = await supabase
      .from("events")
      .select("id")
      .eq("is_active", true)
      .order("activated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (eventError) return errorResponse(req, 500, eventError.message);
    if (!mostRecent) return errorResponse(req, 409, "No active event. Activate one via events-activate first.");
    activeEvent = mostRecent;
  }

  // Signing up from a breakout session is a stronger self-selected engagement
  // signal than a booth walk-up, so it starts hot instead of unclassified.
  // contact_intent_is_manual defaults to false, so local-agent's intentLoop
  // still takes over (and can downgrade this) the moment real interaction
  // notes show up — this is a starting value, not a lock.
  const contactIntent = qrChannel === "session" ? "hot" : null;

  if (body.schoolDistrictId) {
    const { data: district, error: districtError } = await supabase
      .from("school_districts")
      .select("id")
      .eq("id", body.schoolDistrictId)
      .maybeSingle();
    if (districtError) return errorResponse(req, 500, districtError.message);
    if (!district) return errorResponse(req, 404, `No district with id '${body.schoolDistrictId}'.`);
  }

  if (body.schoolId) {
    const { data: school, error: schoolError } = await supabase
      .from("schools")
      .select("id, district_id")
      .eq("id", body.schoolId)
      .maybeSingle();
    if (schoolError) return errorResponse(req, 500, schoolError.message);
    if (!school) return errorResponse(req, 404, `No school with id '${body.schoolId}'.`);
    if (school.district_id !== body.schoolDistrictId) {
      return errorResponse(req, 400, `School '${body.schoolId}' does not belong to district '${body.schoolDistrictId}'.`);
    }
  }

  // The duplicate-name check and the insert happen atomically inside this
  // function (an advisory lock keyed on the normalized name serializes
  // concurrent inserts for the same person) -- doing the check and the
  // insert as two separate round-trips here would let two near-simultaneous
  // submissions for the same person both miss each other.
  const { data, error } = await supabase
    .rpc("insert_contact_with_duplicate_check", {
      payload: {
        event_id: activeEvent.id,
        source: "form",
        qr_channel: qrChannel,
        rep_id: repId,
        contact_intent: contactIntent,
        first_name: firstName,
        last_name: lastName,
        email,
        phone,
        title,
        state,
        school_district_id: body.schoolDistrictId || null,
        school_district_name_raw: body.schoolDistrictId ? null : districtRaw,
        school_id: body.schoolId || null,
        school_name_raw: body.schoolId ? null : schoolRaw,
      },
    })
    .single();
  if (error) return errorResponse(req, 500, error.message);

  return jsonResponse(req, { id: data.id, createdAt: data.created_at }, 201);
});

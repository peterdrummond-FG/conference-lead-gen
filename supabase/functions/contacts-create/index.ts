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
// active event — is what decides which event a submission belongs to. A bare
// call (no slug, no repSlug) is resolved from the CALLER, never from "the
// most recently activated event": a signed-in caller (the Connect tab inside
// the app) lands in their own current_event_id and, if they're a sales rep, is
// credited. See _shared/intakeDestination.ts for the whole decision.
//
// repSlug (Stage 20 — 20260916212541_add_profiles_rep_slug.sql) is a rep's
// own permanent identifier (/connect/<repSlug>, one QR reused across every
// conference they work). The event is whatever that rep is currently linked to
// (profiles.current_event_id) at the moment of submission, not anything
// baked into the QR. Takes priority over eventSlug/repId when present (the
// two shapes are never both populated by a real QR — see routes.ts — but a
// tampered/combined request shouldn't get to pick the more permissive path).
//
// A submission that can't be placed (a rep with no conference, a deleted rep, a
// QR for a conference that has ended, no QR and nobody signed in, a Kiosk tab
// with no conference) is no longer rejected with a 404/409 -- that lost a valid
// attendee's details. It is held in unassigned_submissions and answered with the
// same 201 as any other, for Solutions Success to file (unassigned-assign). Only
// a request that fails validation (400) or the rate/queue caps (429) is refused.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";
import { isUuid, LIMITS, optionalEmail, optionalString, requiredString } from "../_shared/validate.ts";
import { VALID_US_STATES } from "../_shared/usStates.ts";
import { type IntakeDestination, type IntakeLookups, resolveIntakeDestination } from "../_shared/intakeDestination.ts";

// Generous on purpose: conference wifi is usually one NAT, so this has to
// bound automation without policing a booth queue. See audit S2 and
// check_submission_rate.
const RATE_MAX = Number(Deno.env.get("INTAKE_RATE_MAX") ?? 20);
const RATE_WINDOW_MINUTES = Number(Deno.env.get("INTAKE_RATE_WINDOW_MINUTES") ?? 10);

// Ceilings on the "needs a conference" queue (unassigned_submissions): rows from
// one network per 24h, and pending rows overall. Generous because conference
// wifi is one NAT; the per-10-minute rate limit above is what stops a burst.
const QUEUE_IP_CAP = Number(Deno.env.get("INTAKE_QUEUE_IP_CAP") ?? 300);
const QUEUE_TOTAL_CAP = Number(Deno.env.get("INTAKE_QUEUE_TOTAL_CAP") ?? 3000);

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
  const ipHash = await hashIp(ip);
  const { data: allowed, error: rateError } = await supabase.rpc("check_submission_rate", {
    p_ip_hash: ipHash,
    p_max: RATE_MAX,
    p_window_minutes: RATE_WINDOW_MINUTES,
  });
  // Fail open on a rate-limiter error: losing a real attendee's submission is
  // worse than missing one enforcement window.
  if (rateError) console.error("check_submission_rate failed", rateError);
  else if (allowed === false) {
    return errorResponse(req, 429, "Too many submissions from this network — please try again in a few minutes.");
  }

  // Where does this belong? Every way of not finding a conference used to be a
  // 404/409 that threw the attendee's details away; now it is a queue
  // destination (see _shared/intakeDestination.ts for each case and why).
  const lookups: IntakeLookups = {
    async salesRepBySlug(slug) {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, current_event_id")
        .eq("rep_slug", slug)
        .eq("role", "sales")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? { id: data.id, currentEventId: data.current_event_id } : null;
    },
    async eventIsActive(eventId) {
      const { data, error } = await supabase.from("events").select("id").eq("id", eventId).eq("is_active", true).maybeSingle();
      if (error) throw new Error(error.message);
      return !!data;
    },
    async eventBySlug(slug) {
      const { data, error } = await supabase.from("events").select("id, is_active").eq("slug", slug).maybeSingle();
      if (error) throw new Error(error.message);
      return data ? { id: data.id, isActive: data.is_active } : null;
    },
    async linkedSalesRep(eventId, repIdToCheck) {
      // Revalidated against event_reps, never trusted: a stale/unlinked/tampered
      // repId just means no rep is credited, not a rejected submission.
      const { data: link, error: linkError } = await supabase
        .from("event_reps")
        .select("rep_id")
        .eq("event_id", eventId)
        .eq("rep_id", repIdToCheck)
        .maybeSingle();
      if (linkError) throw new Error(linkError.message);
      if (!link) return null;
      const { data: rep, error: repError } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", repIdToCheck)
        .eq("role", "sales")
        .maybeSingle();
      if (repError) throw new Error(repError.message);
      return rep ? rep.id : null;
    },
    caller: () => requireUser(req),
  };

  let destination: IntakeDestination;
  try {
    destination = await resolveIntakeDestination(lookups, { repSlug, eventSlug, repIdParam });
  } catch (err) {
    // A lookup that failed is a server problem, never "no conference": don't
    // queue something that may well have one.
    console.error("contacts-create: destination lookup failed", err);
    return errorResponse(req, 500, err instanceof Error ? err.message : "Lookup failed");
  }

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

  const fields = {
    qr_channel: qrChannel,
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
  };

  if (destination.kind === "queue") {
    // Held for Solutions Success, not rejected: the attendee gets the same
    // success as any other submission, because the form did its job and what is
    // missing (which conference) is ours to sort out, not theirs. Nothing
    // expensive runs here: no contact row, so no matching and no AI until a
    // person files it (assign_unassigned_submission).
    //
    // Bounded: check_submission_rate above limits requests per network, and this
    // adds a ceiling on what can pile up, per network per day and overall. Both
    // fail closed with the same 429 wording.
    const { data: queuedId, error: queueError } = await supabase.rpc("queue_unassigned_submission", {
      p: {
        ...fields,
        reason: destination.reason,
        rep_id: destination.repId,
        event_hint_id: destination.eventHintId,
        rep_slug: repSlug,
        event_slug: eventSlug,
      },
      p_ip_hash: ipHash,
      p_ip_cap: QUEUE_IP_CAP,
      p_total_cap: QUEUE_TOTAL_CAP,
    });
    if (queueError) return errorResponse(req, 500, queueError.message);
    if (queuedId === null) {
      console.error("contacts-create: unassigned queue cap reached", { reason: destination.reason });
      return errorResponse(req, 429, "Too many submissions from this network — please try again in a few minutes.");
    }
    return jsonResponse(req, { id: queuedId, createdAt: new Date().toISOString() }, 201);
  }

  // The duplicate-name check and the insert happen atomically inside this
  // function (an advisory lock keyed on the normalized name serializes
  // concurrent inserts for the same person) -- doing the check and the
  // insert as two separate round-trips here would let two near-simultaneous
  // submissions for the same person both miss each other.
  const { data, error } = await supabase
    .rpc("insert_contact_with_duplicate_check", {
      payload: {
        event_id: destination.eventId,
        source: "form",
        rep_id: destination.repId,
        ...fields,
      },
    })
    .single();
  if (error) return errorResponse(req, 500, error.message);

  // rpc() is untyped here (no generated types in this project), so say what
  // insert_contact_with_duplicate_check returns.
  const contact = data as { id: string; created_at: string };
  return jsonResponse(req, { id: contact.id, createdAt: contact.created_at }, 201);
});

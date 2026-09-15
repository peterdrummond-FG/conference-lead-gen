// POST { firstName, lastName, email?, phone?, title?, state?, schoolDistrictId?,
//        schoolDistrictNameRaw?, schoolId?, schoolNameRaw?, qrChannel? }
// -> { id, createdAt }, 201. Public (kiosk form, no PIN).
//
// State/district/school are all attendee-optional. A typed value that didn't
// match an existing district/school row arrives as *NameRaw plain text
// instead of an id — it is never turned into a new school_districts/schools
// row here (that's what created the free-text junk this schema replaced).
//
// qrChannel ('booth' | 'session') is the ?channel= query param IntakePage.vue
// read off the URL the attendee actually scanned — anything else (missing,
// a bookmarked/typed URL, a stale value) is silently dropped to null rather
// than rejected, since which QR drove the scan is a nice-to-have tag, not
// something worth blocking a submission over.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { serviceClient } from "../_shared/supabase-client.ts";
import { LIMITS, optionalEmail, optionalString, requiredString } from "../_shared/validate.ts";
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

  const qrChannel = body.qrChannel === "booth" || body.qrChannel === "session" ? body.qrChannel : null;

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

  // EventId is resolved server-side, never trusted from the client.
  const { data: activeEvent, error: eventError } = await supabase
    .from("events")
    .select("id, booth_rep_id, session_rep_id")
    .eq("is_active", true)
    .maybeSingle();
  if (eventError) return errorResponse(req, 500, eventError.message);
  if (!activeEvent) return errorResponse(req, 409, "No active event. Activate one via events-activate first.");

  // Whichever rep is currently credited for this channel on the active
  // event (set via events-assign-rep) — null if that channel has no rep
  // assigned, or the scan carried no channel at all.
  const repId = qrChannel === "booth"
    ? activeEvent.booth_rep_id
    : qrChannel === "session"
    ? activeEvent.session_rep_id
    : null;

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

// POST { eventFolderCode, firstName, lastName, email?, phone?, title?,
//        districtName?, schoolName?, extractionConfidence,
//        sourceImageHash, sourceImagePath, croppedImagePath?,
//        inboundMessageId? (Stage 13) }
// -> { id, alreadyProcessed, createdAt }. Called only by process-cards
// (watcher) and, later, the local agent's SMS-photo poll loop — never a
// browser. Authenticated via the service-role key, not a logged-in user.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { isServiceRoleCall } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";
import { resolveDistrict, resolveSchool } from "../_shared/contacts.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse(req, 405, "Method not allowed");
  if (!isServiceRoleCall(req)) return errorResponse(req, 401, "Unauthorized");

  const body = await req.json().catch(() => null);
  if (
    !body ||
    typeof body.eventFolderCode !== "string" ||
    typeof body.firstName !== "string" || !body.firstName.trim() ||
    typeof body.lastName !== "string" || !body.lastName.trim() ||
    typeof body.extractionConfidence !== "string" ||
    typeof body.sourceImageHash !== "string" ||
    typeof body.sourceImagePath !== "string"
  ) {
    return errorResponse(req, 400, "firstName and lastName are required.");
  }

  const supabase = serviceClient();

  // Folder code, never a client-trusted EventId — cards are processed after
  // the event, possibly once a different one is already active.
  // folder_code is always generated lowercase (events_activate) -- lowercase
  // defensively here too, same reasoning as twilio-webhook's own lookup.
  const { data: targetEvent, error: eventError } = await supabase
    .from("events")
    .select("id, state")
    .eq("folder_code", body.eventFolderCode.toLowerCase())
    .maybeSingle();
  if (eventError) return errorResponse(req, 500, eventError.message);
  if (!targetEvent) return errorResponse(req, 404, `No event with folder code '${body.eventFolderCode}'.`);

  // A repeat is a no-op, not a duplicate contact — defense-in-depth behind
  // the watcher's own local archive-hash check.
  const { data: existingByHash, error: existingError } = await supabase
    .from("contacts")
    .select("id, created_at")
    .eq("source_image_hash", body.sourceImageHash)
    .maybeSingle();
  if (existingError) return errorResponse(req, 500, existingError.message);
  if (existingByHash) {
    return jsonResponse(req, { id: existingByHash.id, alreadyProcessed: true, createdAt: existingByHash.created_at });
  }

  // Whichever rep's phone this card was texted in from, if that number
  // matches a sales rep's profile — same attribution contacts-create does
  // via the active event's channel assignment, just resolved from the
  // sender's phone number instead since there's no QR channel involved here.
  let repId: string | null = null;
  if (body.inboundMessageId) {
    const { data: message } = await supabase
      .from("inbound_messages")
      .select("from_phone")
      .eq("id", body.inboundMessageId)
      .maybeSingle();
    if (message?.from_phone) {
      const { data: rep } = await supabase
        .from("profiles")
        .select("id")
        .eq("phone_number", message.from_phone)
        .eq("role", "sales")
        .maybeSingle();
      repId = rep?.id ?? null;
    }
  }

  const district = await resolveDistrict(supabase, targetEvent.state, body.districtName);
  // A school can only be matched within a resolved district's scope — if the
  // district itself didn't resolve to a real row, any school name is kept as
  // plain text too rather than guessed at.
  const school = district.id
    ? await resolveSchool(supabase, district.id, body.schoolName)
    : { id: null, raw: body.schoolName?.trim() || null };
  // A confident district match's own state is more specific than the
  // conference's; otherwise the conference location is a reasonable
  // reviewer-editable guess at the attendee's state.
  const state = district.state ?? targetEvent.state ?? null;

  // Duplicate-name check + insert happen atomically inside this function --
  // same reasoning as contacts-create (see insert_contact_with_duplicate_check).
  const { data, error } = await supabase
    .rpc("insert_contact_with_duplicate_check", {
      payload: {
        event_id: targetEvent.id,
        source: "card_photo",
        rep_id: repId,
        first_name: body.firstName,
        last_name: body.lastName,
        // Deliberately not enforced the way contacts-create enforces it — a
        // photographed card routinely has neither legible.
        email: body.email?.trim() || null,
        phone: body.phone?.trim() || null,
        title: body.title || null,
        state,
        school_district_id: district.id,
        school_district_name_raw: district.raw,
        school_id: school.id,
        school_name_raw: school.raw,
        extraction_confidence: body.extractionConfidence,
        source_image_path: body.sourceImagePath,
        source_image_hash: body.sourceImageHash,
        cropped_image_path: body.croppedImagePath?.trim() || null,
        source_message_id: body.inboundMessageId || null,
      },
    })
    .single();

  if (error) {
    // Unique-violation race: another request won the insert first.
    if (error.code === "23505") {
      const { data: raced } = await supabase
        .from("contacts")
        .select("id, created_at")
        .eq("source_image_hash", body.sourceImageHash)
        .maybeSingle();
      if (raced) return jsonResponse(req, { id: raced.id, alreadyProcessed: true, createdAt: raced.created_at });
    }
    return errorResponse(req, 500, error.message);
  }

  return jsonResponse(req, { id: data.id, alreadyProcessed: false, createdAt: data.created_at }, 201);
});

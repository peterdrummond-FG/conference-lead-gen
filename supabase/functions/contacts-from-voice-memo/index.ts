// POST { inboundMessageId, firstName, lastName, email?, phone?, title?,
//        districtName?, schoolName?, interactionNotes?, extractionConfidence }
// -> { id, alreadyProcessed, createdAt }. Called only by local-agent's
// transcription/relink loop, once attribute-voice-memo has judged (with
// extractFallbackContact: true) that a transcript alone names someone
// clearly enough to create a contact — after ordinary candidate-matching
// against contacts already captured at the event has repeatedly found no
// one this memo could be about. Never a browser. Authenticated via the
// service-role key, not a logged-in user.
//
// Sibling of contacts-from-note: same district/school resolution and the
// same atomic duplicate-check insert, but keyed on the originating audio
// message instead of a note submission, and tagged source='voice_memo' so a
// reviewer can tell "this came from a spoken description alone, no card, no
// pasted note" apart from every other intake path. The skill itself never
// holds the service-role key — it returns JSON and the agent does the
// writing — so a transcript containing instruction-like text has no
// credential to reach even if it did sway the model.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { isServiceRoleCall } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";
import { resolveDistrict, resolveSchool } from "../_shared/contacts.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse(req, 405, "Method not allowed");
  if (!(await isServiceRoleCall(req))) return errorResponse(req, 401, "Unauthorized");

  const body = await req.json().catch(() => null);
  if (
    !body ||
    typeof body.inboundMessageId !== "string" ||
    typeof body.firstName !== "string" || !body.firstName.trim() ||
    typeof body.extractionConfidence !== "string"
  ) {
    return errorResponse(req, 400, "inboundMessageId, firstName and extractionConfidence are required.");
  }
  // lastName is required as a *key* but may legitimately be blank — same
  // reasoning as contacts-from-note: a memo that only ever says a first name
  // still names someone worth reviewing, and contacts.last_name is NOT NULL.
  if (typeof body.lastName !== "string") {
    return errorResponse(req, 400, "lastName is required (may be an empty string).");
  }

  const supabase = serviceClient();

  // A repeat call for the same audio message (a retry after a crash between
  // this function succeeding and the caller recording link_status) is a
  // no-op, not a duplicate contact — mirrors contacts-from-ocr's
  // source_image_hash pre-check, keyed on the partial unique index over
  // (source_message_id) where source='voice_memo' instead (see
  // 20260928120000_voice_memo_fallback_contact_creation.sql).
  const { data: existing, error: existingError } = await supabase
    .from("contacts")
    .select("id, created_at")
    .eq("source_message_id", body.inboundMessageId)
    .eq("source", "voice_memo")
    .maybeSingle();
  if (existingError) return errorResponse(req, 500, existingError.message);
  if (existing) {
    return jsonResponse(req, { id: existing.id, alreadyProcessed: true, createdAt: existing.created_at });
  }

  // Event, rep, and state all come from the inbound message itself, never
  // from the caller — the skill has no business naming either, same seam as
  // contacts-from-note's note_submissions lookup.
  const { data: message, error: messageError } = await supabase
    .from("inbound_messages")
    .select("id, event_id, from_phone, event:events(state)")
    .eq("id", body.inboundMessageId)
    .maybeSingle();
  if (messageError) return errorResponse(req, 500, messageError.message);
  if (!message) return errorResponse(req, 404, `No inbound message with id '${body.inboundMessageId}'.`);
  if (!message.event_id) return errorResponse(req, 400, "Inbound message has no event_id.");

  let repId: string | null = null;
  if (message.from_phone) {
    const { data: rep } = await supabase
      .from("profiles")
      .select("id")
      .eq("phone_number", message.from_phone)
      .eq("role", "sales")
      .maybeSingle();
    repId = rep?.id ?? null;
  }

  // deno-lint-ignore no-explicit-any
  const eventState = (message.event as any)?.state ?? null;
  const district = await resolveDistrict(supabase, eventState, body.districtName);
  // A school is only resolvable inside a resolved district's scope — same
  // rule as contacts-from-ocr/-note; an unresolved district keeps both as
  // plain text.
  const school = district.id
    ? await resolveSchool(supabase, district.id, body.schoolName)
    : { id: null, raw: body.schoolName?.trim() || null };
  const state = district.state ?? eventState ?? null;

  const { data, error } = await supabase
    .rpc("insert_contact_with_duplicate_check", {
      payload: {
        event_id: message.event_id,
        source: "voice_memo",
        rep_id: repId,
        first_name: body.firstName.trim(),
        // A blank surname stays blank rather than becoming a placeholder —
        // a reviewer filling it in beats un-picking an invented one.
        last_name: body.lastName.trim(),
        email: body.email?.trim() || null,
        phone: body.phone?.trim() || null,
        title: body.title?.trim() || null,
        state,
        school_district_id: district.id,
        school_district_name_raw: district.raw,
        school_id: school.id,
        school_name_raw: school.raw,
        extraction_confidence: body.extractionConfidence,
        // Seeds interaction_notes at insert time, which is also what makes
        // intentLoop pick the contact up and classify it hot/warm/cold with
        // no extra step — see classify-contact-intent.
        interaction_notes: body.interactionNotes?.trim() || null,
        source_message_id: body.inboundMessageId,
      },
    })
    .single();

  if (error) {
    // Unique-violation race: another request (a concurrent retry sweep pass)
    // won the insert first.
    if (error.code === "23505") {
      const { data: raced } = await supabase
        .from("contacts")
        .select("id, created_at")
        .eq("source_message_id", body.inboundMessageId)
        .eq("source", "voice_memo")
        .maybeSingle();
      if (raced) return jsonResponse(req, { id: raced.id, alreadyProcessed: true, createdAt: raced.created_at });
    }
    return errorResponse(req, 500, error.message);
  }

  return jsonResponse(req, { id: data.id, alreadyProcessed: false, createdAt: data.created_at }, 201);
});

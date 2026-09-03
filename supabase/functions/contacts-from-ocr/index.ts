// POST { eventFolderCode, firstName, lastName, email?, phone?, title?,
//        districtName?, schoolName?, extractionConfidence,
//        sourceImageHash, sourceImagePath, croppedImagePath?,
//        inboundMessageId? (Stage 13) }
// -> { id, alreadyProcessed, createdAt }. Called only by process-cards
// (watcher) and, later, the local agent's SMS-photo poll loop — never a
// browser. Authenticated via the service-role key, not the staff PIN.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { isServiceRoleCall } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";
import { findLocalDuplicate, resolveDistrict, resolveSchool } from "../_shared/contacts.ts";

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
  const { data: targetEvent, error: eventError } = await supabase
    .from("events")
    .select("id, state")
    .eq("folder_code", body.eventFolderCode)
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

  const districtId = await resolveDistrict(supabase, targetEvent.state, body.districtName);
  const schoolId = await resolveSchool(supabase, districtId, body.schoolName);

  const duplicateOfId = await findLocalDuplicate(supabase, targetEvent.id, body.firstName, body.lastName, districtId);

  const { data, error } = await supabase
    .from("contacts")
    .insert({
      event_id: targetEvent.id,
      source: "card_photo",
      first_name: body.firstName,
      last_name: body.lastName,
      // Deliberately not enforced the way contacts-create enforces it — a
      // photographed card routinely has neither legible.
      email: body.email?.trim() || null,
      phone: body.phone?.trim() || null,
      title: body.title || null,
      school_district_id: districtId,
      school_id: schoolId,
      extraction_confidence: body.extractionConfidence,
      match_status: "pending",
      review_status: "needs_review",
      local_duplicate_of_contact_id: duplicateOfId,
      source_image_path: body.sourceImagePath,
      source_image_hash: body.sourceImageHash,
      cropped_image_path: body.croppedImagePath?.trim() || null,
      source_message_id: body.inboundMessageId || null,
    })
    .select("id, created_at")
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

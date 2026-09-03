// POST { firstName, lastName, email?, phone?, title?, schoolDistrictId, schoolId? }
// -> { id, createdAt }, 201. Public (kiosk form, no PIN).
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { serviceClient } from "../_shared/supabase-client.ts";
import { findLocalDuplicate } from "../_shared/contacts.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse(req, 405, "Method not allowed");

  const body = await req.json().catch(() => null);
  if (!body || typeof body.firstName !== "string" || typeof body.lastName !== "string" || typeof body.schoolDistrictId !== "string") {
    return errorResponse(req, 400, "firstName, lastName, and schoolDistrictId are required");
  }
  // A captured lead with no way to reach them isn't useful, so this isn't
  // optional just because a client forgot. Card-photo submissions
  // (contacts-from-ocr) deliberately do NOT enforce this.
  if (!body.email?.trim() && !body.phone?.trim()) {
    return errorResponse(req, 400, "At least one of email or phone is required.");
  }

  const supabase = serviceClient();

  // EventId is resolved server-side, never trusted from the client.
  const { data: activeEvent, error: eventError } = await supabase
    .from("events")
    .select("id")
    .eq("is_active", true)
    .maybeSingle();
  if (eventError) return errorResponse(req, 500, eventError.message);
  if (!activeEvent) return errorResponse(req, 409, "No active event. Activate one via events-activate first.");

  const { data: district, error: districtError } = await supabase
    .from("school_districts")
    .select("id")
    .eq("id", body.schoolDistrictId)
    .maybeSingle();
  if (districtError) return errorResponse(req, 500, districtError.message);
  if (!district) return errorResponse(req, 404, `No district with id '${body.schoolDistrictId}'.`);

  if (body.schoolId) {
    const { data: school, error: schoolError } = await supabase
      .from("schools")
      .select("id")
      .eq("id", body.schoolId)
      .maybeSingle();
    if (schoolError) return errorResponse(req, 500, schoolError.message);
    if (!school) return errorResponse(req, 404, `No school with id '${body.schoolId}'.`);
  }

  const duplicateOfId = await findLocalDuplicate(
    supabase,
    activeEvent.id,
    body.firstName,
    body.lastName,
    body.schoolDistrictId,
  );

  const { data, error } = await supabase
    .from("contacts")
    .insert({
      event_id: activeEvent.id,
      source: "form",
      first_name: body.firstName,
      last_name: body.lastName,
      email: body.email || null,
      phone: body.phone || null,
      title: body.title || null,
      school_district_id: body.schoolDistrictId,
      school_id: body.schoolId || null,
      match_status: "pending",
      review_status: "needs_review",
      local_duplicate_of_contact_id: duplicateOfId,
    })
    .select("id, created_at")
    .single();
  if (error) return errorResponse(req, 500, error.message);

  return jsonResponse(req, { id: data.id, createdAt: data.created_at }, 201);
});

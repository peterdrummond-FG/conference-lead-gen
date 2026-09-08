// POST ?id=<keeperId> { firstName, lastName, email, phone, title, state,
//   schoolDistrictId, schoolDistrictNameRaw, schoolId, schoolNameRaw,
//   discardContactIds } -> { id, createdAt }
// Staff-gated. Port of DuplicateDetection.FindDuplicateGroupAsync + the
// merge-duplicates endpoint in ContactEndpoints.cs.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireStaffPin } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse(req, 405, "Method not allowed");
  if (!(await requireStaffPin(req))) return errorResponse(req, 401, "Unauthorized");

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return errorResponse(req, 400, "id query param is required");

  const body = await req.json().catch(() => null);
  if (
    !body ||
    typeof body.firstName !== "string" || typeof body.lastName !== "string" ||
    !Array.isArray(body.discardContactIds)
  ) {
    return errorResponse(req, 400, "firstName, lastName, and discardContactIds are required.");
  }
  if (body.schoolId && !body.schoolDistrictId) {
    return errorResponse(req, 400, "schoolId requires schoolDistrictId — a school can't be picked without its district.");
  }

  const supabase = serviceClient();

  const { data: keeper, error: keeperError } = await supabase
    .from("contacts")
    .select("id, local_duplicate_of_contact_id, review_status, auto_approved")
    .eq("id", id)
    .maybeSingle();
  if (keeperError) return errorResponse(req, 500, keeperError.message);
  if (!keeper) return errorResponse(req, 404, `No contact with id '${id}'.`);

  const anchorIds = new Set<string>([keeper.id]);
  if (keeper.local_duplicate_of_contact_id) anchorIds.add(keeper.local_duplicate_of_contact_id);

  const { data: group, error: groupError } = await supabase
    .from("contacts")
    .select("id, local_duplicate_of_contact_id, notes")
    .or(
      `id.in.(${[...anchorIds].join(",")}),local_duplicate_of_contact_id.in.(${[...anchorIds].join(",")})`,
    );
  if (groupError) return errorResponse(req, 500, groupError.message);

  const groupIds = new Set(group.map((c) => c.id));
  const badDiscardId = body.discardContactIds.find((discardId: string) => !groupIds.has(discardId));
  if (badDiscardId) return errorResponse(req, 400, `Contact '${badDiscardId}' is not part of this duplicate group.`);
  if (body.discardContactIds.includes(id)) return errorResponse(req, 400, "Cannot discard the contact being kept.");

  if (body.schoolDistrictId) {
    const { data: district } = await supabase.from("school_districts").select("id").eq("id", body.schoolDistrictId).maybeSingle();
    if (!district) return errorResponse(req, 404, `No district with id '${body.schoolDistrictId}'.`);
  }
  if (body.schoolId) {
    const { data: school } = await supabase.from("schools").select("id, district_id").eq("id", body.schoolId).maybeSingle();
    if (!school) return errorResponse(req, 404, `No school with id '${body.schoolId}'.`);
    if (school.district_id !== body.schoolDistrictId) {
      return errorResponse(req, 400, `School '${body.schoolId}' does not belong to district '${body.schoolDistrictId}'.`);
    }
  }

  // deno-lint-ignore no-explicit-any
  const keeperUpdate: Record<string, any> = {
    first_name: body.firstName,
    last_name: body.lastName,
    email: body.email ?? null,
    phone: body.phone ?? null,
    title: body.title ?? null,
    state: body.state ?? null,
    school_district_id: body.schoolDistrictId ?? null,
    school_district_name_raw: body.schoolDistrictId ? null : (body.schoolDistrictNameRaw?.trim() || null),
    school_id: body.schoolId ?? null,
    school_name_raw: body.schoolId ? null : (body.schoolNameRaw?.trim() || null),
    local_duplicate_of_contact_id: null,
  };
  // The pipeline's own auto-approve rule can't know a *later* card will turn
  // out to be a duplicate of this one — safe to undo automatically. A
  // reviewer's own explicit Approve (auto_approved already false) is never
  // touched here.
  if (keeper.review_status === "approved" && keeper.auto_approved) {
    keeperUpdate.review_status = "needs_review";
    keeperUpdate.auto_approved = false;
  }

  const { data: updatedKeeper, error: updateError } = await supabase
    .from("contacts")
    .update(keeperUpdate)
    .eq("id", id)
    .select("id, created_at")
    .single();
  if (updateError) return errorResponse(req, 500, updateError.message);

  for (const discardId of body.discardContactIds) {
    const discarded = group.find((c) => c.id === discardId);
    const mergeNote = `Merged as duplicate of ${body.firstName} ${body.lastName}.`;
    const notes = discarded?.notes ? `${discarded.notes} ${mergeNote}` : mergeNote;
    const { error } = await supabase
      .from("contacts")
      .update({ review_status: "rejected", notes })
      .eq("id", discardId);
    if (error) return errorResponse(req, 500, error.message);
  }

  return jsonResponse(req, { id: updatedKeeper.id, createdAt: updatedKeeper.created_at });
});

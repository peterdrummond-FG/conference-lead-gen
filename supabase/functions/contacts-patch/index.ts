// PATCH { ...any subset of updatable fields... } -> { id, createdAt }
// Staff-gated. Uses `'key' in body` (not `body.key !== undefined`) to tell
// "key omitted" from "key present as null" apart — the same semantic gap
// backend/Common/Optional.cs closed in C#.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireStaffPin } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

const NO_CLEAR_FIELDS = ["firstName", "lastName", "matchStatus", "reviewStatus"];

// deno-lint-ignore no-explicit-any
function has(body: any, key: string) {
  return Object.prototype.hasOwnProperty.call(body, key);
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "PATCH" && req.method !== "PUT") return errorResponse(req, 405, "Method not allowed");
  if (!(await requireStaffPin(req))) return errorResponse(req, 401, "Unauthorized");

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return errorResponse(req, 400, "id query param is required");

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return errorResponse(req, 400, "Invalid JSON body");

  for (const field of NO_CLEAR_FIELDS) {
    if (has(body, field) && body[field] === null) {
      return errorResponse(req, 400, "firstName, lastName, matchStatus and reviewStatus cannot be explicitly cleared.");
    }
  }

  const supabase = serviceClient();

  const { data: contact, error: fetchError } = await supabase
    .from("contacts")
    .select("match_status, school_district_id, school_id")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) return errorResponse(req, 500, fetchError.message);
  if (!contact) return errorResponse(req, 404, `No contact with id '${id}'.`);

  if (has(body, "schoolDistrictId") && body.schoolDistrictId) {
    const { data: d } = await supabase.from("school_districts").select("id").eq("id", body.schoolDistrictId).maybeSingle();
    if (!d) return errorResponse(req, 404, `No district with id '${body.schoolDistrictId}'.`);
  }

  // Effective post-update values (patched value if present in this request,
  // else whatever's already on the row) — a partial patch that only touches
  // schoolId (or only clears schoolDistrictId) must still end up consistent,
  // same rule contacts-create/contacts-merge-duplicates already enforce.
  const effectiveSchoolId = has(body, "schoolId") ? body.schoolId : contact.school_id;
  const effectiveDistrictId = has(body, "schoolDistrictId") ? body.schoolDistrictId : contact.school_district_id;
  if (effectiveSchoolId) {
    if (!effectiveDistrictId) {
      return errorResponse(req, 400, "schoolId requires schoolDistrictId — a school can't be picked without its district.");
    }
    const { data: s, error: sErr } = await supabase.from("schools").select("id, district_id").eq("id", effectiveSchoolId).maybeSingle();
    if (sErr) return errorResponse(req, 500, sErr.message);
    if (!s) return errorResponse(req, 404, `No school with id '${effectiveSchoolId}'.`);
    if (s.district_id !== effectiveDistrictId) {
      return errorResponse(req, 400, `School '${effectiveSchoolId}' does not belong to district '${effectiveDistrictId}'.`);
    }
  }

  // deno-lint-ignore no-explicit-any
  const updates: Record<string, any> = {};
  const map: Record<string, string> = {
    firstName: "first_name",
    lastName: "last_name",
    email: "email",
    phone: "phone",
    title: "title",
    state: "state",
    schoolDistrictId: "school_district_id",
    schoolDistrictNameRaw: "school_district_name_raw",
    schoolId: "school_id",
    schoolNameRaw: "school_name_raw",
    matchedZohoAccountId: "matched_zoho_account_id",
    matchedZohoAccountName: "matched_zoho_account_name",
    matchedZohoContactId: "matched_zoho_contact_id",
    matchedZohoContactName: "matched_zoho_contact_name",
    matchedZohoContactEmail: "matched_zoho_contact_email",
    matchedZohoContactPhone: "matched_zoho_contact_phone",
    matchedZohoContactTitle: "matched_zoho_contact_title",
    matchStatus: "match_status",
    matchConfidence: "match_confidence",
    reviewStatus: "review_status",
    interactionNotes: "interaction_notes",
  };
  for (const [jsonKey, column] of Object.entries(map)) {
    if (has(body, jsonKey)) updates[column] = body[jsonKey];
  }

  // Any explicit reviewStatus change here is a human decision — never
  // something merge-duplicates should later treat as safe to auto-undo.
  if (has(body, "reviewStatus")) updates.auto_approved = false;

  // The doc's own rule: a still-Pending row can't reach Approved. Judged on
  // this request's *effective* matchStatus (post-update), not what was in
  // the DB before it.
  const effectiveMatchStatus = has(body, "matchStatus") ? body.matchStatus : contact.match_status;
  if (has(body, "reviewStatus") && body.reviewStatus === "approved" && effectiveMatchStatus === "pending") {
    return errorResponse(req, 400, "Cannot approve a contact while MatchStatus is still pending.");
  }

  const { data, error } = await supabase
    .from("contacts")
    .update(updates)
    .eq("id", id)
    .select("id, created_at")
    .single();
  if (error) return errorResponse(req, 500, error.message);

  return jsonResponse(req, { id: data.id, createdAt: data.created_at });
});

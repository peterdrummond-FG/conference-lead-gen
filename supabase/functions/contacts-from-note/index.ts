// Stage 17 — POST { noteSubmissionId, firstName, lastName, email?, phone?,
//        title?, districtName?, schoolName?, interactionNotes?,
//        extractionConfidence }
// -> { id, createdAt }, 201. Called only by local-agent's noteLoop once
// extract-note-contacts has split a pasted note into people — never a
// browser. Authenticated via the service-role key, not a logged-in user.
//
// Sibling of contacts-from-ocr: same district/school resolution and the same
// atomic duplicate-check insert, but keyed on a note submission instead of an
// image hash. The skill itself never holds the service-role key — it returns
// JSON and the agent does the writing — so a note containing instruction-like
// text has no credential to reach even if it did sway the model.
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
    typeof body.noteSubmissionId !== "string" ||
    typeof body.firstName !== "string" || !body.firstName.trim() ||
    typeof body.extractionConfidence !== "string"
  ) {
    return errorResponse(req, 400, "noteSubmissionId, firstName and extractionConfidence are required.");
  }
  // lastName is required as a *key* but may legitimately be blank — a note
  // that says only "talked to Marcus" still has a person worth reviewing,
  // and contacts.last_name is NOT NULL. Deliberately not the same rule as
  // contacts-create's email-or-phone requirement, for the same reason
  // contacts-from-ocr doesn't enforce that either: typed notes routinely
  // carry neither, and dropping the lead is worse than reviewing a thin one.
  if (typeof body.lastName !== "string") {
    return errorResponse(req, 400, "lastName is required (may be an empty string).");
  }

  const supabase = serviceClient();

  // Event and rep both come from the submission row, never from the caller
  // — the extraction skill has no business naming either, and this is the
  // seam where a note's contents stop being able to influence anything but
  // the contact's own fields.
  const { data: submission, error: submissionError } = await supabase
    .from("note_submissions")
    .select("id, event_id, submitted_by, event:events(state)")
    .eq("id", body.noteSubmissionId)
    .maybeSingle();
  if (submissionError) return errorResponse(req, 500, submissionError.message);
  if (!submission) return errorResponse(req, 404, `No note submission with id '${body.noteSubmissionId}'.`);

  // Only a sales rep's own paste credits them on the contact — Review's rep
  // filter is built from sales profiles, so crediting an admin here would
  // produce a rep_id that can never be filtered for.
  const { data: submitter } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", submission.submitted_by)
    .maybeSingle();
  const repId = submitter?.role === "sales" ? submitter.id : null;

  // deno-lint-ignore no-explicit-any
  const eventState = (submission.event as any)?.state ?? null;
  const district = await resolveDistrict(supabase, eventState, body.districtName);
  // A school is only resolvable inside a resolved district's scope — same
  // rule as contacts-from-ocr; an unresolved district keeps both as text.
  const school = district.id
    ? await resolveSchool(supabase, district.id, body.schoolName)
    : { id: null, raw: body.schoolName?.trim() || null };
  const state = district.state ?? eventState ?? null;

  const { data, error } = await supabase
    .rpc("insert_contact_with_duplicate_check", {
      payload: {
        event_id: submission.event_id,
        source: "note",
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
        source_note_id: submission.id,
      },
    })
    .single();
  if (error) return errorResponse(req, 500, error.message);

  return jsonResponse(req, { id: data.id, createdAt: data.created_at }, 201);
});

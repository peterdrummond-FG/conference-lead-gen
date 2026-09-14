// Stage 17 — GET ?id=<note submission id> -> the submission's current state
// plus whatever contacts it has produced so far. Polled by NotesPage.vue
// while extraction runs (local-agent picks the row up on its own poll, then
// a `claude -p` call runs), so the rep sees what was actually pulled out of
// their note instead of having to go hunting in Review for it.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { hasRole, requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return errorResponse(req, 405, "Method not allowed");

  const user = await requireUser(req);
  if (!user) return errorResponse(req, 401, "Unauthorized");

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return errorResponse(req, 400, "id is required");

  const supabase = serviceClient();

  const { data: submission, error } = await supabase
    .from("note_submissions")
    .select("id, body, status, skipped, error, created_at, processed_at, submitted_by, event:events(name)")
    .eq("id", id)
    .maybeSingle();
  if (error) return errorResponse(req, 500, error.message);
  if (!submission) return errorResponse(req, 404, "No such note submission.");

  // A rep only ever sees their own pastes — same scoping rule Review
  // applies to their contacts. Admin/Solutions Success see everyone's, so
  // they can tell a rep what happened to a note that went wrong.
  const isOwner = submission.submitted_by === user.id;
  if (!isOwner && !hasRole(user, ["admin", "solutionsSuccess"])) {
    return errorResponse(req, 403, "That note was submitted by someone else.");
  }

  // Read the contacts back off source_note_id rather than an array written
  // alongside them: one source of truth, and a contact deleted or merged
  // afterward simply stops appearing instead of leaving a dangling id.
  const { data: contacts, error: contactsError } = await supabase
    .from("contacts")
    .select(
      "id, first_name, last_name, title, email, phone, extraction_confidence, interaction_notes, local_duplicate_of_contact_id, school_district_name_raw, school_name_raw, school_district:school_districts(name), school:schools(name), created_at",
    )
    .eq("source_note_id", id)
    .order("created_at");
  if (contactsError) return errorResponse(req, 500, contactsError.message);

  return jsonResponse(req, {
    id: submission.id,
    status: submission.status,
    error: submission.error,
    skipped: submission.skipped ?? [],
    // deno-lint-ignore no-explicit-any
    eventName: (submission.event as any)?.name ?? null,
    createdAt: submission.created_at,
    processedAt: submission.processed_at,
    contacts: (contacts ?? []).map((c) => ({
      id: c.id,
      firstName: c.first_name,
      lastName: c.last_name,
      title: c.title,
      email: c.email,
      phone: c.phone,
      extractionConfidence: c.extraction_confidence,
      interactionNotes: c.interaction_notes,
      // Whichever the pipeline resolved, falling back to the rep's own
      // typed text when it didn't resolve to a real district/school row.
      // deno-lint-ignore no-explicit-any
      districtName: (c.school_district as any)?.name ?? c.school_district_name_raw ?? null,
      // deno-lint-ignore no-explicit-any
      schoolName: (c.school as any)?.name ?? c.school_name_raw ?? null,
      isDuplicate: !!c.local_duplicate_of_contact_id,
    })),
  });
});

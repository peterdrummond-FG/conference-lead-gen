// POST { fileName, rows: [{ row, firstName, lastName, email, phone, title, state,
//   districtName, schoolName, interactionNotes }] } -> { id, eventName, added }.
// The staff-facing half of "Upload a file" on the Import page: the browser has read a
// CSV/Excel file and matched its columns, and this files one contact per row, then the
// page reads the result back through notes-status exactly as it does for a pasted note.
//
// No model runs here and none is needed: the values are the person's own cells, not text
// to be understood. Each contact is inserted with match_status 'pending', which is what
// starts research and matching in n8n (the contacts INSERT webhook), the same as every
// other intake path. Nothing is confirmed: a person confirms each lead in Contacts.
//
// It reuses note_submissions (and source 'note') so Contacts' "Imported note" source,
// the rep credit, notes-status and the Zoho Description column all work unchanged. The
// row is created already 'completed' on purpose: 'pending_extraction' would fire the
// note-extraction webhook and send a file summary to the AI, and a row left at
// 'processing' by a crash would be re-queued to it by reconcile_stale_note_submissions.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";
import { resolveNoteEvent } from "../_shared/noteEvent.ts";
import { resolveDistrict, resolveSchool } from "../_shared/contacts.ts";
import { validateImportRows } from "../_shared/fileImport.ts";

// Rows are inserted a few at a time: fast enough for 500 rows, gentle enough not to
// hold 500 database connections. Duplicate detection is safe concurrently (the RPC takes
// an advisory lock per name).
const CONCURRENCY = 5;

// The body of the request is a few hundred KB at most (500 rows); anything bigger is
// not a spreadsheet this function was written for.
const MAX_BODY_BYTES = 2_000_000;

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse(req, 405, "Method not allowed");

  const user = await requireUser(req);
  if (!user) return errorResponse(req, 401, "Unauthorized");

  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return errorResponse(req, 413, "That file is too big to import.");
  const body = await req.json().catch(() => null);

  const validation = validateImportRows(body?.rows);
  if ("error" in validation) return errorResponse(req, 400, validation.error);
  if (validation.rows.length === 0) {
    return errorResponse(req, 400, "No contact in that file has a name, so there is nothing to add.");
  }

  const supabase = serviceClient();
  const resolved = await resolveNoteEvent(supabase, user.currentEventId);
  if ("failure" in resolved) return errorResponse(req, resolved.failure.status, resolved.failure.message);
  const { event } = resolved;

  // Credit the rep only when the importer is one: Contacts' rep filter is built from
  // sales profiles, so an admin's id would be a rep_id that can never be filtered for.
  const { data: submitter } = await supabase.from("profiles").select("id, role").eq("id", user.id).maybeSingle();
  const repId = submitter?.role === "sales" ? submitter.id : null;

  const fileName = typeof body?.fileName === "string"
    ? body.fileName.replace(/\s+/g, " ").trim().slice(0, 120)
    : "";
  const total = validation.rows.length + validation.skipped.length;
  const { data: submission, error: submissionError } = await supabase
    .from("note_submissions")
    .insert({
      event_id: event.id,
      submitted_by: user.id,
      body: `File import: ${fileName || "spreadsheet"} (${total} rows)`,
      status: "completed",
      skipped: validation.skipped,
      processed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (submissionError) return errorResponse(req, 500, submissionError.message);

  // One lookup per distinct district / school, not per row: a conference list is
  // mostly the same few districts.
  const districtCache = new Map<string, ReturnType<typeof resolveDistrict>>();
  const schoolCache = new Map<string, ReturnType<typeof resolveSchool>>();
  const districtFor = (state: string | null, name: string | null) => {
    const key = `${state ?? ""}\u0000${(name ?? "").toLowerCase()}`;
    let p = districtCache.get(key);
    if (!p) districtCache.set(key, p = resolveDistrict(supabase, state, name));
    return p;
  };
  const schoolFor = (districtId: string, name: string | null) => {
    const key = `${districtId}\u0000${(name ?? "").toLowerCase()}`;
    let p = schoolCache.get(key);
    if (!p) schoolCache.set(key, p = resolveSchool(supabase, districtId, name));
    return p;
  };

  const failed: string[] = [];
  let added = 0;
  const queue = [...validation.rows];
  const worker = async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      try {
        // The row's own state is the better disambiguator when the file has one;
        // otherwise the conference's, same as a pasted note.
        const district = await districtFor(r.state ?? event.state, r.districtName);
        const school = district.id
          ? await schoolFor(district.id, r.schoolName)
          : { id: null, raw: r.schoolName };
        const { error } = await supabase.rpc("insert_contact_with_duplicate_check", {
          payload: {
            event_id: event.id,
            source: "note",
            rep_id: repId,
            first_name: r.firstName,
            last_name: r.lastName,
            email: r.email,
            phone: r.phone,
            title: r.title,
            state: district.state ?? r.state ?? event.state ?? null,
            school_district_id: district.id,
            school_district_name_raw: district.raw,
            school_id: school.id,
            school_name_raw: school.raw,
            // The values are copied from the person's own file, not read by a model,
            // so there is nothing to be unsure of; 'high' is the only honest value the
            // column allows (high/medium/low) for a verbatim copy.
            extraction_confidence: "high",
            interaction_notes: r.interactionNotes,
            source_note_id: submission.id,
          },
        });
        if (error) throw error;
        added++;
      } catch (e) {
        console.error("notes-import-file: row failed", r.row, e);
        failed.push(`Row ${r.row}: couldn't be saved.`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Reconcile after the work (reserve -> work -> confirm): anything that did not save
  // is shown to the rep, never silently missing.
  if (failed.length) {
    await supabase
      .from("note_submissions")
      .update({
        skipped: [...validation.skipped, ...failed.sort((a, b) => Number(a.slice(4, a.indexOf(":"))) - Number(b.slice(4, b.indexOf(":"))))].slice(0, 100),
        error: added === 0
          ? "None of the rows could be saved. Try again in a minute."
          : `${failed.length} row${failed.length === 1 ? "" : "s"} couldn't be saved. They are listed under Not added.`,
      })
      .eq("id", submission.id);
  }

  return jsonResponse(req, {
    id: submission.id,
    eventName: event.name,
    added,
  }, 201);
});

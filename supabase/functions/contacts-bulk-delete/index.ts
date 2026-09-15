// POST { ids: string[] } -> { deleted: string[], skipped: {id, reason}[] }
// Staff-gated. Scoped to review_status='rejected' server-side (not just the
// UI only showing this on the Rejected tab) so a stale client selection can
// never delete a live row.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse(req, 405, "Method not allowed");
  const user = await requireUser(req);
  if (!user) return errorResponse(req, 401, "Unauthorized");

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.ids)) return errorResponse(req, 400, "ids is required");

  const supabase = serviceClient();
  const { data: contacts, error: fetchError } = await supabase
    .from("contacts")
    .select("id, review_status, rep_id, source_image_path, cropped_image_path, source_message_id")
    .in("id", body.ids);
  if (fetchError) return errorResponse(req, 500, fetchError.message);

  const deleted: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  const toDelete: string[] = [];

  for (const id of body.ids as string[]) {
    const contact = contacts.find((c) => c.id === id);
    if (!contact || (user.role === "sales" && contact.rep_id !== user.id)) {
      skipped.push({ id, reason: "not found" });
      continue;
    }
    if (contact.review_status !== "rejected") {
      skipped.push({ id, reason: "not rejected" });
      continue;
    }
    toDelete.push(id);
    deleted.push(id);
  }

  if (toDelete.length > 0) {
    // Audit S12. Deleting the row used to leave the card photo and any voice
    // memo in Storage forever, so "delete this contact" did not actually
    // delete the contact's most identifying data. Remove the media first: if
    // that fails we still have the rows to retry from, whereas the reverse
    // orphans the objects with nothing pointing at them.
    const rows = contacts.filter((c) => toDelete.includes(c.id));

    const photoPaths = [
      ...new Set(
        rows.flatMap((c) => [c.source_image_path, c.cropped_image_path]).filter(Boolean) as string[],
      ),
    ];
    if (photoPaths.length > 0) {
      const { error: rmError } = await supabase.storage.from("contact-photos").remove(photoPaths);
      // Non-fatal: a missing object is the desired end state anyway, and a
      // transient Storage error must not block the row deletion the reviewer
      // asked for. The purge job (expired_media) is the backstop.
      if (rmError) console.error("contact photo cleanup failed", rmError);
    }

    const messageIds = [...new Set(rows.map((c) => c.source_message_id).filter(Boolean) as string[])];
    if (messageIds.length > 0) {
      const { data: msgs } = await supabase
        .from("inbound_messages")
        .select("id, kind, storage_path")
        .in("id", messageIds)
        .not("storage_path", "is", null);
      const audioPaths = (msgs ?? []).filter((m) => m.kind === "audio").map((m) => m.storage_path);
      if (audioPaths.length > 0) {
        const { error: audioError } = await supabase.storage.from("voice-memos").remove(audioPaths);
        if (audioError) console.error("voice memo cleanup failed", audioError);
      }
      if (msgs && msgs.length > 0) {
        await supabase.from("inbound_messages")
          .update({ storage_path: null })
          .in("id", msgs.map((m) => m.id));
      }
    }

    const { error } = await supabase.from("contacts").delete().in("id", toDelete);
    if (error) return errorResponse(req, 500, error.message);
  }

  return jsonResponse(req, { deleted, skipped });
});

// GET ?id=<contactId> -> ContactListItem[] (the whole duplicate group).
// Staff-gated. A gap caught during Stage 15's frontend wiring — this
// endpoint (backing DuplicateResolutionDialog.vue) was missed in Stage 10.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";
import { attachDuplicateNames, findDuplicateGroup, toListItem } from "../_shared/contacts.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return errorResponse(req, 405, "Method not allowed");
  const user = await requireUser(req);
  if (!user) return errorResponse(req, 401, "Unauthorized");

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return errorResponse(req, 400, "id query param is required");

  const supabase = serviceClient();
  let group = await findDuplicateGroup(supabase, id);
  if (group.length === 0) return errorResponse(req, 404, `No contact with id '${id}'.`);
  if (user.role === "sales") {
    const requested = group.find((c) => c.id === id);
    if (requested?.rep_id !== user.id) return errorResponse(req, 404, `No contact with id '${id}'.`);
    // A duplicate group can include a card another rep captured — a sales
    // rep only gets to see their own rows within it, not a teammate's.
    group = group.filter((c) => c.rep_id === user.id);
  }

  const duplicateNames = await attachDuplicateNames(supabase, group);
  return jsonResponse(req, group.map((c) => toListItem(c, duplicateNames)));
});

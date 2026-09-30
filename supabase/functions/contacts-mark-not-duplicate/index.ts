// POST ?id=<contactId> -> { cleared: number }
// Staff-gated. "These are different people who happen to share a name."
//
// A duplicate is only ever "same first and last name" (see
// insert_contact_with_duplicate_check), so two real people can be flagged. Until
// now the only way out of the Resolve-duplicate sheet was to merge (rejecting the
// others) or leave the flag in place — which also keeps the lead out of Review's
// "Ready" state for good. This clears the flag on the group and touches nothing
// else: every record stays exactly as it was, still needing its own review.
//
// The flag lives only on the newer rows (local_duplicate_of_contact_id points at
// the older one) and is set once, at insert. Clearing it dissolves the group, so
// findDuplicateGroup no longer returns these rows together.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";
import { findDuplicateGroup } from "../_shared/contacts.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse(req, 405, "Method not allowed");
  const user = await requireUser(req);
  if (!user) return errorResponse(req, 401, "Unauthorized");

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return errorResponse(req, 400, "id query param is required");

  const supabase = serviceClient();
  const group = await findDuplicateGroup(supabase, id);
  const requested = group.find((c: { id: string }) => c.id === id);
  if (!requested) return errorResponse(req, 404, `No contact with id '${id}'.`);
  // Same rule as contacts-duplicates / contacts-merge-duplicates: a sales rep
  // only acts on groups they own a row in, and only on their own rows within it.
  if (user.role === "sales" && requested.rep_id !== user.id) {
    return errorResponse(req, 404, `No contact with id '${id}'.`);
  }

  const toClear = group
    .filter((c: { local_duplicate_of_contact_id: string | null; rep_id: string | null }) =>
      c.local_duplicate_of_contact_id && (user.role !== "sales" || c.rep_id === user.id)
    )
    .map((c: { id: string }) => c.id);
  if (toClear.length === 0) return jsonResponse(req, { cleared: 0 });

  // Only rows that still carry the flag: if another reviewer merged or cleared
  // this group while the sheet was open, this is a no-op rather than a write
  // against rows that have since changed.
  const { data, error } = await supabase
    .from("contacts")
    .update({ local_duplicate_of_contact_id: null })
    .in("id", toClear)
    .not("local_duplicate_of_contact_id", "is", null)
    .select("id");
  if (error) return errorResponse(req, 500, error.message);

  return jsonResponse(req, { cleared: data?.length ?? 0 });
});

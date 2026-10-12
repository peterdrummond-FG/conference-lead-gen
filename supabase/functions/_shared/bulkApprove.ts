// Which leads "Confirm all N" may confirm (used by contacts-bulk-approve).
//
// What broke: the function confirmed any lead whose match had finished, whatever its
// review status. The app only sends ids it believes are waiting, but a tab left open
// can be stale: a lead rejected on another device since still sat in that list, and
// Confirm all turned a rejected lead into a confirmed one, which then went to Zoho.
//
// Now a lead is confirmed only while its review_status is still 'needs_review'. The
// caller repeats the same condition in the UPDATE itself, so a lead rejected between
// the read and the write is also left alone.

export const REASON_NOT_FOUND = "not found";
export const REASON_STILL_PENDING = "still pending";
// A person already confirmed or rejected it (usually from another tab or device).
export const REASON_NOT_WAITING = "no longer waiting for confirmation";

export interface BulkApproveRow {
  id: string;
  match_status: string;
  review_status: string;
  rep_id: string | null;
}

export interface Skipped {
  id: string;
  reason: string;
}

export function planBulkApprove(
  ids: string[],
  rows: BulkApproveRow[],
  user: { id: string; role: string },
): { toApprove: string[]; skipped: Skipped[] } {
  const toApprove: string[] = [];
  const skipped: Skipped[] = [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const seen = new Set<string>();

  for (const id of ids) {
    if (seen.has(id)) continue; // the same id twice in one request is one lead
    seen.add(id);
    const row = byId.get(id);
    // A rep may only act on their own leads, and learns nothing about anyone else's.
    if (!row || (user.role === "sales" && row.rep_id !== user.id)) {
      skipped.push({ id, reason: REASON_NOT_FOUND });
    } else if (row.review_status !== "needs_review") {
      skipped.push({ id, reason: REASON_NOT_WAITING });
    } else if (row.match_status === "pending") {
      skipped.push({ id, reason: REASON_STILL_PENDING });
    } else {
      toApprove.push(id);
    }
  }
  return { toApprove, skipped };
}

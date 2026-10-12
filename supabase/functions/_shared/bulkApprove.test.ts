// Run: deno test supabase/functions/_shared/bulkApprove.test.ts
import assert from "node:assert/strict";
import { type BulkApproveRow, planBulkApprove, REASON_NOT_FOUND, REASON_NOT_WAITING, REASON_STILL_PENDING } from "./bulkApprove.ts";

const row = (id: string, over: Partial<BulkApproveRow> = {}): BulkApproveRow => ({
  id,
  match_status: "new_account",
  review_status: "needs_review",
  rep_id: "rep1",
  ...over,
});
const rep = { id: "rep1", role: "sales" };
const staff = { id: "admin1", role: "admin" };

Deno.test("a lead waiting for confirmation with a finished match is confirmed", () => {
  const r = planBulkApprove(["a"], [row("a")], rep);
  assert.deepEqual(r, { toApprove: ["a"], skipped: [] });
});

Deno.test("a rejected lead is NOT confirmed, however finished its match", () => {
  const r = planBulkApprove(["a"], [row("a", { review_status: "rejected" })], staff);
  assert.deepEqual(r.toApprove, []);
  assert.deepEqual(r.skipped, [{ id: "a", reason: REASON_NOT_WAITING }]);
});

Deno.test("an already confirmed lead is skipped, not confirmed again", () => {
  const r = planBulkApprove(["a"], [row("a", { review_status: "approved" })], staff);
  assert.deepEqual(r.skipped, [{ id: "a", reason: REASON_NOT_WAITING }]);
});

Deno.test("a lead still matching is skipped with its own reason", () => {
  const r = planBulkApprove(["a"], [row("a", { match_status: "pending" })], staff);
  assert.deepEqual(r.skipped, [{ id: "a", reason: REASON_STILL_PENDING }]);
});

Deno.test("a rejected lead that is also still matching reports the review status first", () => {
  const r = planBulkApprove(["a"], [row("a", { review_status: "rejected", match_status: "pending" })], staff);
  assert.deepEqual(r.skipped, [{ id: "a", reason: REASON_NOT_WAITING }]);
});

Deno.test("an id that does not exist, or another rep's lead, is 'not found' to a rep", () => {
  const r = planBulkApprove(["missing", "theirs"], [row("theirs", { rep_id: "rep2" })], rep);
  assert.deepEqual(r.skipped, [{ id: "missing", reason: REASON_NOT_FOUND }, { id: "theirs", reason: REASON_NOT_FOUND }]);
  assert.deepEqual(r.toApprove, []);
});

Deno.test("staff may confirm any rep's lead", () => {
  const r = planBulkApprove(["theirs"], [row("theirs", { rep_id: "rep2" })], staff);
  assert.deepEqual(r.toApprove, ["theirs"]);
});

Deno.test("a mixed batch is split correctly and a repeated id counts once", () => {
  const rows = [row("ok"), row("rej", { review_status: "rejected" }), row("pend", { match_status: "pending" })];
  const r = planBulkApprove(["ok", "rej", "pend", "ok"], rows, staff);
  assert.deepEqual(r.toApprove, ["ok"]);
  assert.deepEqual(r.skipped.map((s) => s.id), ["rej", "pend"]);
});

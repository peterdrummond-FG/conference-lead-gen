// Run: deno test supabase/functions/_shared/fileImport.test.ts
import assert from "node:assert/strict";
import { type CleanImportRow, MAX_IMPORT_ROWS, validateImportRows } from "./fileImport.ts";

const ok = (r: unknown) => {
  assert.ok(!("error" in (r as object)), JSON.stringify(r));
  return r as { rows: CleanImportRow[]; skipped: string[] };
};
const base = { row: 2, firstName: "Jane", lastName: "Smith", email: "", phone: "", title: "", state: "", districtName: "", schoolName: "", interactionNotes: "" };

Deno.test("a row with no first name is not added, and says which row", () => {
  const r = ok(validateImportRows([{ ...base, firstName: " " }, base]));
  assert.equal(r.rows.length, 1);
  assert.deepEqual(r.skipped, ["Row 2: no name."]);
});

Deno.test("an invalid email or unknown state is kept in the notes, not lost", () => {
  const r = ok(validateImportRows([{ ...base, email: "not-an-email", state: "Narnia", interactionNotes: "Badge ID: 1" }]));
  assert.equal(r.rows[0].email, null);
  assert.equal(r.rows[0].state, null);
  assert.equal(r.rows[0].interactionNotes, "Badge ID: 1\nEmail: not-an-email\nState: Narnia");
});

Deno.test("a valid email is lower-cased and a valid state kept", () => {
  const r = ok(validateImportRows([{ ...base, email: "JS@Lincoln.org", state: "Massachusetts" }]));
  assert.equal(r.rows[0].email, "js@lincoln.org");
  assert.equal(r.rows[0].state, "Massachusetts");
});

Deno.test("over-long fields are moved to notes, control characters removed", () => {
  const r = ok(validateImportRows([{ ...base, phone: "1".repeat(80), title: "Dir\u0000ector" }]));
  assert.equal(r.rows[0].phone, null);
  assert.equal(r.rows[0].title, "Director");
  assert.ok(r.rows[0].interactionNotes?.startsWith("Phone: "));
});

Deno.test("more than the row limit is refused outright", () => {
  const r = validateImportRows(Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => base));
  assert.ok("error" in r);
});

Deno.test("empty or non-array input is refused", () => {
  assert.ok("error" in validateImportRows([]));
  assert.ok("error" in validateImportRows("x"));
  assert.ok("error" in validateImportRows(undefined));
});

Deno.test("a non-object row is skipped, not a crash", () => {
  const r = ok(validateImportRows([null, "x", base]));
  assert.equal(r.rows.length, 1);
  assert.equal(r.skipped.length, 2);
});

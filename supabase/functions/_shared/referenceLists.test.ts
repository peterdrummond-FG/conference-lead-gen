// Run: deno test supabase/functions/_shared/referenceLists.test.ts
import assert from "node:assert/strict";
import { fetchAllPages, type Page } from "./referenceLists.ts";

// A table of n rows, served the way PostgREST does: at most pageSize per range.
function table(n: number, pageSize: number) {
  const calls: Array<[number, number]> = [];
  const read = (from: number, to: number): Promise<Page<number>> => {
    calls.push([from, to]);
    const end = Math.min(to, from + pageSize - 1, n - 1);
    const data: number[] = [];
    for (let i = from; i <= end; i++) data.push(i);
    return Promise.resolve({ data, error: null });
  };
  return { read, calls };
}

Deno.test("a list under one page is one request", async () => {
  const t = table(932, 1000);
  assert.equal((await fetchAllPages(t.read)).length, 932);
  assert.equal(t.calls.length, 1);
});

Deno.test("a list over one page is read page by page and nothing is lost", async () => {
  const t = table(2350, 1000);
  const rows = await fetchAllPages(t.read);
  assert.equal(rows.length, 2350);
  assert.deepEqual(rows.slice(0, 3), [0, 1, 2]);
  assert.equal(rows[2349], 2349);
  assert.equal(t.calls.length, 3);
});

Deno.test("exactly a page asks once more and stops on the empty page", async () => {
  const t = table(1000, 1000);
  assert.equal((await fetchAllPages(t.read)).length, 1000);
  assert.equal(t.calls.length, 2);
});

Deno.test("past the cap it refuses instead of returning a truncated list", async () => {
  const t = table(9000, 1000);
  await assert.rejects(() => fetchAllPages(t.read), /refusing to serve a truncated list/);
});

Deno.test("a read error is thrown, not swallowed into an empty list", async () => {
  await assert.rejects(
    () => fetchAllPages(() => Promise.resolve({ data: null, error: { message: "boom" } })),
    /boom/,
  );
});

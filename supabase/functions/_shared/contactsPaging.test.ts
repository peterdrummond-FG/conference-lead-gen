// Run: deno test supabase/functions/_shared/contactsPaging.test.ts
import assert from "node:assert/strict";
import { ordered, readContacts } from "./contactsPaging.ts";

// A fake PostgREST query over n numbered rows: it serves at most 1000 per request, records
// every call, and (like the real one) answers a count only when asked.
function fakeTable(n: number) {
  const calls: Array<{ from: number; to: number; count: boolean }> = [];
  let queriesBuilt = 0;
  const makeQuery = (withCount: boolean) => {
    queriesBuilt++;
    return {
      range(from: number, to: number) {
        calls.push({ from, to, count: withCount });
        const end = Math.min(to, from + 999, n - 1);
        const data: number[] = [];
        for (let i = from; i <= end; i++) data.push(i);
        return Promise.resolve({ data, error: null, count: withCount ? n : null });
      },
    };
  };
  return { makeQuery, calls, built: () => queriesBuilt };
}

Deno.test("a page request reads exactly that range and reports the total", async () => {
  const t = fakeTable(342);
  const r = await readContacts(t.makeQuery, { page: 2, pageSize: 100, from: 100, to: 199 });
  assert.equal(r.rows.length, 100);
  assert.equal(r.rows[0], 100);
  assert.equal(r.total, 342);
  assert.deepEqual(t.calls, [{ from: 100, to: 199, count: true }]);
});

Deno.test("the last page is short", async () => {
  const t = fakeTable(342);
  const r = await readContacts(t.makeQuery, { page: 4, pageSize: 100, from: 300, to: 399 });
  assert.equal(r.rows.length, 42);
});

Deno.test("no page request reads everything, past the 1000-row limit, with a fresh query per page", async () => {
  const t = fakeTable(2350);
  const r = await readContacts(t.makeQuery, null);
  assert.equal(r.rows.length, 2350);
  assert.equal(r.total, 2350);
  assert.equal(t.built(), 3);
  assert.ok(t.calls.every((c) => !c.count));
});

Deno.test("a list under one page of 1000 is one request", async () => {
  const t = fakeTable(135);
  assert.equal((await readContacts(t.makeQuery, null)).rows.length, 135);
  assert.equal(t.calls.length, 1);
});

Deno.test("a database error is thrown, not turned into an empty list", async () => {
  const bad = () => ({ range: () => Promise.resolve({ data: null, error: { message: "boom" }, count: null }) });
  // PostgREST reports an error as a plain object with a message, not an Error.
  await assert.rejects(
    () => readContacts(bad, { page: 1, pageSize: 100, from: 0, to: 99 }),
    (e: unknown) => (e as { message?: string }).message === "boom",
  );
});

Deno.test("ordered sorts newest first and breaks ties by id", () => {
  const seen: Array<[string, unknown]> = [];
  const q = { order(col: string, opts: unknown) { seen.push([col, opts]); return q; } };
  ordered(q);
  assert.deepEqual(seen, [["created_at", { ascending: false }], ["id", { ascending: false }]]);
});

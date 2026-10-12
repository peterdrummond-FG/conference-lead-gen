// Run: deno test supabase/functions/_shared/pageParams.test.ts
import assert from "node:assert/strict";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, parsePageRequest } from "./pageParams.ts";

const q = (s: string) => new URLSearchParams(s);

Deno.test("no page means the whole list", () => {
  assert.equal(parsePageRequest(q("reviewStatus=needs_review")), null);
});

Deno.test("page 1 is rows 0 to 99 at the default size of 100", () => {
  assert.equal(DEFAULT_PAGE_SIZE, 100);
  assert.deepEqual(parsePageRequest(q("page=1")), { page: 1, pageSize: 100, from: 0, to: 99 });
});

Deno.test("page 3 is rows 200 to 299", () => {
  assert.deepEqual(parsePageRequest(q("page=3")), { page: 3, pageSize: 100, from: 200, to: 299 });
});

Deno.test("a smaller pageSize is honoured, and a larger one is refused", () => {
  assert.deepEqual(parsePageRequest(q("page=2&pageSize=25")), { page: 2, pageSize: 25, from: 25, to: 49 });
  assert.ok("error" in (parsePageRequest(q(`page=1&pageSize=${MAX_PAGE_SIZE + 1}`)) as object));
  assert.ok("error" in (parsePageRequest(q("page=1&pageSize=0")) as object));
});

Deno.test("a page that is not a positive whole number is refused", () => {
  for (const bad of ["page=0", "page=-1", "page=1.5", "page=abc", "page="]) {
    assert.ok("error" in (parsePageRequest(q(bad)) as object), bad);
  }
});

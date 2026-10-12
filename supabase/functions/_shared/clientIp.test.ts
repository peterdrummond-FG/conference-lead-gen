// Run: deno test supabase/functions/_shared/clientIp.test.ts
import assert from "node:assert/strict";
import { clientIp } from "./clientIp.ts";

const h = (o: Record<string, string>) => new Headers(o);

Deno.test("cf-connecting-ip wins over everything else", () => {
  assert.equal(clientIp(h({ "cf-connecting-ip": "198.51.100.1", "x-real-ip": "198.51.100.2", "x-forwarded-for": "203.0.113.9, 198.51.100.3" })), "198.51.100.1");
});

Deno.test("x-real-ip is used when cf-connecting-ip is absent", () => {
  assert.equal(clientIp(h({ "x-real-ip": "198.51.100.2", "x-forwarded-for": "203.0.113.9" })), "198.51.100.2");
});

Deno.test("a client-supplied first x-forwarded-for entry is not trusted: the last one is used", () => {
  assert.equal(clientIp(h({ "x-forwarded-for": "203.0.113.99, 198.51.100.3" })), "198.51.100.3");
});

Deno.test("two requests that fake different first entries still share one address", () => {
  const a = clientIp(h({ "x-forwarded-for": "203.0.113.1, 198.51.100.3" }));
  const b = clientIp(h({ "x-forwarded-for": "203.0.113.2, 198.51.100.3" }));
  assert.equal(a, b);
});

Deno.test("no header at all is the shared 'unknown' bucket, and blanks are ignored", () => {
  assert.equal(clientIp(h({})), "unknown");
  assert.equal(clientIp(h({ "cf-connecting-ip": "  ", "x-forwarded-for": " , " })), "unknown");
});

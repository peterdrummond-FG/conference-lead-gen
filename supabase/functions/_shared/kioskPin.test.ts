// Run: deno test supabase/functions/_shared/kioskPin.test.ts
import assert from "node:assert/strict";
import { kioskPinMatches, validateNewKioskPin } from "./kioskPin.ts";

const same = (a: string, b: string) => Promise.resolve(a === b);

Deno.test("a new PIN must be a string of at least 4 characters", () => {
  assert.ok(validateNewKioskPin("abc"));
  assert.ok(validateNewKioskPin(""));
  assert.ok(validateNewKioskPin(1234));
  assert.ok(validateNewKioskPin(undefined));
  assert.equal(validateNewKioskPin("4821"), null);
  assert.equal(validateNewKioskPin("a longer pass phrase"), null);
});

Deno.test("the old default 1234 cannot be chosen", () => {
  assert.match(validateNewKioskPin("1234") ?? "", /too easy to guess/);
});

Deno.test("an account with no PIN set cannot be unlocked, not even by an empty attempt", async () => {
  assert.equal(await kioskPinMatches(null, "", same), false);
  assert.equal(await kioskPinMatches(undefined, "anything", same), false);
  assert.equal(await kioskPinMatches("", "", same), false);
});

Deno.test("the right PIN unlocks and a wrong one does not", async () => {
  assert.equal(await kioskPinMatches("4821", "4821", same), true);
  assert.equal(await kioskPinMatches("4821", "4822", same), false);
});

// Run: deno test supabase/functions/_shared/onboardingEvent.test.ts
import assert from "node:assert/strict";
import { parseOnboardingBody, RESUME_IDS } from "./onboardingEvent.ts";

Deno.test("a body-less call is the old tour finishing, and stays valid", () => {
  assert.deepEqual(parseOnboardingBody(""), { kind: "legacy" });
  assert.deepEqual(parseOnboardingBody("   \n"), { kind: "legacy" });
});

Deno.test("each new event parses", () => {
  assert.deepEqual(parseOnboardingBody('{"event":"seen"}'), { kind: "seen" });
  assert.deepEqual(parseOnboardingBody('{"event":"reminder-shown"}'), { kind: "reminder-shown" });
  assert.deepEqual(parseOnboardingBody('{"event":"complete"}'), { kind: "complete" });
  assert.deepEqual(parseOnboardingBody('{"event":"ended","path":"quick","resumeFrom":"send-import"}'), {
    kind: "ended", path: "quick", resumeFrom: "send-import",
  });
  assert.deepEqual(parseOnboardingBody('{"event":"ended","path":"tour","resumeFrom":null}'), { kind: "ended", path: "tour", resumeFrom: null });
});

Deno.test("a present body is validated", () => {
  for (const bad of [
    "not json", "null", "[]", '{}', '{"event":3}', '{"event":"nope"}',
    '{"event":"ended","path":"other","resumeFrom":null}',
    '{"event":"ended","path":"tour","resumeFrom":"not-a-scene"}',
    '{"event":"ended","path":"tour","resumeFrom":7}',
    '{"event":"ended"}',
  ]) {
    assert.equal(parseOnboardingBody(bad).kind, "invalid", bad);
  }
});

Deno.test("every known scene id is accepted as a resume point", () => {
  for (const id of RESUME_IDS) assert.equal(parseOnboardingBody(JSON.stringify({ event: "ended", path: "tour", resumeFrom: id })).kind, "ended", id);
});

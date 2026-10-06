// Run: deno test supabase/functions/_shared/intakeDestination.test.ts
// One test per way a public submission used to be thrown away (cases A-E), plus
// the paths that must keep working exactly as before.
import assert from "node:assert/strict";
import { type IntakeLookups, intakePathFor, resolveIntakeDestination } from "./intakeDestination.ts";

const LIVE = "11111111-1111-4111-8111-111111111111";
const ENDED = "22222222-2222-4222-8222-222222222222";
const REP = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";

function lookups(over: Partial<IntakeLookups> = {}): IntakeLookups {
  return {
    salesRepBySlug: () => Promise.resolve(null),
    eventIsActive: (id) => Promise.resolve(id === LIVE),
    eventBySlug: (slug) =>
      Promise.resolve(slug === "live" ? { id: LIVE, isActive: true } : slug === "old" ? { id: ENDED, isActive: false } : null),
    linkedSalesRep: (_e, r) => Promise.resolve(r === REP ? REP : null),
    caller: () => Promise.resolve(null),
    ...over,
  };
}
const none = { repSlug: null, eventSlug: null, repIdParam: null };

Deno.test("normal rep QR: rep at a live conference files to it and is credited", async () => {
  const l = lookups({ salesRepBySlug: () => Promise.resolve({ id: REP, currentEventId: LIVE }) });
  assert.deepEqual(await resolveIntakeDestination(l, { ...none, repSlug: "jamie" }), { kind: "event", eventId: LIVE, repId: REP });
});

Deno.test("A: rep QR, rep has no conference -> queue, rep known", async () => {
  const l = lookups({ salesRepBySlug: () => Promise.resolve({ id: REP, currentEventId: null }) });
  assert.deepEqual(await resolveIntakeDestination(l, { ...none, repSlug: "jamie" }), {
    kind: "queue", reason: "rep_no_conference", repId: REP, eventHintId: null,
  });
});

Deno.test("A: a stale pointer to an ended conference is treated as no conference", async () => {
  const l = lookups({ salesRepBySlug: () => Promise.resolve({ id: REP, currentEventId: ENDED }) });
  const d = await resolveIntakeDestination(l, { ...none, repSlug: "jamie" });
  assert.equal(d.kind, "queue");
  assert.equal(d.kind === "queue" && d.reason, "rep_no_conference");
});

Deno.test("B: repSlug matches no sales rep -> queue, no rep", async () => {
  assert.deepEqual(await resolveIntakeDestination(lookups(), { ...none, repSlug: "gone" }), {
    kind: "queue", reason: "rep_not_found", repId: null, eventHintId: null,
  });
});

Deno.test("C: per-event QR for an ended conference -> queue, hint set, a linked rep is credited", async () => {
  const d = await resolveIntakeDestination(lookups(), { ...none, eventSlug: "old", repIdParam: REP });
  assert.deepEqual(d, { kind: "queue", reason: "event_ended", repId: REP, eventHintId: ENDED });
});

Deno.test("C: the repId on an ended-event QR is never trusted raw", async () => {
  const d = await resolveIntakeDestination(lookups(), { ...none, eventSlug: "old", repIdParam: OTHER });
  assert.deepEqual(d, { kind: "queue", reason: "event_ended", repId: null, eventHintId: ENDED });
});

Deno.test("C: a slug that matches no conference at all is held, not dropped", async () => {
  const d = await resolveIntakeDestination(lookups(), { ...none, eventSlug: "typo" });
  assert.deepEqual(d, { kind: "queue", reason: "event_unknown", repId: null, eventHintId: null });
});

Deno.test("per-event QR at a live conference still files there, crediting only a linked rep", async () => {
  assert.deepEqual(await resolveIntakeDestination(lookups(), { ...none, eventSlug: "live", repIdParam: REP }), {
    kind: "event", eventId: LIVE, repId: REP,
  });
  assert.deepEqual(await resolveIntakeDestination(lookups(), { ...none, eventSlug: "live", repIdParam: OTHER }), {
    kind: "event", eventId: LIVE, repId: null,
  });
});

Deno.test("D: bare call with nobody signed in -> queue, no rep", async () => {
  assert.deepEqual(await resolveIntakeDestination(lookups(), none), {
    kind: "queue", reason: "no_qr", repId: null, eventHintId: null,
  });
});

Deno.test("E: signed-in sales caller with no conference -> queue, caller credited", async () => {
  const l = lookups({ caller: () => Promise.resolve({ id: REP, role: "sales", currentEventId: null }) });
  assert.deepEqual(await resolveIntakeDestination(l, none), {
    kind: "queue", reason: "caller_no_conference", repId: REP, eventHintId: null,
  });
});

Deno.test("E: signed-in caller whose conference ended -> queue; staff are never credited", async () => {
  const l = lookups({ caller: () => Promise.resolve({ id: OTHER, role: "solutionsSuccess", currentEventId: ENDED }) });
  assert.deepEqual(await resolveIntakeDestination(l, none), {
    kind: "queue", reason: "caller_no_conference", repId: null, eventHintId: null,
  });
});

Deno.test("signed-in caller at a live conference files there (sales credited)", async () => {
  const l = lookups({ caller: () => Promise.resolve({ id: REP, role: "sales", currentEventId: LIVE }) });
  assert.deepEqual(await resolveIntakeDestination(l, none), { kind: "event", eventId: LIVE, repId: REP });
});

Deno.test("repSlug wins over eventSlug when a tampered request carries both", async () => {
  const l = lookups({ salesRepBySlug: () => Promise.resolve({ id: REP, currentEventId: null }) });
  const d = await resolveIntakeDestination(l, { repSlug: "jamie", eventSlug: "live", repIdParam: REP });
  assert.equal(d.kind === "queue" && d.reason, "rep_no_conference");
});

Deno.test("a failed lookup throws instead of being read as 'no conference'", async () => {
  const l = lookups({ salesRepBySlug: () => Promise.reject(new Error("db down")) });
  await assert.rejects(resolveIntakeDestination(l, { ...none, repSlug: "jamie" }), /db down/);
});

// ── intakePathFor: the door recorded for Review's source label ────────────────

Deno.test("intake path: a rep's own QR is rep_qr, filed or queued", () => {
  const input = { ...none, repSlug: "jamie" };
  assert.equal(intakePathFor(input, { kind: "event", eventId: LIVE, repId: REP }), "rep_qr");
  assert.equal(intakePathFor(input, { kind: "queue", reason: "rep_no_conference", repId: REP, eventHintId: null }), "rep_qr");
  assert.equal(intakePathFor(input, { kind: "queue", reason: "rep_not_found", repId: null, eventHintId: null }), "rep_qr");
});

Deno.test("intake path: a per-event QR is event_qr, filed or queued", () => {
  const input = { ...none, eventSlug: "live" };
  assert.equal(intakePathFor(input, { kind: "event", eventId: LIVE, repId: null }), "event_qr");
  assert.equal(intakePathFor(input, { kind: "queue", reason: "event_ended", repId: null, eventHintId: ENDED }), "event_qr");
  assert.equal(intakePathFor(input, { kind: "queue", reason: "event_unknown", repId: null, eventHintId: null }), "event_qr");
});

Deno.test("intake path: a signed-in bare call is the Kiosk, filed or queued; an anonymous one is nothing", () => {
  assert.equal(intakePathFor(none, { kind: "event", eventId: LIVE, repId: REP }), "kiosk");
  assert.equal(intakePathFor(none, { kind: "queue", reason: "caller_no_conference", repId: REP, eventHintId: null }), "kiosk");
  assert.equal(intakePathFor(none, { kind: "queue", reason: "no_qr", repId: null, eventHintId: null }), null);
});

Deno.test("intake path: end to end through resolveIntakeDestination", async () => {
  const signedIn = lookups({ caller: () => Promise.resolve({ id: REP, role: "sales", currentEventId: LIVE }) });
  const d = await resolveIntakeDestination(signedIn, none);
  assert.equal(intakePathFor(none, d), "kiosk");
  const anon = await resolveIntakeDestination(lookups(), none);
  assert.equal(intakePathFor(none, anon), null);
  // Both identifiers on one request: repSlug decided it, so repSlug labels it.
  const both = { ...none, repSlug: "jamie", eventSlug: "live" };
  const rep = lookups({ salesRepBySlug: () => Promise.resolve({ id: REP, currentEventId: LIVE }) });
  assert.equal(intakePathFor(both, await resolveIntakeDestination(rep, both)), "rep_qr");
});

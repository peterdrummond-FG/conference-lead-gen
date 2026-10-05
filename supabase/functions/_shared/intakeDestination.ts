// Where does a public intake submission (contacts-create) belong?
//
// Pulled out of contacts-create so every way of failing to find a conference is
// one explicit, testable answer instead of an early `return errorResponse(404|409)`.
// Those early returns threw away a valid attendee's details: a rep with no
// conference chosen, a deleted rep, a printed QR for a conference that has ended,
// a call with no QR and nobody signed in, a Kiosk tab whose conference ended. The
// person saw an error and nothing was kept. Now each of those is a `queue`
// destination: the submission is held in unassigned_submissions for Solutions
// Success to file (migration 20261006100000_unassigned_submissions.sql).
//
// contacts.event_id stays NOT NULL on purpose; nothing here loosens it.
//
// Every lookup goes through `IntakeLookups` so the tests can drive each case with
// fakes. A lookup that fails throws, and the caller turns that into a 500 exactly
// as before: a database hiccup must never be mistaken for "no conference" and
// quietly queue something that has a real conference.

export type QueueReason =
  | "rep_no_conference"
  | "rep_not_found"
  | "event_ended"
  | "event_unknown"
  | "no_qr"
  | "caller_no_conference";

export type IntakeDestination =
  | { kind: "event"; eventId: string; repId: string | null }
  | { kind: "queue"; reason: QueueReason; repId: string | null; eventHintId: string | null };

export interface IntakeLookups {
  // A sales profile by its permanent QR slug; null if none.
  salesRepBySlug(slug: string): Promise<{ id: string; currentEventId: string | null } | null>;
  // Is this conference live right now (events.is_active)?
  eventIsActive(eventId: string): Promise<boolean>;
  // The conference a printed per-event QR names, whether or not it is still live.
  eventBySlug(slug: string): Promise<{ id: string; isActive: boolean } | null>;
  // Re-validates a client-supplied repId: it must be linked to THIS conference
  // (event_reps) and be a sales rep. Returns the id if so, else null.
  linkedSalesRep(eventId: string, repId: string): Promise<string | null>;
  // The signed-in caller, if the request carries a valid session.
  caller(): Promise<{ id: string; role: "admin" | "solutionsSuccess" | "sales"; currentEventId: string | null } | null>;
}

export interface IntakeInput {
  repSlug: string | null;
  eventSlug: string | null;
  // Untrusted. Only ever used after linkedSalesRep() has vouched for it.
  repIdParam: string | null;
}

const queue = (reason: QueueReason, repId: string | null = null, eventHintId: string | null = null): IntakeDestination => ({
  kind: "queue",
  reason,
  repId,
  eventHintId,
});

export async function resolveIntakeDestination(l: IntakeLookups, input: IntakeInput): Promise<IntakeDestination> {
  const { repSlug, eventSlug, repIdParam } = input;

  if (repSlug) {
    // A rep's reusable QR. Takes priority over eventSlug/repId so a tampered
    // request carrying both can't pick the more permissive path.
    const rep = await l.salesRepBySlug(repSlug);
    if (!rep) return queue("rep_not_found");
    if (!rep.currentEventId) return queue("rep_no_conference", rep.id);
    // events_complete() clears current_event_id, so this should always hold;
    // checked anyway because anything that resolves an event re-checks
    // is_active (a stale pointer must not file a lead under a finished
    // conference).
    if (!(await l.eventIsActive(rep.currentEventId))) return queue("rep_no_conference", rep.id);
    return { kind: "event", eventId: rep.currentEventId, repId: rep.id };
  }

  if (eventSlug) {
    // The event is resolved server-side from the slug the QR carried, never
    // taken as an id from the client.
    const event = await l.eventBySlug(eventSlug);
    if (!event) return queue("event_unknown");
    const repId = repIdParam ? await l.linkedSalesRep(event.id, repIdParam) : null;
    if (!event.isActive) return queue("event_ended", repId, event.id);
    return { kind: "event", eventId: event.id, repId };
  }

  // Bare call: no QR identified an event or a rep. Resolve from the CALLER,
  // never from "the most recently activated event" (the 2026-09-29 Region 4 bug).
  const caller = await l.caller();
  if (!caller) return queue("no_qr");
  // Only sales reps are credited; an admin or Solutions Success user keying a
  // lead in sees everything in Review anyway.
  const repId = caller.role === "sales" ? caller.id : null;
  if (!caller.currentEventId) return queue("caller_no_conference", repId);
  if (!(await l.eventIsActive(caller.currentEventId))) return queue("caller_no_conference", repId);
  return { kind: "event", eventId: caller.currentEventId, repId };
}

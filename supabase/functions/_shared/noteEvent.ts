// Which conference a pasted note or an uploaded file is filed under. Shared by
// notes-submit and notes-import-file so the two can never disagree about it.
//
// The rep's own linked event wins over whichever event happens to be active: a rep
// writing up notes on the way home is still filing them against the conference they
// were just at, even if someone has since activated the next one. Falls back to the
// most-recently-activated event for staff who don't keep a current_event_id
// (admin/Solutions Success) — ordered rather than .maybeSingle() since multiple events
// can be active at once (20260915120000_event_slug_and_concurrent_events.sql). Never
// taken from the client — the page shows the same resolution so the rep can see where
// it's going, but it isn't what decides it.
export type NoteEventResult =
  | { event: { id: string; name: string; state: string | null } }
  | { failure: { status: number; message: string } };

// deno-lint-ignore no-explicit-any
export async function resolveNoteEvent(supabase: any, currentEventId: string | null): Promise<NoteEventResult> {
  let eventId = currentEventId;
  if (!eventId) {
    const { data: activeEvent, error } = await supabase
      .from("events")
      .select("id")
      .eq("is_active", true)
      .order("activated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return { failure: { status: 500, message: error.message } };
    if (!activeEvent) {
      return { failure: { status: 409, message: "You're not linked to an event and there's no active event — choose one in Setup first." } };
    }
    eventId = activeEvent.id as string;
  }

  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("id, name, state")
    .eq("id", eventId)
    .maybeSingle();
  if (eventError) return { failure: { status: 500, message: eventError.message } };
  if (!event) return { failure: { status: 409, message: "The event you're linked to no longer exists — choose a new one in Setup." } };
  return { event };
}

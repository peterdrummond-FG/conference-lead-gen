// Saving a note a rep texted to the Twilio number (used by twilio-webhook).
//
// Two writes have to happen, in this order:
//   1. a log row in inbound_messages, whose unique twilio_message_sid is what makes a
//      Twilio retry of the same text detectable (a plain insert into note_submissions is
//      not idempotent, so without this a retried text would make a second note and a
//      second contact);
//   2. the note_submissions row the n8n note pipeline picks up.
//
// What broke: the webhook ignored the result of write 2, and only logged a failure of
// write 1, then replied "that contact's logged" either way. A failed insert therefore
// lost the note while telling the rep it was saved. Now each write is tried twice, and
// if either still fails the caller replies that the contact did not save.
//
// If write 2 fails after write 1 succeeded, the log row is removed again. Leaving it
// would be wrong: the rep texts the note again (a new message id, so that would work),
// but a Twilio retry of this same message would hit the unique id, look like a
// duplicate, and be answered "logged" with no note behind it.

export const NOTE_SAVED_REPLY = "Got it — that contact's logged and will show up in Contacts in a few minutes.";
export const NOTE_NOT_SAVED_REPLY = "That contact did not save. Please text it again.";

export type NoteSaveResult = "saved" | "duplicate" | "failed";

interface DbError {
  code?: string;
  message?: string;
}

// The slice of the Supabase client this uses, so a test can pass a fake.
export interface NoteSaveClient {
  from(table: string): {
    insert(row: Record<string, unknown>): PromiseLike<{ error: DbError | null }>;
    delete(): { eq(column: string, value: string): PromiseLike<{ error: DbError | null }> };
  };
}

export interface TextNote {
  sid: string;
  from: string;
  to: string;
  eventId: string;
  body: string;
}

const UNIQUE_VIOLATION = "23505";

export async function saveTextNote(
  supabase: NoteSaveClient,
  note: TextNote,
  log: (message: string, detail: unknown) => void = console.error,
): Promise<NoteSaveResult> {
  const logRow = {
    twilio_message_sid: note.sid,
    from_phone: note.from,
    to_phone: note.to,
    event_id: note.eventId,
    kind: "text_note",
    status: "completed",
    body: note.body,
  };

  // Write 1, tried twice. A unique violation is not a failure: it means this exact
  // text was already received (a Twilio retry), so there is nothing more to do.
  let logged = false;
  for (let attempt = 1; attempt <= 2 && !logged; attempt++) {
    const { error } = await supabase.from("inbound_messages").insert(logRow);
    if (!error) {
      logged = true;
    } else if (error.code === UNIQUE_VIOLATION) {
      return "duplicate";
    } else {
      log(`texted note: inbound_messages insert failed (attempt ${attempt})`, error);
    }
  }
  if (!logged) return "failed";

  // Write 2, tried twice.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { error } = await supabase.from("note_submissions").insert({
      event_id: note.eventId,
      from_phone: note.from,
      body: note.body,
    });
    if (!error) return "saved";
    log(`texted note: note_submissions insert failed (attempt ${attempt})`, error);
  }

  // Release the log row so a retry of this message (or the rep's resend) can succeed.
  const { error: releaseError } = await supabase.from("inbound_messages").delete().eq("twilio_message_sid", note.sid);
  if (releaseError) log("texted note: could not release the log row after a failed save", releaseError);
  return "failed";
}

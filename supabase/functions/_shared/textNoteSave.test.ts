// Run: deno test supabase/functions/_shared/textNoteSave.test.ts
import assert from "node:assert/strict";
import { type NoteSaveClient, saveTextNote } from "./textNoteSave.ts";

const note = { sid: "SM1", from: "+15550100", to: "+15550199", eventId: "e1", body: "met Dana, wants a demo" };

type Outcome = { code?: string; message?: string } | null;

// A fake client. Each table gets a queue of outcomes, one per insert call (null = success);
// once the queue runs out the call succeeds. Every call is recorded.
function fake(plan: { inbound_messages?: Outcome[]; note_submissions?: Outcome[]; deleteError?: Outcome }) {
  const calls: string[] = [];
  const queues: Record<string, Outcome[]> = {
    inbound_messages: [...(plan.inbound_messages ?? [])],
    note_submissions: [...(plan.note_submissions ?? [])],
  };
  const client: NoteSaveClient = {
    from(table) {
      return {
        insert(row) {
          calls.push(`insert ${table}`);
          void row;
          const error = queues[table]?.shift() ?? null;
          return Promise.resolve({ error });
        },
        delete() {
          return {
            eq(column, value) {
              calls.push(`delete ${table} ${column}=${value}`);
              return Promise.resolve({ error: plan.deleteError ?? null });
            },
          };
        },
      };
    },
  };
  return { client, calls };
}

const quiet = () => {};

Deno.test("both writes succeed: saved, one call each", async () => {
  const f = fake({});
  assert.equal(await saveTextNote(f.client, note, quiet), "saved");
  assert.deepEqual(f.calls, ["insert inbound_messages", "insert note_submissions"]);
});

Deno.test("a repeat of the same message id is a duplicate and writes no note", async () => {
  const f = fake({ inbound_messages: [{ code: "23505" }] });
  assert.equal(await saveTextNote(f.client, note, quiet), "duplicate");
  assert.deepEqual(f.calls, ["insert inbound_messages"]);
});

Deno.test("the log insert failing once is retried and then succeeds", async () => {
  const f = fake({ inbound_messages: [{ code: "XX000", message: "blip" }] });
  assert.equal(await saveTextNote(f.client, note, quiet), "saved");
  assert.deepEqual(f.calls, ["insert inbound_messages", "insert inbound_messages", "insert note_submissions"]);
});

Deno.test("the log insert failing twice is a failure, and no note is written", async () => {
  const f = fake({ inbound_messages: [{ code: "XX000" }, { code: "XX000" }] });
  assert.equal(await saveTextNote(f.client, note, quiet), "failed");
  assert.deepEqual(f.calls, ["insert inbound_messages", "insert inbound_messages"]);
});

Deno.test("the note insert failing once is retried and then succeeds", async () => {
  const f = fake({ note_submissions: [{ code: "XX000" }] });
  assert.equal(await saveTextNote(f.client, note, quiet), "saved");
  assert.deepEqual(f.calls, ["insert inbound_messages", "insert note_submissions", "insert note_submissions"]);
});

Deno.test("the note insert failing twice is a failure and releases the log row", async () => {
  const f = fake({ note_submissions: [{ code: "XX000" }, { code: "XX000" }] });
  assert.equal(await saveTextNote(f.client, note, quiet), "failed");
  assert.deepEqual(f.calls, [
    "insert inbound_messages",
    "insert note_submissions",
    "insert note_submissions",
    "delete inbound_messages twilio_message_sid=SM1",
  ]);
});

Deno.test("a failed release is logged but the result is still a failure", async () => {
  const logged: string[] = [];
  const f = fake({ note_submissions: [{ code: "XX000" }, { code: "XX000" }], deleteError: { message: "nope" } });
  assert.equal(await saveTextNote(f.client, note, (m) => logged.push(m)), "failed");
  assert.ok(logged.some((m) => m.includes("could not release")));
});

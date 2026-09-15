// Runs on the 1-minute pg_cron schedule "session-notifications-dispatch"
// (see the session_reminders_and_confirmations migration). Two independent
// sweeps, both sending an SMS Twilio never asked for — unlike
// twilio-webhook, which only ever replies via TwiML to an inbound request,
// this calls the Messages REST API directly:
//
// 1. Expiry reminder — a phone bound to an event that's gone 60 minutes
//    without any inbound Twilio request gets one nudge to re-send the
//    event's folder code. This is a courtesy nudge, not a hard lock: the
//    binding itself is never cleared, and photos keep working right
//    through and after the reminder. twilio-webhook keeps
//    last_activity_at/expiry_notified_at current on every inbound request
//    from a bound phone.
//
// 2. Contact-received confirmation — once a rep's batch of card
//    photos/voice memos has gone quiet for 2 minutes AND finished
//    OCR/transcription (or has been pending long enough that we stop
//    waiting on it), text back how many contacts were actually created
//    from that batch.
//
// Both sweeps skip any binding idle past PAUSE_IDLE_MS (120 min) —
// otherwise a send that keeps failing (bad number, Twilio outage) would
// retry every single cron tick forever, since neither watermark
// (expiry_notified_at / contacts_confirmed_through) advances on failure.
// Nothing legitimate is lost by this: a stuck-pending confirmation batch
// already force-flushes after PENDING_TIMEOUT_MS (10 min), so anything
// truly owed would have gone out well before 120 minutes of pure
// inactivity. The pause needs no separate state or wake-up logic —
// twilio-webhook already refreshes last_activity_at on every inbound
// request, so the very next cron tick after new activity picks it back up.
//
// Deployed with verify_jwt: false since pg_cron/pg_net carries no Supabase
// JWT; verify_cron_secret (defined in the same migration) checks a
// database-generated secret instead, read back through the normal
// service-role Postgres connection rather than a separately managed env
// var this tool has no way to set.
import { serviceClient } from "../_shared/supabase-client.ts";

const EXPIRY_IDLE_MS = 60 * 60 * 1000;
const CONFIRMATION_IDLE_MS = 2 * 60 * 1000;
// A stuck OCR/transcription job shouldn't hold a confirmation hostage
// forever — flush the batch anyway once a pending item is this old.
const PENDING_TIMEOUT_MS = 10 * 60 * 1000;
// Stop touching a binding at all once it's been this idle — caps retries
// of a permanently-failing send and cuts needless work on dormant phones.
const PAUSE_IDLE_MS = 120 * 60 * 1000;
const PENDING_STATUSES = new Set(["pending_ocr", "pending_transcription", "processing"]);
// Hard ceilings on a code path that spends money and is subject to carrier
// compliance rules (audit N3). MAX_SENDS_PER_TICK bounds a runaway sweep;
// OUTBOUND_SMS_ENABLED is a kill switch that needs no redeploy or cron edit.
const MAX_SENDS_PER_TICK = Number(Deno.env.get("MAX_SMS_PER_TICK") ?? 25);

async function sendSms(accountSid: string, authToken: string, to: string, from: string, body: string) {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${accountSid}:${authToken}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  if (!res.ok) throw new Error(`Twilio send failed: HTTP ${res.status} ${await res.text()}`);
}

// There's one Twilio number for the whole system today, but this avoids
// hardcoding it — reuses whichever number the rep's most recent inbound
// message actually arrived on.
// deno-lint-ignore no-explicit-any
async function lookupSendingNumber(supabase: any, phone: string): Promise<string | null> {
  const { data } = await supabase
    .from("inbound_messages")
    .select("to_phone")
    .eq("from_phone", phone)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.to_phone ?? null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const supabase = serviceClient();

  const candidate = req.headers.get("x-cron-secret") ?? "";
  const { data: authorized, error: authError } = await supabase.rpc("verify_cron_secret", { candidate });
  if (authError || !authorized) return new Response("Unauthorized", { status: 401 });

  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
  if (!accountSid || !authToken) {
    console.error("TWILIO_AUTH_TOKEN/TWILIO_ACCOUNT_SID not configured — skipping this run");
    return new Response("Twilio not configured", { status: 500 });
  }

  if ((Deno.env.get("OUTBOUND_SMS_ENABLED") ?? "true") !== "true") {
    return new Response("outbound sms disabled", { status: 200 });
  }

  const now = Date.now();
  let sent = 0;
  let failures = 0;

  // 1. Expiry reminders.
  const { data: idleBindings, error: idleError } = await supabase
    .from("phone_event_bindings")
    .select("phone_number, events(folder_code)")
    .lt("last_activity_at", new Date(now - EXPIRY_IDLE_MS).toISOString())
    .gte("last_activity_at", new Date(now - PAUSE_IDLE_MS).toISOString())
    .is("expiry_notified_at", null);

  if (idleError) console.error("expiry lookup failed", idleError);

  for (const binding of idleBindings ?? []) {
    // deno-lint-ignore no-explicit-any
    const folderCode = (binding as any).events?.folder_code;
    if (!folderCode) continue;

    const fromNumber = await lookupSendingNumber(supabase, binding.phone_number);
    if (!fromNumber) continue;
    if (sent >= MAX_SENDS_PER_TICK) break;

    // CLAIM BEFORE SENDING (audit N3). pg_cron fires every 60s without
    // waiting for the previous run, and both sweeps do slow per-binding HTTP
    // work, so overlapping ticks are expected. Reading a set and writing the
    // watermark afterwards meant the next tick re-read the same rows and
    // re-sent -- a rep got the same text two or three times, which on an A2P
    // 10DLC campaign is a carrier-filtering risk, not just an annoyance.
    // This is the same optimistic claim photoLoop/transcriptionLoop use.
    const { data: claimed } = await supabase
      .from("phone_event_bindings")
      .update({ expiry_notified_at: new Date().toISOString() })
      .eq("phone_number", binding.phone_number)
      .is("expiry_notified_at", null)
      .select("phone_number")
      .maybeSingle();
    if (!claimed) continue; // another tick got there first

    try {
      await sendSms(
        accountSid,
        authToken,
        binding.phone_number,
        fromNumber,
        `Your session expired. Respond ${folderCode} to reactivate your session.`,
      );
      sent++;
    } catch (err) {
      // Release the claim so a transient failure retries, rather than being
      // swallowed by our own watermark. PAUSE_IDLE_MS still caps how long
      // that retry loop can run.
      await supabase
        .from("phone_event_bindings")
        .update({ expiry_notified_at: null })
        .eq("phone_number", binding.phone_number);
      failures++;
      console.error(`expiry reminder failed for ${binding.phone_number}`, err);
    }
  }

  // 2. Contact-received confirmations.
  const { data: bindings, error: bindingsError } = await supabase
    .from("phone_event_bindings")
    .select("phone_number, contacts_confirmed_through")
    .gte("last_activity_at", new Date(now - PAUSE_IDLE_MS).toISOString());

  if (bindingsError) console.error("bindings lookup failed", bindingsError);

  for (const binding of bindings ?? []) {
    const { data: msgs, error: msgsError } = await supabase
      .from("inbound_messages")
      .select("id, status, received_at")
      .eq("from_phone", binding.phone_number)
      .in("kind", ["photo", "audio"])
      .gt("received_at", binding.contacts_confirmed_through)
      .order("received_at", { ascending: true });

    if (msgsError) {
      console.error(`message lookup failed for ${binding.phone_number}`, msgsError);
      continue;
    }
    if (!msgs || msgs.length === 0) continue;

    const oldestPending = msgs.find((m) => PENDING_STATUSES.has(m.status));
    const readyToFlush = !oldestPending || now - new Date(oldestPending.received_at).getTime() > PENDING_TIMEOUT_MS;
    const newest = msgs[msgs.length - 1];
    const idleLongEnough = now - new Date(newest.received_at).getTime() > CONFIRMATION_IDLE_MS;

    if (!readyToFlush || !idleLongEnough) continue;

    const messageIds = msgs.map((m) => m.id);
    const { count, error: countError } = await supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .in("source_message_id", messageIds);

    if (countError) {
      console.error(`contact count failed for ${binding.phone_number}`, countError);
      continue;
    }

    const fromNumber = await lookupSendingNumber(supabase, binding.phone_number);
    if (!fromNumber) continue;

    const n = count ?? 0;
    const label = n === 1 ? "1 contact" : `${n} contacts`;

    if (sent >= MAX_SENDS_PER_TICK) break;

    // Same claim-before-send as the expiry sweep: advance the high-water mark
    // conditional on it still holding the value this tick read, so an
    // overlapping tick finds nothing to do instead of re-sending.
    const { data: claimedConfirm } = await supabase
      .from("phone_event_bindings")
      .update({ contacts_confirmed_through: newest.received_at })
      .eq("phone_number", binding.phone_number)
      .eq("contacts_confirmed_through", binding.contacts_confirmed_through)
      .select("phone_number")
      .maybeSingle();
    if (!claimedConfirm) continue;

    try {
      await sendSms(accountSid, authToken, binding.phone_number, fromNumber, `${label} received.`);
      sent++;
    } catch (err) {
      await supabase
        .from("phone_event_bindings")
        .update({ contacts_confirmed_through: binding.contacts_confirmed_through })
        .eq("phone_number", binding.phone_number);
      failures++;
      console.error(`contact confirmation failed for ${binding.phone_number}`, err);
    }
  }

  // Return non-200 on any failure so Supabase's own function-error metrics
  // (and any uptime check on the cron) actually fire -- previously every
  // failure was a console.error nobody was watching (audit Q8).
  if (failures > 0) {
    console.error(JSON.stringify({ event: "session_notifications.partial_failure", sent, failures }));
    return new Response(JSON.stringify({ ok: false, sent, failures }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, sent }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

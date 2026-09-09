// Stage 13 — receives Twilio SMS/MMS webhooks. Deployed with verify_jwt:
// false (Twilio's own POST is never a Supabase-authenticated call — it
// carries its own X-Twilio-Signature instead, checked below).
//
// Flow: no media -> either a folder-code bind attempt, or a step in the
// Stage 16 "setup a new conference" SMS conversation (see
// conference_setup_sessions/match_events_by_name in
// 20260909170000_conference_setup_sms.sql) -> bind this phone number to an
// event (phone_event_bindings) either way. Media present -> classify each
// attachment photo/audio off its content-type, insert one inbound_messages
// row per item, and download+upload each to Storage in the background
// (EdgeRuntime.waitUntil) after the TwiML reply is already sent, since
// Twilio expects a fast ack.
// npm:twilio@5's CJS/ESM interop doesn't expose validateRequest as a named
// export under Deno — it's only reachable off the default export (verified
// via a BOOT_ERROR in function_logs on the first deploy attempt).
import twilioPkg from "npm:twilio@5";
import { serviceClient } from "../_shared/supabase-client.ts";

const { validateRequest } = twilioPkg;

// A session older than this is abandoned rather than resumed — a rep who
// goes quiet mid-setup and later texts an unrelated folder code shouldn't
// have that text misread as a stale reply.
const SESSION_STALE_MS = 15 * 60 * 1000;

// Deliberately a small fixed set rather than a looser regex — a false
// trigger would hijack what the rep meant as a folder-code bind attempt.
const START_TRIGGER_PHRASES = new Set([
  "setup a new conference",
  "set up a new conference",
  "new conference",
  "setup conference",
  "set up conference",
]);

interface SetupCandidate {
  id: string;
  name: string;
  state: string;
}

function twiml(message: string): Response {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`;
  return new Response(xml, { status: 200, headers: { "Content-Type": "text/xml" } });
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function extFromContentType(ct: string): string {
  const sub = ct.split("/")[1]?.split(";")[0] ?? "";
  if (sub) return sub;
  return "bin";
}

function normalizeBody(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
  if (!authToken || !accountSid) {
    console.error("TWILIO_AUTH_TOKEN/TWILIO_ACCOUNT_SID not configured — refusing all requests until set");
    return new Response("Twilio not configured", { status: 500 });
  }

  const rawBody = await req.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody));
  const signature = req.headers.get("x-twilio-signature") ?? "";
  // Twilio signs the exact public URL it POSTed to — TWILIO_WEBHOOK_URL lets
  // this be set explicitly if req.url ever differs from what Twilio sees
  // (e.g. behind a proxy that rewrites the host).
  const publicUrl = Deno.env.get("TWILIO_WEBHOOK_URL") ?? req.url;

  const valid = validateRequest(authToken, signature, publicUrl, params);
  if (!valid) return new Response("Invalid signature", { status: 403 });

  const from = params.From ?? "";
  const to = params.To ?? "";
  const sid = params.MessageSid || crypto.randomUUID();
  const body = (params.Body ?? "").trim();
  const numMedia = Number(params.NumMedia ?? "0");

  const supabase = serviceClient();

  // No media: either a step in an in-progress "setup a new conference"
  // conversation, a folder-code bind attempt, or the phrase that starts a
  // new conversation.
  if (numMedia === 0) {
    const normalized = normalizeBody(body);

    const { data: rawSession } = await supabase
      .from("conference_setup_sessions")
      .select("step, candidates, updated_at")
      .eq("phone_number", from)
      .maybeSingle();

    const isStale = !!rawSession && Date.now() - new Date(rawSession.updated_at).getTime() > SESSION_STALE_MS;
    if (isStale) {
      await supabase.from("conference_setup_sessions").delete().eq("phone_number", from);
    }
    const session = isStale ? null : rawSession;

    if (session && normalized === "cancel") {
      await supabase.from("conference_setup_sessions").delete().eq("phone_number", from);
      await supabase.from("inbound_messages").insert({
        twilio_message_sid: sid,
        from_phone: from,
        to_phone: to,
        kind: "conference_setup",
        status: "completed",
        body,
      });
      return twiml("Setup cancelled.");
    }

    // A repeated trigger phrase mid-conversation (e.g. a rep re-sending it
    // after not seeing a reply) restarts the flow rather than being read as
    // the conference name/selection the current step was expecting.
    if (session && START_TRIGGER_PHRASES.has(normalized)) {
      await supabase.from("conference_setup_sessions").upsert({
        phone_number: from,
        step: "awaiting_name",
        candidates: null,
        updated_at: new Date().toISOString(),
      });
      await supabase.from("inbound_messages").insert({
        twilio_message_sid: sid,
        from_phone: from,
        to_phone: to,
        kind: "conference_setup",
        status: "completed",
        body,
      });
      return twiml("Starting over — what's the name of the conference?");
    }

    if (session?.step === "awaiting_selection") {
      const candidates = (session.candidates ?? []) as SetupCandidate[];
      const choice = Number.parseInt(normalized, 10);
      const picked = Number.isInteger(choice) ? candidates[choice - 1] : undefined;

      if (!picked) {
        await supabase.from("inbound_messages").insert({
          twilio_message_sid: sid,
          from_phone: from,
          to_phone: to,
          kind: "conference_setup",
          status: "failed",
          body,
          error: "reply did not match a candidate number",
        });
        return twiml(`Please reply with a number from 1-${candidates.length}, or text cancel.`);
      }

      await supabase.from("phone_event_bindings").upsert({
        phone_number: from,
        event_id: picked.id,
        updated_at: new Date().toISOString(),
      });
      await supabase.from("conference_setup_sessions").delete().eq("phone_number", from);
      await supabase.from("inbound_messages").insert({
        twilio_message_sid: sid,
        from_phone: from,
        to_phone: to,
        event_id: picked.id,
        kind: "conference_setup",
        status: "completed",
        body,
      });
      return twiml(`${picked.name} activated — you can now send contact cards for this event.`);
    }

    if (session?.step === "awaiting_name") {
      const { data: matches, error: matchError } = await supabase.rpc("match_events_by_name", { p_query: body });
      if (matchError) console.error("match_events_by_name failed", matchError);
      const candidates: SetupCandidate[] = (matches ?? []).map(
        (m: SetupCandidate) => ({ id: m.id, name: m.name, state: m.state }),
      );

      if (candidates.length === 0) {
        await supabase.from("inbound_messages").insert({
          twilio_message_sid: sid,
          from_phone: from,
          to_phone: to,
          kind: "conference_setup",
          status: "failed",
          body,
          error: "no fuzzy match found",
        });
        return twiml("I couldn't find a close match. Try the name again, or text cancel.");
      }

      await supabase.from("conference_setup_sessions").upsert({
        phone_number: from,
        step: "awaiting_selection",
        candidates,
        updated_at: new Date().toISOString(),
      });
      await supabase.from("inbound_messages").insert({
        twilio_message_sid: sid,
        from_phone: from,
        to_phone: to,
        kind: "conference_setup",
        status: "completed",
        body,
      });

      const list = candidates.map((c, i) => `${i + 1}. ${c.name} (${c.state})`).join("\n");
      return twiml(`Are any of these the conference you want to activate?\n${list}\nReply with the number, or text cancel.`);
    }

    if (START_TRIGGER_PHRASES.has(normalized)) {
      await supabase.from("conference_setup_sessions").upsert({
        phone_number: from,
        step: "awaiting_name",
        candidates: null,
        updated_at: new Date().toISOString(),
      });
      await supabase.from("inbound_messages").insert({
        twilio_message_sid: sid,
        from_phone: from,
        to_phone: to,
        kind: "conference_setup",
        status: "completed",
        body,
      });
      return twiml("What's the name of the conference?");
    }

    // Fallback: exact folder-code bind attempt (unchanged from before Stage 16).
    // folder_code is always generated lowercase (events_activate); a rep's
    // phone keyboard routinely auto-capitalizes the first letter of a text.
    const { data: event } = await supabase
      .from("events")
      .select("id")
      .eq("folder_code", body.toLowerCase())
      .maybeSingle();

    if (!event) {
      await supabase.from("inbound_messages").insert({
        twilio_message_sid: sid,
        from_phone: from,
        to_phone: to,
        kind: "unrecognized",
        status: "failed",
        body,
        error: "text did not match a known event folder code",
      });
      return twiml("Sorry, that doesn't match a known event code. Text your event's folder code first.");
    }

    await supabase.from("phone_event_bindings").upsert({
      phone_number: from,
      event_id: event.id,
      updated_at: new Date().toISOString(),
    });
    await supabase.from("inbound_messages").insert({
      twilio_message_sid: sid,
      from_phone: from,
      to_phone: to,
      event_id: event.id,
      kind: "folder_code_bind",
      status: "completed",
      body,
    });
    return twiml("Got it — bound to this event. Text card photos (and an optional voice memo) now.");
  }

  // Media present: this phone must already be bound to an event.
  const { data: binding } = await supabase
    .from("phone_event_bindings")
    .select("event_id")
    .eq("phone_number", from)
    .maybeSingle();

  if (!binding) {
    await supabase.from("inbound_messages").insert({
      twilio_message_sid: sid,
      from_phone: from,
      to_phone: to,
      kind: "unrecognized",
      status: "failed",
      body,
      error: "no event binding for this phone number",
    });
    return twiml("Text your event's folder code first, then send card photos.");
  }

  let received = 0;
  for (let i = 0; i < numMedia; i++) {
    const mediaUrl = params[`MediaUrl${i}`];
    const contentType = params[`MediaContentType${i}`] ?? "";
    const kind = contentType.startsWith("image/") ? "photo" : contentType.startsWith("audio/") ? "audio" : "unrecognized";
    const status = kind === "photo" ? "pending_ocr" : kind === "audio" ? "pending_transcription" : "failed";

    const { data: inserted, error } = await supabase
      .from("inbound_messages")
      .insert({
        // NumMedia>1 shares one MessageSid across all its parts — suffix by
        // index so each part gets its own unique row (mirrors process-cards'
        // per-card sourceImageHash suffix for the same underlying reason).
        twilio_message_sid: numMedia > 1 ? `${sid}-${i}` : sid,
        from_phone: from,
        to_phone: to,
        event_id: binding.event_id,
        kind,
        status,
        media_content_type: contentType,
      })
      .select("id")
      .single();

    if (error) {
      if (error.code === "23505") continue; // duplicate webhook retry, already recorded
      console.error("insert inbound_messages failed", error);
      continue;
    }
    received++;

    if (kind === "unrecognized" || !mediaUrl) continue;

    const messageId = inserted.id;
    // deno-lint-ignore no-explicit-any
    (globalThis as any).EdgeRuntime?.waitUntil((async () => {
      try {
        const res = await fetch(mediaUrl, {
          headers: { Authorization: "Basic " + btoa(`${accountSid}:${authToken}`) },
        });
        if (!res.ok) throw new Error(`Twilio media fetch failed: HTTP ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const bucket = kind === "photo" ? "contact-photos" : "voice-memos";
        const key = `sms/${messageId}.${extFromContentType(contentType)}`;

        const { error: uploadError } = await supabase.storage
          .from(bucket)
          .upload(key, bytes, { contentType, upsert: true });
        if (uploadError) throw uploadError;

        await supabase.from("inbound_messages").update({ storage_path: key }).eq("id", messageId);
      } catch (err) {
        console.error(`media download/upload failed for ${messageId}`, err);
        await supabase
          .from("inbound_messages")
          .update({ status: "failed", error: String(err instanceof Error ? err.message : err) })
          .eq("id", messageId);
      }
    })());
  }

  return twiml(`Got it — ${received} item(s) received.`);
});

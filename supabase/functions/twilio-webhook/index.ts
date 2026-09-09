// Stage 13 — receives Twilio SMS/MMS webhooks. Deployed with verify_jwt:
// false (Twilio's own POST is never a Supabase-authenticated call — it
// carries its own X-Twilio-Signature instead, checked below).
//
// Flow: no media + Body matching an event's folder code -> bind this phone
// number to that event (phone_event_bindings). Media present -> classify
// each attachment photo/audio off its content-type, insert one
// inbound_messages row per item, and download+upload each to Storage in
// the background (EdgeRuntime.waitUntil) after the TwiML reply is already
// sent, since Twilio expects a fast ack.
// npm:twilio@5's CJS/ESM interop doesn't expose validateRequest as a named
// export under Deno — it's only reachable off the default export (verified
// via a BOOT_ERROR in function_logs on the first deploy attempt).
import twilioPkg from "npm:twilio@5";
import { serviceClient } from "../_shared/supabase-client.ts";

const { validateRequest } = twilioPkg;

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

  // No media: a plain text message is only ever a folder-code bind attempt.
  if (numMedia === 0) {
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

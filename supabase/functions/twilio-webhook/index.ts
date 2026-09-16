// Stage 13 — receives Twilio SMS/MMS webhooks. Deployed with verify_jwt:
// false (Twilio's own POST is never a Supabase-authenticated call — it
// carries its own X-Twilio-Signature instead, checked below).
//
// Flow: no media -> a step in the Stage 16 "setup a new conference" SMS
// conversation (see conference_setup_sessions/match_conferences_by_name in
// 20260909170000_conference_setup_sms.sql and, for Stage 20's rework,
// 20260917110000_sms_setup_finds_new_conferences.sql -- picking an
// already-active conference just binds; picking one Zoho has but nobody has
// activated yet activates it first, state auto-detected from its name),
// or a folder-code bind attempt (binds phone_event_bindings), or --
// Stage 18, once already bound -- a short single-contact note that fits one
// SMS segment (see fitsOneSmsSegment and 20260916110000_sms_note_intake.sql;
// anything longer or multi-person is pointed at the web notes page instead).
// Media present -> classify each
// attachment photo/audio off its content-type, insert one inbound_messages
// row per item. Audio downloads+uploads to Storage fully in the background
// (EdgeRuntime.waitUntil) after the TwiML reply is already sent, since
// Twilio expects a fast ack. Photos are downloaded inline instead (still
// ack'd well within Twilio's timeout) so a whole-image sha256 match against
// contacts.source_image_hash — a rep re-sending the exact same shot — can
// be reported back in that same reply instead of silently no-op'ing deep in
// process-cards minutes later with no feedback to the rep at all; the
// Storage upload itself still happens in the background either way, reusing
// the bytes already downloaded for hashing.
// npm:twilio@5's CJS/ESM interop doesn't expose validateRequest as a named
// export under Deno — it's only reachable off the default export (verified
// via a BOOT_ERROR in function_logs on the first deploy attempt).
// Same reasoning as _shared/supabase-client.ts: no import map is deployed
// alongside this function for a bare specifier to resolve against.
// deno-lint-ignore no-import-prefix
import twilioPkg from "npm:twilio@5";
import { serviceClient } from "../_shared/supabase-client.ts";
import { US_STATE_BY_ABBREVIATION, VALID_US_STATES } from "../_shared/usStates.ts";

const { validateRequest } = twilioPkg;

// A session older than this is abandoned rather than resumed — a rep who
// goes quiet mid-setup and later texts an unrelated folder code shouldn't
// have that text misread as a stale reply.
const SESSION_STALE_MS = 60 * 60 * 1000;

// Deliberately a small fixed set rather than a looser regex — a false
// trigger would hijack what the rep meant as a folder-code bind attempt.
const START_TRIGGER_PHRASES = new Set([
  "setup",
  "setup a new conference",
  "set up a new conference",
  "new conference",
  "setup conference",
  "set up conference",
]);

// Stage 20: a candidate is either a conference someone already activated
// (kind 'event' -- picking it just binds this phone, same as always) or one
// Zoho has but nobody has activated yet (kind 'campaign' -- picking it
// activates it first, using a state auto-detected from the name if
// possible, then binds). See match_conferences_by_name and
// conference_date_from_name in 20260917110000_sms_setup_finds_new_conferences.sql.
// Stage 20.1: when a campaign's state can't be auto-detected, the session
// moves to a third step ('awaiting_state', storing this same candidate as
// the session's single-element candidates array) rather than dead-ending --
// see 20260917120000_conference_setup_awaiting_state_step.sql.
interface SetupCandidate {
  kind: "event" | "campaign";
  eventId: string | null;
  zohoCampaignId: string | null;
  name: string;
  state: string | null;
}

// This org's campaign/event names consistently carry a two-letter postal
// code for the conference's state, right after the date prefix
// ("2026 09.28 (TX) Region 19 ESC LEAD Summit") or as a trailing ", XX"
// (e.g. "...Carlsbad, CA..."). Tried in that order since the parenthetical
// form is the dominant, clearly-intentional convention; a regional code
// that isn't a real postal abbreviation ("(TW)" for "Texas West") matches
// neither and correctly falls through to null -- see
// US_STATE_BY_ABBREVIATION for why guessing wrong isn't an option here.
function stateFromConferenceName(name: string): string | null {
  const paren = /\(([A-Za-z]{2})\)/.exec(name);
  if (paren) {
    const state = US_STATE_BY_ABBREVIATION[paren[1].toUpperCase()];
    if (state) return state;
  }
  const suffix = /,\s*([A-Za-z]{2})\b/.exec(name);
  if (suffix) {
    const state = US_STATE_BY_ABBREVIATION[suffix[1].toUpperCase()];
    if (state) return state;
  }
  return null;
}

// Case-insensitive match against the full state name a rep texts in reply
// to "what state is this in" (Stage 20.1) -- VALID_US_STATES is exact-case,
// but a rep's keyboard/autocorrect isn't going to reliably produce "Texas"
// over "texas" or "TEXAS".
function matchValidState(text: string): string | null {
  const normalized = text.trim().toLowerCase();
  for (const state of VALID_US_STATES) {
    if (state.toLowerCase() === normalized) return state;
  }
  return null;
}

// Shared with both the initial pick (awaiting_selection) and the
// state-collection follow-up (awaiting_state) -- events_activate can fail
// for the same reasons from either path.
function activationFailureReply(name: string, error: { code?: string; message: string }): string {
  return error.code === "CKH01"
    ? error.message
    : `Couldn't activate ${name} right now — try again in a minute, or ask your Solutions Success contact to activate it from the Setup page.`;
}

function twiml(message: string): Response {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`;
  return new Response(xml, { status: 200, headers: { "Content-Type": "text/xml" } });
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Audit A9/S7. This used to return an arbitrary substring of the handset-
// supplied content type, which then became part of a Storage object key
// (`sms/<id>.<ext>`, with upsert:true) and, downstream, was read back out of
// that key and interpolated into a `claude -p` prompt by local-agent. A
// subtype containing `/` or `..` wrote outside the sms/ prefix; one containing
// whitespace or a newline became a prompt-framing primitive.
//
// Twilio's signature proves the request came from Twilio, not that this string
// is well-formed -- the sending handset chooses it. Allowlist rather than
// sanitise.
const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/gif": "gif",
  "image/webp": "webp",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "m4a",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/amr": "amr",
  "audio/3gpp": "3gp",
};

function extFromContentType(ct: string): string | null {
  return EXT_BY_CONTENT_TYPE[ct.split(";")[0].trim().toLowerCase()] ?? null;
}

function normalizeBody(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

// GSM-7 encodable text fits 160 chars in a single SMS segment; anything
// outside that charset forces UCS-2 encoding, which caps a single segment at
// 70 — a curly quote from autocorrect is enough to trigger it (see
// 20260914140000_pasted_note_intake.sql). Checked against plain 7-bit ASCII
// rather than the exact GSM-7 table: a false negative here just means an
// eligible note gets pointed at the notes page instead, which is the safe
// direction to be wrong in — a false positive would resurrect the
// out-of-order-segment problem this whole check exists to avoid. A code-point
// walk rather than a /[^\x00-\x7F]/ regex -- deno-lint's no-control-regex
// rule flags that escape range as looking like an accidental raw control
// character, and there's no legitimate reason to override it here when a
// plain comparison says the same thing just as clearly.
function fitsOneSmsSegment(text: string): boolean {
  const isAscii = [...text].every((ch) => ch.codePointAt(0)! <= 0x7f);
  return text.length <= (isAscii ? 160 : 70);
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

  // Any inbound request from an already-bound phone counts as activity —
  // refreshes the 60-minute idle clock session-notifications watches and
  // cancels a pending reminder so the next idle stretch can trigger a
  // fresh one. No-ops (0 rows) for a phone that isn't bound to anything.
  await supabase
    .from("phone_event_bindings")
    .update({ last_activity_at: new Date().toISOString(), expiry_notified_at: null })
    .eq("phone_number", from);

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
      return twiml("Starting over — what's the name of the conference? Type as much as you remember.");
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
        return twiml(`That's not one of the options — just reply with the number (ie. 2) from the list above. If it's none of these reply "SETUP" to start over`);
      }

      // Already active: bind only, same as always. Not yet activated and we
      // could parse a state from its name: activate then bind. Not yet
      // activated and we couldn't: ask for the state instead of failing --
      // see the awaiting_state branch below.
      if (picked.kind === "campaign" && !picked.state) {
        await supabase.from("conference_setup_sessions").upsert({
          phone_number: from,
          step: "awaiting_state",
          candidates: [picked],
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
        return twiml(`I can't tell what state "${picked.name}" is in, text the full state name the conference is in here so I can set it up.`);
      }

      let eventId = picked.eventId;
      let eventName = picked.name;
      if (picked.kind === "campaign") {
        // picked.state came from stateFromConferenceName when the candidate
        // list was built, since Zoho campaigns carry no structured state
        // field (see events_activate's p_state param).
        const { data: activated, error: activateError } = await supabase.rpc("events_activate", {
          p_zoho_campaign_id: picked.zohoCampaignId,
          p_name: picked.name,
          p_state: picked.state,
        });
        if (activateError) {
          // Same 'CKH01' user-facing/technical split events-activate/index.ts
          // uses -- see 20260917100000_event_reps_and_activation_guard.sql.
          console.error("events_activate failed (SMS setup)", activateError);
          const friendly = activationFailureReply(picked.name, activateError);
          await supabase.from("inbound_messages").insert({
            twilio_message_sid: sid,
            from_phone: from,
            to_phone: to,
            kind: "conference_setup",
            status: "failed",
            body,
            error: friendly,
          });
          return twiml(friendly);
        }
        eventId = activated.id;
        eventName = activated.name;
      }

      await supabase.from("phone_event_bindings").upsert({
        phone_number: from,
        event_id: eventId,
        updated_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
        expiry_notified_at: null,
        // Switching events resets the confirmation watermark so a stale
        // value from a prior event can't skip confirming this event's
        // first batch of contacts.
        contacts_confirmed_through: new Date().toISOString(),
      });
      await supabase.from("conference_setup_sessions").delete().eq("phone_number", from);
      await supabase.from("inbound_messages").insert({
        twilio_message_sid: sid,
        from_phone: from,
        to_phone: to,
        event_id: eventId,
        kind: "conference_setup",
        status: "completed",
        body,
      });
      const reply = picked.kind === "campaign"
        ? `${eventName} (${picked.state}) is activated and you're linked to it. Text a photo of a business card (and an optional voice memo right after) whenever you're ready.`
        : `You're linked to ${eventName}. Text photo(s) of business cards, conference tags, etc. (and an optional voice memo right after) whenever you're ready.`;
      return twiml(reply);
    }

    if (session?.step === "awaiting_state") {
      const candidate = ((session.candidates ?? []) as SetupCandidate[])[0];
      const state = matchValidState(body);

      if (!state) {
        await supabase.from("inbound_messages").insert({
          twilio_message_sid: sid,
          from_phone: from,
          to_phone: to,
          kind: "conference_setup",
          status: "failed",
          body,
          error: "reply did not match a US state name",
        });
        return twiml("I didn't recognize that as a US state — reply with the full name (like Texas or Ohio).");
      }

      const { data: activated, error: activateError } = await supabase.rpc("events_activate", {
        p_zoho_campaign_id: candidate.zohoCampaignId,
        p_name: candidate.name,
        p_state: state,
      });
      if (activateError) {
        console.error("events_activate failed (SMS setup, state supplied)", activateError);
        const friendly = activationFailureReply(candidate.name, activateError);
        await supabase.from("inbound_messages").insert({
          twilio_message_sid: sid,
          from_phone: from,
          to_phone: to,
          kind: "conference_setup",
          status: "failed",
          body,
          error: friendly,
        });
        return twiml(friendly);
      }

      await supabase.from("phone_event_bindings").upsert({
        phone_number: from,
        event_id: activated.id,
        updated_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
        expiry_notified_at: null,
        contacts_confirmed_through: new Date().toISOString(),
      });
      await supabase.from("conference_setup_sessions").delete().eq("phone_number", from);
      await supabase.from("inbound_messages").insert({
        twilio_message_sid: sid,
        from_phone: from,
        to_phone: to,
        event_id: activated.id,
        kind: "conference_setup",
        status: "completed",
        body,
      });
      return twiml(`${activated.name} (${state}) is activated and you're linked to it. Text a photo of a business card (and an optional voice memo right after) whenever you're ready.`);
    }

    if (session?.step === "awaiting_name") {
      // Stage 20: searches both already-active events (pick -> bind) and
      // not-yet-activated Zoho campaigns (pick -> activate, then bind) --
      // "setup a new conference" couldn't previously find or create
      // anything that wasn't already an event, no matter how well it
      // matched. See 20260917110000_sms_setup_finds_new_conferences.sql.
      const { data: matches, error: matchError } = await supabase.rpc("match_conferences_by_name", { p_query: body });
      if (matchError) console.error("match_conferences_by_name failed", matchError);
      // deno-lint-ignore no-explicit-any
      const candidates: SetupCandidate[] = (matches ?? []).map((m: any) => ({
        kind: m.kind,
        eventId: m.event_id,
        zohoCampaignId: m.zoho_campaign_id,
        name: m.name,
        state: m.kind === "event" ? m.state : stateFromConferenceName(m.name),
      }));

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
        return twiml(`I couldn't find a close match for "${body}". Try typing more of the official name — the state or city helps too.`);
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

      // A not-yet-active campaign always reads "I'll set it up when you pick
      // it" regardless of whether a state could be parsed from its name --
      // if not, picking it now asks for the state instead of failing (see
      // the awaiting_state step), so it's never a dead end either way.
      const list = candidates.map((c, i) => {
        if (c.kind === "event") return `${i + 1}. ${c.name} (${c.state}) — already active, I'll just link your phone`;
        return `${i + 1}. ${c.name}${c.state ? ` (${c.state})` : ""} — not active yet, I'll set it up when you pick it`;
      }).join("\n");
      return twiml(`Here's what I found — reply with the number:\n${list}\n(If none of these are right, try texting the name again with more detail.)`);
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
      return twiml("What's the name of the conference? (as much as you remember)");
    }

    // Fallback: exact folder-code bind attempt (unchanged from before Stage 16).
    // folder_code is always generated lowercase (events_activate); a rep's
    // phone keyboard routinely auto-capitalizes the first letter of a text.
    const { data: event } = await supabase
      .from("events")
      .select("id, name")
      .eq("folder_code", body.toLowerCase())
      .maybeSingle();

    if (!event) {
      // Not a folder code either. If this phone is already bound to an
      // event, this wasn't a mistyped code — Stage 18: a short, one-contact
      // note fits inside a single SMS segment and is worth accepting
      // directly, rather than replying with a confusing "doesn't match a
      // known event code" for text that was never meant to be one. Longer or
      // multi-person notes still go to the web notes page — see
      // fitsOneSmsSegment and 20260916110000_sms_note_intake.sql.
      const { data: binding } = await supabase
        .from("phone_event_bindings")
        .select("event_id")
        .eq("phone_number", from)
        .maybeSingle();

      if (binding && body.length > 0) {
        if (!fitsOneSmsSegment(body)) {
          await supabase.from("inbound_messages").insert({
            twilio_message_sid: sid,
            from_phone: from,
            to_phone: to,
            event_id: binding.event_id,
            kind: "text_note",
            status: "failed",
            body,
            error: "text exceeds a single SMS segment",
          });
          return twiml("That's too long for one text. Keep it to one short line about one person, or use the Notes page in the app for anything longer or for multiple people.");
        }

        // Logged first, and note_submissions only inserted if that log entry
        // was new. Every other branch in this function performs an upsert
        // (phone_event_bindings) or a delete for its real side effect, both
        // idempotent against a Twilio retry of the same MessageSid; this
        // branch's real side effect is a plain insert, which isn't. The
        // unique twilio_message_sid constraint is what makes a retry
        // detectable at all, so it has to run before the non-idempotent
        // write, not after — otherwise a retry (Twilio resends on a slow ack
        // or non-2xx) would create a second note_submissions row, and a
        // second contact, for the same text.
        const { error: logError } = await supabase.from("inbound_messages").insert({
          twilio_message_sid: sid,
          from_phone: from,
          to_phone: to,
          event_id: binding.event_id,
          kind: "text_note",
          status: "completed",
          body,
        });
        if (logError) {
          if (logError.code !== "23505") console.error("insert inbound_messages failed", logError);
          return twiml("Got it — that contact's logged and will show up in Review in a few minutes.");
        }

        await supabase.from("note_submissions").insert({ event_id: binding.event_id, from_phone: from, body });
        return twiml("Got it — that contact's logged and will show up in Review in a few minutes.");
      }

      await supabase.from("inbound_messages").insert({
        twilio_message_sid: sid,
        from_phone: from,
        to_phone: to,
        kind: "unrecognized",
        status: "failed",
        body,
        error: "text did not match a known event folder code",
      });
      return twiml("I didn't recognize that. If you have your event's folder code, text it to link your phone. If not, text SETUP and I'll help you find your conference by name.");
    }

    await supabase.from("phone_event_bindings").upsert({
      phone_number: from,
      event_id: event.id,
      updated_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      expiry_notified_at: null,
      // Switching events resets the confirmation watermark so a stale
      // value from a prior event can't skip confirming this event's
      // first batch of contacts.
      contacts_confirmed_through: new Date().toISOString(),
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
    return twiml(`You're linked to ${event.name}. Text a photo of a business card (and an optional voice memo right after) whenever you're ready.`);
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
    return twiml("Your phone isn't linked to an event yet. Text your folder code, or text SETUP to find your conference by name — then send card photos.");
  }

  let received = 0;
  // Duplicate photos (a rep re-sending the exact same shot, e.g. while
  // testing) used to disappear silently: process-cards would correctly
  // no-op them against contacts.source_image_hash, but nothing ever told
  // the rep that — they'd just see the same generic "Got it" reply as a
  // brand-new card and assume the pipeline was broken. Checked here,
  // synchronously, so the very first reply already says so — this can't
  // wait for local-agent's background OCR pass, which may run minutes
  // later or not be running at all.
  const noteworthy: string[] = [];

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
    const bucket = kind === "photo" ? "contact-photos" : "voice-memos";

    const ext = extFromContentType(contentType);
    if (!ext) {
      // An unmapped type is not something the pipeline can process; storing it
      // as ".bin" just defers the failure to a place with less context.
      await supabase
        .from("inbound_messages")
        .update({ status: "failed", error: `unsupported media content-type: ${contentType}` })
        .eq("id", messageId);
      noteworthy.push("That attachment type isn't supported — send a photo or a voice memo.");
      continue;
    }

    const key = `sms/${messageId}.${ext}`;
    // Assert the composed key rather than trusting the derivation: upsert is
    // on, so a key that escapes the prefix would clobber another message's
    // object.
    if (!/^sms\/[0-9a-f-]{36}\.[a-z0-9]{1,5}$/.test(key)) {
      await supabase
        .from("inbound_messages")
        .update({ status: "failed", error: `refusing to upload to an unexpected storage key: ${key}` })
        .eq("id", messageId);
      continue;
    }

    if (kind === "photo") {
      // Photos only: download inline (not in the background) so the hash
      // is known before the TwiML reply is built. Audio has no dedup
      // concept, so it keeps the original fully-backgrounded path below.
      try {
        const res = await fetch(mediaUrl, {
          headers: { Authorization: "Basic " + btoa(`${accountSid}:${authToken}`) },
        });
        if (!res.ok) throw new Error(`Twilio media fetch failed: HTTP ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const hashBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
        const hash = Array.from(hashBytes).map((b) => b.toString(16).padStart(2, "0")).join("");

        // A plain (unsuffixed) hash match only ever corresponds to a prior
        // single-card submission — process-cards suffixes multi-card hashes
        // with -01/-02/etc, so this can't false-positive against one card
        // of an unrelated multi-card sheet.
        const { data: existingContact } = await supabase
          .from("contacts")
          .select("first_name, last_name")
          .eq("source_image_hash", hash)
          .maybeSingle();

        // Upload in the background either way (still worth archiving a
        // duplicate submission) — reuses the bytes already downloaded above
        // rather than fetching from Twilio a second time.
        // deno-lint-ignore no-explicit-any
        (globalThis as any).EdgeRuntime?.waitUntil((async () => {
          try {
            const { error: uploadError } = await supabase.storage
              .from(bucket)
              .upload(key, bytes, { contentType, upsert: true });
            if (uploadError) throw uploadError;
            await supabase.from("inbound_messages").update({ storage_path: key }).eq("id", messageId);
          } catch (err) {
            console.error(`media upload failed for ${messageId}`, err);
            // Don't clobber a status this request already finalized below
            // (completed, for the duplicate path) with a stale failure.
            await supabase
              .from("inbound_messages")
              .update({ status: "failed", error: String(err instanceof Error ? err.message : err) })
              .eq("id", messageId)
              .eq("status", "pending_ocr");
          }
        })());

        if (existingContact) {
          await supabase.from("inbound_messages").update({
            status: "completed",
            processed_at: new Date().toISOString(),
          }).eq("id", messageId);
          const name = [existingContact.first_name, existingContact.last_name].filter(Boolean).join(" ") || "an existing contact";
          noteworthy.push(`Already have this one — ${name}.`);
        }
      } catch (err) {
        console.error(`media download failed for ${messageId}`, err);
        await supabase
          .from("inbound_messages")
          .update({ status: "failed", error: String(err instanceof Error ? err.message : err) })
          .eq("id", messageId);
        noteworthy.push(`Couldn't download that photo — try resending it.`);
      }
      continue;
    }

    // deno-lint-ignore no-explicit-any
    (globalThis as any).EdgeRuntime?.waitUntil((async () => {
      try {
        const res = await fetch(mediaUrl, {
          headers: { Authorization: "Basic " + btoa(`${accountSid}:${authToken}`) },
        });
        if (!res.ok) throw new Error(`Twilio media fetch failed: HTTP ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());

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

  return twiml([`Got it — ${received} item(s) received.`, ...noteworthy].join(" "));
});

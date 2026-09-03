// Stage 14 — transcribes one voice memo (OpenAI Whisper) and merges the
// transcript into interaction_notes on whichever contact(s) it's about.
// Invoked by a Postgres trigger (inbound_messages_audio_insert, in the
// twilio_intake_trigger migration) immediately on INSERT of an
// kind='audio' row — no reason to wait on the local agent's poll cycle
// since this step has no claude -p dependency.
//
// verify_jwt stays true (the default): the trigger calls this with the
// project's anon key as a bearer token, same trust level as the other
// public-but-anon-gated functions. The claim-then-mark-processing update
// below is the real guard against a repeat/replayed invocation re-running
// (and re-billing) a transcription.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

const CORRELATION_WINDOW_MINUTES = 15;

function extFromContentType(ct: string | null): string {
  if (!ct) return "m4a";
  if (ct.includes("mp4") || ct.includes("m4a") || ct.includes("aac")) return "m4a";
  if (ct.includes("mpeg") || ct.includes("mp3")) return "mp3";
  if (ct.includes("wav")) return "wav";
  if (ct.includes("ogg")) return "ogg";
  return "m4a";
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse(req, 405, "Method not allowed");

  const body = await req.json().catch(() => null);
  if (!body || typeof body.inboundMessageId !== "string") {
    return errorResponse(req, 400, "inboundMessageId is required");
  }

  const supabase = serviceClient();

  // Idempotency / cost-griefing guard: only ever proceeds from
  // pending_transcription, flipping to processing atomically as part of
  // the same update — a retry or a replayed id is a clean no-op.
  const { data: claimed, error: claimError } = await supabase
    .from("inbound_messages")
    .update({ status: "processing" })
    .eq("id", body.inboundMessageId)
    .eq("kind", "audio")
    .eq("status", "pending_transcription")
    .select("*")
    .maybeSingle();
  if (claimError) return errorResponse(req, 500, claimError.message);
  if (!claimed) return jsonResponse(req, { skipped: true, reason: "not pending_transcription" });

  if (!claimed.storage_path) {
    await supabase.from("inbound_messages").update({
      status: "failed",
      error: "no storage_path yet — media upload may still be in flight or failed",
    }).eq("id", claimed.id);
    return errorResponse(req, 409, "Audio not yet uploaded to Storage");
  }

  try {
    const { data: audioBlob, error: downloadError } = await supabase.storage
      .from("voice-memos")
      .download(claimed.storage_path);
    if (downloadError || !audioBlob) throw downloadError ?? new Error("Storage download returned no data");

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) throw new Error("OPENAI_API_KEY not configured");

    const form = new FormData();
    form.append("file", audioBlob, `memo.${extFromContentType(claimed.media_content_type)}`);
    form.append("model", "whisper-1");

    const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: form,
    });
    if (!whisperRes.ok) {
      throw new Error(`Whisper API HTTP ${whisperRes.status}: ${await whisperRes.text()}`);
    }
    const { text: transcript } = await whisperRes.json();

    // Correlate: contacts whose source_message_id points at a photo message
    // from the same phone, received in the window preceding this memo.
    const windowStart = new Date(
      new Date(claimed.received_at).getTime() - CORRELATION_WINDOW_MINUTES * 60_000,
    ).toISOString();

    const { data: candidateMessages, error: candidatesError } = await supabase
      .from("inbound_messages")
      .select("id")
      .eq("from_phone", claimed.from_phone)
      .eq("kind", "photo")
      .gte("received_at", windowStart)
      .lte("received_at", claimed.received_at);
    if (candidatesError) throw candidatesError;

    const matchedContactIds: string[] = [];
    if (candidateMessages && candidateMessages.length > 0) {
      const messageIds = candidateMessages.map((m) => m.id);
      const { data: matchedContacts, error: matchError } = await supabase
        .from("contacts")
        .select("id, interaction_notes")
        .in("source_message_id", messageIds);
      if (matchError) throw matchError;

      for (const contact of matchedContacts ?? []) {
        // Append, not overwrite — a rep could leave more than one memo
        // about the same contact across an event; each keeps a running log.
        const merged = contact.interaction_notes ? `${contact.interaction_notes}\n\n${transcript}` : transcript;
        const { error: updateError } = await supabase
          .from("contacts")
          .update({ interaction_notes: merged })
          .eq("id", contact.id);
        if (updateError) throw updateError;
        matchedContactIds.push(contact.id);
      }
    }

    // An empty matchedContactIds array is a valid, non-error outcome — a
    // memo with nothing to attach to still transcribed successfully.
    await supabase.from("inbound_messages").update({
      transcript,
      status: "completed",
      processed_at: new Date().toISOString(),
      matched_contact_ids: matchedContactIds,
    }).eq("id", claimed.id);

    return jsonResponse(req, { transcript, matchedContactIds });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.from("inbound_messages").update({ status: "failed", error: message }).eq("id", claimed.id);
    return errorResponse(req, 500, message);
  }
});

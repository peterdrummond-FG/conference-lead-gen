// GET [?viewAsRepId=] -> { audio: AudioMemoItem[], failedIntake: FailedIntakeItem[] }
//
// Surfaces the two "went missing" shapes found in the 2026-09-22 voice-memo
// audit that Review previously had no visibility into at all, because it
// only ever lists contacts — a voice memo that never links to one, or a
// photo whose OCR failed, had no row anywhere in the UI:
//   - audio: inbound_messages(kind='audio') still link_status in
//     ('unlinked','no_candidate_found') — see
//     20260922110000_voice_memo_link_state_and_ocr_retry.sql. 'unlinked'
//     rows are still being retried automatically (claim_unlinked_audio_messages);
//     included here so a human can see and, if they recognize who it's
//     about, resolve it themselves rather than only ever waiting.
//   - failedIntake: any inbound_messages row stuck at status='failed'
//     (photo OCR or transcription) — pairs with inbound-messages-retry's
//     manual retry action.
//
// Same role scoping model as contacts-list: sales (or an admin's
// viewAsRepId preview) always sees only their own submissions — matched by
// phone_number, since inbound_messages has no rep_id of its own — scoped to
// their current_event_id; admin/solutionsSuccess see everything.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return errorResponse(req, 405, "Method not allowed");
  const user = await requireUser(req);
  if (!user) return errorResponse(req, 401, "Unauthorized");

  const supabase = serviceClient();
  const url = new URL(req.url);
  const viewAsRepId = user.role === "admin" ? url.searchParams.get("viewAsRepId") : null;

  let phoneFilter: string | null = null;
  let eventFilter: string | null = null;
  if (user.role === "sales" || viewAsRepId) {
    const repId = viewAsRepId ?? user.id;
    const { data: target, error: targetError } = await supabase
      .from("profiles")
      .select("phone_number, current_event_id, role")
      .eq("id", repId)
      .maybeSingle();
    if (targetError) return errorResponse(req, 500, targetError.message);
    if (!target || (viewAsRepId && target.role !== "sales")) return errorResponse(req, 400, "viewAsRepId must be a sales rep.");
    phoneFilter = target.phone_number;
    eventFilter = target.current_event_id;
    // No phone on file, or not linked to an event right now — nothing this
    // rep could have sent in could be scoped to either, so there's nothing
    // to show rather than an error.
    if (!phoneFilter || !eventFilter) return jsonResponse(req, { audio: [], failedIntake: [] });
  }

  let audioQuery = supabase
    .from("inbound_messages")
    .select("id, transcript, received_at, from_phone, event_id, link_status, link_attempts, event:events(name)")
    .eq("kind", "audio")
    .in("link_status", ["unlinked", "no_candidate_found"])
    .order("received_at", { ascending: false });
  let failedQuery = supabase
    .from("inbound_messages")
    .select("id, kind, received_at, from_phone, event_id, error, error_class, processing_attempts, event:events(name)")
    .eq("status", "failed")
    .in("kind", ["photo", "audio"])
    .order("received_at", { ascending: false });

  if (phoneFilter) {
    audioQuery = audioQuery.eq("from_phone", phoneFilter);
    failedQuery = failedQuery.eq("from_phone", phoneFilter);
  }
  if (eventFilter) {
    audioQuery = audioQuery.eq("event_id", eventFilter);
    failedQuery = failedQuery.eq("event_id", eventFilter);
  }

  const [{ data: audio, error: audioError }, { data: failedIntake, error: failedError }] = await Promise.all([
    audioQuery,
    failedQuery,
  ]);
  if (audioError) return errorResponse(req, 500, audioError.message);
  if (failedError) return errorResponse(req, 500, failedError.message);

  return jsonResponse(req, {
    // deno-lint-ignore no-explicit-any
    audio: (audio ?? []).map((m: any) => ({
      id: m.id,
      transcript: m.transcript,
      receivedAt: m.received_at,
      fromPhone: m.from_phone,
      eventId: m.event_id,
      eventName: m.event?.name ?? null,
      linkStatus: m.link_status,
      linkAttempts: m.link_attempts,
    })),
    // deno-lint-ignore no-explicit-any
    failedIntake: (failedIntake ?? []).map((m: any) => ({
      id: m.id,
      kind: m.kind,
      receivedAt: m.received_at,
      fromPhone: m.from_phone,
      eventId: m.event_id,
      eventName: m.event?.name ?? null,
      error: m.error,
      errorClass: m.error_class,
      processingAttempts: m.processing_attempts,
    })),
  });
});

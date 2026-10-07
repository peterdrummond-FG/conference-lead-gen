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
//     about, resolve it themselves rather than only ever waiting. Only memos
//     that already have a transcript: one still being transcribed has nothing
//     to read, assign or extract people from, and would sit here as "(no
//     transcript)" for the seconds it takes. Each also says whether its audio
//     still exists (hasAudio; the 90-day purge nulls storage_path), who sent it
//     (repName, for a manager's list) and what a person's "Create contacts" is
//     doing (create: working / none / failed, null when nobody has tried).
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
    .select("id, transcript, received_at, from_phone, event_id, link_status, link_attempts, storage_path, event:events(name)")
    .eq("kind", "audio")
    .in("link_status", ["unlinked", "no_candidate_found"])
    .not("transcript", "is", null)
    .neq("transcript", "")
    .order("received_at", { ascending: false });
  let failedQuery = supabase
    .from("inbound_messages")
    .select("id, kind, received_at, from_phone, event_id, error, error_class, processing_attempts, storage_path, event:events(name)")
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

  // Two small lookups keyed on the memos just fetched, not joins: the sender's name
  // (a phone number maps to at most one profile) and every Create-contacts attempt
  // made for these memos, newest first so the first one seen per memo is the latest.
  const memoIds = (audio ?? []).map((m) => m.id);
  const phones = [...new Set([...(audio ?? []), ...(failedIntake ?? [])].map((m) => m.from_phone))];
  const [{ data: reps }, { data: submissions }] = await Promise.all([
    phones.length
      ? supabase.from("profiles").select("name, phone_number").in("phone_number", phones)
      : Promise.resolve({ data: [] as { name: string; phone_number: string }[] }),
    memoIds.length
      ? supabase
        .from("note_submissions")
        .select("source_message_id, status, error, created_at")
        .in("source_message_id", memoIds)
        .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as { source_message_id: string; status: string; error: string | null }[] }),
  ]);
  const repByPhone = new Map((reps ?? []).map((r) => [r.phone_number, r.name]));
  const attemptsByMemo = new Map<string, { latest: { status: string; error: string | null }; count: number }>();
  for (const sub of submissions ?? []) {
    const seen = attemptsByMemo.get(sub.source_message_id);
    if (seen) seen.count += 1;
    else attemptsByMemo.set(sub.source_message_id, { latest: sub, count: 1 });
  }
  // A memo is only listed while it has no contact, so a completed submission here
  // means the extraction ran and found nobody ("none"), not that it succeeded.
  const createState = (memoId: string) => {
    const a = attemptsByMemo.get(memoId);
    if (!a) return null;
    const status = ["pending_extraction", "processing"].includes(a.latest.status)
      ? "working"
      : a.latest.status === "failed"
      ? "failed"
      : "none";
    return { status, error: status === "failed" ? a.latest.error : null, attempts: a.count };
  };

  return jsonResponse(req, {
    // deno-lint-ignore no-explicit-any
    audio: (audio ?? []).map((m: any) => ({
      id: m.id,
      transcript: m.transcript,
      receivedAt: m.received_at,
      fromPhone: m.from_phone,
      repName: repByPhone.get(m.from_phone) ?? null,
      eventId: m.event_id,
      eventName: m.event?.name ?? null,
      linkStatus: m.link_status,
      linkAttempts: m.link_attempts,
      hasAudio: !!m.storage_path,
      create: createState(m.id),
    })),
    // deno-lint-ignore no-explicit-any
    failedIntake: (failedIntake ?? []).map((m: any) => ({
      id: m.id,
      kind: m.kind,
      receivedAt: m.received_at,
      fromPhone: m.from_phone,
      eventId: m.event_id,
      repName: repByPhone.get(m.from_phone) ?? null,
      // Whether the stored photo / recording still exists (the 90-day purge removes it):
      // the card offers View photo / Play only while it does.
      hasMedia: !!m.storage_path,
      eventName: m.event?.name ?? null,
      error: m.error,
      errorClass: m.error_class,
      processingAttempts: m.processing_attempts,
    })),
  });
});

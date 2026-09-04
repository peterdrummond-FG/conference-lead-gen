// Stage 11 — replaces backend/Services/MatchingQueue.cs,
// MatchingBackgroundService.cs, and MatchingRetryScanner.cs now that
// matching state lives in Supabase Postgres instead of an in-process .NET
// channel. One poll loop covers what used to be three mechanisms:
//   - claim_pending_contacts' `FOR UPDATE SKIP LOCKED` replaces
//     MatchingQueue's in-flight ConcurrentDictionary tracking.
//   - claim_pending_contacts' attempts/cooldown condition replaces
//     MatchingRetryScanner's separate stuck-Pending sweep.
// processContact below is a near-verbatim port of
// MatchingBackgroundService.ProcessAsync, including its exact
// ResearchInput/ResearchOutput/MatchOutput field contracts and its
// auto-approve rule.
//
// Stage 13 (SMS photo intake) added a second, independent poll loop below
// — photoLoop — for card photos that arrived via Twilio MMS rather than
// the local watcher's inbox/ folder. Both loops run concurrently in this
// one process (matchingLoop's polls are cheap and frequent; photoLoop's
// claude -p calls can run up to 15 minutes for a big multi-card sheet, and
// must not block matching in the meantime — see the bottom of this file).
//
// Stage 14 (revised) added a third loop — transcriptionLoop — for voice
// memos. Originally this ran as a Supabase Edge Function calling OpenAI's
// Whisper API on a Postgres trigger; that's been replaced with a fully
// local, open-source Whisper CLI invocation here, same reasoning as every
// other claude -p step in this file: no metered API key, no cloud
// dependency. See whisper-runner.mjs and 20260903_drop_audio_transcription_trigger.sql.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { supabase } from './supabase-client.mjs';
import { runSkill, runClaudeRaw } from './skill-runner.mjs';
import { transcribeAudio } from './whisper-runner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function log(message) {
  console.log(`${new Date().toISOString()} ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------
// Matching poll loop (Stage 11)
// ---------------------------------------------------------------------

const MATCH_POLL_INTERVAL_MS = Number(process.env.MATCH_POLL_INTERVAL_MS ?? 20_000);
// Same values as MatchingRetryScanner.cs: up to 3 auto attempts, 10 minutes
// idle before a stuck Pending row is eligible for another attempt.
const MAX_MATCH_ATTEMPTS = 3;
const RETRY_DELAY_MINUTES = 10;
const CLAIM_LIMIT = 1;

async function claimPendingContacts() {
  const { data, error } = await supabase.rpc('claim_pending_contacts', {
    max_attempts: MAX_MATCH_ATTEMPTS,
    retry_delay_minutes: RETRY_DELAY_MINUTES,
    claim_limit: CLAIM_LIMIT,
  });
  if (error) throw error;
  if (!data || data.length === 0) return [];

  // The RPC's `RETURNING *` only has bare contacts columns — fetch the
  // event/district/school names research-contact needs as a follow-up
  // select (the claim itself already happened atomically above).
  const ids = data.map((c) => c.id);
  const { data: withJoins, error: joinError } = await supabase
    .from('contacts')
    .select('*, event:events(state), school_district:school_districts(name), school:schools(name)')
    .in('id', ids);
  if (joinError) throw joinError;
  return withJoins ?? [];
}

// Mirrors MatchingBackgroundService.ProcessAsync exactly: research-contact
// runs first, its full output (not just the new fields) is fed as input to
// match-contact, and a single update applies everything at the end. Any
// thrown error here leaves the row exactly as claimPendingContacts left it
// (attempts incremented, still pending) — never fabricate a result.
async function processContact(contact) {
  const researchInput = {
    contactId: contact.id,
    firstName: contact.first_name,
    lastName: contact.last_name,
    email: contact.email,
    phone: contact.phone,
    title: contact.title,
    districtName: contact.school_district?.name ?? null,
    schoolName: contact.school?.name ?? null,
    eventState: contact.event?.state ?? null,
    source: contact.source,
    extractionConfidence: contact.extraction_confidence ?? null,
  };

  const researchOutput = await runSkill('research-contact', researchInput, REPO_ROOT);
  const matchOutput = await runSkill('match-contact', researchOutput, REPO_ROOT);

  // match-contact's own contract guarantees matchStatus is never "pending"
  // — if it ever violates that, treat it like a pipeline failure rather
  // than trusting it blindly.
  if (matchOutput.matchStatus === 'pending') {
    throw new Error('match-contact violated its contract and returned matchStatus=pending');
  }

  const update = {
    research_confidence: researchOutput.researchConfidence ?? null,
    person_verified: researchOutput.personVerified ?? null,
    match_status: matchOutput.matchStatus,
    match_confidence: matchOutput.matchConfidence ?? null,
    matched_zoho_contact_id: matchOutput.matchedZohoContactId ?? null,
    matched_zoho_contact_name: matchOutput.matchedZohoContactName ?? null,
    matched_zoho_contact_email: matchOutput.matchedZohoContactEmail ?? null,
    matched_zoho_contact_phone: matchOutput.matchedZohoContactPhone ?? null,
    matched_zoho_contact_title: matchOutput.matchedZohoContactTitle ?? null,
    matched_zoho_account_id: matchOutput.matchedZohoAccountId ?? null,
    matched_zoho_account_name: matchOutput.matchedZohoAccountName ?? null,
    has_active_opportunity: matchOutput.hasActiveOpportunity ?? null,
    active_opportunity_name: matchOutput.activeOpportunityName ?? null,
    candidate_matches: matchOutput.candidateMatches ?? null,
    notes: matchOutput.notes ?? null,
  };

  // Verbatim auto-approve rule from MatchingBackgroundService.cs, guarded
  // on still being needs_review so a reviewer's manual action that landed
  // mid-flight is never clobbered.
  const stillNeedsReview = contact.review_status === 'needs_review';
  const noLocalDuplicate = !contact.local_duplicate_of_contact_id;
  const highMatchConfidence = update.match_confidence === 'high';
  const extractionOk = contact.extraction_confidence == null || contact.extraction_confidence === 'high';
  if (stillNeedsReview && noLocalDuplicate && highMatchConfidence && extractionOk) {
    update.review_status = 'approved';
    update.auto_approved = true;
  }

  const { error } = await supabase.from('contacts').update(update).eq('id', contact.id);
  if (error) throw error;
}

async function matchingTick() {
  let claimed;
  try {
    claimed = await claimPendingContacts();
  } catch (err) {
    log(`ERROR claiming pending contacts: ${err.message ?? err}`);
    return;
  }

  for (const contact of claimed) {
    log(`processing ${contact.id} (${contact.first_name} ${contact.last_name})`);
    try {
      await processContact(contact);
      log(`done: ${contact.id}`);
    } catch (err) {
      // Never fabricate a result — the row stays at match_status='pending'
      // with attempts already incremented by the claim RPC; it's picked up
      // again after the retry-delay cooldown, up to MAX_MATCH_ATTEMPTS.
      log(`FAIL: ${contact.id} — ${err.message ?? err}`);
    }
  }
}

async function matchingLoop() {
  log(`matching loop starting (poll every ${MATCH_POLL_INTERVAL_MS}ms)`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await matchingTick();
    await sleep(MATCH_POLL_INTERVAL_MS);
  }
}

// ---------------------------------------------------------------------
// SMS card-photo poll loop (Stage 13)
// ---------------------------------------------------------------------
// Card photos texted to the Twilio number land in inbound_messages
// (kind='photo', status='pending_ocr') via the twilio-webhook Edge
// Function, which has already uploaded the bytes to the contact-photos
// Storage bucket at inbound_messages.storage_path. This loop: downloads
// that file locally, runs it through the SAME process-cards skill the
// local folder watcher uses (unchanged OCR/crop logic — only the
// sourceImagePath/croppedImagePath values it's given differ), then
// uploads any crop files process-cards wrote locally back to Storage
// (the original never needs re-uploading — it's already there).
//
// Known limitation, accepted for the pilot (same judgment call as the
// Twilio webhook's own "no auto-retry sweep for stuck media downloads"):
// a crash mid-run leaves a row stuck at status='processing' with no
// automatic recovery. Rare in practice; would need a manual status reset
// via SQL if it ever happens.
const PHOTO_POLL_INTERVAL_MS = Number(process.env.PHOTO_POLL_INTERVAL_MS ?? 20_000);
// Same ceiling as watch-cards.command's CLAUDE_TIMEOUT_SECONDS — a
// multi-card sheet needs well past what a single-card photo ever did.
const PHOTO_CLAUDE_TIMEOUT_MS = Number(process.env.PHOTO_CLAUDE_TIMEOUT_MS ?? 900_000);
const SMS_PHOTO_WORKDIR = path.join(__dirname, '.processing-sms');

async function findNextPendingPhotoMessage() {
  const { data, error } = await supabase
    .from('inbound_messages')
    .select('*')
    .eq('kind', 'photo')
    .eq('status', 'pending_ocr')
    .not('storage_path', 'is', null)
    .order('received_at')
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

// Optimistic claim: the WHERE clause re-asserts status='pending_ocr', so a
// row already claimed by (hypothetically) another agent process comes back
// null here instead of being double-processed.
async function claimPhotoMessage(id) {
  const { data, error } = await supabase
    .from('inbound_messages')
    .update({ status: 'processing' })
    .eq('id', id)
    .eq('status', 'pending_ocr')
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function convertHeicToJpeg(srcPath) {
  const destPath = srcPath.replace(/\.\w+$/, '.jpg');
  await new Promise((resolve, reject) => {
    const proc = spawn('sips', ['-s', 'format', 'jpeg', srcPath, '--out', destPath]);
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`sips exited ${code}`))));
  });
  await rm(srcPath, { force: true });
  return destPath;
}

async function processPhotoMessage(message) {
  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('folder_code')
    .eq('id', message.event_id)
    .maybeSingle();
  if (eventError) throw eventError;
  if (!event?.folder_code) throw new Error(`event ${message.event_id} has no folder_code`);

  const { data: blob, error: downloadError } = await supabase.storage
    .from('contact-photos')
    .download(message.storage_path);
  if (downloadError || !blob) throw downloadError ?? new Error('Storage download returned no data');

  const bytes = Buffer.from(await blob.arrayBuffer());
  // A real content hash, same as the local watcher's — lets a photo sent
  // both via SMS and dropped locally (or sent twice via SMS) still dedup
  // through contacts-from-ocr's existing sourceImageHash uniqueness check.
  const hash = createHash('sha256').update(bytes).digest('hex');

  const workDir = path.join(SMS_PHOTO_WORKDIR, event.folder_code);
  await mkdir(workDir, { recursive: true });

  let ext = (path.extname(message.storage_path).replace('.', '') || 'jpg').toLowerCase();
  let localPath = path.join(workDir, `${hash}.${ext}`);
  await writeFile(localPath, bytes);

  if (ext === 'heic' || ext === 'heif') {
    localPath = await convertHeicToJpeg(localPath);
  }

  // The original is already durably in Storage at message.storage_path
  // (twilio-webhook uploaded it) — echoed back verbatim, not re-uploaded.
  // Only crop files (written locally by Step 2) need uploading after
  // success, at a key sharing that same directory prefix (see SKILL.md).
  const storagePrefix = path.dirname(message.storage_path);

  const prompt = [
    `Use the process-cards skill on the photo at ${localPath}.`,
    `Event folder code: ${event.folder_code}.`,
    `Content hash: ${hash}.`,
    `Local archive path — write any cropped card images (Step 2) into this same directory, which already exists — is: ${localPath}.`,
    `Supabase Storage object key — include this exact string as sourceImagePath in your POST body — is: ${message.storage_path}.`,
    `Inbound message id — include this exact string as inboundMessageId in your POST body — is: ${message.id}.`,
    `Print only PROCESS_CARDS_OK ${hash} or PROCESS_CARDS_FAIL ${hash} <reason> as your entire final message.`,
  ].join(' ');

  try {
    const { stdout, exitCode, timedOut } = await runClaudeRaw(prompt, REPO_ROOT, PHOTO_CLAUDE_TIMEOUT_MS);
    const lastLine = stdout.trim().split('\n').pop() ?? '';

    if (timedOut) throw new Error(`process-cards timed out after ${PHOTO_CLAUDE_TIMEOUT_MS}ms`);
    if (exitCode !== 0 || !lastLine.startsWith('PROCESS_CARDS_OK')) {
      throw new Error(exitCode !== 0 ? `claude exited ${exitCode}: ${lastLine}` : lastLine || 'process-cards reported failure with no reason');
    }

    // Upload any crops process-cards wrote into workDir, at a Storage key
    // sharing the original's directory prefix — same basename it already
    // reported as croppedImagePath in its own POST(s).
    const files = await readdir(workDir);
    const cropFiles = files.filter((f) => f.startsWith(`${hash}-crop-`));
    for (const cropFile of cropFiles) {
      const cropBytes = await readFile(path.join(workDir, cropFile));
      const { error: uploadError } = await supabase.storage
        .from('contact-photos')
        .upload(`${storagePrefix}/${cropFile}`, cropBytes, { upsert: true });
      if (uploadError) throw uploadError;
    }

    await supabase.from('inbound_messages').update({
      status: 'completed',
      processed_at: new Date().toISOString(),
    }).eq('id', message.id);
    log(`photo OK: ${message.id} (${cropFiles.length} crop(s) uploaded)`);
  } catch (err) {
    const reason = err.message ?? String(err);
    await supabase.from('inbound_messages').update({ status: 'failed', error: reason }).eq('id', message.id);
    log(`photo FAIL: ${message.id} — ${reason}`);
  } finally {
    // Scratch only — the durable copy is Storage, not this directory.
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function photoTick() {
  let message;
  try {
    const candidate = await findNextPendingPhotoMessage();
    if (!candidate) return;
    message = await claimPhotoMessage(candidate.id);
  } catch (err) {
    log(`ERROR finding/claiming pending photo message: ${err.message ?? err}`);
    return;
  }
  if (!message) return; // someone/something else claimed it first

  log(`processing photo message ${message.id}`);
  await processPhotoMessage(message);
}

async function photoLoop() {
  log(`sms-photo loop starting (poll every ${PHOTO_POLL_INTERVAL_MS}ms)`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await photoTick();
    await sleep(PHOTO_POLL_INTERVAL_MS);
  }
}

// ---------------------------------------------------------------------
// Voice-memo transcription poll loop (Stage 14, revised to run locally)
// ---------------------------------------------------------------------
// Ported from supabase/functions/transcribe-voice-memo/index.ts — same
// claim-then-mark-processing idempotency guard (still worth keeping even
// with no OpenAI cost-griefing concern anymore: it's also what makes a
// crash/restart mid-transcription safe rather than double-processing).
// Only the transcription call itself changed, from a Whisper API fetch to
// whisper-runner.mjs's local CLI invocation.
//
// Attribution (which contact a memo is actually about) used to be pure
// phone+timing correlation — attach the whole transcript to whoever's
// photo arrived in the preceding 15 minutes. That's wrong the moment a memo
// mentions more than one person (e.g. a correction about someone captured
// 30+ minutes earlier plus praise for the card just taken): the whole blob
// landed on one contact and the other never got their part. See
// linkTranscriptToContacts below and the attribute-voice-memo skill.
const TRANSCRIPTION_POLL_INTERVAL_MS = Number(process.env.TRANSCRIPTION_POLL_INTERVAL_MS ?? 20_000);
// How long a transcribed memo keeps getting retried against newly-created
// contacts before we give up. Set comfortably above PHOTO_CLAUDE_TIMEOUT_MS
// (15 min) — the photo/OCR pipeline that creates the contact a memo
// correlates against can legitimately take that long for a busy multi-card
// sheet, and transcription (a single Whisper call) routinely finishes
// first. Without a retry, that ordering — correct arrival order, "wrong"
// finish order — permanently orphans the memo: matched_contact_ids stays
// empty forever with no way to reattach it short of manual SQL.
const LINK_RETRY_WINDOW_MINUTES = 20;
const AUDIO_WORKDIR = path.join(__dirname, '.processing-audio');

// Shared write path for every branch below — append-not-overwrite, same as
// before: a rep could leave more than one memo about the same contact
// across an event, so each keeps a running log rather than clobbering the
// last one.
async function attachExcerpts(items) {
  const matchedContactIds = [];
  for (const { contact, excerpt } of items) {
    const merged = contact.interaction_notes ? `${contact.interaction_notes}\n\n${excerpt}` : excerpt;
    const { error } = await supabase.from('contacts').update({ interaction_notes: merged }).eq('id', contact.id);
    if (error) throw error;
    matchedContactIds.push(contact.id);
  }
  return matchedContactIds;
}

// Candidates for a memo are every card_photo contact captured at the same
// event BY THE SAME REP (joined through source_message_id -> inbound_messages
// -> from_phone) — not just the one photo immediately preceding this memo,
// and not every contact at the event regardless of who captured them (a rep
// can only ever be describing someone whose card *they* took, and pooling
// every rep's contacts would both be wrong and make the candidate list grow
// unboundedly over a multi-rep event's life). Forms have no associated
// audio, so source is always 'card_photo' here.
async function findCandidateContacts(eventId, fromPhone) {
  const { data, error } = await supabase
    .from('contacts')
    .select('id, first_name, last_name, email, phone, title, interaction_notes, created_at, source_msg:inbound_messages!contacts_source_message_id_fkey!inner(from_phone)')
    .eq('event_id', eventId)
    .eq('source', 'card_photo')
    .eq('source_msg.from_phone', fromPhone)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// Used both by the first attempt (right after transcribing) and every retry
// pass below (retryOrphanedTranscripts) — re-running this against a
// possibly-grown candidate list is exactly the right retry behavior.
async function linkTranscriptToContacts(message, transcript) {
  if (!message.event_id) return []; // no event bound — nothing to scope to (should be unreachable in practice)

  const candidates = await findCandidateContacts(message.event_id, message.from_phone);
  if (candidates.length === 0) return []; // nothing to attach to yet; retry sweep will catch it later

  if (candidates.length === 1) {
    // No ambiguity possible — skip the LLM call and attach the full
    // transcript directly, same as the old behavior, at zero extra cost.
    return attachExcerpts([{ contact: candidates[0], excerpt: transcript }]);
  }

  const skillInput = {
    transcript,
    candidates: candidates.map((c) => ({
      contactId: c.id,
      firstName: c.first_name,
      lastName: c.last_name,
      email: c.email,
      phone: c.phone,
      title: c.title,
    })),
  };
  const { results } = await runSkill('attribute-voice-memo', skillInput, REPO_ROOT);
  const attributed = (results ?? []).filter((r) => typeof r.excerpt === 'string' && r.excerpt.length > 0);

  if (attributed.length === 0) {
    // Memo names no one explicitly (e.g. "great conversation, really
    // knowledgeable" with no name spoken) — fall back to the single
    // most-recently-captured candidate, preserving the old good-case
    // default instead of regressing to "attach to nobody."
    return attachExcerpts([{ contact: candidates[0], excerpt: transcript }]);
  }

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const toAttach = attributed
    .map((r) => ({ contact: byId.get(r.contactId), excerpt: r.excerpt }))
    .filter((x) => x.contact); // defensive: ignore an id the skill echoed that wasn't in the candidate list
  return attachExcerpts(toAttach);
}

// Sweeps completed memos whose first-attempt link (in processAudioMessage,
// right after transcribing) came up empty, and retries the same
// correlation now that more time has passed — the photo/contact side of
// the race may well have finished since. Runs every transcription poll
// tick; a memo that never finds a contact within LINK_RETRY_WINDOW_MINUTES
// ages out of the query and is left alone (a memo with genuinely nothing
// to attach to is an expected, valid outcome, not a bug).
async function retryOrphanedTranscripts() {
  const windowStart = new Date(Date.now() - LINK_RETRY_WINDOW_MINUTES * 60_000).toISOString();
  const { data, error } = await supabase
    .from('inbound_messages')
    .select('id, event_id, from_phone, received_at, transcript, matched_contact_ids, attempts')
    .eq('kind', 'audio')
    .eq('status', 'completed')
    .not('transcript', 'is', null)
    .gte('received_at', windowStart);
  if (error) {
    log(`ERROR finding orphaned transcripts: ${error.message ?? error}`);
    return;
  }

  const orphaned = (data ?? []).filter((m) => !m.matched_contact_ids || m.matched_contact_ids.length === 0);
  for (const message of orphaned) {
    try {
      const matchedContactIds = await linkTranscriptToContacts(message, message.transcript);
      await supabase
        .from('inbound_messages')
        .update({ matched_contact_ids: matchedContactIds, attempts: (message.attempts ?? 0) + 1 })
        .eq('id', message.id);
      if (matchedContactIds.length > 0) {
        log(`retry-link OK: ${message.id} (${matchedContactIds.length} contact(s) updated)`);
      }
    } catch (err) {
      log(`retry-link ERROR: ${message.id} — ${err.message ?? err}`);
    }
  }
}

async function findNextPendingAudioMessage() {
  const { data, error } = await supabase
    .from('inbound_messages')
    .select('*')
    .eq('kind', 'audio')
    .eq('status', 'pending_transcription')
    .not('storage_path', 'is', null)
    .order('received_at')
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

// Same optimistic claim pattern as claimPhotoMessage — the WHERE clause
// re-asserts status='pending_transcription', so a row already claimed
// comes back null here instead of being double-processed.
async function claimAudioMessage(id) {
  const { data, error } = await supabase
    .from('inbound_messages')
    .update({ status: 'processing' })
    .eq('id', id)
    .eq('status', 'pending_transcription')
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Builds a Whisper --initial_prompt from the same event/rep-scoped
// candidate roster linkTranscriptToContacts uses below, to bias
// transcription toward the actual names it needs to get right (see
// whisper-runner.mjs's header comment — this is what turned "our church
// melody"/"Judge Miller" into "Chad Schmeller" in testing). No candidates
// yet (e.g. the memo arrived before any card photo) just means no prompt.
async function buildNamePrompt(message) {
  if (!message.event_id) return undefined;
  const candidates = await findCandidateContacts(message.event_id, message.from_phone);
  if (candidates.length === 0) return undefined;
  const names = candidates.map((c) => [c.first_name, c.last_name].filter(Boolean).join(' ')).filter(Boolean);
  if (names.length === 0) return undefined;
  return `Contacts at this event: ${names.join(', ')}.`;
}

async function processAudioMessage(message) {
  const { data: blob, error: downloadError } = await supabase.storage
    .from('voice-memos')
    .download(message.storage_path);
  if (downloadError || !blob) throw downloadError ?? new Error('Storage download returned no data');

  await mkdir(AUDIO_WORKDIR, { recursive: true });
  const ext = (path.extname(message.storage_path).replace('.', '') || 'm4a').toLowerCase();
  const localPath = path.join(AUDIO_WORKDIR, `${message.id}.${ext}`);
  const bytes = Buffer.from(await blob.arrayBuffer());
  await writeFile(localPath, bytes);

  try {
    const prompt = await buildNamePrompt(message);
    const transcript = await transcribeAudio(localPath, { prompt });
    const matchedContactIds = await linkTranscriptToContacts(message, transcript);

    // An empty matchedContactIds array is a valid, non-error outcome — a
    // memo with nothing to attach to (yet — see retryOrphanedTranscripts
    // below) still transcribed successfully.
    await supabase.from('inbound_messages').update({
      transcript,
      status: 'completed',
      processed_at: new Date().toISOString(),
      matched_contact_ids: matchedContactIds,
    }).eq('id', message.id);
    log(`transcription OK: ${message.id} (${matchedContactIds.length} contact(s) updated)`);
  } catch (err) {
    const reason = err.message ?? String(err);
    await supabase.from('inbound_messages').update({ status: 'failed', error: reason }).eq('id', message.id);
    log(`transcription FAIL: ${message.id} — ${reason}`);
  } finally {
    await rm(localPath, { force: true }).catch(() => {});
  }
}

async function transcriptionTick() {
  let message;
  try {
    const candidate = await findNextPendingAudioMessage();
    if (candidate) {
      message = await claimAudioMessage(candidate.id);
    }
  } catch (err) {
    log(`ERROR finding/claiming pending audio message: ${err.message ?? err}`);
  }

  if (message) {
    log(`processing audio message ${message.id}`);
    await processAudioMessage(message);
  }

  // Runs every tick regardless of whether a new memo was just processed —
  // this is what catches memos whose contact didn't exist yet the first
  // time around (see retryOrphanedTranscripts's own comment).
  await retryOrphanedTranscripts();
}

async function transcriptionLoop() {
  log(`transcription loop starting (poll every ${TRANSCRIPTION_POLL_INTERVAL_MS}ms)`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await transcriptionTick();
    await sleep(TRANSCRIPTION_POLL_INTERVAL_MS);
  }
}

// ---------------------------------------------------------------------

log('=== local-agent starting ===');

// Three independent, concurrently-running loops in one process — a slow
// process-cards run (up to 15 min) must not delay the 20s matching poll,
// and transcription runs independently of both.
await Promise.all([matchingLoop(), photoLoop(), transcriptionLoop()]);

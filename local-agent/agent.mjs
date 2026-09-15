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
import { runSkill, runClaudeRaw, extractJson } from './skill-runner.mjs';
import { transcribeAudio } from './whisper-runner.mjs';
import {
  AttributionOutput,
  CardExtractionOutput,
  IntentOutput,
  MatchOutput,
  NoteExtractionOutput,
  ResearchOutput,
} from './schemas.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// Working directory for every `claude -p` call. Deliberately NOT the repo
// root (audit A2): that directory holds .env with the Zoho client secret and
// refresh token, and a permission-skipped session reading OCR'd card text has
// no business being able to open it. This directory contains nothing but a
// .claude/skills symlink, which is all the CLI needs to resolve skills.
//
// One-time setup (also in start-agent.command):
//   mkdir -p ~/.conference-lead-gen-agent/.claude
//   ln -sfn <repo>/.claude/skills ~/.conference-lead-gen-agent/.claude/skills
const AGENT_WORKDIR = process.env.AGENT_WORKDIR
  ?? path.join(process.env.HOME ?? REPO_ROOT, '.conference-lead-gen-agent');

// Held by THIS process only. Never forwarded to a skill subprocess -- see
// skill-runner.mjs's skillEnv().
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

  // Both skills' full output contracts -- enum values, Zoho id formats, the
  // null-together rules, and the "high confidence requires a matched account"
  // invariant -- are enforced in schemas.mjs before either result is seen
  // here. A violation throws inside runSkill, which retries and then leaves
  // the row pending for a human; it is never persisted. This replaces the two
  // hand-rolled checks that used to live here (matchStatus!=='pending' and a
  // Zoho-id regex), generalised from the two fields that broke once to the
  // whole contract. See audit A6.
  const researchOutput = await runSkill('research-contact', researchInput, AGENT_WORKDIR, {
    schema: ResearchOutput,
  });
  const matchOutput = await runSkill('match-contact', researchOutput, AGENT_WORKDIR, {
    schema: MatchOutput,
  });

  // Auto-approve rule from MatchingBackgroundService.cs, now evaluated
  // atomically inside finalize_contact_match against the row's *current*
  // review_status/local_duplicate_of_contact_id at write time — not the
  // stale snapshot `contact` holds from claim time — so a reviewer's manual
  // action landing mid-flight (research-contact/match-contact can each take
  // minutes) is never clobbered by this update.
  const extractionOk = contact.extraction_confidence == null || contact.extraction_confidence === 'high';
  const { error } = await supabase.rpc('finalize_contact_match', {
    p_contact_id: contact.id,
    p_match_status: matchOutput.matchStatus,
    p_match_confidence: matchOutput.matchConfidence ?? null,
    p_matched_zoho_contact_id: matchOutput.matchedZohoContactId ?? null,
    p_matched_zoho_contact_name: matchOutput.matchedZohoContactName ?? null,
    p_matched_zoho_contact_email: matchOutput.matchedZohoContactEmail ?? null,
    p_matched_zoho_contact_phone: matchOutput.matchedZohoContactPhone ?? null,
    p_matched_zoho_contact_title: matchOutput.matchedZohoContactTitle ?? null,
    p_matched_zoho_account_id: matchOutput.matchedZohoAccountId ?? null,
    p_matched_zoho_account_name: matchOutput.matchedZohoAccountName ?? null,
    p_matched_zoho_account_level: matchOutput.matchedZohoAccountLevel ?? null,
    p_has_active_opportunity: matchOutput.hasActiveOpportunity ?? null,
    p_active_opportunity_name: matchOutput.activeOpportunityName ?? null,
    p_candidate_matches: matchOutput.candidateMatches ?? null,
    p_notes: matchOutput.notes ?? null,
    p_glance_summary: matchOutput.glanceSummary ?? null,
    p_research_confidence: researchOutput.researchConfidence ?? null,
    p_person_verified: researchOutput.personVerified ?? null,
    p_extraction_ok: extractionOk,
  });
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
// A crash mid-run leaves a row stuck at status='processing' — claimed_at
// (set by claimPhotoMessage/claimAudioMessage) plus reconcileStaleInbound
// Messages (called once at startup, near the bottom of this file) resets
// any such row back to its pending_* state so the next poll picks it back
// up, the same way watch-cards.command's resume_staged reconciles the
// folder-watcher's own .processing/ directory on restart.
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
// null here instead of being double-processed. claimed_at lets a startup
// sweep (reconcileStaleInboundMessages, below) tell a genuinely stuck row
// (crash mid-run) apart from one still legitimately being worked on.
async function claimPhotoMessage(id) {
  const { data, error } = await supabase
    .from('inbound_messages')
    .update({ status: 'processing', claimed_at: new Date().toISOString() })
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

// The authenticated write for OCR'd cards. This used to be the model's job:
// process-cards was handed $SUPABASE_SERVICE_ROLE_KEY as a shell env var and
// told to curl with it, which put an RLS-bypassing credential inside a
// permission-skipped session whose context is an attacker-supplied photo
// (audit A2). The skill now returns JSON and this does the writing.
//
// Posted one card at a time rather than as a batch so a single unusable entry
// costs only itself -- same reasoning as the skill's old "don't stop the loop
// on one card's failure" rule.
async function postExtractedCards({ cards, folderCode, hash, sourceImagePath, storagePrefix, inboundMessageId }) {
  const failures = [];
  let created = 0;

  for (const card of cards) {
    const label = [card.firstName, card.lastName].filter(Boolean).join(' ') || `card ${card.index}`;
    // SourceImageHash is uniquely constrained and every card from one photo
    // shares a sourceImagePath, so each card needs its own suffix. Derived
    // from the same deterministic reading-order index the crop filename uses,
    // which is what makes retrying a partially-failed photo safe: already-
    // succeeded cards re-derive the same hash and land on the existing-hash
    // no-op path instead of duplicating.
    const sourceImageHash = cards.length > 1
      ? `${hash}-${String(card.index).padStart(2, '0')}`
      : hash;

    const body = {
      eventFolderCode: folderCode,
      firstName: card.firstName,
      lastName: card.lastName,
      email: card.email,
      phone: card.phone,
      title: card.title,
      districtName: card.districtName,
      schoolName: card.schoolName,
      extractionConfidence: card.extractionConfidence,
      sourceImageHash,
      sourceImagePath,
      ...(card.cropFileName ? { croppedImagePath: `${storagePrefix}/${card.cropFileName}` } : {}),
      ...(inboundMessageId ? { inboundMessageId } : {}),
    };

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/contacts-from-ocr`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        let detail = text;
        try { detail = JSON.parse(text).error ?? text; } catch { /* non-JSON body */ }
        throw new Error(`HTTP ${res.status}: ${detail}`.trim());
      }
      created++;
    } catch (err) {
      failures.push(`${label}: ${err.message ?? err}`);
    }
  }

  return { created, failures };
}

async function processPhotoMessage(message) {
  // The whole body lives inside this one try/catch — an early failure (the
  // events select, Storage download, mkdir/writeFile, HEIC conversion) used
  // to throw uncaught, crashing the whole local-agent process via
  // photoTick's missing try/catch and taking matchingLoop/transcriptionLoop
  // down with it. Now every failure path, early or late, marks the row
  // 'failed' and returns normally instead.
  let workDir;
  try {
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

    workDir = path.join(SMS_PHOTO_WORKDIR, event.folder_code);
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

    // The skill is told the paths it needs and nothing else. It no longer
    // POSTs anything and is never given a credential (audit A2) -- it reads
    // the photo, writes crops, and prints JSON. The authenticated write is
    // done below, by this process, which OCR'd card text can never reach.
    const prompt = [
      `Use the process-cards skill on the photo at ${localPath}.`,
      `Content hash: ${hash}.`,
      `Write any cropped card images (Step 2) into this same directory, which already exists: ${workDir}.`,
      `Print only the final JSON.`,
    ].join(' ');

    const { stdout, exitCode, timedOut } = await runClaudeRaw(
      prompt, AGENT_WORKDIR, PHOTO_CLAUDE_TIMEOUT_MS, 'process-cards',
    );

    if (timedOut) throw new Error(`process-cards timed out after ${PHOTO_CLAUDE_TIMEOUT_MS}ms`);
    if (exitCode !== 0) throw new Error(`claude exited ${exitCode}: ${stdout.trim().slice(-400)}`);

    const parsed = CardExtractionOutput.safeParse(extractJson(stdout));
    if (!parsed.success) {
      throw new Error(
        `process-cards output failed schema validation: ` +
        parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
      );
    }
    const extraction = parsed.data;

    if (extraction.status === 'no_card_detected') {
      throw new Error('no legible business card detected in photo');
    }

    // Upload any crops the skill wrote, at a Storage key sharing the
    // original's directory prefix. Done BEFORE creating the contacts so a
    // row's croppedImagePath never points at an object that isn't there yet.
    const files = await readdir(workDir);
    const cropFiles = files.filter((f) => f.startsWith(`${hash}-crop-`));
    for (const cropFile of cropFiles) {
      const cropBytes = await readFile(path.join(workDir, cropFile));
      const { error: uploadError } = await supabase.storage
        .from('contact-photos')
        .upload(`${storagePrefix}/${cropFile}`, cropBytes, { upsert: true });
      if (uploadError) throw uploadError;
    }

    const { created, failures } = await postExtractedCards({
      cards: extraction.cards,
      folderCode: event.folder_code,
      hash,
      sourceImagePath: message.storage_path,
      storagePrefix,
      inboundMessageId: message.id,
    });
    if (failures.length > 0 && created === 0) {
      throw new Error(`every card failed: ${failures.join('; ')}`);
    }

    await supabase.from('inbound_messages').update({
      status: 'completed',
      processed_at: new Date().toISOString(),
      error: failures.length > 0 ? failures.join('; ') : null,
    }).eq('id', message.id);
    log(
      `photo OK: ${message.id} (${created} contact(s), ${cropFiles.length} crop(s) uploaded` +
      `${failures.length ? `, ${failures.length} failed` : ''})`,
    );
  } catch (err) {
    const reason = err.message ?? String(err);
    await supabase.from('inbound_messages').update({ status: 'failed', error: reason }).eq('id', message.id);
    log(`photo FAIL: ${message.id} — ${reason}`);
  } finally {
    // Scratch only — the durable copy is Storage, not this directory.
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
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
// THIS LOOP IS THE LIVE VOICE-MEMO FEATURE. The Edge Function that shares
// its name (supabase/functions/transcribe-voice-memo/) has been retired
// since 2026-09-03 and is kept only as reference — see the banner at the
// top of that file before assuming either one is dead.
//
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
// How close a sole candidate's photo must be to this memo's arrival for the
// single-candidate fast path below to trust it's about that person with no
// name-matching check at all. Without this, a rep's only card-photo contact
// at an event would catch *every* later voice memo verbatim, including ones
// recorded hours afterward about something unrelated.
const SINGLE_CANDIDATE_WINDOW_MINUTES = 20;
const AUDIO_WORKDIR = path.join(__dirname, '.processing-audio');

// Shared write path for every branch below — append-not-overwrite, same as
// before: a rep could leave more than one memo about the same contact
// across an event, so each keeps a running log rather than clobbering the
// last one.
//
// Each contact's update is independent: one contact's failure is logged and
// skipped rather than thrown, so it can never discard work already done for
// the others in the same batch (previously, the first failure threw and
// abandoned the whole call — losing track of any already-successful
// updates, since the caller only learns about matchedContactIds on a
// normal return). Also idempotent — an excerpt already present in a
// contact's notes is treated as already-attached rather than appended
// again, so re-running the same correlation (a retry, or a second call
// during multi-candidate attribution) can't duplicate the same text.
async function attachExcerpts(items) {
  const matchedContactIds = [];
  for (const { contact, excerpt } of items) {
    try {
      if (contact.interaction_notes?.includes(excerpt)) {
        matchedContactIds.push(contact.id);
        continue;
      }
      const merged = contact.interaction_notes ? `${contact.interaction_notes}\n\n${excerpt}` : excerpt;
      const { error } = await supabase.from('contacts').update({ interaction_notes: merged }).eq('id', contact.id);
      if (error) throw error;
      matchedContactIds.push(contact.id);
    } catch (err) {
      log(`attachExcerpts FAIL for contact ${contact.id}: ${err.message ?? err}`);
    }
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
    const minutesSincePhoto = (new Date(message.received_at).getTime() - new Date(candidates[0].created_at).getTime()) / 60_000;
    if (minutesSincePhoto >= 0 && minutesSincePhoto <= SINGLE_CANDIDATE_WINDOW_MINUTES) {
      // No ambiguity possible and recent enough to trust without a name
      // check — skip the LLM call and attach the full transcript directly,
      // same as the old behavior, at zero extra cost.
      return attachExcerpts([{ contact: candidates[0], excerpt: transcript }]);
    }
    // Only candidate, but well outside the window (a rep's one card-photo
    // contact all event, memo recorded hours later about something else) —
    // fall through to attribute-voice-memo below so the transcript actually
    // has to name this person before it gets attached to them.
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
  const { results } = await runSkill('attribute-voice-memo', skillInput, AGENT_WORKDIR, {
    schema: AttributionOutput,
  });
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
    .update({ status: 'processing', claimed_at: new Date().toISOString() })
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
  // Three explicit stages, each marking failure precisely where it happens,
  // instead of one try/catch/finally around everything:
  //   1. download+stage the file — a failure here means we never even got a
  //      transcript, so 'failed' is correct and final for this attempt.
  //   2. transcribe — same: no transcript exists yet, 'failed' is correct.
  //   3. once a transcript exists, persist it and mark 'completed'
  //      immediately, *before* attribution — attribution (attachExcerpts,
  //      which can partially fail per-contact) must never be able to lose a
  //      transcript that already succeeded, or flip a real success back to
  //      'failed'. A failure here just logs; matched_contact_ids stays
  //      however far attribution got (possibly empty), which is exactly
  //      what makes retryOrphanedTranscripts's own query pick the row back
  //      up on a later tick.
  let localPath;
  try {
    const { data: blob, error: downloadError } = await supabase.storage
      .from('voice-memos')
      .download(message.storage_path);
    if (downloadError || !blob) throw downloadError ?? new Error('Storage download returned no data');

    await mkdir(AUDIO_WORKDIR, { recursive: true });
    const ext = (path.extname(message.storage_path).replace('.', '') || 'm4a').toLowerCase();
    localPath = path.join(AUDIO_WORKDIR, `${message.id}.${ext}`);
    const bytes = Buffer.from(await blob.arrayBuffer());
    await writeFile(localPath, bytes);
  } catch (err) {
    const reason = err.message ?? String(err);
    await supabase.from('inbound_messages').update({ status: 'failed', error: reason }).eq('id', message.id);
    log(`transcription FAIL: ${message.id} — ${reason}`);
    return;
  }

  let transcript;
  try {
    const prompt = await buildNamePrompt(message);
    transcript = await transcribeAudio(localPath, { prompt });
  } catch (err) {
    const reason = err.message ?? String(err);
    await supabase.from('inbound_messages').update({ status: 'failed', error: reason }).eq('id', message.id);
    log(`transcription FAIL: ${message.id} — ${reason}`);
    await rm(localPath, { force: true }).catch(() => {});
    return;
  }

  await supabase.from('inbound_messages').update({
    transcript,
    status: 'completed',
    processed_at: new Date().toISOString(),
  }).eq('id', message.id);

  try {
    const matchedContactIds = await linkTranscriptToContacts(message, transcript);
    await supabase.from('inbound_messages').update({ matched_contact_ids: matchedContactIds }).eq('id', message.id);
    log(`transcription OK: ${message.id} (${matchedContactIds.length} contact(s) updated)`);
  } catch (err) {
    log(`attribution FAIL: ${message.id} — ${err.message ?? err}`);
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
// Contact-intent classification poll loop
// ---------------------------------------------------------------------
// Runs the classify-contact-intent skill against interaction_notes (rep-
// typed text and voice-memo transcripts alike) whenever that text differs
// from contact_intent_classified_notes — the snapshot last fed to the
// classifier, standing in for an updated_at column contacts doesn't have —
// and only while contact_intent_is_manual is false. A reviewer's own pick on
// the review card always wins and is never revisited here; see
// 20260910140000_add_contact_intent.sql.
const INTENT_POLL_INTERVAL_MS = Number(process.env.INTENT_POLL_INTERVAL_MS ?? 20_000);

async function findContactsNeedingIntentClassification() {
  const { data, error } = await supabase
    .from('contacts')
    .select('id, interaction_notes, contact_intent_classified_notes')
    .eq('contact_intent_is_manual', false)
    .not('interaction_notes', 'is', null)
    .neq('interaction_notes', '')
    .limit(200);
  if (error) throw error;
  // contact_intent_classified_notes != interaction_notes isn't a filter
  // PostgREST can express against another column on the same row — compare
  // client-side instead. Pilot-scale row counts make this cheap.
  return (data ?? []).filter((c) => c.interaction_notes !== c.contact_intent_classified_notes);
}

async function classifyContactIntent(contact) {
  // The hot/warm/cold enum (and null) is enforced by IntentOutput in
  // schemas.mjs; an invalid value throws inside runSkill rather than here.
  const result = await runSkill(
    'classify-contact-intent',
    { contactId: contact.id, interactionNotes: contact.interaction_notes },
    AGENT_WORKDIR,
    { schema: IntentOutput },
  );
  const intent = result.contactIntent ?? null;

  // Optimistic write: the WHERE clause re-asserts both contact_intent_is_manual=false
  // and the exact interaction_notes text this result was classified from — a
  // reviewer's manual pick, or a newer note landing mid-classification,
  // lands a no-op update here instead of clobbering something fresher. The
  // next tick re-reads current state and (for a newer note) reclassifies it.
  const { error } = await supabase
    .from('contacts')
    .update({ contact_intent: intent, contact_intent_classified_notes: contact.interaction_notes })
    .eq('id', contact.id)
    .eq('contact_intent_is_manual', false)
    .eq('interaction_notes', contact.interaction_notes);
  if (error) throw error;
}

async function intentTick() {
  let candidates;
  try {
    candidates = await findContactsNeedingIntentClassification();
  } catch (err) {
    log(`ERROR finding contacts needing intent classification: ${err.message ?? err}`);
    return;
  }

  for (const contact of candidates) {
    try {
      await classifyContactIntent(contact);
      log(`intent classified: ${contact.id}`);
    } catch (err) {
      log(`intent classification FAIL: ${contact.id} — ${err.message ?? err}`);
    }
  }
}

async function intentLoop() {
  log(`intent loop starting (poll every ${INTENT_POLL_INTERVAL_MS}ms)`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await intentTick();
    await sleep(INTENT_POLL_INTERVAL_MS);
  }
}

// ---------------------------------------------------------------------
// Pasted-note extraction poll loop (Stage 17)
// ---------------------------------------------------------------------
// A rep pastes a whole typed note — usually covering several people — into
// NotesPage.vue; notes-submit records it and this loop turns it into one
// contact per person via extract-note-contacts, then posts each to
// contacts-from-note. From there it's the ordinary pipeline: matchingLoop
// researches and matches each new row, and intentLoop classifies whichever
// of them arrived with interaction notes.
//
// Same claim-then-mark-processing mechanics as photoLoop, against
// note_submissions rather than inbound_messages (a web paste has no
// MessageSid, no phone numbers, and no media — see
// 20260914140000_pasted_note_intake.sql for why it isn't folded into
// inbound_messages).
//
// Note that the skill here only *returns* JSON — unlike process-cards, it
// never posts anything itself and is never handed the service-role key.
// That's what makes runSkill's plain retry safe (an extraction has no side
// effects to redo), and it keeps a note containing instruction-like text
// from having a credential within reach even in the worst case.
const NOTE_POLL_INTERVAL_MS = Number(process.env.NOTE_POLL_INTERVAL_MS ?? 10_000);
// Well above runSkill's 180s default: a long note covering a dozen people is
// a single big extraction, and timing it out halfway costs the whole note.
const NOTE_SKILL_TIMEOUT_MS = Number(process.env.NOTE_SKILL_TIMEOUT_MS ?? 300_000);


async function findNextPendingNoteSubmission() {
  const { data, error } = await supabase
    .from('note_submissions')
    .select('*')
    .eq('status', 'pending_extraction')
    .order('created_at')
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

async function claimNoteSubmission(submission) {
  const { data, error } = await supabase
    .from('note_submissions')
    .update({
      status: 'processing',
      claimed_at: new Date().toISOString(),
      attempts: (submission.attempts ?? 0) + 1,
    })
    .eq('id', submission.id)
    .eq('status', 'pending_extraction')
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Posted one at a time rather than in a batch so a single unusable entry
// (a name the skill mangled past what the endpoint will accept) costs only
// itself — same reasoning as process-cards' "don't stop the loop on one
// card's failure".
async function postExtractedContact(submissionId, contact) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/contacts-from-note`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      noteSubmissionId: submissionId,
      firstName: contact.firstName ?? '',
      lastName: contact.lastName ?? '',
      email: contact.email ?? '',
      phone: contact.phone ?? '',
      title: contact.title ?? '',
      districtName: contact.districtName ?? '',
      schoolName: contact.schoolName ?? '',
      interactionNotes: contact.interactionNotes ?? '',
      extractionConfidence: contact.extractionConfidence,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let detail = text;
    try {
      detail = JSON.parse(text).error ?? text;
    } catch { /* non-JSON error body — use it as-is */ }
    throw new Error(`HTTP ${res.status}: ${detail}`.trim());
  }
  return res.json();
}

async function processNoteSubmission(submission) {
  try {
    // Shape, field lengths, the confidence enum, and the per-note contact cap
    // are all enforced by NoteExtractionOutput in schemas.mjs before anything
    // is posted. A violation -- including a note the model split into more
    // than MAX_CONTACTS_PER_NOTE people -- throws inside runSkill, marks the
    // submission failed with that message, and creates nothing; notes-status
    // surfaces it to the rep on the paste page. See audit A6/N4.
    const result = await runSkill(
      'extract-note-contacts',
      { noteText: submission.body },
      AGENT_WORKDIR,
      { timeoutMs: NOTE_SKILL_TIMEOUT_MS, schema: NoteExtractionOutput },
    );

    const skipped = result.skipped;

    const failures = [];
    let created = 0;
    for (const [i, contact] of result.contacts.entries()) {
      const label = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || `entry ${i + 1}`;
      try {
        await postExtractedContact(submission.id, contact);
        created++;
      } catch (err) {
        failures.push(`${label}: ${err.message ?? err}`);
      }
    }

    // Partial success stays 'completed', with the failures recorded: the
    // contacts that did land are already real and visible in Review, and
    // calling the whole submission failed would misdescribe that. Only a
    // note where nothing at all could be created is a failure — and a note
    // that legitimately contained nobody (contacts: []) is a valid result,
    // not an error, so it isn't one either.
    const allFailed = failures.length > 0 && created === 0;
    await supabase
      .from('note_submissions')
      .update({
        status: allFailed ? 'failed' : 'completed',
        skipped,
        error: failures.length > 0 ? failures.join('; ') : null,
        processed_at: new Date().toISOString(),
      })
      .eq('id', submission.id);

    log(`note ${allFailed ? 'FAIL' : 'OK'}: ${submission.id} — ${created} contact(s) created` +
      `${skipped.length ? `, ${skipped.length} skipped` : ''}${failures.length ? `, ${failures.length} failed` : ''}`);
  } catch (err) {
    const reason = err.message ?? String(err);
    await supabase
      .from('note_submissions')
      .update({ status: 'failed', error: reason, processed_at: new Date().toISOString() })
      .eq('id', submission.id);
    log(`note FAIL: ${submission.id} — ${reason}`);
  }
}

async function noteTick() {
  let submission;
  try {
    const candidate = await findNextPendingNoteSubmission();
    if (!candidate) return;
    submission = await claimNoteSubmission(candidate);
  } catch (err) {
    log(`ERROR finding/claiming pending note submission: ${err.message ?? err}`);
    return;
  }
  if (!submission) return; // someone/something else claimed it first

  log(`processing note submission ${submission.id}`);
  await processNoteSubmission(submission);
}

async function noteLoop() {
  log(`note loop starting (poll every ${NOTE_POLL_INTERVAL_MS}ms)`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await noteTick();
    await sleep(NOTE_POLL_INTERVAL_MS);
  }
}

// ---------------------------------------------------------------------

// Resets any inbound_messages row a previous run left stuck at
// status='processing' (crashed/killed mid-photo-or-transcription) back to
// its pending_* state, so this run's loops pick it back up normally instead
// of it sitting stuck until a manual SQL fix. A restart is exactly when a
// prior crash's stuck rows need finding, so this runs once at startup —
// mirrors watch-cards.command's own resume_staged reconciliation of its
// .processing/ directory. Threshold comfortably exceeds
// PHOTO_CLAUDE_TIMEOUT_MS's 15-minute ceiling so a still-legitimately-
// running job from a *different*, still-alive process is never reconciled
// out from under itself.
const STALE_PROCESSING_MINUTES = Number(process.env.STALE_PROCESSING_MINUTES ?? 30);

async function reconcileStaleInboundMessages() {
  const { data, error } = await supabase.rpc('reconcile_stale_inbound_messages', {
    stale_minutes: STALE_PROCESSING_MINUTES,
  });
  if (error) {
    log(`ERROR reconciling stale inbound_messages: ${error.message ?? error}`);
    return;
  }
  if (data && data.length > 0) {
    log(`reconciled ${data.length} stale inbound_messages row(s) back to pending`);
  }
}

// Same reasoning as reconcileStaleInboundMessages above, for the
// note_submissions rows noteLoop claims the same optimistic way.
async function reconcileStaleNoteSubmissions() {
  const { data, error } = await supabase.rpc('reconcile_stale_note_submissions', {
    stale_minutes: STALE_PROCESSING_MINUTES,
  });
  if (error) {
    log(`ERROR reconciling stale note_submissions: ${error.message ?? error}`);
    return;
  }
  if (data && data.length > 0) {
    log(`reconciled ${data.length} stale note_submissions row(s) back to pending`);
  }
}

log('=== local-agent starting ===');

await reconcileStaleInboundMessages();
await reconcileStaleNoteSubmissions();

// Five independent, concurrently-running loops in one process — a slow
// process-cards run (up to 15 min) or note extraction (up to 5) must not
// delay the 20s matching poll, and transcription/intent classification each
// run independently of the others.
await Promise.all([matchingLoop(), photoLoop(), transcriptionLoop(), intentLoop(), noteLoop()]);

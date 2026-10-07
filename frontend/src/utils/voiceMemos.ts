// The words and rules for voice memos nobody has matched to a contact yet (the amber
// "Voice memos" section at the top of Contacts). Plain data and functions, like
// unassignedScans.ts, so the wording is testable without opening a component.
//
// Every sentence here is a promise about the pipeline behind it (CLAUDE.md, "a UI
// promise has to be true"): memoWords.test.mjs checks the ones that can be checked
// against the Edge Functions' source.
import type { FailedIntakeMessage, LinkCandidateContact, UnresolvedAudioMemo } from '@/types/review';

// How many automatic attempts the agent makes before a memo becomes "Needs review"
// (LINK_MAX_ATTEMPTS in local-agent/agent.mjs and the 20 the n8n sweep passes to
// claim_unlinked_audio_messages). Shown only in the pane's help line.
export const AUTO_ATTEMPTS = 20;
// inbound-messages-create-contacts' MAX_ATTEMPTS. After this many the button is gone
// and the card says to assign or delete, instead of offering a run that is refused.
export const MAX_CREATE_ATTEMPTS = 3;

export type MemoState = 'review' | 'matching' | 'creating';

// creating beats the link status: while a person's Create contacts is running the
// automatic sweep is paused for that memo (claim_unlinked_audio_messages skips it).
export function memoState(m: Pick<UnresolvedAudioMemo, 'linkStatus' | 'create'>): MemoState {
  if (m.create?.status === 'working') return 'creating';
  return m.linkStatus === 'no_candidate_found' ? 'review' : 'matching';
}

export const STATE_LABEL: Record<MemoState, string> = {
  review: 'Needs review',
  matching: 'Still matching',
  creating: 'Reading memo…',
};

// Nothing can be done to a memo while its contacts are being created: Assign would
// attach a transcript the extraction is about to turn into people, and Delete is
// refused by the server for the same reason.
export function isBusy(m: Pick<UnresolvedAudioMemo, 'create'>): boolean {
  return m.create?.status === 'working';
}

// Retry matching is for a memo that gave up. One still matching is already being
// retried, so a button would suggest the rep has to do something they don't.
export function canRetry(m: Pick<UnresolvedAudioMemo, 'linkStatus' | 'create'>): boolean {
  return m.linkStatus === 'no_candidate_found' && !isBusy(m);
}

export function canCreate(m: Pick<UnresolvedAudioMemo, 'create'>): boolean {
  return !isBusy(m) && (m.create?.attempts ?? 0) < MAX_CREATE_ATTEMPTS;
}

// One line under the buttons when the last Create contacts did not produce anyone.
// null when there is nothing to say (never tried, or running).
export function createNote(m: Pick<UnresolvedAudioMemo, 'create'>): string | null {
  const c = m.create;
  if (!c || c.status === 'working') return null;
  const spent = c.attempts >= MAX_CREATE_ATTEMPTS;
  if (c.status === 'none') {
    return spent
      ? "We couldn't find anyone named in this memo. Assign it to a contact or delete it."
      : "We couldn't find anyone named in this memo. You can assign it to a contact, try again, or delete it.";
  }
  return spent
    ? "Reading this memo didn't work. Assign it to a contact or delete it."
    : "Reading this memo didn't work. Try again, or assign it to a contact.";
}

// The section holds two kinds of thing: voice memos nobody could match to a contact
// (unmatched) and photos or memos that failed to process (failed).
export const SECTION_TITLE = 'Unlinked Voice Memos / Errors';

export function sectionCount(n: number): string {
  return n === 1 ? '1 item' : `${n} items`;
}

export function sectionHelp(unmatched: number, failed: number): string {
  if (!failed) return `We couldn't tell who ${unmatched === 1 ? 'this is' : 'these are'} about.`;
  if (!unmatched) return failed === 1 ? "This couldn't be read." : "These couldn't be read.";
  return "Memos we couldn't match to a contact, and photos or memos we couldn't read.";
}

// ── Failed photos and memos ──────────────────────────────────────────────────────
type FailedFields = Pick<FailedIntakeMessage, 'kind' | 'errorClass' | 'error'>;

export const failedKind = (m: Pick<FailedIntakeMessage, 'kind'>): string => (m.kind === 'photo' ? 'Card photo' : 'Voice memo');

// 'transient' = the agent is retrying it on its own (reconcile_retryable_failed_inbound_messages);
// anything else is waiting for a person.
export const failedState = (m: Pick<FailedIntakeMessage, 'errorClass'>): string => (m.errorClass === 'transient' ? 'Retrying automatically' : 'Needs manual retry');

// Retry only where the system has given up, the same rule as a memo's Retry matching.
export const canRetryFailed = (m: Pick<FailedIntakeMessage, 'errorClass'>): boolean => m.errorClass !== 'transient';

export const failedText = (m: FailedFields): string => `${failedKind(m)}: ${m.error?.trim() || "couldn't be processed"}`;

export function failedDelete(m: Pick<FailedIntakeMessage, 'kind'>): { title: string; message: string; toast: string } {
  return m.kind === 'photo'
    ? { title: 'Delete this photo?', message: "This permanently deletes the photo. This can't be undone.", toast: 'Photo deleted' }
    : { title: 'Delete voice memo?', message: "This permanently deletes the memo and its recording. This can't be undone.", toast: DELETED_TOAST };
}

export const failedRetryToast = (m: Pick<FailedIntakeMessage, 'kind'>): string => (
  m.kind === 'photo' ? 'Trying again. If the card reads, the contact shows up in your list.' : 'Trying again. If it transcribes, it joins the memos here or becomes a contact.'
);

// "2:14 PM" for today, "Oct 6, 2:14 PM" for any other day. `now` is a parameter so the
// wording is testable.
export function memoTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return time;
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`;
}

export function candidateName(c: Pick<LinkCandidateContact, 'firstName' | 'lastName'>): string {
  return `${c.firstName} ${c.lastName}`.trim() || '(no name)';
}

export function assignedToast(name: string): string {
  return `Added to ${name}'s notes`;
}

export const CREATE_STARTED_TOAST = 'Reading the memo. The people show up in your list in about a minute.';
export const CREATED_TOAST = 'Contacts added from your memo. Find them in your list.';
export const RETRY_TOAST = 'Matching again. If it finds the person, this memo leaves the list.';
export const DELETED_TOAST = 'Voice memo deleted';
export const ASSIGN_HINT = 'The whole transcript is added to their notes and goes to Zoho with the import.';

// 0:48 style clock for the player.
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Searches a candidate list the way the contact pickers do: every word typed must
// appear in the name, title or email, in any order, case-insensitive.
export function filterCandidates<T extends LinkCandidateContact>(list: T[], query: string): T[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((c) => {
    const hay = `${c.firstName} ${c.lastName} ${c.title ?? ''} ${c.email ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

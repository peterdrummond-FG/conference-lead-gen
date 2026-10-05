// The words for the "scans need a conference" queue in Review. Plain data and
// functions, like onboardingTour.ts, so the wording is testable and reviewable
// without opening a component. Written for Solutions Success reading a list, not
// a developer: no "409", no "slug", and each line says who or what the scan was
// tied to and why it couldn't be filed.
import type { UnassignedReason, UnassignedSubmission } from '@/types/review';

const first = (name: string | null) => (name ?? '').trim().split(/\s+/)[0] ?? '';

// One line per row. `eventHintName` is shown as given: the component passes it
// through cleanConferenceName first (utils here don't import each other, so the
// node tests can run without a build). Only claims what the row knows: a rep is named only when the
// server resolved one, and the ended conference only when its QR named it.
export function reasonText(s: Pick<UnassignedSubmission, 'reason' | 'repName' | 'eventHintName'>): string {
  const rep = s.repName?.trim() || null;
  switch (s.reason) {
    case 'rep_no_conference':
      return rep ? `${rep}'s QR. ${first(rep)} isn't at a conference.` : "A rep's QR. They aren't at a conference.";
    case 'rep_not_found':
      return "A rep's QR for an account that no longer exists.";
    case 'event_ended':
      return s.eventHintName
        ? `Printed QR for ${s.eventHintName}. That conference has ended.`
        : 'Printed QR for a conference that has ended.';
    case 'event_unknown':
      return "Printed QR for a conference we don't recognize.";
    case 'no_qr':
      return 'No QR details.';
    case 'caller_no_conference':
      return rep ? `Entered on ${rep}'s Kiosk tab while not at a conference.` : 'Entered on the Kiosk tab while not at a conference.';
  }
}

export const REASONS: UnassignedReason[] = [
  'rep_no_conference', 'rep_not_found', 'event_ended', 'event_unknown', 'no_qr', 'caller_no_conference',
];

export function bannerText(n: number): string {
  return n === 1 ? '1 scan needs a conference' : `${n} scans need a conference`;
}

// "Waiting 2h". Coarse on purpose; the row also carries nothing more precise
// because the age is the only thing that changes how urgent it is.
export function waitingText(iso: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `Waiting ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Waiting ${hours}h`;
  return `Waiting ${Math.round(hours / 24)}d`;
}

// Every string the queue can show, for the same banned-words check the tour has.
export function allQueueCopy(): string[] {
  const sample = { repName: 'Jamie Cole', eventHintName: 'TASSP Summer' };
  return [
    ...REASONS.map((reason) => reasonText({ reason, ...sample })),
    ...REASONS.map((reason) => reasonText({ reason, repName: null, eventHintName: null })),
    bannerText(1),
    bannerText(3),
  ];
}

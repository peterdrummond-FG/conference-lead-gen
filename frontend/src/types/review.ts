export interface CandidateMatch {
  type: 'account' | 'contact';
  zohoId: string;
  name: string;
  score: number;
  level?: 'district' | 'school' | null;
}

export interface ContactListItem {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  source: string;
  qrChannel: 'booth' | 'session' | null;
  // Which door a public form came in by; null on form leads from before it was
  // recorded. See utils/contactsList.ts "Signup source".
  intakePath: 'rep_qr' | 'event_qr' | 'kiosk' | null;
  // For source 'note': 'sms' (texted in) or 'import' (pasted on Import).
  noteOrigin: 'sms' | 'import' | null;
  // Present when research filled the district in from the school (nothing was given).
  districtLookup: { name: string; evidenceUrl: string; confidence: string; mappedToOurList: boolean } | null;
  repId: string | null;
  repName: string | null;
  eventId: string;
  eventName: string;
  state: string | null;
  schoolDistrictId: string | null;
  districtName: string | null;
  schoolDistrictNameRaw: string | null;
  schoolId: string | null;
  schoolName: string | null;
  schoolNameRaw: string | null;
  extractionConfidence: string | null;
  researchConfidence: string | null;
  personVerified: boolean | null;
  matchStatus: string;
  matchConfidence: string | null;
  matchedZohoContactId: string | null;
  matchedZohoContactName: string | null;
  matchedZohoContactEmail: string | null;
  matchedZohoContactPhone: string | null;
  matchedZohoContactTitle: string | null;
  matchedZohoAccountId: string | null;
  matchedZohoAccountName: string | null;
  matchedZohoAccountLevel: 'district' | 'school' | null;
  hasActiveOpportunity: boolean | null;
  activeOpportunityName: string | null;
  candidateMatches: CandidateMatch[] | null;
  localDuplicateOfContactId: string | null;
  localDuplicateOfContactName: string | null;
  localDuplicateOfContactContext: string | null;
  reviewStatus: string;
  notes: string | null;
  glanceSummary: string | null;
  interactionNotes: string | null;
  followedUp: boolean;
  hasPhoto: boolean;
  hasCroppedPhoto: boolean;
  matchAttempts: number;
  lastMatchAttemptAt: string | null;
  syncedAt: string | null;
  createdAt: string;
}

export interface UpdateContactPayload {
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  state?: string | null;
  schoolDistrictId?: string | null;
  schoolDistrictNameRaw?: string | null;
  schoolId?: string | null;
  schoolNameRaw?: string | null;
  matchedZohoAccountId?: string;
  matchedZohoAccountName?: string;
  matchedZohoAccountLevel?: 'district' | 'school' | null;
  matchedZohoContactId?: string | null;
  matchedZohoContactName?: string | null;
  matchedZohoContactEmail?: string | null;
  matchedZohoContactPhone?: string | null;
  matchedZohoContactTitle?: string | null;
  matchStatus?: string;
  matchConfidence?: string | null;
  reviewStatus?: string;
  interactionNotes?: string | null;
  followedUp?: boolean;
}

// What a person's "Create contacts" on a memo is doing (inbound-messages-unresolved-list).
// working = the transcript is queued or being read; none = it ran and found nobody
// (the memo stays listed, so nothing is hidden behind a "done" that made no one);
// failed = the run itself broke. attempts counts every try, capped server-side.
export interface MemoCreateState {
  status: 'working' | 'none' | 'failed';
  error: string | null;
  attempts: number;
}

// A voice memo nobody has matched to a contact (inbound-messages-unresolved-list). Only
// memos that already have a transcript are listed. linkStatus 'unlinked' = still being
// retried automatically ("Still matching"); 'no_candidate_found' = it gave up ("Needs
// review"), the only state with a Retry matching button.
export interface UnresolvedAudioMemo {
  id: string;
  transcript: string | null;
  receivedAt: string;
  fromPhone: string;
  repName: string | null;
  eventId: string | null;
  eventName: string | null;
  linkStatus: 'unlinked' | 'no_candidate_found';
  linkAttempts: number;
  // False once the 90-day purge has removed the recording: the card shows no player.
  hasAudio: boolean;
  create: MemoCreateState | null;
}

// Assignment target for the "Assign to contact" action on an unmatched
// voice memo — see inbound-messages-link-candidates.
export interface LinkCandidateContact {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  title: string | null;
}

export interface FailedIntakeMessage {
  id: string;
  kind: 'photo' | 'audio';
  receivedAt: string;
  fromPhone: string;
  repName: string | null;
  // False once the 90-day purge has removed the photo / recording: no View photo, no player.
  hasMedia: boolean;
  eventId: string | null;
  eventName: string | null;
  error: string | null;
  errorClass: 'transient' | 'terminal' | null;
  processingAttempts: number;
}

// A public submission contacts-create couldn't place under a conference, held for
// Solutions Success (unassigned-list). `reason` says why; see utils/unassignedScans.ts
// for the words shown for each.
export type UnassignedReason =
  | 'rep_no_conference'
  | 'rep_not_found'
  | 'event_ended'
  | 'event_unknown'
  | 'no_qr'
  | 'caller_no_conference';

export interface UnassignedSubmission {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  state: string | null;
  districtName: string | null;
  schoolName: string | null;
  reason: UnassignedReason;
  repId: string | null;
  repName: string | null;
  eventHintId: string | null;
  eventHintName: string | null;
  createdAt: string;
}

export type Role = 'admin' | 'solutionsSuccess' | 'sales';

export interface Profile {
  id: string;
  name: string;
  role: Role;
  phoneNumber: string | null;
  currentEventId: string | null;
  // Only ever set for role === 'sales' — the identifier in their reusable
  // /connect/<repSlug> QR (see generateConnectSlide.ts).
  repSlug: string | null;
  email: string | null;
}

export interface MergeDuplicatesPayload {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  state: string | null;
  schoolDistrictId: string | null;
  schoolDistrictNameRaw: string | null;
  schoolId: string | null;
  schoolNameRaw: string | null;
  discardContactIds: string[];
}

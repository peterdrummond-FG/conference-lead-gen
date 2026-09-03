export interface CandidateMatch {
  type: 'account' | 'contact';
  zohoId: string;
  name: string;
  score: number;
}

export interface ContactListItem {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  source: string;
  eventId: string;
  eventName: string;
  eventState: string;
  schoolDistrictId: string;
  districtName: string;
  schoolId: string | null;
  schoolName: string | null;
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
  hasActiveOpportunity: boolean | null;
  activeOpportunityName: string | null;
  candidateMatches: CandidateMatch[] | null;
  localDuplicateOfContactId: string | null;
  localDuplicateOfContactName: string | null;
  reviewStatus: string;
  notes: string | null;
  interactionNotes: string | null;
  hasPhoto: boolean;
  hasCroppedPhoto: boolean;
  matchAttempts: number;
  lastMatchAttemptAt: string | null;
  createdAt: string;
}

export interface UpdateContactPayload {
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  schoolDistrictId?: string;
  schoolId?: string | null;
  matchedZohoAccountId?: string;
  matchedZohoAccountName?: string;
  matchedZohoContactId?: string | null;
  matchedZohoContactName?: string | null;
  matchedZohoContactEmail?: string | null;
  matchedZohoContactPhone?: string | null;
  matchedZohoContactTitle?: string | null;
  matchStatus?: string;
  matchConfidence?: string | null;
  reviewStatus?: string;
  interactionNotes?: string | null;
}

export interface MergeDuplicatesPayload {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  schoolDistrictId: string;
  schoolId: string | null;
  discardContactIds: string[];
}

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
  contactIntent: 'hot' | 'warm' | 'cold' | null;
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
  contactIntent?: 'hot' | 'warm' | 'cold' | null;
}

export interface Rep {
  id: string;
  name: string;
  phoneNumber: string;
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

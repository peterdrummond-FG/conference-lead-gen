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
  eventName: string;
  districtName: string;
  schoolName: string | null;
  extractionConfidence: string | null;
  matchStatus: string;
  matchConfidence: string | null;
  matchedZohoContactId: string | null;
  matchedZohoContactName: string | null;
  matchedZohoAccountId: string | null;
  matchedZohoAccountName: string | null;
  candidateMatches: CandidateMatch[] | null;
  localDuplicateOfContactId: string | null;
  localDuplicateOfContactName: string | null;
  reviewStatus: string;
  notes: string | null;
  createdAt: string;
}

export interface UpdateContactPayload {
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  matchedZohoAccountId?: string;
  matchedZohoAccountName?: string;
  matchedZohoContactId?: string;
  matchedZohoContactName?: string;
  matchStatus?: string;
  matchConfidence?: string;
  reviewStatus?: string;
}

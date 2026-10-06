import type { ContactListItem } from '@/types/review';

// What the Resolve-duplicate sheet shows so a rep can tell WHICH record is
// right. A duplicate is only ever "same first and last name" (see
// insert_contact_with_duplicate_check), so the name can't settle it — two real
// people can share one, and three records of one person can each be wrong in a
// different field. These rules turn what the row already carries (how it was
// captured, OCR confidence, research, Zoho match) into something readable.
// Nothing here is new data; it is all on ContactListItem already.

export type FieldKey = 'firstName' | 'lastName' | 'email' | 'phone' | 'title' | 'org';
export type Tone = 'good' | 'warn' | 'neutral';
export interface EvidenceTag { label: string; tone: Tone }

export function sourceInfo(source: string): { label: string; icon: string } {
  switch (source) {
    case 'form':
      return { label: 'Typed by attendee', icon: 'keyboard' };
    case 'qr_code':
      return { label: 'Scanned QR code', icon: 'qr_code_2' };
    case 'card_photo':
      return { label: 'Card scan', icon: 'badge' };
    case 'directory_photo':
      return { label: 'List photo scan', icon: 'menu_book' };
    case 'note':
      return { label: 'Rep note', icon: 'sticky_note_2' };
    default:
      return { label: source, icon: 'person' };
  }
}

const isPhoto = (c: ContactListItem) => c.source === 'card_photo' || c.source === 'directory_photo';

export function orgText(c: ContactListItem): string {
  const district = c.districtName || c.schoolDistrictNameRaw;
  const school = c.schoolName || c.schoolNameRaw;
  return [school, district].filter(Boolean).join(', ');
}

function fieldValue(c: ContactListItem, f: FieldKey): string {
  if (f === 'org') return orgText(c);
  return (c[f] ?? '').trim();
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

// A field "differs" when the records give two or more DIFFERENT non-empty
// values for it. A record that simply lacks the value isn't in conflict — that
// is missing data, which the card says plainly ("Not on this record") rather
// than painting it as a disagreement.
export function differingFields(group: ContactListItem[]): Set<FieldKey> {
  const out = new Set<FieldKey>();
  for (const f of ['firstName', 'lastName', 'email', 'phone', 'title', 'org'] as FieldKey[]) {
    const distinct = new Set(group.map((c) => norm(fieldValue(c, f))).filter(Boolean));
    if (distinct.size > 1) out.add(f);
  }
  return out;
}

// Other records' values for one field, minus what's already in the merged
// record, de-duplicated ignoring case. (The old dialog offered "Taylor" twice.)
export function alternativeValues(group: ContactListItem[], f: FieldKey, current: string): string[] {
  const seen = new Set<string>([norm(current)]);
  const out: string[] = [];
  for (const c of group) {
    const v = fieldValue(c, f);
    if (!v || seen.has(norm(v))) continue;
    seen.add(norm(v));
    out.push(v);
  }
  return out;
}

export function evidenceTags(c: ContactListItem): EvidenceTag[] {
  const tags: EvidenceTag[] = [];
  if (c.matchStatus === 'existing_contact') tags.push({ label: 'Contact in Zoho', tone: 'good' });
  else if (c.matchStatus === 'new_contact_existing_account') tags.push({ label: 'School or district in Zoho', tone: 'neutral' });
  if (c.personVerified === true) tags.push({ label: 'Verified online', tone: 'good' });
  else if (c.personVerified === false) tags.push({ label: 'Not verified online', tone: 'warn' });
  if (isPhoto(c)) {
    if (c.extractionConfidence === 'low') tags.push({ label: 'Hard to read', tone: 'warn' });
    else if (c.extractionConfidence === 'high') tags.push({ label: 'Read clearly', tone: 'good' });
  }
  return tags;
}

// A hint, never a decision — the rep still picks. Points are for things that
// make a record more likely to be the right one: someone already in Zoho, a
// person research could confirm, an attendee who typed their own details (an
// OCR read can misspell a name, like Caleb for Calen), and how much is filled
// in. A tie suggests nothing: saying "can't tell" beats a coin flip the rep
// would trust.
export function suggestedId(group: ContactListItem[]): string | null {
  if (group.length < 2) return null;
  const score = (c: ContactListItem) => {
    let s = 0;
    if (c.matchStatus === 'existing_contact') s += 3;
    if (c.personVerified === true) s += 2;
    if (c.personVerified === false) s -= 1;
    if (c.source === 'form' || c.source === 'qr_code') s += 1;
    if (isPhoto(c) && c.extractionConfidence === 'low') s -= 1;
    for (const f of ['email', 'phone', 'title', 'org'] as FieldKey[]) if (fieldValue(c, f)) s += 1;
    return s;
  };
  const ranked = group.map((c) => ({ id: c.id, s: score(c) })).sort((a, b) => b.s - a.s);
  const [top, next] = ranked;
  return top && next && top.s > next.s ? top.id : null;
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

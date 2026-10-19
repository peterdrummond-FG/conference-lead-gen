// Reading a CSV/Excel file into contacts for the Import page ("Upload a file").
//
// Pure functions, no DOM: the page reads the file, this turns its rows into the
// contacts notes-import-file expects, and fileImport.test.mjs holds the behaviour.
//
// Matching is deliberately plain code, not a model call: a header is matched by its
// wording ("Work Email", "Mobile", "Surname") and, where that fails or the file has no
// header row, by what the cells look like (an email, a phone number, a state). The
// project rule is that every model call runs inside an n8n skill workflow holding only
// the model credential; a browser-side model call would break that for no gain here.
//
// The server (supabase/functions/_shared/fileImport.ts) re-validates every value, so
// nothing here is trusted: this only decides where each cell goes.

export type ImportField =
  | 'firstName' | 'lastName' | 'fullName' | 'email' | 'phone' | 'title' | 'state' | 'district' | 'school';

export interface ImportRow {
  row: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  title: string;
  state: string;
  districtName: string;
  schoolName: string;
  interactionNotes: string;
}

export interface ImportTable {
  headers: string[];
  rows: string[][];
  // The spreadsheet's own row number for each entry in `rows`, so "Row 14: no name"
  // still points at the right line after blank rows were dropped.
  rowNumbers: number[];
  // False when the first row was data (no header row), so headers are "Column 1"...
  hasHeader: boolean;
}

export interface ColumnMatch {
  // column index -> the field it fills. A column missing here goes to notes.
  fields: Map<number, ImportField>;
  // True when no column could be identified as a name: the page asks which one.
  needsName: boolean;
}

export const MAX_IMPORT_ROWS = 500;
// One note line is cut here so a pasted essay in a Comments cell can't bury the rest.
export const NOTE_VALUE_LIMIT = 500;

// ---------------------------------------------------------------- reading text

// RFC 4180 parsing (quoted cells, "" escapes, newlines inside quotes), with the
// delimiter sniffed from the first line because spreadsheet exports from Europe
// and some CRMs use ; or tab.
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const delimiter = [',', ';', '\t'].reduce((best, d) => (count(d) > count(best) ? d : best), ',');

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell); cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// Excel cells arrive as strings, numbers, booleans or Dates. A phone typed as a number
// must not become "1.5551234567e10", and a date must read as a date.
export function cellToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  if (typeof v === 'number') return Number.isInteger(v) ? v.toFixed(0) : String(v);
  return String(v).trim();
}

// ---------------------------------------------------------------- shape

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// 7-15 digits with the usual separators, optionally an extension. Not "2024-05-01".
function looksLikePhone(s: string): boolean {
  if (!/^[+()\d][\d\s().+-]*(?:\s*(?:x|ext\.?)\s*\d+)?$/i.test(s)) return false;
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) return false;
  const digits = s.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// ---------------------------------------------------------------- headers

// Exact (normalised) header wording first, then "contains" rules, checked in this order
// because "School District" must be a district, not a school.
const EXACT: Record<string, ImportField> = {
  'first name': 'firstName', 'firstname': 'firstName', 'first': 'firstName', 'fname': 'firstName',
  'given name': 'firstName', 'forename': 'firstName', 'first nm': 'firstName',
  'last name': 'lastName', 'lastname': 'lastName', 'last': 'lastName', 'lname': 'lastName',
  'surname': 'lastName', 'family name': 'lastName', 'last nm': 'lastName',
  'name': 'fullName', 'full name': 'fullName', 'fullname': 'fullName', 'contact': 'fullName',
  'contact name': 'fullName', 'attendee': 'fullName', 'attendee name': 'fullName',
  'participant': 'fullName', 'participant name': 'fullName',
  'email': 'email', 'e mail': 'email', 'email address': 'email', 'work email': 'email',
  'phone': 'phone', 'phone number': 'phone', 'mobile': 'phone', 'cell': 'phone',
  'telephone': 'phone', 'tel': 'phone', 'mobile phone': 'phone', 'cell phone': 'phone',
  'work phone': 'phone',
  'title': 'title', 'job title': 'title', 'position': 'title', 'role': 'title',
  'state': 'state', 'st': 'state', 'state province': 'state', 'province': 'state',
  'district': 'district', 'school district': 'district', 'district name': 'district',
  'organization': 'district', 'organisation': 'district', 'org': 'district',
  'company': 'district', 'account': 'district', 'account name': 'district',
  'school': 'school', 'school name': 'school', 'building': 'school', 'campus': 'school',
};

const CONTAINS: Array<[RegExp, ImportField]> = [
  [/\be mail\b|\bemail\b/, 'email'],
  [/\bphone\b|\bmobile\b|\bcell\b|\btelephone\b/, 'phone'],
  [/\bdistrict\b/, 'district'],
  [/\bschool\b|\bcampus\b/, 'school'],
  [/\bfirst\b|\bgiven\b/, 'firstName'],
  [/\blast\b|\bsurname\b|\bfamily\b/, 'lastName'],
  [/\bjob\b|\btitle\b|\bposition\b/, 'title'],
  [/\bstate\b/, 'state'],
];

export function fieldForHeader(header: string): ImportField | null {
  const h = norm(header);
  if (!h) return null;
  if (EXACT[h]) return EXACT[h];
  for (const [re, field] of CONTAINS) if (re.test(h)) return field;
  return null;
}

// ---------------------------------------------------------------- content

export interface StateOption { code: string; name: string }

// A column's cells, ignoring blanks, judged against a test: true when most pass.
function mostly(cells: string[], test: (s: string) => boolean): boolean {
  const filled = cells.filter(Boolean);
  if (filled.length < 1) return false;
  return filled.filter(test).length / filled.length >= 0.6;
}

function looksLikePersonName(s: string): boolean {
  const words = s.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  return words.every((w) => /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ.'’-]*$/.test(w));
}

function looksLikeState(s: string, states: StateOption[]): boolean {
  const t = s.trim().toLowerCase();
  return states.some((st) => st.code.toLowerCase() === t || st.name.toLowerCase() === t);
}

// A file with no header row has data where the headers would be: the tell is an
// email or phone number in the first row.
export function buildTable(raw: string[][]): ImportTable | null {
  const kept = raw
    .map((r, i) => ({ cells: r.map((c) => c.trim()), n: i + 1 }))
    .filter((r) => r.cells.some((c) => c !== ''));
  if (kept.length === 0) return null;
  const width = Math.max(...kept.map((r) => r.cells.length));
  const pad = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? '');
  const first = pad(kept[0]?.cells ?? []);
  const firstIsData = first.some((c) => EMAIL_RE.test(c) || looksLikePhone(c));
  const dataRows = firstIsData ? kept : kept.slice(1);
  return {
    headers: firstIsData ? first.map((_, i) => `Column ${i + 1}`) : first,
    rows: dataRows.map((r) => pad(r.cells)),
    rowNumbers: dataRows.map((r) => r.n),
    hasHeader: !firstIsData,
  };
}

export function matchColumns(table: ImportTable, states: StateOption[]): ColumnMatch {
  const fields = new Map<number, ImportField>();
  const taken = new Set<ImportField>();
  const claim = (i: number, f: ImportField) => {
    // One column per field: a second "Email" column (a personal address) goes to notes.
    if (taken.has(f) || fields.has(i)) return;
    fields.set(i, f);
    taken.add(f);
  };

  // 1. Header wording.
  if (table.hasHeader) {
    table.headers.forEach((h, i) => {
      const f = fieldForHeader(h);
      if (f) claim(i, f);
    });
  }

  // 2. What the cells look like, for anything still unplaced.
  const col = (i: number) => table.rows.map((r) => r[i] ?? '');
  for (let i = 0; i < table.headers.length; i++) {
    if (fields.has(i)) continue;
    const cells = col(i);
    if (!taken.has('email') && mostly(cells, (s) => EMAIL_RE.test(s))) claim(i, 'email');
    else if (!taken.has('phone') && mostly(cells, looksLikePhone)) claim(i, 'phone');
    else if (!taken.has('state') && mostly(cells, (s) => looksLikeState(s, states))) claim(i, 'state');
  }

  // 3. A name from the cells, only when the headers gave none.
  const hasName = taken.has('firstName') || taken.has('lastName') || taken.has('fullName');
  if (!hasName) {
    for (let i = 0; i < table.headers.length; i++) {
      if (!fields.has(i) && mostly(col(i), looksLikePersonName)) { claim(i, 'fullName'); break; }
    }
  }

  const named = taken.has('firstName') || taken.has('lastName') || taken.has('fullName');
  return { fields, needsName: !named };
}

// The page's one question: which column holds the names.
export function withNameColumn(match: ColumnMatch, index: number): ColumnMatch {
  const fields = new Map(match.fields);
  fields.set(index, 'fullName');
  return { fields, needsName: false };
}

// ---------------------------------------------------------------- rows

export function normalizeState(raw: string, states: StateOption[]): string {
  const t = raw.trim().toLowerCase();
  if (!t) return '';
  const hit = states.find((s) => s.code.toLowerCase() === t || s.name.toLowerCase() === t);
  return hit ? hit.name : raw.trim();
}

export function splitName(full: string): { firstName: string; lastName: string } {
  const s = full.replace(/\s+/g, ' ').trim();
  if (!s) return { firstName: '', lastName: '' };
  // "Smith, Jane" is how most directories print it.
  const comma = s.indexOf(',');
  if (comma > 0) {
    const last = s.slice(0, comma).trim();
    const first = s.slice(comma + 1).trim();
    if (first) return { firstName: first, lastName: last };
  }
  const space = s.indexOf(' ');
  return space < 0
    ? { firstName: s, lastName: '' }
    : { firstName: s.slice(0, space), lastName: s.slice(space + 1).trim() };
}

export function buildRows(table: ImportTable, match: ColumnMatch, states: StateOption[]): ImportRow[] {
  const out: ImportRow[] = [];
  table.rows.forEach((cells, r) => {
    const get = (f: ImportField) => {
      for (const [i, field] of match.fields) if (field === f) return cells[i] ?? '';
      return '';
    };
    let firstName = get('firstName');
    let lastName = get('lastName');
    if (!firstName && !lastName) {
      ({ firstName, lastName } = splitName(get('fullName')));
    } else if (!firstName) {
      // Only a surname: still a person, and the server needs a first name to file one.
      firstName = lastName;
      lastName = '';
    }

    // Every column that is not one of our fields is kept with the contact as a note.
    const lines: string[] = [];
    table.headers.forEach((h, i) => {
      if (match.fields.has(i)) return;
      const v = (cells[i] ?? '').replace(/\s+/g, ' ').trim();
      if (!v) return;
      lines.push(`${h.trim() || `Column ${i + 1}`}: ${v.length > NOTE_VALUE_LIMIT ? `${v.slice(0, NOTE_VALUE_LIMIT)}…` : v}`);
    });

    out.push({
      row: table.rowNumbers[r] ?? r + 1,
      firstName,
      lastName,
      email: get('email'),
      phone: get('phone'),
      title: get('title'),
      state: normalizeState(get('state'), states),
      districtName: get('district'),
      schoolName: get('school'),
      interactionNotes: lines.join('\n'),
    });
  });
  return out;
}

// What the page says it matched, in the person's own column names.
export function describeMatch(table: ImportTable, match: ColumnMatch): { matched: string[]; notes: string[] } {
  const label: Record<ImportField, string> = {
    firstName: 'first name', lastName: 'last name', fullName: 'name', email: 'email', phone: 'phone',
    title: 'title', state: 'state', district: 'district', school: 'school',
  };
  const matched: string[] = [];
  const notes: string[] = [];
  table.headers.forEach((h, i) => {
    const f = match.fields.get(i);
    if (f) matched.push(`${h} → ${label[f]}`);
    else if (table.rows.some((r) => (r[i] ?? '').trim())) notes.push(h);
  });
  return { matched, notes };
}

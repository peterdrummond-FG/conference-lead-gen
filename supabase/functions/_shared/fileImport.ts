// Validation for rows uploaded from a CSV/Excel file (used by notes-import-file).
//
// The browser reads the file and matches its columns, but the browser is not trusted:
// anyone signed in can POST to the function directly, and every value ends up in the
// Zoho CSV export and in LLM prompts (research-contact reads the contact's own fields).
// So every field is re-capped here with the same limits the other intake paths use, and
// a value that does not fit its field is moved into the notes rather than dropped,
// because losing a rep's data silently is worse than a thin lead to review.
import { LIMITS } from "./validate.ts";
import { VALID_US_STATES } from "./usStates.ts";

// Each row costs a district lookup, an insert, and then a research + match run in n8n, so
// the file size is the amplification bound. Past this is a mis-pick (a whole attendee
// export), not a day's leads.
export const MAX_IMPORT_ROWS = 500;
// How many "Not added" lines a rep is shown. The rest are counted, not listed.
export const MAX_SKIPPED_LINES = 50;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface CleanImportRow {
  row: number;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  state: string | null;
  districtName: string | null;
  schoolName: string | null;
  interactionNotes: string | null;
}

export interface ImportValidation {
  rows: CleanImportRow[];
  skipped: string[];
}

// Control characters other than newline/tab have no place in a spreadsheet cell.
// Built from char codes so the source file holds no raw control bytes (deno-lint's
// no-control-regex only flags escape syntax; see validate.ts for the same trick).
const CONTROL = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(8)}${String.fromCharCode(11)}${String.fromCharCode(12)}${String.fromCharCode(14)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`, "g");

function oneLine(v: unknown): string {
  return typeof v === "string" ? v.replace(CONTROL, "").replace(/\s+/g, " ").trim() : "";
}

function multiLine(v: unknown): string {
  return typeof v === "string" ? v.replace(CONTROL, "").replace(/\r\n?/g, "\n").trim() : "";
}

export function validateImportRows(raw: unknown): ImportValidation | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: "That file has no rows to import." };
  if (raw.length > MAX_IMPORT_ROWS) {
    return { error: `That file has ${raw.length.toLocaleString()} rows — the limit is ${MAX_IMPORT_ROWS}. Split it into smaller files.` };
  }

  const rows: CleanImportRow[] = [];
  const skipped: string[] = [];
  let skippedCount = 0;
  const skip = (line: string) => {
    skippedCount++;
    if (skipped.length < MAX_SKIPPED_LINES) skipped.push(line);
  };

  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    const n = Number.isInteger(r?.row) && r.row > 0 && r.row < 1_000_000 ? r.row : i + 1;
    if (typeof r !== "object" || r === null) {
      skip(`Row ${n}: not readable.`);
      continue;
    }
    // What does not fit goes here and is appended to the notes below.
    const overflow: string[] = [];
    const keep = (label: string, value: string, max: number): string | null => {
      if (!value) return null;
      if (value.length <= max) return value;
      overflow.push(`${label}: ${value}`);
      return null;
    };

    const firstName = oneLine(r.firstName);
    if (!firstName) {
      skip(`Row ${n}: no name.`);
      continue;
    }
    if (firstName.length > LIMITS.name) {
      skip(`Row ${n}: the name is too long to be a name.`);
      continue;
    }
    const lastNameRaw = oneLine(r.lastName);
    const lastName = lastNameRaw.length <= LIMITS.name ? lastNameRaw : "";
    if (lastNameRaw && !lastName) overflow.push(`Last name: ${lastNameRaw}`);

    const emailRaw = oneLine(r.email);
    let email: string | null = null;
    if (emailRaw) {
      if (emailRaw.length <= LIMITS.email && EMAIL_RE.test(emailRaw)) email = emailRaw.toLowerCase();
      else overflow.push(`Email: ${emailRaw}`);
    }

    const stateRaw = oneLine(r.state);
    let state: string | null = null;
    if (stateRaw) {
      if (VALID_US_STATES.has(stateRaw)) state = stateRaw;
      else overflow.push(`State: ${stateRaw}`);
    }

    let notes = multiLine(r.interactionNotes);
    const phone = keep("Phone", oneLine(r.phone), LIMITS.phone);
    const title = keep("Title", oneLine(r.title), LIMITS.title);
    const districtName = keep("District", oneLine(r.districtName), LIMITS.institution);
    const schoolName = keep("School", oneLine(r.schoolName), LIMITS.institution);
    if (overflow.length) notes = [notes, ...overflow].filter(Boolean).join("\n");
    if (notes.length > LIMITS.notes) notes = notes.slice(0, LIMITS.notes);

    rows.push({
      row: n,
      firstName,
      lastName,
      email,
      phone,
      title,
      state,
      districtName,
      schoolName,
      interactionNotes: notes || null,
    });
  }

  if (skippedCount > skipped.length) skipped.push(`…and ${skippedCount - skipped.length} more rows with no name.`);
  return { rows, skipped };
}

// How the Contacts page loads a long list, and the words it says while it does.
//
// What was wrong: contacts-list answered one unpaged query and the database returns at
// most 1000 rows per request, so a status (for a rep, a conference scope) with more than
// 1000 contacts silently lost the rest. Now each list is requested 100 at a time
// (contacts-list ?page=&pageSize=). The first page of each list shows at once; the rest
// load behind it, and the actions that would act on a partial list wait.
//
// Pure functions only (tested in contactsPaging.test.mjs); the requests are in
// composables/useContacts.ts.

// Contacts per request. The server accepts up to 100 and uses 100 by default.
export const CONTACTS_PAGE_SIZE = 100;

// The same ceiling contacts-list enforces for an unpaged request. A list this long is
// not something to scroll or confirm in bulk; the page stops and asks for a narrower one.
export const MAX_CONTACTS_PER_LIST = 5000;

// How many pages a list of `total` rows takes.
export function pageCount(total: number): number {
  return total <= 0 ? 0 : Math.ceil(total / CONTACTS_PAGE_SIZE);
}

// The page numbers still to fetch after page 1 (2..last). Empty when page 1 had it all.
export function remainingPages(total: number): number[] {
  const last = pageCount(total);
  const pages: number[] = [];
  for (let p = 2; p <= last; p++) pages.push(p);
  return pages;
}

export function isTooMany(total: number): boolean {
  return total > MAX_CONTACTS_PER_LIST;
}

// Adds `incoming` rows whose id has not been seen yet. A contact created while the pages
// load pushes later rows down by one, so a row can turn up on two pages; and a row the
// person already moved (confirmed, rejected) must not be put back by a page fetched
// before the change. `seen` is shared across every list, and is updated.
export function appendUnseen<T extends { id: string }>(seen: Set<string>, rows: T[], incoming: T[]): T[] {
  const out = rows.slice();
  for (const row of incoming) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

export function loadingLine(loaded: number, total: number): string {
  return `Loading all contacts: ${loaded} of ${total}`;
}

export const TOO_MANY_LINE =
  `There are more than ${MAX_CONTACTS_PER_LIST.toLocaleString('en-US')} contacts here, too many to show at once. Use Filter to narrow the list.`;

export const CONFIRM_ALL_WAITING = 'Confirm all: waiting for the rest to load';
export const CONFIRM_ALL_TOO_MANY = 'Confirm all: narrow the list first';
export const CONFIRM_ALL_FAILED = 'Confirm all: reload to load everything';

// The part of the Confirm all result toast that says why some leads were skipped, in the
// words a rep uses. Reasons are the strings contacts-bulk-approve returns.
export function skippedSummary(skipped: { id: string; reason: string }[]): string {
  const matching = skipped.filter((s) => s.reason === 'still pending').length;
  const changed = skipped.filter((s) => s.reason === 'no longer waiting for confirmation').length;
  const other = skipped.length - matching - changed;
  const parts: string[] = [];
  if (matching) parts.push(`${matching} still matching`);
  if (changed) parts.push(`${changed} already confirmed or rejected`);
  if (other) parts.push(`${other} not found`);
  return parts.join(', ');
}

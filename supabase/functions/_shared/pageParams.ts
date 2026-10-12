// Paging parameters for contacts-list (?page=1&pageSize=100).
//
// What was wrong: contacts-list returned one unpaged query, and the database answers at
// most 1000 rows per request, so the 1001st contact of one status (for a rep, one
// conference scope) silently never reached the app. Two fixes live side by side: a
// request with no `page` still gets the whole list, now read page by page and refused
// past MAX_ROWS rather than cut short (so an app that has not been updated is also safe);
// a request with `page` gets just that page and the total, which is what the Contacts
// page uses to show the first 100 at once and load the rest behind them.

export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 100;

export interface PageRequest {
  page: number; // 1-based
  pageSize: number;
  from: number; // inclusive row offsets for .range(from, to)
  to: number;
}

// null: no `page` given, so the caller wants the whole list. A `page` that is not a
// positive whole number, or a pageSize outside 1..MAX_PAGE_SIZE, is an error message.
export function parsePageRequest(params: URLSearchParams): PageRequest | null | { error: string } {
  const rawPage = params.get("page");
  if (rawPage === null) return null;
  const page = Number(rawPage);
  if (!Number.isInteger(page) || page < 1) return { error: "page must be a whole number, 1 or more." };

  const rawSize = params.get("pageSize");
  const pageSize = rawSize === null ? DEFAULT_PAGE_SIZE : Number(rawSize);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    return { error: `pageSize must be a whole number from 1 to ${MAX_PAGE_SIZE}.` };
  }
  const from = (page - 1) * pageSize;
  return { page, pageSize, from, to: from + pageSize - 1 };
}

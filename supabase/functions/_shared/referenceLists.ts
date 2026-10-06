// Whole-list reads for the District and School pickers.
//
// The pickers used to ask the server for 50 rows per keystroke and nothing until two
// characters were typed, so opening a field showed an empty box and every letter was
// a round trip (the 2026-10-06 complaint: "clunky, appears broken"). They now load a
// state's whole district list, or a district's whole school list, once and filter on
// the device. These helpers are the server half: bounded, and cacheable.
//
// PostgREST returns at most 1000 rows per request (the project's max-rows), and the
// biggest state has 932 districts today, so a bigger one would silently lose its tail.
// fetchAllPages reads page by page up to MAX_ROWS and throws past it rather than
// handing back a list that looks complete and isn't.
import { corsHeaders } from "./http.ts";

export const PAGE_SIZE = 1000;
// Far above any real state or district (Texas 932; Charlotte-Mecklenburg, the biggest
// district, 183 schools). Past it is a bug or an abusive query, not a list to serve.
export const MAX_ROWS = 5000;

export interface Page<T> {
  data: T[] | null;
  error: { message: string } | null;
}

export async function fetchAllPages<T>(
  readRange: (from: number, to: number) => PromiseLike<Page<T>>,
  maxRows = MAX_ROWS,
  pageSize = PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await readRange(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
  throw new Error(`more than ${maxRows} rows: refusing to serve a truncated list`);
}

// A reference list changes at most when someone imports districts, so the browser can
// keep it for ten minutes and, past that, show the old copy for a day while it
// re-fetches (stale-while-revalidate): a rep on bad conference wifi gets the list
// instantly. `private`: the request carries the caller's key, so a shared cache must
// not hold it.
export const LIST_CACHE_CONTROL = "private, max-age=600, stale-while-revalidate=86400";

export function cachedJson(req: Request, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders(req), "Content-Type": "application/json", "Cache-Control": LIST_CACHE_CONTROL },
  });
}

// Reading the contacts list from the database, whole or one page (used by contacts-list).
// See pageParams.ts for why: the database answers at most 1000 rows per request.
import { fetchAllPages } from "./referenceLists.ts";
import type { PageRequest } from "./pageParams.ts";

// Newest first; the id breaks ties so two contacts created in the same instant keep a
// fixed order and a page boundary can never split or repeat them.
// deno-lint-ignore no-explicit-any
export function ordered(query: any) {
  return query.order("created_at", { ascending: false }).order("id", { ascending: false });
}

// Reads the list, whole or one page, from a function that builds a FRESH query each time
// (a PostgREST query is consumed by being awaited, so each page needs its own). With a
// page request it also returns the total number of matching rows.
export async function readContacts(
  // deno-lint-ignore no-explicit-any
  makeQuery: (withCount: boolean) => any,
  pageRequest: PageRequest | null,
  // deno-lint-ignore no-explicit-any
): Promise<{ rows: any[]; total: number }> {
  if (pageRequest) {
    const { data, error, count } = await makeQuery(true).range(pageRequest.from, pageRequest.to);
    if (error) throw error;
    return { rows: data ?? [], total: count ?? 0 };
  }
  const rows = await fetchAllPages((from, to) => makeQuery(false).range(from, to));
  return { rows, total: rows.length };
}

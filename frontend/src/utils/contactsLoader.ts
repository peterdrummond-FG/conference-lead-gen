// The Contacts page's loader: fetches each list a page at a time and keeps the three
// lists (unconfirmed, confirmed, rejected) up to date without ever showing a half-picture
// that is wrong. It is plain code with its dependencies passed in so it can be tested with a
// fake server (contactsLoader.test.mjs); composables/useContacts.ts wires it to the real
// requests and to Vue's reactive state. The reasons for paging are in contactsPaging.ts.
import { REVIEW_STATUSES, type ReviewStatus } from './contactsList.ts';
import { appendUnseen, isTooMany, remainingPages } from './contactsPaging.ts';

export interface LoaderJob { status: ReviewStatus; extra: Record<string, string> }
export interface LoaderPage<T> { items: T[]; total: number }

// Plain fields the page watches. useContacts passes a reactive object.
export interface LoaderState {
  loading: boolean;
  loaded: boolean;
  loadingMore: boolean;
  loadError: boolean;
  tooMany: boolean;
  loadedCount: number;
  totalCount: number;
}

export interface LoaderDeps<T extends { id: string }> {
  buildJobs(): LoaderJob[];
  fetchPage(job: LoaderJob, page: number): Promise<LoaderPage<T>>;
  buckets: Record<ReviewStatus, T[]>;
  state: LoaderState;
  // Bumped by the page whenever a write starts and ends, and how many are in flight now:
  // a quiet refresh that straddles one is a snapshot from before it landed and is dropped.
  writes(): number;
  busyCount(): number;
}

export interface LoadOptions {
  quiet?: boolean;
  // Called once the pages behind the first have all arrived (not for a quiet refresh).
  onComplete?: (() => void) | undefined;
}

export function createContactsLoader<T extends { id: string }>(deps: LoaderDeps<T>) {
  const { buckets, state } = deps;
  let loadSeq = 0;

  const countAll = () => REVIEW_STATUSES.reduce((n, status) => n + buckets[status].length, 0);

  // Put one batch of rows per job into the three lists, each id once.
  function applyRows(jobs: LoaderJob[], rowsByJob: T[][]) {
    const next = { needs_review: [], approved: [], rejected: [] } as Record<ReviewStatus, T[]>;
    const seen = new Set<string>();
    jobs.forEach((job, i) => { next[job.status] = appendUnseen(seen, next[job.status], rowsByJob[i] ?? []); });
    for (const status of REVIEW_STATUSES) buckets[status] = next[status];
    state.loadedCount = countAll();
  }

  // quiet: the page's own background refresh (processing poll, tab refocus). It yields to
  // any write that overlaps it (the next tick fetches again), and it loads every page BEFORE
  // it touches the lists, so they never shrink to one page and grow back under someone's
  // hands. A normal load shows its first page at once and the rest as they arrive.
  async function load(opts: LoadOptions = {}): Promise<void> {
    // A half-loaded list is not replaced by a background refresh.
    if (opts.quiet && state.loadingMore) return;
    // Two overlapping loads (a filter change during the first fetch) must not let the older,
    // slower response overwrite the newer one.
    const seq = ++loadSeq;
    const writesAtStart = deps.writes();
    const writingAtStart = deps.busyCount() > 0;
    const overlapped = () => Boolean(opts.quiet) && (deps.writes() !== writesAtStart || writingAtStart || deps.busyCount() > 0);
    state.loading = true;
    if (!opts.quiet) { state.loadingMore = false; state.loadError = false; }
    try {
      const jobs = deps.buildJobs();
      const firsts = await Promise.all(jobs.map(async (job) => ({ job, page: await deps.fetchPage(job, 1) })));
      if (seq !== loadSeq) return;
      if (overlapped()) return;

      const tooManyNow = firsts.some((f) => isTooMany(f.page.total));
      const rows = firsts.map((f) => f.page.items.slice());
      const more = tooManyNow ? [] : firsts.map((f) => remainingPages(f.page.total));
      const hasMore = more.some((pages) => pages.length > 0);
      state.totalCount = firsts.reduce((n, f) => n + f.page.total, 0);

      if (!opts.quiet) {
        state.tooMany = tooManyNow;
        applyRows(jobs, rows);
        state.loaded = true;
      } else if (tooManyNow) {
        return;
      }
      if (!hasMore) {
        if (opts.quiet) applyRows(jobs, rows);
        return;
      }

      // The pages behind the first. Jobs run side by side; each walks its own pages in order.
      const rest = async () => {
        try {
          await Promise.all(firsts.map(async (f, i) => {
            for (const page of more[i] ?? []) {
              const next = await deps.fetchPage(f.job, page);
              if (seq !== loadSeq) return;
              if (opts.quiet) {
                rows[i]?.push(...next.items);
              } else {
                // Only rows not already on screen: a lead the person has since confirmed or
                // rejected sits in another list now and a page fetched earlier must not put
                // it back, and a new contact pushes a row onto two pages.
                const seen = new Set(REVIEW_STATUSES.flatMap((status) => buckets[status].map((c) => c.id)));
                buckets[f.job.status] = appendUnseen(seen, buckets[f.job.status], next.items);
                state.loadedCount = countAll();
              }
            }
          }));
          if (seq !== loadSeq) return;
          if (opts.quiet) {
            if (!overlapped()) applyRows(jobs, rows);
          } else {
            opts.onComplete?.();
          }
        } catch {
          // The request layer already told the user. The list is partial, so whatever acts
          // on the whole list stays waiting until a reload.
          if (seq === loadSeq && !opts.quiet) state.loadError = true;
        } finally {
          if (seq === loadSeq && !opts.quiet) state.loadingMore = false;
        }
      };
      if (opts.quiet) {
        await rest();
      } else {
        state.loadingMore = true;
        void rest();
      }
    } finally {
      if (seq === loadSeq) state.loading = false;
    }
  }

  return { load };
}

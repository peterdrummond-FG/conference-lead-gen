import { computed, reactive, toRefs } from 'vue';
import { Notify } from 'quasar';
import { api } from '@/boot/axios';
import { useSessionStore } from '@/stores/session-store';
import type { ContactListItem, UpdateContactPayload } from '@/types/review';
import { REVIEW_STATUSES, fullName, type ReviewStatus } from '@/utils/contactsList';
import { CONTACTS_PAGE_SIZE, skippedSummary } from '@/utils/contactsPaging';
import { createContactsLoader, type LoaderJob, type LoaderState } from '@/utils/contactsLoader';

// Display-only fields the list item carries next to the ids the PATCH writes
// (schoolDistrictId → districtName). A save only sends the ids, so without
// patching these locally the row would keep showing the old district name
// until the next reload.
export type DisplayPatch = Partial<Pick<ContactListItem, 'districtName' | 'schoolName'>>;

const UNDO_MS = 6000;

// All three review statuses are held at once. That is what gives the status bar
// live counts, lets an approve/reject move a lead between the unconfirmed,
// confirmed and rejected lists locally (no refetch, no flicker, no lost place),
// and makes Undo a plain PATCH back. The card photos are separate requests, and only
// the open lead's is ever fetched.
//
// Each list is requested CONTACTS_PAGE_SIZE (100) at a time. The first page of every list
// shows at once; the rest load behind it (`loadingMore`), and the page keeps anything that
// acts on the whole list (Confirm all, search) waiting until they are in (`partial`). This
// replaced one unpaged request that the database cut off at 1000 rows without saying so.
// See utils/contactsPaging.ts.
export function useContacts() {
  const sessionStore = useSessionStore();

  const buckets = reactive<Record<ReviewStatus, ContactListItem[]>>({
    needs_review: [],
    approved: [],
    rejected: [],
  });
  // What the page watches while it loads (see utils/contactsLoader.ts).
  const state = reactive<LoaderState>({
    loading: false,
    loaded: false,
    // More pages are still arriving behind the first one.
    loadingMore: false,
    // Some pages could not be loaded.
    loadError: false,
    // A list above the 5,000 ceiling: only its first page is shown, and the page says so.
    tooMany: false,
    loadedCount: 0,
    totalCount: 0,
  });
  const { loading, loaded, loadingMore, loadError, tooMany, loadedCount, totalCount } = toRefs(state);
  // True while the lists on screen are not the whole of what the server holds. Anything
  // that acts on "everything shown" (Confirm all) must wait for this to be false.
  const partial = computed(() => state.loadingMore || state.loadError || state.tooMany);
  const busy = reactive(new Set<string>());

  // Admin / Solutions Success only — the server slices by these.
  const serverFilters = reactive<{ repId: string | null; synced: string | null }>({ repId: null, synced: null });

  // Bumped when a write starts and again when it ends. A background refresh
  // that straddles either is a snapshot of the server from before the write
  // landed; applying it would put the old values back under the rep (the
  // editor's Save button reappearing as if nothing had saved).
  let writes = 0;

  function isSales() {
    return sessionStore.effectiveRole === 'sales';
  }

  function baseParams(): Record<string, string> {
    const params: Record<string, string> = {};
    if (sessionStore.viewingAs?.role === 'sales') params.viewAsRepId = sessionStore.viewingAs.id;
    return params;
  }

  interface Paged { items: ContactListItem[]; page: number; pageSize: number; total: number }

  async function fetchPage(job: LoaderJob, page: number): Promise<Paged> {
    const { data } = await api.get<Paged>('/contacts-list', {
      params: { ...baseParams(), reviewStatus: job.status, ...job.extra, page, pageSize: CONTACTS_PAGE_SIZE },
    });
    return data;
  }

  function buildJobs(): LoaderJob[] {
    if (isSales()) {
      // contacts-list splits a rep's leads into their current conference and the
      // rest; the page wants all of them (it filters by conference itself).
      return REVIEW_STATUSES.flatMap((status) => [
        { status, extra: { scope: 'current' } },
        { status, extra: { scope: 'past' } },
      ]);
    }
    const extra: Record<string, string> = {};
    if (serverFilters.repId) extra.repId = serverFilters.repId;
    if (serverFilters.synced) extra.synced = serverFilters.synced;
    return REVIEW_STATUSES.map((status) => ({ status, extra }));
  }

  // The fetching, paging and "never show a wrong half-picture" rules live in
  // utils/contactsLoader.ts, where they are tested with a fake server.
  const loader = createContactsLoader<ContactListItem>({
    buildJobs, fetchPage, buckets, state, writes: () => writes, busyCount: () => busy.size,
  });
  const load = loader.load;

  function find(id: string): ContactListItem | undefined {
    for (const status of REVIEW_STATUSES) {
      const hit = buckets[status].find((c) => c.id === id);
      if (hit) return hit;
    }
    return undefined;
  }

  function moveTo(id: string, to: ReviewStatus) {
    const contact = find(id);
    if (!contact || contact.reviewStatus === to) return;
    const from = contact.reviewStatus as ReviewStatus;
    buckets[from] = buckets[from].filter((c) => c.id !== id);
    contact.reviewStatus = to;
    buckets[to] = [...buckets[to], contact];
  }

  // One in-flight action per contact: a double tap on Confirm must not send
  // two PATCHes, and Undo racing a second tap would leave the tab and the
  // server disagreeing about where the lead is.
  async function guarded<T>(id: string, fn: () => Promise<T>): Promise<T | undefined> {
    if (busy.has(id)) return undefined;
    busy.add(id);
    writes++;
    try {
      return await fn();
    } catch {
      // The axios interceptor already told the user; local state is untouched
      // because every mutation below happens only after the request succeeds.
      return undefined;
    } finally {
      busy.delete(id);
      writes++;
    }
  }

  function toastWithUndo(message: string, id: string, restoreTo: ReviewStatus) {
    Notify.create({
      type: 'positive',
      message,
      timeout: UNDO_MS,
      actions: [{ label: 'Undo', color: 'white', handler: () => void setStatus(id, restoreTo, { quiet: true }) }],
    });
  }

  async function setStatus(
    id: string,
    to: ReviewStatus,
    opts: { quiet?: boolean; edits?: UpdateContactPayload | undefined; display?: DisplayPatch | undefined; message?: string } = {},
  ): Promise<boolean> {
    const contact = find(id);
    if (!contact) return false;
    const from = contact.reviewStatus as ReviewStatus;
    const done = await guarded(id, async () => {
      // Pending edits ride on the same PATCH as the status change — one
      // request that lands or fails as a unit (see Classic's approve()).
      await api.patch('/contacts-patch', { ...opts.edits, reviewStatus: to }, { params: { id } });
      if (opts.edits) Object.assign(contact, opts.edits, opts.display);
      moveTo(id, to);
      return true;
    });
    if (!done) return false;
    if (!opts.quiet && opts.message) toastWithUndo(opts.message, id, from);
    return true;
  }

  const approve = (id: string, edits?: UpdateContactPayload, display?: DisplayPatch) => {
    const c = find(id);
    return setStatus(id, 'approved', { edits, display, message: c ? `Confirmed ${fullName(c)}` : 'Confirmed' });
  };
  const reject = (id: string) => {
    const c = find(id);
    return setStatus(id, 'rejected', { message: c ? `Rejected ${fullName(c)}` : 'Rejected' });
  };
  const restore = (id: string) => {
    const c = find(id);
    return setStatus(id, 'needs_review', { message: c ? `${fullName(c)} moved back to Contacts` : 'Moved back' });
  };

  // Followed-up saves the instant it changes; text fields wait for
  // Save. Both go through here.
  // message: said once the save has landed. Followed-up changes on
  // screen as you tap, but "Save changes" used to just make its button vanish,
  // which reads the same as the lead vanishing.
  async function update(id: string, payload: UpdateContactPayload, display?: DisplayPatch, message?: string) {
    const contact = find(id);
    if (!contact) return false;
    const done = await guarded(id, async () => {
      await api.patch('/contacts-patch', payload, { params: { id } });
      Object.assign(contact, payload, display);
      return true;
    });
    if (done && message) Notify.create({ type: 'positive', message, timeout: 2500 });
    return Boolean(done);
  }

  async function retryMatch(id: string) {
    await guarded(id, async () => {
      // Matching runs on the server's queue; nothing to show immediately.
      await api.post('/contacts-retry-match', undefined, { params: { id } });
      Notify.create({ type: 'info', message: 'Retrying the match. It can take a minute.' });
    });
  }

  // contacts-bulk-approve answers 200 with { approved, skipped } even when it
  // skipped some — the response has to be read (Classic's Finding 11).
  async function bulkApprove(ids: string[]) {
    writes++;
    const { data } = await api.post<{ approved: string[]; skipped: { id: string; reason: string }[] }>(
      '/contacts-bulk-approve',
      { ids },
    ).finally(() => { writes++; });
    for (const id of data.approved) moveTo(id, 'approved');
    const skippedCount = data.skipped.length;
    const n = data.approved.length;
    if (skippedCount === 0) {
      Notify.create({ type: 'positive', message: `Confirmed ${n} contact${n === 1 ? '' : 's'}.` });
      return;
    }
    const summary = skippedSummary(data.skipped);
    Notify.create({
      type: 'warning',
      timeout: 8000,
      message: `Confirmed ${n}, skipped ${skippedCount} (${summary}). Skipped contacts stay as they were.`,
    });
  }

  async function bulkDelete(ids: string[]) {
    writes++;
    const { data } = await api.post<{ deleted: string[]; skipped: { id: string; reason: string }[] }>(
      '/contacts-bulk-delete',
      { ids },
    ).finally(() => { writes++; });
    const gone = new Set(data.deleted);
    buckets.rejected = buckets.rejected.filter((c) => !gone.has(c.id));
    if (data.skipped.length) {
      Notify.create({ type: 'warning', message: `Deleted ${data.deleted.length}, skipped ${data.skipped.length}.` });
    } else {
      Notify.create({ type: 'positive', message: `Deleted ${data.deleted.length} contact${data.deleted.length === 1 ? '' : 's'}.` });
    }
  }

  return {
    buckets, loading, loaded, busy, serverFilters,
    loadingMore, loadError, tooMany, loadedCount, totalCount, partial,
    load, find, approve, reject, restore, update, retryMatch, bulkApprove, bulkDelete,
  };
}

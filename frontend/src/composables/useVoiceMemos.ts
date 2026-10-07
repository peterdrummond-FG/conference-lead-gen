import { computed, onBeforeUnmount, reactive, ref, watch, type Ref } from 'vue';
import { Dialog, Notify } from 'quasar';
import { api } from '@/boot/axios';
import type { FailedIntakeMessage, LinkCandidateContact, UnresolvedAudioMemo } from '@/types/review';
import { CREATED_TOAST, CREATE_STARTED_TOAST, DELETED_TOAST, RETRY_TOAST, assignedToast, failedDelete, failedRetryToast } from '@/utils/voiceMemos';

// While a person's Create contacts is running the page polls for the result. The
// extraction is a model call behind the agent / n8n pipeline, so it is seconds to
// a minute or two; this is the one place the page waits on it.
const POLL_MS = 6000;

type Doing = 'retry' | 'create' | 'delete' | 'assign';

// Voice memos nobody has matched to a contact yet (the amber section at the top of
// Contacts) and, from the same request, photos and memos that failed to process.
// One composable owns both because inbound-messages-unresolved-list returns both, so
// the page asks once; the section, the laptop pane, the phone sheet and the failed
// panel are display over this.
//
// `onContactsChanged` runs when something here changed a contact's list: a memo was
// assigned (a contact's notes grew) or Create contacts finished (new contacts exist).
export function useVoiceMemos(opts: { viewAsRepId: Ref<string | null>; onContactsChanged: () => void }) {
  const memos = ref<UnresolvedAudioMemo[]>([]);
  const failed = ref<FailedIntakeMessage[]>([]);
  const loaded = ref(false);
  const doing = reactive<Record<string, Doing | undefined>>({});

  async function load() {
    const params: Record<string, string> = {};
    if (opts.viewAsRepId.value) params.viewAsRepId = opts.viewAsRepId.value;
    const { data } = await api.get<{ audio: UnresolvedAudioMemo[]; failedIntake: FailedIntakeMessage[] }>(
      '/inbound-messages-unresolved-list',
      { params },
    );
    // A memo that was running Create contacts and is no longer listed became real
    // contacts (contacts-from-note moves it out once the first person exists): say
    // so and refresh the list they landed in. One that left some other way (the
    // automatic sweep linked it, someone else deleted it) is not that story.
    const wasCreating = new Set(memos.value.filter((m) => m.create?.status === 'working').map((m) => m.id));
    const nowIds = new Set(data.audio.map((m) => m.id));
    const finished = [...wasCreating].filter((id) => !nowIds.has(id));
    memos.value = data.audio;
    failed.value = data.failedIntake;
    loaded.value = true;
    if (finished.length) {
      Notify.create({ type: 'positive', message: CREATED_TOAST });
      opts.onContactsChanged();
    }
  }

  // A failed refresh must not leave the section stale-and-silent forever, but it also
  // must not throw into the page: the axios interceptor already told the person.
  async function safeLoad() {
    try { await load(); } catch { /* shown by the interceptor */ }
  }

  const working = computed(() => memos.value.some((m) => m.create?.status === 'working'));
  let timer: ReturnType<typeof setInterval> | null = null;
  function stopPolling() {
    if (timer !== null) { clearInterval(timer); timer = null; }
  }
  watch(working, (on) => {
    if (on && timer === null) timer = setInterval(() => void safeLoad(), POLL_MS);
    if (!on) stopPolling();
  });
  onBeforeUnmount(stopPolling);
  watch(opts.viewAsRepId, () => void safeLoad());

  function patch(id: string, change: Partial<UnresolvedAudioMemo>) {
    memos.value = memos.value.map((m) => (m.id === id ? { ...m, ...change } : m));
  }
  function drop(id: string) {
    memos.value = memos.value.filter((m) => m.id !== id);
  }

  // Each action sets `doing` for its memo, so its buttons show a spinner and cannot be
  // tapped twice, and clears it whatever happens. The server's refusal (a stale tab,
  // the attempt cap) is shown by the axios interceptor; the catch refreshes so the
  // card stops offering something that is no longer true.
  async function run(id: string, what: Doing, job: () => Promise<void>): Promise<boolean> {
    if (doing[id]) return false;
    doing[id] = what;
    try {
      await job();
      return true;
    } catch {
      await safeLoad();
      return false;
    } finally {
      doing[id] = undefined;
    }
  }

  const createContacts = (id: string) => run(id, 'create', async () => {
    await api.post('/inbound-messages-create-contacts', undefined, { params: { id } });
    // Shown as working straight away; the poll takes over from here.
    patch(id, { create: { status: 'working', error: null, attempts: (memos.value.find((m) => m.id === id)?.create?.attempts ?? 0) + 1 } });
    Notify.create({ type: 'info', message: CREATE_STARTED_TOAST });
  });

  const retryMatching = (id: string) => run(id, 'retry', async () => {
    await api.post('/inbound-messages-retry', undefined, { params: { id } });
    // Back to "Still matching" with a fresh count, the same state the server just wrote.
    patch(id, { linkStatus: 'unlinked', linkAttempts: 0 });
    Notify.create({ type: 'info', message: RETRY_TOAST });
  });

  function confirmDelete(id: string) {
    Dialog.create({
      title: 'Delete voice memo?',
      message: "This permanently deletes the memo and its recording. This can't be undone.",
      cancel: true,
      persistent: true,
      ok: { label: 'Delete', color: 'negative' },
    }).onOk(() => void run(id, 'delete', async () => {
      await api.post('/inbound-messages-delete', undefined, { params: { id } });
      drop(id);
      Notify.create({ type: 'positive', message: DELETED_TOAST });
    }));
  }

  const assign = (id: string, contactId: string, contactName: string) => run(id, 'assign', async () => {
    await api.post('/inbound-messages-assign', undefined, { params: { id, contactId } });
    drop(id);
    Notify.create({ type: 'positive', message: assignedToast(contactName) });
    // The contact's notes just grew; the list shows them.
    opts.onContactsChanged();
  });

  async function candidates(id: string): Promise<LinkCandidateContact[]> {
    const { data } = await api.get<LinkCandidateContact[]>('/inbound-messages-link-candidates', { params: { id } });
    return data;
  }

  async function audioUrl(id: string): Promise<string> {
    const { data } = await api.get<{ url: string }>('/inbound-messages-audio', { params: { id } });
    return data.url;
  }

  // Failed photos and memos: Retry puts them back in the queue the agent already
  // drains; Delete removes the item and its stored file; View photo shows the picture.
  const retryFailed = (m: FailedIntakeMessage) => run(m.id, 'retry', async () => {
    await api.post('/inbound-messages-retry', undefined, { params: { id: m.id } });
    failed.value = failed.value.filter((x) => x.id !== m.id);
    Notify.create({ type: 'info', message: failedRetryToast(m) });
  });

  function confirmDeleteFailed(m: FailedIntakeMessage) {
    const words = failedDelete(m);
    Dialog.create({
      title: words.title,
      message: words.message,
      cancel: true,
      persistent: true,
      ok: { label: 'Delete', color: 'negative' },
    }).onOk(() => void run(m.id, 'delete', async () => {
      await api.post('/inbound-messages-delete', undefined, { params: { id: m.id } });
      failed.value = failed.value.filter((x) => x.id !== m.id);
      Notify.create({ type: 'positive', message: words.toast });
    }));
  }

  // The image as bytes (the page's CSP has no Storage host in img-src), shown from a
  // blob: URL the dialog revokes when it closes. Same pattern as useContactPhoto.
  async function photoBlob(id: string): Promise<Blob> {
    const { data } = await api.get<Blob>('/inbound-messages-photo', { params: { id }, responseType: 'blob' });
    return data;
  }

  return { memos, failed, loaded, doing, load: safeLoad, createContacts, retryMatching, confirmDelete, assign, candidates, audioUrl, retryFailed, confirmDeleteFailed, photoBlob };
}

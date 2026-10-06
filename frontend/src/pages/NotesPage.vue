<template>
  <q-page class="q-pa-md">
    <NotesBody
      v-model:text="text"
      :phase="phase" :sending="sending" :timed-out="timedOut" :contacts="contacts" :skipped="skipped"
      :submission-error="submissionError" :previewing="previewing" :preview-name="sessionStore.viewingAs?.name ?? null"
      :target-event-name="targetEventName" :placeholder="placeholder" :max-chars="MAX_NOTE_CHARS"
      @submit="submit" @reset="reset"
    />
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import { api } from '@/boot/axios';
import { useSessionStore } from '@/stores/session-store';
import { useEventStore } from '@/stores/event-store';
import NotesBody, { type ExtractedContact } from '@/components/NotesBody.vue';

interface NoteStatus {
  id: string;
  status: 'pending_extraction' | 'processing' | 'completed' | 'failed';
  error: string | null;
  skipped: string[];
  eventName: string | null;
  contacts: ExtractedContact[];
}

// Matches notes-submit's own cap — enforced there too, since this is only a
// convenience for the person typing.
const MAX_NOTE_CHARS = 20_000;
const POLL_INTERVAL_MS = 2_000;
// Extraction is one `claude -p` call on the local agent (5 min ceiling) plus
// that loop's own poll interval. Past this, stop asking and tell the rep
// where to look instead of spinning forever — most often this means the
// local agent isn't running at all.
const POLL_TIMEOUT_MS = 5 * 60_000;

const sessionStore = useSessionStore();
const eventStore = useEventStore();

const text = ref('');
const phase = ref<'idle' | 'working' | 'done'>('idle');
const sending = ref(false);
const timedOut = ref(false);
const contacts = ref<ExtractedContact[]>([]);
const skipped = ref<string[]>([]);
const submissionError = ref<string | null>(null);

let pollTimer: ReturnType<typeof setTimeout> | undefined;

const placeholder = [
  'e.g.',
  '',
  'jane smith principal lincoln hs — really engaged, wants pricing for next fall',
  'bob ortiz curriculum dir same district, bortiz@lincoln.k12.ma.us, budget set til FY27',
].join('\n');

// The same resolution notes-submit does server-side (a rep's own linked
// event first, then the active one) — shown up front so where the note is
// going is never a surprise, but the server never trusts this.
const previewing = computed(() => !!sessionStore.viewingAs);
const targetEventName = computed(() => (
  // Previewing shows the previewed person's own conference. eventStore only
  // ever describes the caller, so it can't stand in for theirs.
  previewing.value
    ? sessionStore.preview?.currentEventName ?? null
    : sessionStore.user?.currentEventName ?? eventStore.activeEvent?.name ?? null
));

function stopPolling() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = undefined;
}

async function submit() {
  if (previewing.value) return;
  sending.value = true;
  try {
    const { data } = await api.post<{ id: string }>('/notes-submit', { text: text.value });
    phase.value = 'working';
    poll(data.id, Date.now());
  } finally {
    sending.value = false;
  }
}

function poll(id: string, startedAt: number) {
  stopPolling();
  pollTimer = setTimeout(async () => {
    let status: NoteStatus;
    try {
      ({ data: status } = await api.get<NoteStatus>('/notes-status', { params: { id } }));
    } catch {
      // The axios interceptor has already surfaced the error; keep polling
      // rather than giving up on a single blip (the timeout below is what
      // actually ends this).
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        timedOut.value = true;
        phase.value = 'done';
        return;
      }
      poll(id, startedAt);
      return;
    }

    contacts.value = status.contacts;
    skipped.value = status.skipped;
    submissionError.value = status.error;

    if (status.status === 'completed' || status.status === 'failed') {
      phase.value = 'done';
      return;
    }
    if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
      timedOut.value = true;
      phase.value = 'done';
      return;
    }
    poll(id, startedAt);
  }, POLL_INTERVAL_MS);
}

function reset() {
  stopPolling();
  text.value = '';
  phase.value = 'idle';
  timedOut.value = false;
  contacts.value = [];
  skipped.value = [];
  submissionError.value = null;
}

onUnmounted(stopPolling);

// Needed for targetEventName when this page is opened directly (a bookmark
// or a reload) rather than navigated to from Contacts.
if (!eventStore.loaded) void eventStore.fetchActive();
</script>

<template>
  <q-page class="q-pa-md">
    <div class="notes-column">
      <div class="row items-center q-mb-xs">
        <div class="text-h5">Contacts from a note</div>
        <q-space />
        <q-btn flat dense no-caps color="primary" label="Back to Review" to="/review" />
      </div>

      <div class="text-body2 text-grey-8 q-mb-md">
        Paste everything you typed — several people in one go is fine. Whatever
        you wrote about each person is kept with them.
      </div>

      <q-banner v-if="!targetEventName" dense class="bg-orange-1 text-orange-9 q-mb-md rounded-borders">
        You're not linked to an event yet, so there's nowhere to file these.
        Link yourself to one on the Review page first.
      </q-banner>
      <div v-else class="text-caption text-grey q-mb-md">
        Filing under <span class="text-weight-medium">{{ targetEventName }}</span>
      </div>

      <!-- The textarea stays on screen while extraction runs: a rep who
           spots a typo mid-run can see exactly what they sent, and nothing
           they typed is ever thrown away by a failure. -->
      <q-input
        v-model="text"
        type="textarea"
        outlined
        autogrow
        input-style="min-height: 220px"
        :readonly="phase !== 'idle'"
        :placeholder="placeholder"
        counter
        :maxlength="MAX_NOTE_CHARS"
      />

      <div class="row items-center q-gutter-sm q-mt-md">
        <q-btn
          v-if="phase === 'idle'"
          color="primary"
          no-caps
          unelevated
          label="Send"
          icon-right="send"
          :loading="sending"
          :disable="!text.trim() || !targetEventName"
          @click="submit"
        />
        <template v-else>
          <q-btn color="primary" no-caps unelevated label="Paste another note" icon="add" @click="reset" />
          <q-btn flat no-caps color="primary" label="Open Review" to="/review" />
        </template>
      </div>

      <!-- Running -->
      <div v-if="phase === 'working'" class="row items-center q-gutter-sm q-mt-lg text-grey-8">
        <q-spinner size="22px" color="primary" />
        <div class="text-body2">
          Reading your note — this usually takes under a minute. You can leave
          this page; the contacts land in Review either way.
        </div>
      </div>

      <q-banner v-if="timedOut" dense class="bg-blue-1 text-blue-9 q-mt-md rounded-borders">
        Still working on it. Nothing is lost — check Review in a few minutes.
        If it never shows up, the extraction agent may not be running.
      </q-banner>

      <!-- Results. Rendered as soon as any contact exists, so they appear as
           they're created rather than all at the end. -->
      <div v-if="contacts.length" class="q-mt-lg">
        <div class="text-subtitle1 q-mb-sm">
          {{ contacts.length }} contact{{ contacts.length === 1 ? '' : 's' }}
          {{ phase === 'working' ? 'so far' : 'added' }}
        </div>

        <q-card v-for="c in contacts" :key="c.id" flat bordered class="q-mb-sm">
          <q-card-section class="q-py-sm">
            <div class="row items-center q-gutter-xs">
              <span class="text-weight-medium">{{ [c.firstName, c.lastName].filter(Boolean).join(' ') }}</span>
              <q-chip dense size="sm" class="tag-chip" :class="`tone-${confidenceTone(c.extractionConfidence)}`">
                {{ c.extractionConfidence }} confidence
              </q-chip>
              <q-chip v-if="c.isDuplicate" dense size="sm" class="tag-chip tone-orange">
                possible duplicate
              </q-chip>
            </div>
            <div class="text-caption text-grey-8 q-mt-xs">
              {{ [c.title, c.schoolName, c.districtName].filter(Boolean).join(' · ') || 'No title or district in the note' }}
            </div>
            <div v-if="c.email || c.phone" class="text-caption text-grey-8">
              {{ [c.email, c.phone].filter(Boolean).join(' · ') }}
            </div>
            <div v-if="c.interactionNotes" class="text-caption text-grey-9 q-mt-xs notes-excerpt">
              "{{ c.interactionNotes }}"
            </div>
          </q-card-section>
        </q-card>
      </div>

      <!-- Nothing found is a real, expected outcome, not an error. -->
      <q-banner
        v-if="phase === 'done' && contacts.length === 0 && !submissionError"
        dense
        class="bg-grey-3 text-grey-9 q-mt-md rounded-borders"
      >
        No contacts could be picked out of that note. If there are people in
        there, adding a name next to each one usually does it.
      </q-banner>

      <div v-if="skipped.length" class="q-mt-md">
        <div class="text-subtitle2 q-mb-xs">Not added</div>
        <ul class="text-body2 text-grey-8 q-my-none skipped-list">
          <li v-for="(s, i) in skipped" :key="i">{{ s }}</li>
        </ul>
      </div>

      <q-banner v-if="submissionError" dense class="bg-red-1 text-red-9 q-mt-md rounded-borders">
        <div class="text-weight-medium">
          {{ contacts.length ? "Some of that note couldn't be saved" : "That note couldn't be processed" }}
        </div>
        <div class="text-caption">{{ submissionError }}</div>
      </q-banner>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import { api } from '@/boot/axios';
import { useSessionStore } from '@/stores/session-store';
import { useEventStore } from '@/stores/event-store';

interface ExtractedContact {
  id: string;
  firstName: string;
  lastName: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  districtName: string | null;
  schoolName: string | null;
  interactionNotes: string | null;
  extractionConfidence: string | null;
  isDuplicate: boolean;
}

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
const targetEventName = computed(
  () => sessionStore.user?.currentEventName ?? eventStore.activeEvent?.name ?? null,
);

function confidenceTone(confidence: string | null) {
  switch (confidence) {
    case 'high':
      return 'green';
    case 'medium':
      return 'orange';
    case 'low':
      return 'red';
    default:
      return 'slate';
  }
}

function stopPolling() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = undefined;
}

async function submit() {
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
// or a reload) rather than navigated to from Review.
if (!eventStore.loaded) void eventStore.fetchActive();
</script>

<style scoped>
/* Notes get pasted on a phone as often as a laptop — cap the line length so
   it stays readable on a wide screen without fighting the narrow one. */
.notes-column {
  max-width: 720px;
  margin: 0 auto;
}

.notes-excerpt {
  font-style: italic;
}

.skipped-list {
  padding-left: 20px;
}

.tag-chip {
  font-weight: 500;
}

.tone-green {
  background: #e6f4ea;
  color: #1e7e34;
}

.tone-orange {
  background: #fdeee3;
  color: #b35a00;
}

.tone-red {
  background: #fbeaea;
  color: #b23b3b;
}

.tone-slate {
  background: #eceff1;
  color: #455a64;
}
</style>

<template>
  <q-page class="q-pa-md">
    <NotesBody
      v-model:text="text"
      v-model:mode="mode"
      can-upload :max-rows="MAX_IMPORT_ROWS" :file-summary="fileSummary" :name-choices="nameChoices" :file-error="fileError"
      @file="onFile" @pick-name="onPickName"
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
import { US_STATES } from '@/constants/usStates';
import {
  MAX_IMPORT_ROWS, buildRows, buildTable, cellToString, describeMatch, matchColumns, parseCsv, withNameColumn,
  type ColumnMatch, type ImportTable,
} from '@/utils/fileImport';

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
// Extraction is one skill-extract-note-contacts call inside the n8n
// pipeline-note-extraction (picked up by a database webhook, or at worst by the
// pipeline's 5-minute backstop). Past this, stop asking and tell the rep where to
// look instead of spinning forever — most often this means the pipeline isn't
// running.
const POLL_TIMEOUT_MS = 5 * 60_000;

const sessionStore = useSessionStore();
const eventStore = useEventStore();

const text = ref('');
const mode = ref<'paste' | 'file'>('paste');
const phase = ref<'idle' | 'working' | 'done'>('idle');
const sending = ref(false);
const timedOut = ref(false);
const contacts = ref<ExtractedContact[]>([]);
const skipped = ref<string[]>([]);
const submissionError = ref<string | null>(null);

// Upload a file: what was read, what was matched, and the one question that can come up.
const fileSummary = ref<{ fileName: string; matched: string[]; notes: string[] } | null>(null);
const fileError = ref<string | null>(null);
const nameChoices = ref<{ label: string; value: number }[] | null>(null);
let pendingFile: { name: string; table: ImportTable; match: ColumnMatch } | null = null;

// A spreadsheet of 500 contacts is well under this; a bigger file is a mis-pick.
const MAX_FILE_BYTES = 5 * 1024 * 1024;

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

function poll(id: string, startedAt: number, delay = POLL_INTERVAL_MS) {
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
  }, delay);
}

async function readFileTable(file: File): Promise<string[][]> {
  if (/\.xlsx$/i.test(file.name)) {
    // Loaded on demand: most visits to this page never upload a spreadsheet.
    const { readSheet } = await import('read-excel-file/browser');
    const rows = await readSheet(file);
    return rows.map((r) => r.map(cellToString));
  }
  if (/\.xls$/i.test(file.name)) {
    throw new Error('That is an older Excel format. Save it as .xlsx or CSV and choose it again.');
  }
  return parseCsv(await file.text());
}

async function onFile(file: File) {
  if (previewing.value) return;
  fileError.value = null;
  nameChoices.value = null;
  fileSummary.value = null;
  pendingFile = null;
  if (file.size > MAX_FILE_BYTES) {
    fileError.value = 'That file is too big. Choose a CSV or Excel file under 5 MB.';
    return;
  }
  let table: ImportTable | null;
  try {
    table = buildTable(await readFileTable(file));
  } catch (e) {
    fileError.value = e instanceof Error && e.message.startsWith('That is an older')
      ? e.message
      : "We couldn't read that file. Choose a CSV or an .xlsx Excel file.";
    return;
  }
  if (!table || table.rows.length === 0) {
    fileError.value = 'That file has no contacts in it.';
    return;
  }
  if (table.rows.length > MAX_IMPORT_ROWS) {
    fileError.value = `That file has ${table.rows.length.toLocaleString()} rows. The limit is ${MAX_IMPORT_ROWS}; split it into smaller files.`;
    return;
  }
  const match = matchColumns(table, US_STATES);
  pendingFile = { name: file.name, table, match };
  if (match.needsName) {
    // The one question: which column has the names. Asked before anything is sent.
    fileSummary.value = { fileName: file.name, matched: [], notes: [] };
    nameChoices.value = table.headers.map((h, i) => ({ label: h || `Column ${i + 1}`, value: i }));
    return;
  }
  await importPending();
}

function onPickName(index: number) {
  if (!pendingFile) return;
  pendingFile.match = withNameColumn(pendingFile.match, index);
  nameChoices.value = null;
  void importPending();
}

async function importPending() {
  const f = pendingFile;
  if (!f || previewing.value) return;
  const { matched, notes } = describeMatch(f.table, f.match);
  fileSummary.value = { fileName: f.name, matched, notes };
  const rows = buildRows(f.table, f.match, US_STATES);
  phase.value = 'working';
  sending.value = true;
  try {
    // The server files every row before it answers, so the first read-back is complete.
    const { data } = await api.post<{ id: string }>('/notes-import-file', { fileName: f.name, rows });
    pendingFile = null;
    poll(data.id, Date.now(), 0);
  } catch {
    // The axios interceptor has already said why. Back to the file box so it can be retried.
    phase.value = 'idle';
    fileError.value = "That file wasn't imported. Check your connection and choose it again.";
  } finally {
    sending.value = false;
  }
}

function reset() {
  stopPolling();
  text.value = '';
  phase.value = 'idle';
  timedOut.value = false;
  contacts.value = [];
  skipped.value = [];
  submissionError.value = null;
  fileSummary.value = null;
  fileError.value = null;
  nameChoices.value = null;
  pendingFile = null;
}

onUnmounted(stopPolling);

// Needed for targetEventName when this page is opened directly (a bookmark
// or a reload) rather than navigated to from Contacts.
if (!eventStore.loaded) void eventStore.fetchActive();
</script>

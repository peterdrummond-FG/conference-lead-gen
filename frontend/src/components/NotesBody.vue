<template>
  <div class="notes-column">
    <div class="row items-center q-mb-xs">
      <div class="text-h5">Contacts from a note</div>
      <q-space />
      <q-btn flat dense no-caps color="primary" label="Back to Contacts" to="/contacts" />
    </div>

    <q-tabs
      v-if="canUpload"
      v-model="mode"
      dense
      no-caps
      align="left"
      active-color="primary"
      indicator-color="primary"
      class="q-mb-md"
    >
      <q-tab name="paste" label="Paste a note" :disable="phase !== 'idle'" />
      <q-tab name="file" label="Upload a file" :disable="phase !== 'idle'" />
    </q-tabs>

    <div v-if="mode === 'paste'" class="text-body2 text-grey-8 q-mb-md">
      Paste everything you typed — several people in one go is fine. Whatever
      you wrote about each person is kept with them.
    </div>
    <div v-else class="text-body2 text-grey-8 q-mb-md">
      Choose a CSV or Excel file. Each row becomes a contact, and any column we
      don't use is kept with that contact as a note.
    </div>

    <!-- Admin "View as": notes-submit files under the CALLER's own conference,
         so a note sent from here would land in the admin's, not the rep's. -->
    <q-banner v-if="previewing" dense class="bg-grey-2 text-grey-9 q-mb-md rounded-borders">
      {{ previewName }}'s page. Sending is off while you're viewing as someone.
    </q-banner>

    <q-banner v-if="!targetEventName" dense class="bg-orange-1 text-orange-9 q-mb-md rounded-borders">
      You're not linked to an event yet, so there's nowhere to file these.
      Choose one in Setup first.
    </q-banner>
    <div v-else class="text-caption text-grey-8 q-mb-md">
      Filing under <span class="text-weight-medium">{{ targetEventName }}</span>
    </div>

    <!-- The textarea stays on screen while extraction runs: a rep who
         spots a typo mid-run can see exactly what they sent, and nothing
         they typed is ever thrown away by a failure. -->
    <q-input
      v-if="mode === 'paste'"
      v-model="text"
      type="textarea"
      outlined
      autogrow
      input-style="min-height: 220px"
      :readonly="phase !== 'idle'"
      :placeholder="placeholder"
      counter
      :maxlength="maxChars"
    />

    <!-- Once a note is sent, the phone shows just the results: the tab bar
         already leads to Contacts, and the two buttons only pushed them down the
         screen. They stay on a laptop, where there is room (gt-xs hides the row
         below 600px; while idle the row holds Send and always shows). -->
    <div v-if="mode === 'paste' || phase !== 'idle'" class="row items-center q-gutter-sm q-mt-md" :class="{ 'gt-xs': phase !== 'idle' }">
      <q-btn
        v-if="phase === 'idle' && mode === 'paste'"
        color="primary"
        no-caps
        unelevated
        label="Send"
        class="notes-btn notes-send"
        icon-right="send"
        :loading="sending"
        :disable="!text.trim() || !targetEventName || previewing"
        @click="$emit('submit')"
      />
      <template v-else>
        <q-btn color="primary" no-caps unelevated :label="mode === 'file' ? 'Import another file' : 'Paste another note'" icon="add" class="notes-btn" @click="$emit('reset')" />
        <q-btn flat no-caps color="primary" label="Open Contacts" to="/contacts" class="notes-btn" />
      </template>
    </div>

    <!-- Upload: choosing a file starts the import at once (the page reads it, matches the
         columns itself and sends the rows). The only question it ever asks is which column
         holds the names, and only when it truly can't tell. -->
    <div v-if="mode === 'file' && phase === 'idle'">
      <div
        class="dropzone"
        :class="{ 'dropzone-over': dragging, 'dropzone-off': !targetEventName || previewing }"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        <q-icon name="upload_file" size="32px" color="grey-7" />
        <div class="q-mt-xs">Drop a CSV or Excel file here</div>
        <div class="text-caption text-grey-8 q-mb-sm">Up to {{ maxRows }} rows. Column names can be in any order.</div>
        <q-btn
          color="primary" no-caps unelevated label="Choose file" class="notes-btn"
          :disable="!targetEventName || previewing" @click="fileInput?.click()"
        />
        <input ref="fileInput" type="file" class="hidden-input" accept=".csv,.tsv,.txt,.xlsx" @change="onPick">
      </div>

      <q-banner v-if="fileError" dense class="bg-red-1 text-red-9 q-mt-md rounded-borders">{{ fileError }}</q-banner>

      <div v-if="nameChoices" class="q-mt-md">
        <div class="text-body2 q-mb-xs">
          {{ fileSummary?.fileName }}: we couldn't tell which column has the names. Which one is it?
        </div>
        <q-select
          :model-value="null" outlined dense emit-value map-options label="Name column" :options="nameChoices"
          @update:model-value="(v: number) => emit('pickName', v)"
        />
      </div>
    </div>

    <div v-if="mode === 'file' && fileSummary && phase !== 'idle'" class="text-caption text-grey-8 q-mt-md">
      <span class="text-weight-medium">{{ fileSummary.fileName }}</span>
      <div v-if="fileSummary.matched.length">Matched: {{ fileSummary.matched.join(', ') }}.</div>
      <div v-if="fileSummary.notes.length">Kept in notes: {{ fileSummary.notes.join(', ') }}.</div>
    </div>

    <!-- Running -->
    <div v-if="phase === 'working'" class="row items-center q-gutter-sm q-mt-lg text-grey-8">
      <q-spinner size="22px" color="primary" />
      <div v-if="mode === 'file'" class="text-body2">
        Adding your contacts. A big file can take a minute — stay on this page until it finishes.
      </div>
      <div v-else class="text-body2">
        Reading your note — this usually takes under a minute. You can leave
        this page; the contacts land in Contacts either way.
      </div>
    </div>

    <q-banner v-if="timedOut" dense class="bg-blue-1 text-blue-9 q-mt-md rounded-borders">
      Still working on it. Nothing is lost — check Contacts in a few minutes.
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
      <template v-if="mode === 'file'">No contacts were added from that file. Rows need a name to be added.</template>
      <template v-else>
        No contacts could be picked out of that note. If there are people in
        there, adding a name next to each one usually does it.
      </template>
    </q-banner>

    <div v-if="skipped.length" class="q-mt-md">
      <div class="text-subtitle2 q-mb-xs">Not added</div>
      <ul class="text-body2 text-grey-8 q-my-none skipped-list">
        <li v-for="(s, i) in skipped" :key="i">{{ s }}</li>
      </ul>
    </div>

    <q-banner v-if="submissionError" dense class="bg-red-1 text-red-9 q-mt-md rounded-borders">
      <div class="text-weight-medium">
        {{ mode === 'file' ? "That file couldn't be fully imported" : contacts.length ? "Some of that note couldn't be saved" : "That note couldn't be processed" }}
      </div>
      <div class="text-caption">{{ submissionError }}</div>
    </q-banner>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
// The page "Contacts from a note" (reached from Contacts' Import button), as pure
// display: the words, the box, the buttons and the results. NotesPage owns the
// request, the polling and the numbers; the onboarding tour draws this same body
// with sample contacts. The text is a v-model so the box still writes straight
// into the page's own ref.
export interface ExtractedContact {
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

const text = defineModel<string>('text', { required: true });
// Which way contacts come in. Only the Import page turns uploading on (canUpload); the
// onboarding tour draws this body without it and sees the paste box exactly as before.
const mode = defineModel<'paste' | 'file'>('mode', { default: 'paste' });
const fileInput = ref<HTMLInputElement | null>(null);
const dragging = ref(false);
const emit = defineEmits<{ submit: []; reset: []; file: [file: File]; pickName: [index: number] }>();

function onPick(e: Event) {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  // Cleared so choosing the same file again (after fixing it) fires change again.
  input.value = '';
  if (f) emit('file', f);
}
function onDrop(e: DragEvent) {
  dragging.value = false;
  if (props.previewing || !props.targetEventName) return;
  const f = e.dataTransfer?.files?.[0];
  if (f) emit('file', f);
}

const props = withDefaults(defineProps<{
  phase: 'idle' | 'working' | 'done';
  sending: boolean;
  timedOut: boolean;
  contacts: ExtractedContact[];
  skipped: string[];
  submissionError: string | null;
  previewing: boolean;
  previewName: string | null;
  targetEventName: string | null;
  placeholder: string;
  maxChars: number;
  canUpload?: boolean;
  maxRows?: number;
  fileSummary?: { fileName: string; matched: string[]; notes: string[] } | null;
  nameChoices?: { label: string; value: number }[] | null;
  fileError?: string | null;
}>(), { canUpload: false, maxRows: 500, fileSummary: null, nameChoices: null, fileError: null });
</script>

<style scoped>
/* Notes get pasted on a phone as often as a laptop — cap the line length so
   it stays readable on a wide screen without fighting the narrow one. */
.notes-column {
  max-width: 720px;
  margin: 0 auto;
}

/* Send is the page's one job; it was a small pill at the left edge of a phone. */
.notes-btn { min-height: 48px; }
.notes-send { min-width: 140px; }
@media (max-width: 599px) {
  /* q-gutter-sm adds an 8px left margin to each child, so a bare 100% overshoots. */
  .notes-send { flex: 1 0 calc(100% - 8px); }
}

.dropzone {
  border: 1.5px dashed #b0b0b0;
  border-radius: 12px;
  padding: 24px 16px;
  text-align: center;
}
.dropzone-over { border-color: var(--q-primary); background: #f3f8fd; }
.dropzone-off { opacity: 0.6; }
.hidden-input { display: none; }

.notes-excerpt {
  font-style: italic;
}

.skipped-list {
  padding-left: 20px;
}

.tag-chip {
  font-weight: 500;
}

.tone-orange {
  background: #fdeee3;
  color: #b35a00;
}
</style>

<template>
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

    <!-- Admin "View as": notes-submit files under the CALLER's own conference,
         so a note sent from here would land in the admin's, not the rep's. -->
    <q-banner v-if="previewing" dense class="bg-grey-2 text-grey-9 q-mb-md rounded-borders">
      {{ previewName }}'s page. Sending is off while you're viewing as someone.
    </q-banner>

    <q-banner v-if="!targetEventName" dense class="bg-orange-1 text-orange-9 q-mb-md rounded-borders">
      You're not linked to an event yet, so there's nowhere to file these.
      Link yourself to one on the Review page first.
    </q-banner>
    <div v-else class="text-caption text-grey-8 q-mb-md">
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
      :maxlength="maxChars"
    />

    <!-- Once a note is sent, the phone shows just the results: the tab bar
         already leads to Review, and the two buttons only pushed them down the
         screen. They stay on a laptop, where there is room (gt-xs hides the row
         below 600px; while idle the row holds Send and always shows). -->
    <div class="row items-center q-gutter-sm q-mt-md" :class="{ 'gt-xs': phase !== 'idle' }">
      <q-btn
        v-if="phase === 'idle'"
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
        <q-btn color="primary" no-caps unelevated label="Paste another note" icon="add" class="notes-btn" @click="$emit('reset')" />
        <q-btn flat no-caps color="primary" label="Open Review" to="/review" class="notes-btn" />
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
</template>

<script setup lang="ts">
// The page "Contacts from a note" (reached from Review's Import button), as pure
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
defineProps<{
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
}>();
defineEmits<{ submit: []; reset: [] }>();
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

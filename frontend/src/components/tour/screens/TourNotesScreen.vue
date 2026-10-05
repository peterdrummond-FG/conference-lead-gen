<template>
  <!-- NotesPage ("Contacts from a note", reached from Review's Import button),
       markup and styles copied for the tour. PROTOTYPE: for the build the page
       splits into a presentational part both render. -->
  <div class="q-pa-md tns">
    <div class="notes-column">
      <div class="row items-center q-mb-xs">
        <div class="text-h5">Contacts from a note</div>
        <q-space />
        <q-btn flat dense no-caps color="primary" label="Back to Review" />
      </div>
      <div class="text-body2 text-grey-8 q-mb-md">
        Paste everything you typed — several people in one go is fine. Whatever
        you wrote about each person is kept with them.
      </div>
      <div class="text-caption text-grey-8 q-mb-md">
        Filing under <span class="text-weight-medium">{{ TOUR_CONFERENCE }}</span>
      </div>

      <q-input :model-value="text" type="textarea" outlined autogrow input-style="min-height: 150px" readonly counter :maxlength="20000" data-tt="note-box" />

      <div class="row items-center q-gutter-sm q-mt-md" :class="{ 'gt-xs': phase !== 'idle' }">
        <q-btn
          v-if="phase === 'idle'"
          color="primary" no-caps unelevated label="Send" class="notes-btn notes-send" icon-right="send"
          :disable="!text.trim()" data-tt="note-send"
        />
        <template v-else>
          <q-btn color="primary" no-caps unelevated label="Paste another note" icon="add" class="notes-btn" />
          <q-btn flat no-caps color="primary" label="Open Review" class="notes-btn" />
        </template>
      </div>

      <div v-if="phase === 'working'" class="row items-center q-gutter-sm q-mt-lg text-grey-8">
        <q-spinner size="22px" color="primary" />
        <div class="text-body2">
          Reading your note — this usually takes under a minute. You can leave
          this page; the contacts land in Review either way.
        </div>
      </div>

      <div v-if="contacts.length" class="q-mt-lg" data-tt="note-results">
        <div class="text-subtitle1 q-mb-sm">
          {{ contacts.length }} contact{{ contacts.length === 1 ? '' : 's' }}
          {{ phase === 'working' ? 'so far' : 'added' }}
        </div>
        <TransitionGroup name="tns-pop">
          <q-card v-for="c in contacts" :key="c.name" flat bordered class="q-mb-sm">
            <q-card-section class="q-py-sm">
              <div class="text-weight-medium">{{ c.name }}</div>
              <div class="text-caption text-grey-8 q-mt-xs">{{ c.line }}</div>
              <div v-if="c.notes" class="text-caption text-grey-9 q-mt-xs notes-excerpt">"{{ c.notes }}"</div>
            </q-card-section>
          </q-card>
        </TransitionGroup>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { TOUR_CONFERENCE } from '../tourSampleData';

defineProps<{
  text: string;
  phase: 'idle' | 'working' | 'done';
  contacts: { name: string; line: string; notes?: string }[];
}>();
</script>

<style scoped>
.tns { height: 100%; overflow: hidden; }
/* From NotesPage.vue */
.notes-column { max-width: 720px; margin: 0 auto; }
.notes-btn { min-height: 48px; }
.notes-send { min-width: 140px; }
@media (max-width: 599px) {
  .notes-send { flex: 1 0 calc(100% - 8px); }
}
.notes-excerpt { font-style: italic; }
.tns-pop-enter-active { transition: transform 0.35s ease, opacity 0.35s ease; }
.tns-pop-enter-from { transform: translateY(10px); opacity: 0; }
</style>

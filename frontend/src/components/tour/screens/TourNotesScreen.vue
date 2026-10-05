<template>
  <!-- The page "Contacts from a note" (Review's Import button) inside the tour: the
       app's own NotesBody with a sample note and sample results. Nothing is sent. -->
  <div class="q-pa-md tns">
    <NotesBody
      v-model:text="note"
      :phase="phase" :sending="false" :timed-out="false" :contacts="shown" :skipped="[]"
      :submission-error="null" :previewing="false" preview-name="" :target-event-name="TOUR_CONFERENCE"
      :placeholder="PLACEHOLDER" :max-chars="20000"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import NotesBody, { type ExtractedContact } from '@/components/NotesBody.vue';
import { TOUR_CONFERENCE } from '../tourText.ts';

const props = defineProps<{
  text: string;
  phase: 'idle' | 'working' | 'done';
  contacts: { name: string; line: string; notes?: string }[];
}>();

// The note box is the page's own v-model; the scene sets `text` as it "pastes".
const note = computed({ get: () => props.text, set: () => undefined });
const PLACEHOLDER = '';

// The scene hands over one line per person ("Superintendent · Cedar ISD"); the page
// shows title, school and district, so split the line back out for it.
const shown = computed<ExtractedContact[]>(() => props.contacts.map((c, i) => {
  const [first = '', ...rest] = c.name.split(' ');
  const [title = null, org = null] = c.line.split(' · ');
  return {
    id: `tour-note-${i}`, firstName: first, lastName: rest.join(' '), title, email: null, phone: null,
    districtName: org, schoolName: null, interactionNotes: c.notes ?? null, extractionConfidence: null, isDuplicate: false,
  };
}));
</script>

<style scoped>
.tns { height: 100%; overflow: hidden; }
</style>

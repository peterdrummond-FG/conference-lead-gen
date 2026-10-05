<template>
  <!-- "Send us leads": everything a rep can text in (a card photo, a voice
       memo, one person typed out), then the other way in: Review's Import
       button, a pasted note, one lead per person. Whatever just arrived is
       still being matched against Zoho, so Review shows it processing. -->
  <TourMessages v-if="part === 'text'" :messages="messages" :draft="draft" />
  <TourAppShell v-else :manager="manager" :active="part === 'review' ? 'review' : ''">
    <TourReviewScreen v-if="part === 'review'" :manager="manager" :leads="leads" />
    <TourNotesScreen v-else :text="noteText" :phase="notePhase" :contacts="noteContacts" />
  </TourAppShell>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue';
import { useQuasar } from 'quasar';
import TourMessages from '../screens/TourMessages.vue';
import TourNotesScreen from '../screens/TourNotesScreen.vue';
import TourAppShell from '../TourAppShell.vue';
import TourReviewScreen from '../TourReviewScreen.vue';
import { tourLeads, SAMPLE_CARD, SMS_REPLIES, type TourText } from '../tourSampleData';
import type { TourRun } from '../useTourScript';

defineProps<{ manager: boolean }>();
const emit = defineEmits<{ size: [s: { w: number; h: number }] }>();
const $q = useQuasar();

const NOTE = `Priya Shah, superintendent at Cedar ISD, wants a call about spring PD
Tom Reyes counselor Pine Valley HS tom.reyes@pvisd.org
Ana Cruz from the keynote, AP at Westlake MS`;
const NOTE_RESULTS = [
  { name: 'Priya Shah', line: 'Superintendent · Cedar ISD', notes: 'Wants a call about spring PD.' },
  { name: 'Tom Reyes', line: 'Counselor · Pine Valley High School' },
  { name: 'Ana Cruz', line: 'Assistant Principal · Westlake Middle School', notes: 'Met at the keynote.' },
];

const part = ref<'text' | 'review' | 'notes'>('text');
const messages = ref<TourText[]>([]);
const draft = ref('');
// What is in Review at each point: Dana and Sam have just been texted in, so they
// are still being matched (it takes minutes), not Ready.
const textedLeads = () => tourLeads(['dana', 'sam'], { processing: ['dana', 'sam'] });
const allSentLeads = () => tourLeads(['dana', 'sam', 'priya', 'tom', 'ana'], { processing: ['dana', 'sam', 'priya', 'tom', 'ana'] });
const leads = ref(textedLeads());
const noteText = ref('');
const notePhase = ref<'idle' | 'working' | 'done'>('idle');
const noteContacts = ref<typeof NOTE_RESULTS>([]);

const phoneSize = { w: 375, h: 600 };
function appSize() { return $q.screen.lt.sm ? phoneSize : { w: 1280, h: 800 }; }

function reset() {
  part.value = 'text';
  messages.value = [];
  draft.value = '';
  leads.value = textedLeads();
  noteText.value = '';
  notePhase.value = 'idle';
  noteContacts.value = [];
  emit('size', phoneSize);
}

function say(m: Omit<TourText, 'id'>) {
  messages.value = [...messages.value.filter((x) => x.kind !== 'typing'), { ...m, id: `m${messages.value.length}-${Date.now()}` }];
}

async function reply(t: TourRun, text: string) {
  await t.wait(400);
  say({ from: 'them', kind: 'typing' });
  await t.wait(900);
  say({ from: 'them', kind: 'text', text });
}

async function run(t: TourRun) {
  // Texting: a card photo, a voice memo right after, one person typed out.
  await t.wait(600);
  await t.tap(t.find('.tm-compose .q-icon'), { press: true });
  say({ from: 'me', kind: 'card', card: SAMPLE_CARD });
  t.hideFinger();
  await reply(t, SMS_REPLIES.received(1));
  await t.wait(700);
  say({ from: 'me', kind: 'voice', text: '0:14' });
  await reply(t, SMS_REPLIES.received(1));
  await t.wait(700);
  await t.tap(t.find('.tm-field'), { press: true });
  for (const c of 'Sam Ortiz, AP Lakeview HS, sortiz@lakeviewisd.org') { draft.value += c; await t.wait(28); }
  await t.tap(t.find('[data-tt="send"]'), { press: true });
  say({ from: 'me', kind: 'text', text: draft.value });
  draft.value = '';
  t.hideFinger();
  await reply(t, SMS_REPLIES.noteLogged);
  await t.wait(1800);

  // The other way in: typed notes, from Review's Import button.
  part.value = 'review';
  emit('size', appSize());
  await nextTick();
  await t.wait(900);
  const importBtn = t.find('[data-tt="import"]');
  await t.ring(importBtn, 1200);
  await t.tap(importBtn, { press: true });
  part.value = 'notes';
  await nextTick();
  await t.wait(600);
  await t.tap(t.find('[data-tt="note-box"]'), { press: true });
  noteText.value = NOTE; // pasted, the way notes really arrive
  await t.wait(1200);
  await t.tap(t.find('[data-tt="note-send"]'), { press: true });
  t.hideFinger();
  notePhase.value = 'working';
  for (const [i, c] of NOTE_RESULTS.entries()) {
    await t.wait(900);
    noteContacts.value = [...noteContacts.value, c];
    if (i === 0) {
      await nextTick();
      await t.scrollTo(t.find('.tns'), t.find('[data-tt="note-results"]'), 8);
    }
  }
  notePhase.value = 'done';
  await t.wait(400);
  await t.ring(t.find('[data-tt="note-results"]'), 2200);

  // They land in Review, and are still being matched: that takes a few minutes.
  await t.tap(t.findText('Open Review'), { press: true });
  leads.value = allSentLeads();
  part.value = 'review';
  await nextTick();
  await t.wait(700);
  t.hideFinger();
  await t.ring(t.find('[data-tt="processing"]'), 2600);
}

defineExpose({ run, reset });
reset();
</script>

<template>
  <!-- "Text SETUP to start", from scratch: a brand-new rep isn't linked to
       anything yet, so this is the real conversation twilio-webhook has with
       them: SETUP, "what's the conference?", a partial name, the list of matches,
       a number, and the link confirmation. (A rep who already picked a conference
       in the app just gets a confirmation instead; the note says so.) Every reply
       is quoted from SMS_REPLIES in tourSampleData.ts. -->
  <TourMessages :messages="messages" :draft="draft" />
</template>

<script setup lang="ts">
import { ref } from 'vue';
import TourMessages from '../screens/TourMessages.vue';
import { SETUP_CANDIDATES, SMS_REPLIES, TOUR_CONFERENCE, type TourText } from '../tourSampleData';
import type { TourRun } from '../useTourScript';

defineProps<{ manager: boolean }>();
// Texting happens on a phone, so this scene is a phone screen on a laptop too.
// Taller than the other texting scenes: the thread has six messages and the last
// one is the one to read.
const emit = defineEmits<{ size: [s: { w: number; h: number }] }>();

const messages = ref<TourText[]>([]);
const draft = ref('');
let n = 0;

function reset() {
  messages.value = [];
  draft.value = '';
  n = 0;
  emit('size', { w: 375, h: 700 });
}

async function typeDraft(t: TourRun, text: string) {
  for (const c of text) {
    draft.value += c;
    await t.wait(c === ' ' ? 80 : 110);
  }
}

// The rep types into the compose box and sends, as a person would.
async function say(t: TourRun, text: string) {
  await t.tap(t.find('.tm-field'), { press: true });
  await typeDraft(t, text);
  await t.wait(300);
  await t.tap(t.find('[data-tt="send"]'), { press: true });
  messages.value = [...messages.value, { id: `m${++n}`, from: 'me', kind: 'text', text }];
  draft.value = '';
  t.hideFinger();
  await t.wait(500);
}

// Our number answers: a typing bubble, then the text.
async function reply(t: TourRun, text: string) {
  const typingId = `m${++n}`;
  messages.value = [...messages.value, { id: typingId, from: 'them', kind: 'typing' }];
  await t.wait(1200);
  messages.value = messages.value.filter((m) => m.id !== typingId);
  messages.value = [...messages.value, { id: `m${++n}`, from: 'them', kind: 'text', text }];
  await t.wait(700);
}

async function run(t: TourRun) {
  await t.wait(700);
  await say(t, 'SETUP');
  await reply(t, SMS_REPLIES.askName);
  await say(t, 'tassp summer');
  await reply(t, SMS_REPLIES.candidates(SETUP_CANDIDATES));
  await t.wait(800);
  await say(t, '1');
  await reply(t, SMS_REPLIES.linked(TOUR_CONFERENCE));
  await t.ring(t.findIncl("You're linked to", '.tm-bubble'), 3200);
}

defineExpose({ run, reset });
reset();
</script>

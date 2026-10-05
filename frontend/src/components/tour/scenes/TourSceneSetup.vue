<template>
  <!-- "Text SETUP to start": the rep texts the one word and gets the real reply
       for a rep whose conference is already chosen in the app (texting SETUP
       binds the phone to it; see twilio-webhook's linkedEventFromProfile). -->
  <TourMessages :messages="messages" :draft="draft" />
</template>

<script setup lang="ts">
import { ref } from 'vue';
import TourMessages from '../screens/TourMessages.vue';
import { SMS_REPLIES, TOUR_CONFERENCE, type TourText } from '../tourSampleData';
import type { TourRun } from '../useTourScript';

defineProps<{ manager: boolean }>();
// Texting happens on a phone, so this scene is a phone screen on a laptop too.
const emit = defineEmits<{ size: [s: { w: number; h: number }] }>();

const messages = ref<TourText[]>([]);
const draft = ref('');

function reset() {
  messages.value = [];
  draft.value = '';
  emit('size', { w: 375, h: 600 });
}

async function typeDraft(t: TourRun, text: string) {
  for (const c of text) {
    draft.value += c;
    await t.wait(120);
  }
}

async function run(t: TourRun) {
  await t.wait(700);
  await t.tap(t.find('.tm-field'), { press: true });
  await typeDraft(t, 'SETUP');
  await t.wait(300);
  await t.tap(t.find('[data-tt="send"]'), { press: true });
  messages.value = [{ id: 'm1', from: 'me', kind: 'text', text: 'SETUP' }];
  draft.value = '';
  t.hideFinger();
  await t.wait(500);
  messages.value = [...messages.value, { id: 'm2', from: 'them', kind: 'typing' }];
  await t.wait(1300);
  messages.value = [messages.value[0]!, { id: 'm3', from: 'them', kind: 'text', text: SMS_REPLIES.alreadySetUp(TOUR_CONFERENCE) }];
  await t.wait(600);
  await t.ring(t.findIncl("You're already set up", '.tm-bubble'), 3200);
}

defineExpose({ run, reset });
reset();
</script>

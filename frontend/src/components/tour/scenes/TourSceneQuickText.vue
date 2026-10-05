<template>
  <!-- The quick start's first screen: what a rep can text us, and what our
       number says back. The same texts as the tour's "Send us leads", without
       the Import half. -->
  <TourMessages :messages="messages" :draft="draft" />
</template>

<script setup lang="ts">
import { ref } from 'vue';
import TourMessages from '../screens/TourMessages.vue';
import { SAMPLE_CARD, SMS_REPLIES, type TourText } from '../tourSampleData';
import type { TourRun } from '../useTourScript';

defineProps<{ manager: boolean }>();
const emit = defineEmits<{ size: [s: { w: number; h: number }] }>();

const messages = ref<TourText[]>([]);
const draft = ref('');

function reset() {
  messages.value = [];
  draft.value = '';
  emit('size', { w: 375, h: 600 });
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
  await t.wait(1500);
}

defineExpose({ run, reset });
reset();
</script>

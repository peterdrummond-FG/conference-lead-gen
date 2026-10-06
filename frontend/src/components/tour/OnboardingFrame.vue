<template>
  <!-- The frame every onboarding screen sits in: full screen on a phone, a
       card over the dimmed app on a laptop. Progress along the top, the main
       area (an animation or a few words), the words, then the buttons. -->
  <div class="of" :class="[isPhone ? 'is-phone' : 'is-wide', { 'is-tall': tall, 'has-stage': stage }]">
    <div class="of-card">
      <div v-if="steps || back || skip" class="of-top">
        <q-btn v-if="back" flat round dense icon="arrow_back" color="grey-8" aria-label="Back" @click="$emit('back')" />
        <div class="of-segs" :aria-label="steps ? `Step ${current + 1} of ${steps}` : undefined">
          <i v-for="i in steps" :key="i"><b :style="{ width: segmentWidth(i - 1) }" /></i>
        </div>
        <q-btn v-if="skip" flat no-caps dense color="grey-8" :label="skip" class="of-skip" @click="$emit('skip')" />
      </div>
      <div class="of-main"><slot /></div>
      <div v-if="title" class="of-copy" aria-live="polite">
        <h2 class="of-title">{{ title }}</h2>
        <!-- eslint-disable-next-line vue/no-v-html -- only **bold** and {number}, from tourFlow.ts -->
        <p v-if="body" class="of-body" v-html="renderCopy(body)" />
        <!-- eslint-disable-next-line vue/no-v-html -- same -->
        <p v-if="note" class="of-note" v-html="renderCopy(note)" />
      </div>
      <div class="of-bottom"><slot name="actions" /></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useQuasar } from 'quasar';
import { renderCopy } from './tourFlow';

const props = withDefaults(defineProps<{
  steps?: number;
  current?: number;
  back?: boolean;
  skip?: string | undefined;
  title?: string | undefined;
  body?: string | undefined;
  note?: string | undefined;
  // The tour's card on a laptop is big, to fit a laptop-sized screen in it;
  // everything else is a narrow card.
  tall?: boolean;
  // A narrow card that still holds an animation (the quick start's first
  // screen), so it needs a height for the animation to fill.
  stage?: boolean;
  // How far through the CURRENT segment is (0 to 1), for a screen with an animation:
  // the segment fills as the scene plays, so the person can see when it's done
  // instead of tapping Next halfway. Finished steps are full, later ones empty. A
  // screen with nothing playing leaves it at 1, which is the old "current is full".
  fill?: number;
}>(), { steps: 0, current: 0, fill: 1 });
defineEmits<{ back: []; skip: [] }>();

const $q = useQuasar();
const isPhone = computed(() => $q.screen.lt.sm);

function segmentWidth(i: number): string {
  if (i < props.current) return '100%';
  if (i > props.current) return '0%';
  return `${Math.round(Math.min(1, Math.max(0, props.fill)) * 100)}%`;
}
</script>

<style scoped>
.of { position: absolute; inset: 0; display: flex; background: #fff; z-index: 6000; }
.of-card { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.of-top { display: flex; align-items: center; gap: 10px; padding: 10px 12px 8px 16px; min-height: 52px; }
.of-segs { flex: 1; display: flex; gap: 4px; }
.of-segs i { flex: 1; height: 4px; border-radius: 2px; background: #DDE4EB; overflow: hidden; }
.of-segs i b { display: block; height: 100%; width: 0; background: var(--q-primary); transition: width 0.12s linear; }
@media (prefers-reduced-motion: reduce) { .of-segs i b { transition: none; } }
.of-skip { min-height: 40px; padding: 0 8px; }
.of-main { flex: 1; min-height: 0; display: flex; flex-direction: column; margin: 0 10px; }
.of-copy { padding: 12px 18px 0; display: flex; flex-direction: column; gap: 6px; }
.of-title { margin: 0; font-size: 21px; font-weight: 700; line-height: 1.25; }
.of-body { margin: 0; font-size: 15px; line-height: 1.45; color: #1D2733; }
.of-note { margin: 0; font-size: 13px; line-height: 1.4; color: #5D6B7A; }
.of-bottom { display: flex; align-items: center; gap: 8px; padding: 10px 16px 14px; }
.of-bottom :deep(.q-btn) { min-height: 48px; font-size: 16px; padding: 0 18px; }

.of.is-wide { background: rgba(15, 25, 35, 0.55); align-items: center; justify-content: center; padding: 24px; }
.of.is-wide .of-card { flex: none; width: min(560px, 100%); max-height: 100%; background: #fff; border-radius: 18px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35); overflow: hidden; }
.of.is-wide.is-tall .of-card { width: min(1040px, 100%); height: min(780px, 100%); }
.of.is-wide.has-stage .of-card { height: min(760px, 100%); }
.of.is-wide .of-copy { padding: 16px 24px 0; }
.of.is-wide .of-bottom { padding: 14px 24px 20px; }
.of.is-wide .of-top { padding: 14px 16px 10px 24px; }
.of.is-wide .of-main { margin: 0 16px; }
</style>

<style>
/* Put on the Next button once the scene has played all the way through: one gentle
   pulse that says "that's the whole thing", never a loop. Global because the button
   belongs to whoever uses the frame (the tour, the quick start). Under reduced
   motion the bar still fills, and there is just no pulse. */
.of-pulse { animation: of-pulse 0.9s ease-out 1; }
@keyframes of-pulse {
  0% { transform: scale(1); box-shadow: 0 0 0 0 color-mix(in srgb, var(--q-primary) 50%, transparent); }
  40% { transform: scale(1.05); box-shadow: 0 0 0 7px color-mix(in srgb, var(--q-primary) 18%, transparent); }
  100% { transform: scale(1); box-shadow: 0 0 0 0 color-mix(in srgb, var(--q-primary) 0%, transparent); }
}
@media (prefers-reduced-motion: reduce) { .of-pulse { animation: none; } }
</style>

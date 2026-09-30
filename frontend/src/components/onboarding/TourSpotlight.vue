<template>
  <div class="ts-root">
    <!-- Catches every click so the page underneath can't be used mid-tour (a
         half-followed tour that navigates somewhere else is worse than none).
         Scrolling still passes through to the page. -->
    <div v-if="!openHole" class="ts-blocker" @click.stop.prevent />
    <!-- An interactive step ("Try it now") has to let the tap through to the very
         button it points at. A single full-screen blocker sat over it, so the
         button looked live and did nothing. Four panels around the hole block
         everything else and leave the hole itself clickable. -->
    <template v-else>
      <div class="ts-blocker-part" :style="{ top: 0, left: 0, right: 0, height: `${box!.top}px` }" @click.stop.prevent />
      <div class="ts-blocker-part" :style="{ top: `${box!.top + box!.height}px`, left: 0, right: 0, bottom: 0 }" @click.stop.prevent />
      <div class="ts-blocker-part" :style="{ top: `${box!.top}px`, left: 0, width: `${box!.left}px`, height: `${box!.height}px` }" @click.stop.prevent />
      <div class="ts-blocker-part" :style="{ top: `${box!.top}px`, left: `${box!.left + box!.width}px`, right: 0, height: `${box!.height}px` }" @click.stop.prevent />
    </template>

    <div v-if="box" class="ts-hole" :style="holeStyle" />
    <div v-else class="ts-dim" />

    <!-- No card while the page is still moving, so it never appears beside a
         spot the target is about to leave. A target that never turns up gets the
         card centred with a line saying so, instead of a stuck tour. -->
    <div
      v-if="state === 'ready' || state === 'missing'"
      ref="wrap"
      :key="step.id"
      class="ts-card"
      :style="cardStyle"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
      aria-describedby="tour-body"
    >
      <TourCard
        :step="step"
        :index="index"
        :total="total"
        :is-last="isLast"
        :fallback="state === 'missing' ? TOUR_FALLBACK_COPY[0] : undefined"
        @skip="$emit('skip')"
        @back="$emit('back')"
        @next="$emit('next')"
        @skip-to="(id: string) => $emit('skipTo', id)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import TourCard from '@/components/onboarding/TourCard.vue';
import { useTourTarget } from '@/composables/useTourTarget';
import { TOUR_FALLBACK_COPY, type TourStep } from '@/utils/onboardingTour';

const props = defineProps<{ step: TourStep; index: number; total: number; isLast: boolean }>();
defineEmits<{ skip: []; back: []; next: []; skipTo: [id: string] }>();

const $q = useQuasar();
const phone = computed(() => $q.screen.lt.sm);

const selector = computed(() => (props.step.target ? `[data-tour="${props.step.target}"]` : null));
const { box, state } = useTourTarget(selector);

// Only once the window is actually on screen; until then the whole page stays blocked.
const openHole = computed(() => !!props.step.interactive && !!box.value);

const holeStyle = computed(() => (box.value
  ? {
    top: `${box.value.top}px`,
    left: `${box.value.left}px`,
    width: `${box.value.width}px`,
    height: `${box.value.height}px`,
  }
  : {}));

// The card's own height and the screen's size, kept as state so placement is a
// plain computed: it re-runs whenever the window moves or the card grows.
const wrap = ref<HTMLElement | null>(null);
const cardH = ref(240);
const view = ref({ w: window.innerWidth, h: window.innerHeight });
let resizeObs: ResizeObserver | null = null;

function onResize() { view.value = { w: window.innerWidth, h: window.innerHeight }; }
onMounted(() => window.addEventListener('resize', onResize));
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize);
  resizeObs?.disconnect();
});
watch(wrap, (el) => {
  resizeObs?.disconnect();
  if (!el) return;
  cardH.value = el.offsetHeight;
  resizeObs = new ResizeObserver(() => { cardH.value = el.offsetHeight; });
  resizeObs.observe(el);
});

const M = 12;
const cardStyle = computed<Record<string, string>>(() => {
  const h = box.value;
  const { w: vw, h: vh } = view.value;

  if (phone.value) {
    // A docked sheet at the top or bottom, never floating over the thing it
    // describes. Bottom unless the target is down there too; and a target
    // taller than most of the screen keeps the bottom dock, since its top is
    // what the step is about.
    const tall = !!h && h.height > vh * 0.55;
    const low = !!h && h.top + h.height / 2 > vh * 0.55;
    if (h && low && !tall) {
      const headerBottom = document.querySelector('.q-header')?.getBoundingClientRect().bottom ?? 0;
      return { left: `${M}px`, right: `${M}px`, top: `${Math.max(headerBottom, 0) + M}px` };
    }
    return { left: `${M}px`, right: `${M}px`, bottom: `calc(${M}px + env(safe-area-inset-bottom))` };
  }

  const cw = Math.min(360, vw - M * 2);
  if (!h) return { left: '50%', top: '50%', width: `${cw}px`, transform: 'translate(-50%, -50%)' };

  const ch = cardH.value;
  const gap = 14;
  const clampX = (x: number) => Math.min(Math.max(x, M), vw - cw - M);
  const clampY = (y: number) => Math.min(Math.max(y, M), vh - ch - M);
  const centredX = clampX(h.left + h.width / 2 - cw / 2);
  const bottom = h.top + h.height;

  let left: number;
  let top: number;
  if (vh - bottom - gap >= ch + M) { left = centredX; top = bottom + gap; } // room below
  else if (h.top - gap >= ch + M) { left = centredX; top = h.top - gap - ch; } // room above
  else if (vw - (h.left + h.width) - gap >= cw + M) { left = h.left + h.width + gap; top = clampY(h.top); } // room to the right
  else if (h.left - gap >= cw + M) { left = h.left - gap - cw; top = clampY(h.top); } // room to the left
  else { left = vw - cw - M; top = vh - ch - M; } // nowhere clear: dock bottom-right
  return { left: `${left}px`, top: `${top}px`, width: `${cw}px` };
});
</script>

<style scoped>
.ts-root { position: fixed; inset: 0; }
.ts-blocker { position: fixed; inset: 0; }
.ts-blocker-part { position: fixed; }

/* The bright window is a transparent box with a huge shadow around it, so one
   element both cuts the hole and dims everything else. No transition on
   purpose: it follows its target every frame, and an animation would make it
   trail behind whenever the page moves. */
.ts-hole {
  position: fixed;
  border-radius: 12px;
  box-shadow: 0 0 0 100vmax rgba(15, 30, 50, 0.62);
  outline: 3px solid rgba(255, 255, 255, 0.9);
  pointer-events: none;
}
.ts-dim { position: fixed; inset: 0; background: rgba(15, 30, 50, 0.62); pointer-events: none; }

.ts-card {
  position: fixed;
  max-width: calc(100vw - 24px);
  max-height: calc(100dvh - 24px);
  overflow-y: auto;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.28);
}
</style>

<template>
  <teleport to="body">
    <div v-if="tour.phase === 'tour' && step" class="tour-root">
      <TourStage
        v-if="step.kind === 'illustrated'"
        :key="step.id"
        :step="step"
        :index="tour.stepIndex"
        :total="tour.total"
        :is-last="tour.isLast"
        @skip="tour.close()"
        @back="tour.back()"
        @next="onNext"
        @skip-to="(id: string) => tour.goTo(id)"
      />
      <TourSpotlight
        v-else
        :key="step.id"
        :step="step"
        :index="tour.stepIndex"
        :total="tour.total"
        :is-last="tour.isLast"
        @skip="tour.close()"
        @back="tour.back()"
        @next="onNext"
        @skip-to="(id: string) => tour.goTo(id)"
      />
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import TourSpotlight from '@/components/onboarding/TourSpotlight.vue';
import TourStage from '@/components/onboarding/TourStage.vue';
import { useSessionStore } from '@/stores/session-store';
import { useTourStore } from '@/stores/tour-store';

// The controller: which page to be on, what Esc and Tab do, and which kind of
// card to draw. Finding and following the thing a spotlight points at is
// useTourTarget's job; illustrated steps need none of it.
const tour = useTourStore();
const session = useSessionStore();
const route = useRoute();
const router = useRouter();

const step = computed(() => tour.currentStep);
const active = computed(() => tour.phase === 'tour');

// A new step, or the person pressing their browser's back button mid-tour, both
// mean "get us to the right page". Steps with no route stay where they are.
watch([() => tour.currentStep?.id, () => route.path], () => {
  const s = tour.currentStep;
  if (active.value && s?.route && route.path !== s.route) {
    router.push(s.route).catch(() => { /* the card still explains it */ });
  }
}, { immediate: true });

function onNext() {
  const wasLast = tour.isLast;
  tour.next();
  // Finishing sends someone who hasn't picked a conference yet to the one
  // place that fixes that; anyone already linked stays where they are.
  if (wasLast && !session.user?.currentEventId) void router.push('/setup');
}

function focusables(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.tour-root [data-tour-card] button:not([disabled])'));
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    tour.close();
    return;
  }
  if (e.key !== 'Tab') return;
  const items = focusables();
  if (!items.length) return;
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const activeEl = document.activeElement as HTMLElement | null;
  const inside = !!activeEl && items.includes(activeEl);
  if (!inside) {
    e.preventDefault();
    first.focus();
  } else if (e.shiftKey && activeEl === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && activeEl === last) {
    e.preventDefault();
    first.focus();
  }
}

watch(active, (on) => {
  if (on) document.addEventListener('keydown', onKeydown);
  else document.removeEventListener('keydown', onKeydown);
}, { immediate: true });
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));
</script>

<style scoped>
/* Above Quasar's toasts (9500): a toast that landed on the Next button would
   leave someone unable to move on, and the page behind is not usable mid-tour
   anyway. */
.tour-root { position: fixed; inset: 0; z-index: 9600; }
</style>

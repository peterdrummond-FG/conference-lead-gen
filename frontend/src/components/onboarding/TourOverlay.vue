<template>
  <teleport to="body">
    <div v-if="tour.phase === 'tour' && step" class="tour-root">
      <!-- Catches every click so the page underneath can't be used mid-tour
           (a half-followed tour that navigates somewhere else is worse than
           none). Scrolling still passes through to the page. -->
      <div class="tour-blocker" @click.stop.prevent />

      <div v-if="hole" class="tour-hole" :style="holeStyle" />
      <div v-else class="tour-dim" />

      <div
        v-if="!searching"
        ref="cardEl"
        :key="step.id"
        class="tour-card"
        :style="cardStyle"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
      >
        <div class="tour-count">Step {{ tour.stepIndex + 1 }} of {{ tour.total }}</div>
        <q-linear-progress :value="(tour.stepIndex + 1) / tour.total" rounded size="4px" color="primary" track-color="blue-1" class="q-mb-sm" />
        <div id="tour-title" class="tour-title" aria-live="polite">{{ step.title }}</div>
        <p id="tour-body" class="tour-body">{{ step.body }}</p>
        <p v-if="!hole" class="tour-fallback">{{ TOUR_FALLBACK_COPY[0] }}</p>

        <div class="tour-actions">
          <q-btn flat no-caps dense color="grey-8" label="Skip for now" class="tour-btn" @click="tour.close()" />
          <q-space />
          <q-btn v-if="tour.stepIndex > 0" flat no-caps color="primary" label="Back" class="tour-btn" @click="tour.back()" />
          <q-btn ref="nextBtn" unelevated no-caps color="primary" :label="tour.isLast ? 'Done' : 'Next'" class="tour-btn tour-next" @click="onNext" />
        </div>
      </div>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import { useTourStore } from '@/stores/tour-store';
import { useSessionStore } from '@/stores/session-store';
import { TOUR_FALLBACK_COPY } from '@/utils/onboardingTour';

interface Box { top: number; left: number; width: number; height: number }

const tour = useTourStore();
const session = useSessionStore();
const route = useRoute();
const router = useRouter();
const $q = useQuasar();

const step = computed(() => tour.currentStep);
const phone = computed(() => $q.screen.lt.sm);

const cardEl = ref<HTMLElement | null>(null);
const nextBtn = ref<{ $el: HTMLElement } | null>(null);
// True while we're getting to the right page and waiting for the thing to
// point at. The dim is shown but the card isn't, so it never flashes in the
// wrong place first.
const searching = ref(true);
const hole = ref<Box | null>(null);
const cardStyle = ref<Record<string, string>>({});
let targetEl: HTMLElement | null = null;
let resizeObs: ResizeObserver | null = null;
let attempt = 0;

const PAD = 6;
const holeStyle = computed(() => (hole.value
  ? {
    top: `${hole.value.top}px`,
    left: `${hole.value.left}px`,
    width: `${hole.value.width}px`,
    height: `${hole.value.height}px`,
  }
  : {}));

// Polls for the target rather than assuming it exists: the page may still be
// loading its chunk or its data when the step starts. Gives up after a few
// seconds so a missing target degrades to a plain centred card (e.g. Review's
// Classic layout has none of Smart's markers) instead of a stuck tour.
function waitFor(selector: string, timeoutMs: number, cancelled: () => boolean): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const tick = () => {
      if (cancelled()) return resolve(null);
      const el = document.querySelector<HTMLElement>(selector);
      const r = el?.getBoundingClientRect();
      if (el && r && r.width > 0 && r.height > 0) return resolve(el);
      if (performance.now() - t0 > timeoutMs) return resolve(null);
      setTimeout(tick, 100);
    };
    tick();
  });
}

function measure() {
  if (!targetEl || !document.contains(targetEl)) {
    hole.value = null;
    return;
  }
  const r = targetEl.getBoundingClientRect();
  hole.value = { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
}

// Puts the card beside the thing it's about without covering it, or, when
// there's no room (a tall card on a small screen, a target that fills the
// view), docks it to an edge and lets it overlap the least important part.
function layout() {
  const card = cardEl.value;
  if (!card) return;
  const m = 12;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const h = hole.value;

  if (phone.value) {
    const headerBottom = document.querySelector('.q-header')?.getBoundingClientRect().bottom ?? 0;
    const targetMid = h ? h.top + h.height / 2 : 0;
    // Dock at the bottom unless the target is down there too. A target taller
    // than most of the screen stays with the bottom dock: the top of it is
    // what the step is about, and it's scrolled to the top of the screen.
    const tall = !!h && h.height > vh * 0.55;
    const atTop = !!h && !tall && targetMid > vh * 0.55;
    cardStyle.value = atTop
      ? { left: `${m}px`, right: `${m}px`, top: `${Math.max(headerBottom, 0) + m}px` }
      : { left: `${m}px`, right: `${m}px`, bottom: `calc(${m}px + env(safe-area-inset-bottom))` };
    return;
  }

  const cw = Math.min(360, vw - m * 2);
  const ch = card.offsetHeight;
  if (!h) {
    cardStyle.value = { left: '50%', top: '50%', width: `${cw}px`, transform: 'translate(-50%, -50%)' };
    return;
  }

  const gap = 14;
  const clampX = (x: number) => Math.min(Math.max(x, m), vw - cw - m);
  const clampY = (y: number) => Math.min(Math.max(y, m), vh - ch - m);
  const centredX = clampX(h.left + h.width / 2 - cw / 2);
  const bottom = h.top + h.height;

  let left: number;
  let top: number;
  if (vh - bottom - gap >= ch + m) { // room below
    left = centredX; top = bottom + gap;
  } else if (h.top - gap >= ch + m) { // room above
    left = centredX; top = h.top - gap - ch;
  } else if (vw - (h.left + h.width) - gap >= cw + m) { // room to the right
    left = h.left + h.width + gap; top = clampY(h.top);
  } else if (h.left - gap >= cw + m) { // room to the left
    left = h.left - gap - cw; top = clampY(h.top);
  } else { // nowhere clear: dock bottom-right, over the target's lower edge
    left = vw - cw - m; top = vh - ch - m;
  }
  cardStyle.value = { left: `${left}px`, top: `${top}px`, width: `${cw}px` };
}

let raf = 0;
function refresh() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    measure();
    layout();
  });
}

// On a phone the card sits under the target, so bring it to the top of the
// screen; on a larger one, the middle leaves room on either side.
function bringIntoView(el: HTMLElement) {
  el.scrollIntoView({ block: phone.value ? 'start' : 'center', inline: 'nearest' });
}

async function locate() {
  const s = step.value;
  const mine = ++attempt;
  const cancelled = () => mine !== attempt;
  searching.value = true;
  hole.value = null;
  resizeObs?.disconnect();
  targetEl = null;
  if (!s) return;

  if (s.route && route.path !== s.route) {
    try { await router.push(s.route); } catch { /* fall through: the card still explains it */ }
  }
  const el = await waitFor(`[data-tour="${s.target}"]`, 3000, cancelled);
  if (cancelled()) return;

  targetEl = el;
  if (el) {
    bringIntoView(el);
    resizeObs = new ResizeObserver(refresh);
    resizeObs.observe(el);
    // A second pass once the page has settled. The first scroll can be undone
    // right after a route change (the router resets scroll to the top once it
    // finishes) or land before the page has grown to its full height, which
    // left a tall target half below the fold. Repeating it is harmless if the
    // first one stuck.
    setTimeout(() => {
      if (cancelled() || el !== targetEl) return;
      bringIntoView(el);
      refresh();
    }, 450);
  }
  measure();
  searching.value = false;
  await nextTick();
  layout();
  nextBtn.value?.$el?.focus?.({ preventScroll: true });
}

function onNext() {
  const wasLast = tour.isLast;
  tour.next();
  // Finishing sends someone who hasn't picked a conference yet to the one
  // place that fixes that; anyone already linked stays where they are.
  if (wasLast && !session.user?.currentEventId) void router.push('/setup');
}

function focusables(): HTMLElement[] {
  return Array.from(cardEl.value?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? []);
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
  const active = document.activeElement as HTMLElement | null;
  if (!cardEl.value?.contains(active)) {
    e.preventDefault();
    first.focus();
  } else if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

function attach() {
  window.addEventListener('resize', refresh);
  window.addEventListener('scroll', refresh, true);
  document.addEventListener('keydown', onKeydown);
}
function detach() {
  window.removeEventListener('resize', refresh);
  window.removeEventListener('scroll', refresh, true);
  document.removeEventListener('keydown', onKeydown);
  resizeObs?.disconnect();
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

const active = computed(() => tour.phase === 'tour');
watch(active, (on) => {
  if (on) attach();
  else detach();
}, { immediate: true });

// A new step, or the person pressing their browser's back button mid-tour, both
// mean "get us to the right page and find the thing again".
watch([() => tour.currentStep?.id, () => route.path], () => {
  if (active.value) void locate();
}, { immediate: true });

onBeforeUnmount(detach);
</script>

<style scoped>
.tour-root { position: fixed; inset: 0; z-index: 6100; }
.tour-blocker { position: fixed; inset: 0; }

/* The bright window is a transparent box with a huge shadow around it, so one
   element both cuts the hole and dims everything else. */
.tour-hole {
  position: fixed;
  border-radius: 12px;
  box-shadow: 0 0 0 100vmax rgba(15, 30, 50, 0.62);
  outline: 3px solid rgba(255, 255, 255, 0.9);
  pointer-events: none;
  transition: top 0.25s ease, left 0.25s ease, width 0.25s ease, height 0.25s ease;
}
.tour-dim { position: fixed; inset: 0; background: rgba(15, 30, 50, 0.62); pointer-events: none; }

.tour-card {
  position: fixed;
  max-width: calc(100vw - 24px);
  padding: 16px 16px 12px;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.28);
}
.tour-count { margin-bottom: 6px; font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: #5B6670; }
.tour-title { font-size: 19px; font-weight: 600; line-height: 1.25; }
.tour-body { margin: 6px 0 0; font-size: 15px; line-height: 1.5; color: #2F3A44; }
.tour-fallback { margin: 8px 0 0; font-size: 13px; color: #5B6670; font-style: italic; }
.tour-actions { display: flex; align-items: center; gap: 4px; margin-top: 14px; }
.tour-btn { min-height: 44px; }
.tour-next { padding: 0 20px; }

@media (prefers-reduced-motion: reduce) {
  .tour-hole { transition: none; }
}
</style>

<template>
  <!-- The three welcome screens. Skipping is available on every one of them
       and always says "Skip for now": nothing here is a test, and nobody
       should feel trapped in it. -->
  <q-dialog
    :model-value="tour.phase === 'splash'"
    maximized
    persistent
    no-esc-dismiss
    transition-show="fade"
    transition-hide="fade"
  >
    <q-card class="splash" role="region" aria-label="Welcome" @keydown.esc="skip">
      <div class="splash-top">
        <q-btn flat no-caps color="grey-8" label="Skip for now" class="splash-skip" @click="skip" />
      </div>

      <q-carousel
        v-model="slide"
        class="splash-carousel"
        height="min(440px, 62vh)"
        swipeable
        :animated="!reducedMotion"
        transition-prev="slide-right"
        transition-next="slide-left"
      >
        <q-carousel-slide v-for="s in slides" :key="s.id" :name="s.id" class="splash-slide">
          <div class="splash-icon"><q-icon :name="s.icon" size="44px" color="primary" /></div>
          <h1 class="splash-title">{{ s.title }}</h1>
          <p class="splash-body">{{ s.body }}</p>

          <ol v-if="s.stops" class="splash-stops">
            <li v-for="(stop, i) in s.stops" :key="stop.label" class="splash-stop">
              <q-avatar size="28px" color="primary" text-color="white" class="splash-stop-num">{{ i + 1 }}</q-avatar>
              <q-icon :name="stop.icon" size="22px" color="primary" />
              <span>{{ stop.label }}</span>
            </li>
          </ol>
        </q-carousel-slide>
      </q-carousel>

      <div class="splash-dots" role="presentation">
        <span v-for="(s, i) in slides" :key="s.id" class="splash-dot" :class="{ 'is-on': i === index }" />
      </div>
      <div class="sr-only" aria-live="polite">Screen {{ index + 1 }} of {{ slides.length }}: {{ slides[index]?.title }}</div>

      <div class="splash-actions">
        <q-btn v-if="index > 0" flat no-caps color="primary" icon="arrow_back" label="Back" @click="go(-1)" />
        <q-space />
        <q-btn
          unelevated
          no-caps
          color="primary"
          size="lg"
          class="splash-next"
          :label="isLast ? 'Show me around' : 'Next'"
          :icon-right="isLast ? 'arrow_forward' : undefined"
          @click="isLast ? tour.beginTour() : go(1)"
        />
      </div>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useTourStore } from '@/stores/tour-store';
import { useSessionStore } from '@/stores/session-store';
import { splashSlides } from '@/utils/onboardingTour';

const tour = useTourStore();
const session = useSessionStore();

const slides = computed(() => splashSlides(tour.role ?? session.user?.role ?? 'sales'));
const slide = ref<string>('welcome');
const index = computed(() => Math.max(slides.value.findIndex((s) => s.id === slide.value), 0));
const isLast = computed(() => index.value === slides.value.length - 1);

// People who ask their device to cut down on motion get the slides without
// the sliding animation.
const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Every time the welcome opens (first login or a replay) it starts at the top.
watch(() => tour.phase, (phase) => {
  if (phase === 'splash') slide.value = 'welcome';
});

function go(delta: number) {
  const next = slides.value[index.value + delta];
  if (next) slide.value = next.id;
}

function skip() {
  tour.close();
}
</script>

<style scoped>
.splash {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: none;
  padding: 8px 16px calc(16px + env(safe-area-inset-bottom));
  border: 0;
  border-radius: 0;
  background: linear-gradient(180deg, #EAF3FA 0%, #FFFFFF 46%);
}
.splash-top { display: flex; justify-content: flex-end; min-height: 48px; }
.splash-skip { min-height: 44px; }

.splash-carousel { background: transparent; width: 100%; max-width: 520px; margin: 0 auto; }
.splash-slide { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 8px 12px; }
.splash-icon {
  display: grid;
  place-items: center;
  width: 88px;
  height: 88px;
  margin-top: 8px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2px 10px rgba(0, 103, 172, 0.16);
}
.splash-title { margin: 20px 0 8px; font-size: 28px; font-weight: 600; line-height: 1.2; }
.splash-body { margin: 0; max-width: 420px; font-size: 17px; line-height: 1.5; color: #3F4A54; }

.splash-stops { list-style: none; margin: 20px 0 0; padding: 0; width: 100%; max-width: 320px; }
.splash-stop {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  padding: 8px 12px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  font-size: 16px;
  font-weight: 500;
  text-align: left;
}

.splash-dots { display: flex; justify-content: center; gap: 8px; margin: 4px 0 12px; }
.splash-dot { width: 8px; height: 8px; border-radius: 50%; background: #C5D3DF; transition: width 0.2s, background 0.2s; }
.splash-dot.is-on { width: 24px; border-radius: 4px; background: var(--q-primary); }

.splash-actions { display: flex; align-items: center; width: 100%; max-width: 520px; margin: 0 auto; }
.splash-next { min-height: 48px; padding: 0 24px; }

.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

@media (prefers-reduced-motion: reduce) {
  .splash-dot { transition: none; }
}
</style>

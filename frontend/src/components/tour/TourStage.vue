<template>
  <!-- The framed, dark "you're watching" area: a scene playing on a scaled
       screen, on a loop, with a pause button. Nothing in it responds to a tap. -->
  <div class="ts">
    <span class="ts-watch"><q-icon name="visibility" size="16px" /> WATCH</span>
    <q-btn
      flat round dense color="white" class="ts-pause"
      :icon="paused ? 'play_arrow' : 'pause'"
      :aria-label="paused ? 'Play' : 'Pause'"
      @click="paused = !paused"
    />
    <div class="ts-device-wrap">
      <TourDevice :key="String(isPhone)" ref="device" :width="size.w" :height="size.h">
        <component :is="scene" ref="sceneRef" :manager="manager" v-bind="importOnly ? { importOnly: true } : {}" @size="(s: { w: number; h: number }) => (sceneSize = s)" />
      </TourDevice>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, provide, watch, nextTick, onMounted, onBeforeUnmount, type Component } from 'vue';
import { TOUR_ROLE } from './tourRole';
import type { Role } from '@/types/review';
import { useQuasar } from 'quasar';
import TourDevice from './TourDevice.vue';
import { createRun, TourCancelled, type TourDeviceApi, type TourRun } from './useTourScript';

// importOnly: the version of "Send us leads" that starts at Import (see tourCopy.ts).
// Bound only when true, so a scene that has no such prop never receives the attribute.
const props = defineProps<{ scene: Component; manager: boolean; role?: Role; importOnly?: boolean }>();
// The scenes' header is the app's own AppHeader, which differs by role (an admin has
// View as, Solutions Success shows a name), so the role goes down by provide/inject:
// a prop on every scene would land as an attribute on whatever element each one renders.
provide(TOUR_ROLE, computed(() => props.role ?? (props.manager ? 'solutionsSuccess' : 'sales')));

const $q = useQuasar();
const isPhone = computed(() => $q.screen.lt.sm);
const paused = ref(false);
// The screen a scene is showing: the app at this device's size unless the
// scene says otherwise (texting is always on a phone).
const sceneSize = ref<{ w: number; h: number } | null>(null);
const size = computed(() => sceneSize.value ?? (isPhone.value ? { w: 375, h: 600 } : { w: 1280, h: 800 }));

const device = ref<TourDeviceApi | null>(null);
const sceneRef = ref<{ run: (t: TourRun) => Promise<void>; reset: () => void } | null>(null);

// The scene loops until the person moves on. Leaving (or the layout flipping
// between phone and laptop) bumps the token, and the old script stops at its
// next await (TourCancelled) instead of driving a screen that has gone.
let token = 0;
// Development only: /tour-preview?fast plays every script with its waits cut to
// ~10 ms, and each completed run adds one to <html data-tour-cycles>. A script
// that can't find what it points at logs an error and stops instead, so
// "cycles went up and the console is clean" means the scene played to the end.
const FAST = import.meta.env.DEV && new URLSearchParams(window.location.search).has('fast');
async function play() {
  const mine = ++token;
  await nextTick();
  const alive = () => mine === token && !!device.value && !!sceneRef.value;
  while (alive()) {
    const run = createRun(device.value!, { paused: () => paused.value, alive, fast: FAST });
    try {
      sceneRef.value!.reset();
      run.hideFinger();
      await nextTick();
      await sceneRef.value!.run(run);
      if (FAST) document.documentElement.dataset.tourCycles = String(Number(document.documentElement.dataset.tourCycles ?? 0) + 1);
      await run.wait(2500);
    } catch (e) {
      if (e instanceof TourCancelled) return;
      // A scene that can't find what it points at is broken: stop and say so
      // rather than loop on an error. The tour's tests run every scene for
      // exactly this reason.
      console.error(e);
      return;
    }
  }
}

watch(isPhone, () => { sceneSize.value = null; void play(); });
onMounted(() => void play());
onBeforeUnmount(() => { token++; });
</script>

<style scoped>
.ts { position: relative; flex: 1; min-height: 0; border-radius: 18px; background: #0F2236; }
.ts-device-wrap { position: absolute; left: 8px; right: 8px; top: 30px; bottom: 8px; }
.ts-watch { position: absolute; left: 12px; top: 8px; z-index: 2; display: inline-flex; align-items: center; gap: 4px; color: #CFE3F5; font-size: 12px; font-weight: 600; letter-spacing: 0.06em; }
.ts-pause { position: absolute; right: 6px; top: 2px; z-index: 2; }
</style>

<style>
/* Applied by the tour script to whatever it wants the rep to look at. Global
   because the element belongs to an app component, not to the tour. */
.tour-ring { outline: 3px solid #FFB300; outline-offset: 3px; border-radius: 8px; animation: tour-ring 0.7s ease-in-out infinite alternate; }
@keyframes tour-ring { from { outline-color: #FFB300; } to { outline-color: rgba(255, 179, 0, 0.35); } }
@media (prefers-reduced-motion: reduce) { .tour-ring { animation: none; } }
</style>

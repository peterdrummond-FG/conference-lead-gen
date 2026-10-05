<template>
  <!-- A screen drawn at its real size (375 wide on a phone, 1280 on a laptop)
       and scaled down to fit the stage, so the app's own components lay out
       exactly as they do in the app and the rep sees the whole page at once.
       Nothing inside can be tapped: the tour is something you watch. The
       script drives it with el.click(), which pointer-events doesn't block. -->
  <div ref="outer" class="td-outer">
    <div class="td-box" :style="{ width: `${width * scale}px`, height: `${height * scale}px` }">
      <div
        ref="screen"
        class="td-screen"
        :style="{ width: `${width}px`, height: `${height}px`, transform: `scale(${scale})` }"
        aria-hidden="true"
      >
        <slot />
        <div
          class="td-finger"
          :class="{ 'is-on': finger.visible, 'is-tap': finger.tapping }"
          :style="{ transform: `translate(${finger.x - 18}px, ${finger.y - 18}px)` }"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import type { TourDeviceApi } from './useTourScript';

const props = defineProps<{ width: number; height: number }>();

const outer = ref<HTMLElement | null>(null);
const screen = ref<HTMLElement | null>(null);
const scale = ref(1);
const finger = reactive({ x: props.width / 2, y: props.height * 0.75, visible: false, tapping: false });

let ro: ResizeObserver | null = null;
function measure() {
  const el = outer.value;
  if (!el) return;
  const s = Math.min(el.clientWidth / props.width, el.clientHeight / props.height);
  scale.value = s > 0 ? s : 1;
}
onMounted(() => {
  measure();
  ro = new ResizeObserver(measure);
  if (outer.value) ro.observe(outer.value);
});
onBeforeUnmount(() => ro?.disconnect());
// A scene can switch screens mid-way (the rep's phone, then the app on a
// laptop), so the size can change while it plays.
watch(() => [props.width, props.height], () => void nextTick(measure));

const api: TourDeviceApi = {
  root: () => screen.value,
  scale: () => scale.value,
  finger,
};
defineExpose(api);
</script>

<style scoped>
.td-outer { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
.td-box { position: relative; overflow: hidden; border-radius: 14px; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35); background: #fff; flex: none; }
.td-screen { position: absolute; left: 0; top: 0; transform-origin: 0 0; overflow: hidden; pointer-events: none; user-select: none; background: #F5F7FA; }

.td-finger {
  position: absolute;
  left: 0;
  top: 0;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(255, 179, 0, 0.35);
  border: 3px solid #FFB300;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
  opacity: 0;
  z-index: 9000;
  transition: transform 0.6s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s;
}
.td-finger.is-on { opacity: 1; }
.td-finger::after {
  content: '';
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  border: 3px solid #FFB300;
  opacity: 0;
}
.td-finger.is-tap { background: rgba(255, 179, 0, 0.7); }
.td-finger.is-tap::after { animation: td-ripple 0.5s ease-out; }
@keyframes td-ripple {
  from { transform: scale(1); opacity: 0.9; }
  to { transform: scale(2.2); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .td-finger { transition: opacity 0.25s; }
  .td-finger.is-tap::after { animation: none; }
}
</style>

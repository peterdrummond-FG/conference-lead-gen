<template>
  <!-- sm: just the round play button, for the thin phone card. lg: the button, a
       scrubber and the clock, for the laptop pane. A memo whose recording has been
       purged (90 days) draws a plain mic in the same circle: nothing to press. -->
  <div class="mp" :class="`mp-${size}`">
    <button
      v-if="hasAudio"
      type="button"
      class="mp-btn"
      :aria-label="playing ? 'Pause voice memo' : 'Play voice memo'"
      :disabled="loading"
      @click="toggle"
    >
      <q-spinner v-if="loading" size="20px" color="amber-10" />
      <q-icon v-else :name="playing ? 'pause' : 'play_arrow'" :size="size === 'lg' ? '28px' : '22px'" />
    </button>
    <span v-else class="mp-btn mp-none" role="img" aria-label="Recording no longer available" title="The recording was deleted after 90 days. The transcript is kept.">
      <q-icon name="mic_off" :size="size === 'lg' ? '24px' : '20px'" />
    </span>

    <template v-if="size === 'lg' && hasAudio">
      <q-slider
        :model-value="time"
        :min="0"
        :max="duration || 1"
        :step="0.1"
        :disable="!duration"
        color="primary"
        class="mp-slider"
        aria-label="Playback position"
        @update:model-value="(v: number | null) => v !== null && seek(v)"
      />
      <span class="mp-time">{{ clock(time) }}<template v-if="duration"> / {{ clock(duration) }}</template></span>
    </template>
    <span v-if="failed" class="mp-fail" role="status">Couldn't play this recording.</span>
  </div>
</template>

<script setup lang="ts">
import { useMemoAudio } from '@/composables/useMemoAudio';
import { clock } from '@/utils/voiceMemos';

const props = defineProps<{ size: 'sm' | 'lg'; hasAudio: boolean; getUrl: () => Promise<string> }>();
const { playing, loading, failed, time, duration, toggle, seek } = useMemoAudio(() => props.getUrl());
</script>

<style scoped>
.mp { display: flex; align-items: center; gap: 10px; min-width: 0; }
.mp-btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 50%;
  background: #FFE0B2;
  color: #8A4B00;
  cursor: pointer;
}
.mp-lg .mp-btn { width: 48px; height: 48px; background: #E3F1FA; color: #0067AC; }
.mp-btn:focus-visible { outline: 2px solid #0067AC; outline-offset: 2px; }
.mp-btn:disabled { cursor: progress; }
.mp-none { cursor: default; background: #EEF0F2; color: #6B7680; }
.mp-slider { flex: 1; min-width: 0; }
.mp-time { flex: none; font-size: 12px; color: #5B6670; font-variant-numeric: tabular-nums; white-space: nowrap; }
.mp-fail { font-size: 12px; color: #B23B3B; }
</style>

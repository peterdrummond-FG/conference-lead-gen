<template>
  <span class="lc" :class="`lc-${tone}`"><slot /></span>
</template>

<script setup lang="ts">
import type { Tone } from '@/utils/reviewSmart';

defineProps<{ tone: Tone }>();
</script>

<style scoped>
/* Soft pastel tags (light fill, dark text of the same hue) — the same
   palette Classic's chips use, so both views read as one app. Text is always
   the dark stop: never colour alone, always a word. */
.lc {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
  white-space: nowrap;
}
.lc-red { background: #FBEAEA; color: #B23B3B; }
.lc-orange { background: #FDEEE3; color: #9A4D00; }
.lc-blue { background: #E3F1FA; color: #0067AC; }
.lc-green { background: #E6F4EA; color: #1E7E34; }
.lc-grey { background: #EEF0F2; color: #4A555F; }
</style>

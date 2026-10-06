<template>
  <span class="lc" :class="`lc-${tone}`"><span class="lc-text"><slot /></span></span>
</template>

<script setup lang="ts">
import type { Tone } from '@/utils/contactsList';

defineProps<{ tone: Tone }>();
</script>

<style scoped>
/* Soft pastel tags (light fill, dark text of the same hue) — the same
   palette Classic's chips use, so both views read as one app. Text is always
   the dark stop: never colour alone, always a word. */
.lc {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
  white-space: nowrap;
  /* A long value (a 50-character conference name) truncates instead of
     pushing the page wider than a phone. */
  max-width: 100%;
  min-width: 0;
}
.lc-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lc-text :deep(.q-icon) { vertical-align: -3px; margin-right: 4px; }
.lc-red { background: #FBEAEA; color: #B23B3B; }
.lc-orange { background: #FDEEE3; color: #9A4D00; }
.lc-blue { background: #E3F1FA; color: #0067AC; }
.lc-green { background: #E6F4EA; color: #1E7E34; }
.lc-grey { background: #EEF0F2; color: #4A555F; }
</style>

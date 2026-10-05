<template>
  <!-- The rep's QR dialog (the header's QR icon) drawn inside the tour's screen. It
       is the app's own RepQrContent; only the scrim and the box around it are the
       tour's, because Quasar's q-dialog would open over the real page instead of
       inside the tour. Full screen on a phone and a card on a laptop, as in the app. -->
  <div class="tqo-scrim" :class="{ 'is-on': open }">
    <div class="tqo-box" :class="{ 'is-phone': isPhone }">
      <RepQrContent
        :rep="{ name: 'Sample', repSlug: 'tour-sample' }"
        :event-name="noConference ? null : TOUR_CONFERENCE"
        active embedded :maximized="isPhone"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useQuasar } from 'quasar';
import RepQrContent from '@/components/RepQrContent.vue';
import { TOUR_CONFERENCE } from '../tourText.ts';

// noConference: the footer the rep sees when no conference is chosen, where a scan
// waits for Solutions Success. The slug is made up, so a scan of the screen goes
// nowhere real.
defineProps<{ open: boolean; noConference?: boolean }>();
const $q = useQuasar();
const isPhone = computed(() => $q.screen.lt.sm);
</script>

<style scoped>
.tqo-scrim { position: absolute; inset: 0; z-index: 40; background: rgba(0, 0, 0, 0.5); display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.3s; pointer-events: none; }
.tqo-scrim.is-on { opacity: 1; }
.tqo-box { width: 440px; height: 92%; }
.tqo-box.is-phone { width: 100%; height: 100%; }
</style>

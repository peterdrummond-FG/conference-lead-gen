<template>
  <!-- RepQrDialog (the header's QR icon) drawn inside the tour's screen: same
       markup and styles, same artwork from renderPhoneQrCode, full screen on a
       phone and a card on a laptop. Quasar's q-dialog would open over the real
       page instead of inside the tour, which is why this isn't the component
       itself. -->
  <div class="tqo-scrim" :class="{ 'is-on': open }">
    <div class="rq" :class="{ 'rq-max': isPhone }">
      <q-btn flat round dense icon="close" color="white" class="rq-close" />
      <div class="rq-stage">
        <q-spinner v-if="!src" color="white" size="40px" />
        <img v-else :src="src" class="rq-img" alt="" />
      </div>
      <!-- RepQrDialog's footer, both states. With no conference the scan is held for
           Solutions Success to file instead of failing, and the footer says so. -->
      <div class="rq-foot" :class="{ 'is-warn': noConference }" data-tt="qr-foot">
        <template v-if="!noConference">Scans go to <strong>{{ TOUR_CONFERENCE }}</strong></template>
        <template v-else>You're not at a conference, so scans wait for Solutions Success to file them.</template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useQuasar } from 'quasar';
import { intakeUrlForRep, renderPhoneQrCode } from '@/utils/generateConnectSlide';
import { TOUR_CONFERENCE } from '../tourSampleData';

defineProps<{ open: boolean; noConference?: boolean }>();
const $q = useQuasar();
const isPhone = computed(() => $q.screen.lt.sm);
const src = ref<string | null>(null);

// A blob: URL, as RepQrDialog does: the production CSP refuses data: images.
// The slug is made up, so a scan of the screen goes nowhere real.
onMounted(async () => {
  const canvas = await renderPhoneQrCode({ intakeUrl: intakeUrlForRep('tour-sample'), repName: 'Sample' });
  canvas.toBlob((b) => { if (b) src.value = URL.createObjectURL(b); }, 'image/png');
});
onBeforeUnmount(() => { if (src.value) URL.revokeObjectURL(src.value); });
</script>

<style scoped>
.tqo-scrim { position: absolute; inset: 0; z-index: 40; background: rgba(0, 0, 0, 0.5); display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.3s; }
.tqo-scrim.is-on { opacity: 1; }
/* From RepQrDialog.vue, with the viewport units swapped for the tour's screen. */
.rq { background: #215091; color: #fff; display: flex; flex-direction: column; align-items: center; width: 440px; height: 92%; position: relative; border-radius: 4px; }
.rq.rq-max { width: 100%; max-height: none; height: 100%; border-radius: 0; }
.rq-close { position: absolute; top: 8px; right: 8px; z-index: 1; min-width: 44px; min-height: 44px; background: rgba(0, 0, 0, 0.25); }
.rq-stage { flex: 1; min-height: 0; width: 100%; display: flex; align-items: center; justify-content: center; padding: 8px; }
.rq-img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
.rq-foot { flex: none; padding: 8px 16px 14px; text-align: center; font-size: 14px; }
.rq-foot.is-warn { color: #FFD9A0; }
</style>

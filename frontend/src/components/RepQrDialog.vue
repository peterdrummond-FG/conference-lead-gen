<template>
  <!-- The rep's own QR, big, in a couple of taps from anywhere in the app: the
       header's QR button opens this. It is the same 9:16 "phone screen" artwork
       Setup offers to save (renderPhoneQrCode), drawn on screen instead of
       downloaded, so what someone scans is exactly what a rep would otherwise
       have had to go to Setup, save, and open from Photos to show. Full screen on
       a phone so the code is as large as it can be. -->
  <q-dialog :model-value="modelValue" :maximized="maximized" @update:model-value="(v: boolean) => $emit('update:modelValue', v)">
    <q-card class="rq" :class="{ 'rq-max': maximized }">
      <q-btn v-close-popup flat round dense icon="close" color="white" class="rq-close" aria-label="Close QR code" />
      <div class="rq-stage">
        <q-spinner v-if="!src && !failed" color="white" size="40px" />
        <img
          v-else-if="src"
          :src="src"
          class="rq-img"
          alt="QR code for your sign-up form. People scan it with their phone camera."
        />
        <div v-else class="rq-fail" role="alert">Couldn't draw the QR code. Close this and try again.</div>
      </div>
      <!-- Says where a scan goes right now, and is honest when nothing is chosen:
           contacts-create answers 409 for a rep with no conference. -->
      <div class="rq-foot" :class="{ 'is-warn': !eventName }" role="status">
        <template v-if="eventName">Scans go to <strong>{{ eventName }}</strong></template>
        <template v-else>Choose a conference in Setup first. Scans won't go through until you do.</template>
      </div>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useQuasar } from 'quasar';
import { intakeUrlForRep, renderPhoneQrCode } from '@/utils/generateConnectSlide';
import { cleanConferenceName } from '@/utils/conferenceName';

const props = defineProps<{
  modelValue: boolean;
  rep: { name: string; repSlug: string };
  // The conference a scan lands in right now; null when the rep has none chosen.
  eventName: string | null;
}>();
defineEmits<{ 'update:modelValue': [value: boolean] }>();

const $q = useQuasar();
const maximized = computed(() => $q.screen.lt.sm);
const eventName = computed(() => (props.eventName ? cleanConferenceName(props.eventName) : null));

const src = ref<string | null>(null);
const failed = ref(false);
// The code only changes with the slug, so drawing it again on every open (or
// every re-render of the header) would just be wasted canvas work.
let drawnFor = '';

async function draw() {
  const slug = props.rep.repSlug;
  if (drawnFor === slug && src.value) return;
  src.value = null;
  failed.value = false;
  try {
    const canvas = await renderPhoneQrCode({ intakeUrl: intakeUrlForRep(slug), repName: props.rep.name });
    if (props.rep.repSlug !== slug) return; // the previewed rep changed while drawing
    src.value = canvas.toDataURL('image/png');
    drawnFor = slug;
  } catch {
    failed.value = true;
  }
}

watch(() => [props.modelValue, props.rep.repSlug] as const, ([open]) => { if (open) void draw(); }, { immediate: true });
</script>

<style scoped>
.rq { background: #215091; color: #fff; display: flex; flex-direction: column; align-items: center; width: min(92vw, 440px); max-height: 92vh; }
.rq.rq-max { width: 100%; max-height: none; height: 100%; }
.rq-close { position: absolute; top: 8px; right: 8px; z-index: 1; min-width: 44px; min-height: 44px; background: rgba(0, 0, 0, 0.25); }
.rq-stage { flex: 1; min-height: 0; width: 100%; display: flex; align-items: center; justify-content: center; padding: 8px; }
/* The artwork is 1080x1920 and already carries the logo, headline and URL, so it
   is only ever scaled to fit, never cropped. */
.rq-img { max-width: 100%; max-height: calc(92vh - 64px); object-fit: contain; display: block; }
.rq.rq-max .rq-img { max-height: calc(100dvh - 72px); }
.rq-fail { padding: 24px; text-align: center; }
.rq-foot { flex: none; padding: 8px 16px 14px; text-align: center; font-size: 14px; }
.rq-foot.is-warn { color: #FFD9A0; }
</style>

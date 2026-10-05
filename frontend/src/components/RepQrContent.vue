<template>
  <!-- The inside of the rep's QR dialog: the 9:16 "phone screen" artwork Setup offers
       to save (renderPhoneQrCode), drawn on screen instead of downloaded, and the
       line that says where a scan goes. Pulled out of RepQrDialog so the onboarding
       tour draws exactly this and not a copy; the dialog only adds the q-dialog
       around it. `embedded` sizes it to the box it is in (the tour's screen)
       instead of to the browser window. -->
  <div class="rq" :class="{ 'rq-max': maximized, 'rq-embedded': embedded }">
    <q-btn flat round dense icon="close" color="white" class="rq-close" aria-label="Close QR code" @click="$emit('close')" />
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
    <!-- Says where a scan goes right now, and is honest when nothing is chosen: with
         no conference the scan is held (unassigned_submissions) for Solutions
         Success to file, so the attendee still gets "Thanks" and nothing is lost,
         but it won't reach this rep's Review until someone files it. -->
    <div class="rq-foot" :class="{ 'is-warn': !shownEventName }" role="status">
      <template v-if="shownEventName">Scans go to <strong>{{ shownEventName }}</strong></template>
      <template v-else>You're not at a conference, so scans wait for Solutions Success to file them.</template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import { intakeUrlForRep, renderPhoneQrCode } from '@/utils/generateConnectSlide';
import { cleanConferenceName } from '@/utils/conferenceName';

const props = defineProps<{
  rep: { name: string; repSlug: string };
  // The conference a scan lands in right now; null when the rep has none chosen.
  eventName: string | null;
  // Draw the code (the dialog passes whether it is open).
  active: boolean;
  maximized?: boolean;
  embedded?: boolean;
}>();
defineEmits<{ close: [] }>();

const shownEventName = computed(() => (props.eventName ? cleanConferenceName(props.eventName) : null));

const src = ref<string | null>(null);
const failed = ref(false);
// The code only changes with the slug, so drawing it again on every open (or
// every re-render of the header) would just be wasted canvas work.
let drawnFor = '';

// A blob: URL, never canvas.toDataURL(): index.html's Content-Security-Policy is
// `img-src 'self' blob:`, so a data: image is refused and the dialog opened onto
// an empty box with only its alt text (found 2026-10-01 by opening it under the
// production policy). Revoked when replaced or on unmount so it can't pile up.
function setSrc(next: string | null) {
  if (src.value) URL.revokeObjectURL(src.value);
  src.value = next;
}
onBeforeUnmount(() => setSrc(null));

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the QR code.'))), 'image/png');
  });
}

async function draw() {
  const slug = props.rep.repSlug;
  if (drawnFor === slug && src.value) return;
  setSrc(null);
  failed.value = false;
  try {
    const canvas = await renderPhoneQrCode({ intakeUrl: intakeUrlForRep(slug), repName: props.rep.name });
    const blob = await toBlob(canvas);
    if (props.rep.repSlug !== slug) return; // the previewed rep changed while drawing
    setSrc(URL.createObjectURL(blob));
    drawnFor = slug;
  } catch {
    failed.value = true;
  }
}

watch(() => [props.active, props.rep.repSlug] as const, ([open]) => { if (open) void draw(); }, { immediate: true });
</script>

<style scoped>
.rq { position: relative; background: #215091; color: #fff; display: flex; flex-direction: column; align-items: center; width: min(92vw, 440px); max-height: 92vh; }
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
.rq.rq-embedded { width: 100%; max-height: none; height: 100%; position: relative; border-radius: 4px; }
.rq.rq-embedded .rq-img { max-height: 100%; }
</style>

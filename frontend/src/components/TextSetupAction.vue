<template>
  <!-- The one way into texting SETUP, with its consent disclosure attached.
       The disclosure has to be on the same screen as the action that gives
       consent, directly under it (our texting campaign was rejected four times
       over this), so the two live in one component and nothing can show the
       button without it. Used by the quick-start screen; PROTOTYPE: for the
       build, Setup's phone card uses it too instead of its own copy. -->
  <div class="tsa">
    <template v-if="!hasPhone">
      <div class="tsa-warn">
        <q-icon name="phone_disabled" size="22px" />
        <div>Your account has no phone number yet, so texted cards can't be credited to you. Ask your Solutions Success rep to add yours.</div>
      </div>
    </template>

    <template v-else>
      <!-- On a phone, sms: opens a text with SETUP already in it. -->
      <q-btn
        v-if="isMobile"
        unelevated no-caps color="primary" icon="sms" label="Text the code SETUP"
        class="full-width tsa-btn" :href="`sms:${TWILIO_NUMBER_E164}?&body=SETUP`"
        @click="$emit('texted')"
      />
      <!-- On a laptop sms: does nothing, so a QR code does the same job: a
           phone camera opens a text to our number with SETUP filled in. -->
      <div v-else class="tsa-qr">
        <canvas ref="qrCanvas" class="tsa-qr-code" aria-label="QR code that opens a text to our number with SETUP filled in" />
        <div class="tsa-qr-text">
          Scan this with your phone's camera. It opens a text to us with <b>SETUP</b> filled in.
          <div class="q-mt-sm">
            No camera handy? From your phone, text the code <b>SETUP</b> to
            <span class="text-weight-bold text-no-wrap">{{ TWILIO_NUMBER_DISPLAY }}</span>.
          </div>
        </div>
      </div>

      <div class="text-caption text-grey-8 q-mt-md">
        By texting this code, you agree to receive recurring automated text messages from
        Flippen Group related to conference lead capture. Msg&amp;data rates may apply. Msg
        frequency varies. Reply HELP for help, STOP to cancel.
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Platform } from 'quasar';
import QRCode from 'qrcode';
import { TWILIO_NUMBER_DISPLAY, TWILIO_NUMBER_E164 } from '@/utils/smsNumber';

defineProps<{ hasPhone: boolean }>();
defineEmits<{ texted: [] }>();

// Same test Setup uses for its own button.
const isMobile = Platform.is.mobile === true;
const qrCanvas = ref<HTMLCanvasElement | null>(null);

// Drawn straight onto a canvas: no image URL at all, so nothing for the
// production CSP (img-src 'self' blob:) to refuse. SMSTO: is the form both
// iPhone and Android cameras turn into a prefilled text.
onMounted(() => {
  if (qrCanvas.value) void QRCode.toCanvas(qrCanvas.value, `SMSTO:${TWILIO_NUMBER_E164}:SETUP`, { width: 160, margin: 1 });
});
</script>

<style scoped>
.tsa-btn { min-height: 52px; font-size: 17px; }
.tsa-qr { display: flex; gap: 16px; align-items: center; background: #F2F6FA; border-radius: 12px; padding: 12px; }
.tsa-qr-code { flex: none; width: 140px !important; height: 140px !important; border-radius: 6px; background: #fff; }
.tsa-qr-text { font-size: 14px; line-height: 1.45; min-width: 0; }
.tsa-warn { display: flex; gap: 10px; align-items: flex-start; background: #FFF4EC; border: 1px solid #F6CFB0; color: #8A3B07; border-radius: 12px; padding: 12px; font-size: 15px; line-height: 1.45; }
</style>

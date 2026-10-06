<template>
  <!-- The attendee form a rep's QR scan opens (IntakePage), as it looks on the
       attendee's phone. The fields are the app's own IntakeFormFields, shown
       read-only with sample answers; only the title and the "Thanks" screen are
       drawn here, in IntakePage's phone styling (the attendee is always on a phone,
       even when the rep watching the tour is on a laptop). A rep's /connect/<repSlug>
       link carries no ?channel, so the form asks "How did you hear about us?". -->
  <div class="intake-page tis">
    <div class="intake-shell">
      <transition name="fade" mode="out-in">
        <div v-if="submitted" key="thanks" class="text-center tis-thanks">
          <q-icon name="check_circle" color="positive" size="72px" />
          <div class="intake-thanks-title q-mt-md">Thanks — we've got your info!</div>
          <div class="intake-subtitle">Someone from our team will be in touch.</div>
        </div>
        <div v-else key="form">
          <div class="intake-title">{{ TOUR_CONFERENCE }}</div>
          <div class="intake-subtitle">Tell us a bit about yourself.</div>
          <IntakeFormFields
            :form="form" :folded="folded" :show-channel="true"
            :autofill="false" readonly phone
          />
        </div>
      </transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import IntakeFormFields, { type IntakeFormModel } from '@/components/IntakeFormFields.vue';
import { TOUR_CONFERENCE } from '../tourText.ts';

defineProps<{ form: IntakeFormModel; folded: boolean; submitted: boolean }>();
</script>

<style scoped>
/* IntakePage.vue's phone styles, fixed on. */
.tis { position: absolute; inset: 0; overflow: hidden; }
.intake-page { background: #fafafa; padding: 20px 16px 32px; }
.intake-shell { width: 100%; max-width: 640px; }
.intake-title { font-size: 24px; font-weight: 700; line-height: 1.15; color: #262627; }
.intake-subtitle { font-size: 16px; color: #6b6b6b; margin-top: 4px; margin-bottom: 12px; }
.intake-thanks-title { font-size: 24px; font-weight: 700; color: #262627; }
.tis-thanks { padding-top: 120px; }
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>

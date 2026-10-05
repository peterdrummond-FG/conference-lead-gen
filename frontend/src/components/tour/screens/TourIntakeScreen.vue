<template>
  <!-- The attendee form a QR scan opens (IntakePage), as it looks on the
       attendee's phone. Markup, labels and phone styles copied from
       IntakePage.vue; PROTOTYPE, for the build it gets a presentational part
       both render. The labels are also in CONNECT_MOCK, which the existing test
       checks against IntakePage. -->
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
          <div class="intake-form">
            <div class="intake-name-row">
              <q-input :model-value="form.firstName" label="First name *" borderless readonly data-tt="f-first" />
              <q-input :model-value="form.lastName" label="Last name *" borderless readonly />
            </div>
            <q-input :model-value="form.email" label="Email" borderless readonly data-tt="f-email" />
            <q-input :model-value="form.phone" label="Phone" borderless readonly />
            <div class="intake-hint">Add your email and phone number</div>
            <div class="intake-optional">Optional</div>
            <q-input :model-value="form.title" label="Title" borderless readonly data-tt="f-title" />
            <q-input model-value="" label="State" borderless readonly />
            <div class="intake-submit-row">
              <q-btn unelevated rounded color="primary" size="lg" class="intake-submit-btn" label="Submit" data-tt="f-submit" />
            </div>
          </div>
        </div>
      </transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { TOUR_CONFERENCE } from '../tourSampleData';

defineProps<{
  form: { firstName: string; lastName: string; email: string; phone: string; title: string };
  submitted: boolean;
}>();
</script>

<style scoped>
/* IntakePage.vue's phone styles, fixed on: the attendee is always on a phone,
   even when the rep watching the tour is on a laptop. */
.tis { position: absolute; inset: 0; overflow: hidden; }
.intake-page { background: #fafafa; padding: 20px 16px 32px; }
.intake-shell { width: 100%; max-width: 640px; }
.intake-title { font-size: 24px; font-weight: 700; line-height: 1.15; color: #262627; }
.intake-subtitle { font-size: 16px; color: #6b6b6b; margin-top: 4px; margin-bottom: 12px; }
.intake-thanks-title { font-size: 24px; font-weight: 700; color: #262627; }
.tis-thanks { padding-top: 120px; }
.intake-form :deep(.q-field) { font-size: 18px; margin-bottom: 4px; }
.intake-form :deep(.q-field__control) { height: 52px; }
.intake-form :deep(.q-field__label) { font-size: 18px; color: #5f6368; }
.intake-name-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.intake-hint { font-size: 14px; color: #5f6368; margin: -4px 0 20px; }
.intake-optional { font-size: 13px; font-weight: 600; letter-spacing: 0.02em; color: #5f6368; margin: 8px 0 0; }
.intake-submit-row { margin-top: 24px; }
.intake-submit-btn { width: 100%; font-size: 18px; font-weight: 600; padding: 16px 0; text-transform: none; }
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>

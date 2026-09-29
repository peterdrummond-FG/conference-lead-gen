<template>
  <!-- What an attendee sees after scanning a rep's QR code. A picture, not the
       real form: that only renders once a conference is joined, so a brand-new
       rep would see a blank "Join a conference first" box in its place. The
       labels come from CONNECT_MOCK, which a test checks against IntakePage.vue. -->
  <div class="mc" role="img" :aria-label="`Picture of the sign-up form people fill in: ${CONNECT_MOCK.fields.join(', ')}, and more.`">
    <div class="mc-frame" aria-hidden="true">
      <div class="mc-notch" />
      <div class="mc-screen">
        <div class="mc-title">{{ CONNECT_MOCK.title }}</div>
        <div class="mc-sub">{{ CONNECT_MOCK.subtitle }}</div>

        <div v-for="f in CONNECT_MOCK.fields" :key="f" class="mc-field">{{ f }}</div>
        <div class="mc-hint">{{ CONNECT_MOCK.hint }}</div>

        <div class="mc-optional">{{ CONNECT_MOCK.optional }}</div>
        <div v-for="f in CONNECT_MOCK.optionalFields" :key="f" class="mc-field">{{ f }}</div>

        <div class="mc-submit">{{ CONNECT_MOCK.submit }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { CONNECT_MOCK } from '@/utils/onboardingTour';
</script>

<style scoped>
.mc { display: flex; justify-content: center; padding: 4px 0; }
.mc-frame {
  position: relative;
  width: 264px;
  padding: 10px 8px 12px;
  background: #1F2933;
  border-radius: 34px;
  box-shadow: 0 8px 24px rgba(15, 30, 50, 0.22);
}
.mc-notch { width: 64px; height: 6px; margin: 0 auto 8px; border-radius: 3px; background: #3E4C59; }
.mc-screen { padding: 14px 16px 16px; background: #FAFAFA; border-radius: 26px; }
.mc-title { font-size: 20px; font-weight: 700; line-height: 1.15; color: #262627; }
.mc-sub { margin: 4px 0 14px; font-size: 13px; color: #5F6368; }
/* Underlined label, like the real form's borderless fields. */
.mc-field {
  padding: 8px 0 5px;
  font-size: 14px;
  color: #5F6368;
  border-bottom: 1px solid rgba(0, 0, 0, 0.32);
}
.mc-hint { margin: 6px 0 12px; font-size: 11.5px; color: #5F6368; }
.mc-optional { margin: 10px 0 2px; font-size: 11px; font-weight: 600; letter-spacing: 0.02em; color: #5F6368; }
.mc-submit {
  margin-top: 18px;
  padding: 11px 0;
  border-radius: 999px;
  background: var(--q-primary);
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  text-align: center;
}
</style>

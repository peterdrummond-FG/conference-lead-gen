<template>
  <!-- One made-up lead, drawn with the real Review row so it can't drift from
       what a rep will see. It is a picture, not data: it lives only inside this
       card, never in any list, count, filter or selection, so "Approve all N"
       (which acts on real lead ids) can never reach it. Inert on purpose:
       nothing in it can be focused, tapped or hovered. -->
  <div class="ml">
    <section class="ml-card" :aria-label="SAMPLE_LEAD_LABEL">
      <div class="ml-ribbon">{{ SAMPLE_LEAD_LABEL }}</div>
      <div class="ml-row" :inert="true">
        <ReviewLeadRow :contact="SAMPLE_LEAD" tab="needs_review" />
      </div>
    </section>

    <ul class="ml-callouts">
      <li v-for="c in SAMPLE_CALLOUTS" :key="c.text" class="ml-callout">
        <span class="ml-dot"><q-icon :name="c.icon" size="16px" color="primary" /></span>
        <span>{{ c.text }}</span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import ReviewLeadRow from '@/components/smart/ReviewLeadRow.vue';
import { SAMPLE_CALLOUTS, SAMPLE_LEAD, SAMPLE_LEAD_LABEL } from '@/utils/onboardingTour';
</script>

<style scoped>
.ml { width: 100%; max-width: 440px; margin: 0 auto; }
.ml-card { background: #fff; border: 2px dashed rgba(0, 103, 172, 0.45); border-radius: 12px; overflow: hidden; }
.ml-ribbon { padding: 4px 12px; background: #E6F1F9; color: #004F85; font-size: 12px; font-weight: 600; letter-spacing: 0.02em; }
.ml-row { pointer-events: none; user-select: none; }
.ml-callouts { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.ml-callout { display: flex; align-items: flex-start; gap: 10px; font-size: 14px; line-height: 1.4; color: #2F3A44; }
.ml-dot { display: grid; place-items: center; flex: none; width: 26px; height: 26px; border-radius: 50%; background: #E6F1F9; }
</style>

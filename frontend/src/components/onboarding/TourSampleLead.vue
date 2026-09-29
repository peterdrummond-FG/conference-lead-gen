<template>
  <!-- Shown on Review only while the welcome tour is explaining what a Ready
       lead looks like. It is a picture, not data: SAMPLE_LEAD never enters any
       list, count, filter or selection, so "Approve N ready" (which acts on
       real lead ids) can never touch it. The row itself is inert -- nothing in
       it can be focused, clicked or hovered -- and no handlers are bound, so
       even a stray event does nothing. -->
  <section class="tsl" data-tour="review-sample" aria-label="Sample lead">
    <div class="tsl-ribbon">{{ SAMPLE_LEAD_LABEL }}</div>
    <div class="tsl-row" :inert="true">
      <ReviewLeadRow :contact="SAMPLE_LEAD" tab="needs_review" />
    </div>
  </section>
</template>

<script setup lang="ts">
import ReviewLeadRow from '@/components/smart/ReviewLeadRow.vue';
import { SAMPLE_LEAD, SAMPLE_LEAD_LABEL } from '@/utils/onboardingTour';
</script>

<style scoped>
.tsl {
  margin-bottom: 12px;
  background: #fff;
  border: 2px dashed rgba(0, 103, 172, 0.45);
  border-radius: 12px;
  overflow: hidden;
}
.tsl-ribbon {
  padding: 4px 12px;
  background: #E6F1F9;
  color: #004F85;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.tsl-row { pointer-events: none; user-select: none; }
</style>

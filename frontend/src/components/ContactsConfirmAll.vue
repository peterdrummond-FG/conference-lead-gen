<template>
  <!-- With Ready selected, everything listed is ready, so one button confirms the lot
       (the page shows the same dialog and sends the same request as ever). The page and
       the onboarding tour draw this one component. -->
  <q-btn
    unelevated
    no-caps
    color="positive"
    icon="done_all"
    :label="waiting ?? `Confirm all ${count}`"
    :disable="Boolean(waiting)"
    class="rs-confirm-all"
  />
</template>

<script setup lang="ts">
// waiting: words to show instead, and the button is off, while the rest of a long list is
// still loading (or could not be): Confirm all acts on what is on screen, and the
// screen must hold everything first. Left out by the onboarding tour, which draws this too.
defineProps<{ count: number; waiting?: string | undefined }>();
</script>

<style scoped>
.rs-confirm-all { width: 100%; min-height: 44px; margin: 4px 0 10px; font-size: 15px; font-weight: 600; }
</style>

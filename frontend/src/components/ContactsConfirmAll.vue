<template>
  <!-- With Ready selected, everything listed is ready, so one button confirms the lot
       (the page shows the same dialog and sends the same request as ever). The page and
       the onboarding tour draw this one component. -->
  <q-btn
    unelevated
    no-caps
    color="positive"
    icon="done_all"
    :label="`Confirm all ${count}`"
    class="rs-confirm-all"
  />
</template>

<script setup lang="ts">
defineProps<{ count: number }>();
</script>

<style scoped>
.rs-confirm-all { width: 100%; min-height: 44px; margin: 4px 0 10px; font-size: 15px; font-weight: 600; }
</style>

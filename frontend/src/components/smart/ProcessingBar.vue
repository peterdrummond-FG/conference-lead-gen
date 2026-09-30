<template>
  <!-- A sweeping bar instead of a paragraph: it stands where the Approve / Reject
       buttons will be, so "the bar is gone" is the signal that the lead can be
       acted on. Its own markup rather than q-linear-progress so the sweep can be
       switched off for reduced motion without reaching into Quasar's internals. -->
  <div class="pb" role="progressbar" :aria-label="label" aria-busy="true">
    <div class="pb-track"><i class="pb-sweep" /></div>
    <div v-if="caption" class="pb-caption">{{ caption }}</div>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ caption?: string; label?: string }>(), {
  caption: 'Processing',
  label: 'Processing this contact',
});
</script>

<style scoped>
.pb { min-width: 0; }
.pb-track { position: relative; height: 6px; border-radius: 3px; background: #DCE8F3; overflow: hidden; }
.pb-sweep {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -40%;
  width: 40%;
  border-radius: 3px;
  background: #0067AC;
  animation: pb-sweep 1.4s ease-in-out infinite;
}
.pb-caption { margin-top: 4px; font-size: 11px; line-height: 1.2; color: #5B6670; }
@keyframes pb-sweep { to { left: 100%; } }
@media (prefers-reduced-motion: reduce) {
  .pb-sweep { animation: none; left: 0; width: 35%; }
}
</style>

<template>
  <!-- The rep's own QR, big, in a couple of taps from anywhere in the app: the
       header's QR button opens this. The content (artwork and the "where a scan
       goes" line) is RepQrContent, which the onboarding tour draws too. Full
       screen on a phone so the code is as large as it can be. -->
  <q-dialog :model-value="modelValue" :maximized="maximized" @update:model-value="(v: boolean) => $emit('update:modelValue', v)">
    <q-card class="rq-card">
      <RepQrContent :rep="rep" :event-name="eventName" :active="modelValue" :maximized="maximized" @close="$emit('update:modelValue', false)" />
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useQuasar } from 'quasar';
import RepQrContent from '@/components/RepQrContent.vue';

defineProps<{
  modelValue: boolean;
  rep: { name: string; repSlug: string };
  // The conference a scan lands in right now; null when the rep has none chosen.
  eventName: string | null;
}>();
defineEmits<{ 'update:modelValue': [value: boolean] }>();

const $q = useQuasar();
const maximized = computed(() => $q.screen.lt.sm);
</script>

<style scoped>
/* The card is the dialog's surface (same blue as the content, so a rounded corner
   never shows white); RepQrContent sizes itself. */
.rq-card { background: #215091; }
</style>

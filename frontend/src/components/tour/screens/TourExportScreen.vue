<template>
  <!-- The Export page inside the tour: the app's own ExportCard with sample counts.
       Phases: ready (the Export button), pending ("Did the file download?"), done
       (nothing left to export, and the toast the app shows). Nothing is downloaded. -->
  <div class="tex flex flex-center" :class="isPhone ? 'q-pa-sm' : 'q-pa-lg'">
    <ExportCard
      :summary="summary" :pending="phase === 'pending' ? { count: 8 } : null" :export-count="exportCount"
      :exporting="false" :confirming="false"
    />
    <div v-if="done" class="tex-toast">Exported 8 contacts. They're marked as synced.</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useQuasar } from 'quasar';
import ExportCard, { type ExportSummary } from '@/components/ExportCard.vue';

const props = defineProps<{ phase: 'ready' | 'pending' | 'done' }>();
const $q = useQuasar();
const isPhone = computed(() => $q.screen.lt.sm);
const done = computed(() => props.phase === 'done');
const summary = computed<ExportSummary>(() => (done.value
  ? { readyToExport: 0, newAccountsToExport: 0, needsReview: 3 }
  : { readyToExport: 2, newAccountsToExport: 6, needsReview: 3 }));
const exportCount = computed(() => summary.value.readyToExport + summary.value.newAccountsToExport);
</script>

<style scoped>
.tex { height: 100%; position: relative; }
/* Quasar's positive Notify, drawn in place. */
.tex-toast { position: absolute; left: 50%; bottom: 24px; transform: translateX(-50%); background: #21BA45; color: #fff; padding: 12px 18px; border-radius: 4px; font-size: 14px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25); white-space: nowrap; }
</style>

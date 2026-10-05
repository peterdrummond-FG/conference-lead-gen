<template>
  <q-page :class="[$q.screen.lt.sm ? 'q-pa-sm' : 'q-pa-lg', 'flex', 'flex-center']">
    <ExportCard
      :summary="summary" :pending="pending" :export-count="exportCount" :exporting="exporting" :confirming="confirming"
      @download="download" @confirm="confirmExport" @download-again="saveBlob(pending!.blob)"
    />
  </q-page>
</template>

<script setup lang="ts">
import { Notify } from 'quasar';
import { ref, computed, onMounted } from 'vue';
import { api } from '@/boot/axios';
import { anchorDownload } from '@/utils/saveImage';
import ExportCard, { type ExportSummary } from '@/components/ExportCard.vue';

const summary = ref<ExportSummary | null>(null);
const exporting = ref(false);
const confirming = ref(false);
// The generated file and its batch, held from the first download until the rep
// confirms it — see the comment in the template.
const pending = ref<{ blob: Blob; batchId: string; count: number } | null>(null);

const exportCount = computed(() => (summary.value ? summary.value.readyToExport + summary.value.newAccountsToExport : 0));

async function load() {
  const { data } = await api.get<ExportSummary>('/export-summary');
  summary.value = data;
}

// A plain navigation (window.location.href) can't carry the bearer token
// export-csv needs, so this fetches via the normal authenticated axios
// instance and triggers the download from the resulting blob instead —
// same reasoning as useContactPhoto.ts.
function saveBlob(blob: Blob) {
  anchorDownload(blob, 'ckh-connect-leads.csv');
}

async function download() {
  if (exporting.value || pending.value) return;
  exporting.value = true;
  try {
    const count = exportCount.value;
    const res = await api.get<Blob>('/export-csv', { responseType: 'blob' });
    saveBlob(res.data);

    const batchId = res.headers['x-export-batch-id'];
    if (!batchId) {
      Notify.create({
        type: 'warning',
        message: 'Downloaded, but the export could not be confirmed — these leads will appear in the next export too.',
      });
      await load();
      return;
    }
    // Not confirmed yet: the leads stay reserved until the rep says the file arrived.
    pending.value = { blob: res.data, batchId: String(batchId), count };
  } finally {
    exporting.value = false;
  }
}

async function confirmExport() {
  if (!pending.value || confirming.value) return;
  confirming.value = true;
  try {
    const { batchId, count } = pending.value;
    await api.post('/export-confirm', { batchId });
    pending.value = null;
    await load();
    Notify.create({
      type: 'positive',
      message: `Exported ${count} ${count === 1 ? 'lead' : 'leads'}. They're marked as synced.`,
    });
  } finally {
    confirming.value = false;
  }
}

onMounted(load);
</script>

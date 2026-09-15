<template>
  <q-page class="q-pa-lg flex flex-center">
    <q-card style="width: 480px; max-width: 92vw">
      <q-card-section>
        <div class="text-h5">Export to Zoho</div>
        <div class="text-caption text-grey">
          Generates the Zoho-ready CSV from every approved contact. A contact with no matched Zoho
          Account yet still goes out — flagged as a new Account to create — rather than being held
          back. Each contact is marked synced the moment it's included — re-exporting only ever
          picks up new ones.
        </div>
      </q-card-section>

      <q-card-section v-if="summary" class="q-gutter-sm">
        <div class="row justify-between">
          <span>Ready to export (existing Zoho Account)</span>
          <q-badge color="positive">{{ summary.readyToExport }}</q-badge>
        </div>
        <div class="row justify-between">
          <span>Ready to export (new Account — flagged)</span>
          <q-badge color="info">{{ summary.newAccountsToExport }}</q-badge>
        </div>
        <div class="row justify-between">
          <span>Still needs review</span>
          <q-badge color="warning">{{ summary.needsReview }}</q-badge>
        </div>
      </q-card-section>

      <q-card-actions align="right">
        <q-btn
          color="primary"
          label="Export to Zoho"
          :disable="!summary || summary.readyToExport + summary.newAccountsToExport === 0"
          @click="download"
        />
      </q-card-actions>
    </q-card>
  </q-page>
</template>

<script setup lang="ts">
import { Notify } from 'quasar';
import { ref, onMounted } from 'vue';
import { api } from '@/boot/axios';

interface ExportSummary {
  readyToExport: number;
  needsReview: number;
  newAccountsToExport: number;
}

const summary = ref<ExportSummary | null>(null);

async function load() {
  const { data } = await api.get<ExportSummary>('/export-summary');
  summary.value = data;
}

// A plain navigation (window.location.href) can't carry the bearer token
// export-csv needs, so this fetches via the normal authenticated axios
// instance and triggers the download from the resulting blob instead —
// same reasoning as useContactPhoto.ts.
async function download() {
  const res = await api.get<Blob>('/export-csv', { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'ckh-connect-leads.csv';
  link.click();
  URL.revokeObjectURL(url);

  // Two-phase export (audit Q2): export-csv reserves the batch but does NOT
  // mark those contacts synced. Only once the blob is actually in hand do we
  // confirm. If anything above failed, or this confirm never happens, the
  // batch ages out server-side and the leads come back on the next export --
  // which is the entire point: a dropped download used to lose them forever.
  const batchId = res.headers['x-export-batch-id'];
  if (!batchId) {
    Notify.create({
      type: 'warning',
      message: 'Downloaded, but the export could not be confirmed — these leads will appear in the next export too.',
    });
    return;
  }
  await api.post('/export-confirm', { batchId });
  await load();
}

onMounted(load);
</script>

<template>
  <q-page class="q-pa-lg flex flex-center">
    <q-card style="width: 480px; max-width: 92vw">
      <q-card-section>
        <div class="text-h5">Export to Zoho</div>
        <div class="text-caption text-grey">
          Generates the Zoho-ready CSV from every approved, fully-linked contact.
        </div>
      </q-card-section>

      <q-card-section v-if="summary" class="q-gutter-sm">
        <div class="row justify-between">
          <span>Ready to export</span>
          <q-badge color="positive">{{ summary.readyToExport }}</q-badge>
        </div>
        <div class="row justify-between">
          <span>Still needs review</span>
          <q-badge color="warning">{{ summary.needsReview + summary.blockedOnNewAccount }}</q-badge>
        </div>
      </q-card-section>

      <q-card-actions align="right">
        <q-btn
          color="primary"
          label="Export to Zoho"
          :disable="!summary || summary.readyToExport === 0"
          @click="download"
        />
      </q-card-actions>
    </q-card>
  </q-page>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '@/boot/axios';

interface ExportSummary {
  readyToExport: number;
  needsReview: number;
  blockedOnNewAccount: number;
}

const summary = ref<ExportSummary | null>(null);

async function load() {
  const { data } = await api.get<ExportSummary>('/export-summary');
  summary.value = data;
}

// A plain navigation (window.location.href) can't carry the staff-PIN
// header or the anon-key bearer token export-csv needs, so this fetches
// via the normal authenticated axios instance and triggers the download
// from the resulting blob instead — same reasoning as useContactPhoto.ts.
async function download() {
  const { data } = await api.get<Blob>('/export-csv', { responseType: 'blob' });
  const url = URL.createObjectURL(data);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'conference-leads.csv';
  link.click();
  URL.revokeObjectURL(url);
}

onMounted(load);
</script>

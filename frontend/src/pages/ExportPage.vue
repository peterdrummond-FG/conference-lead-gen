<template>
  <q-page class="q-pa-lg flex flex-center">
    <q-card style="width: 480px; max-width: 92vw">
      <q-card-section>
        <div class="text-h5">Export</div>
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
          <q-badge color="warning">{{ summary.needsReview }}</q-badge>
        </div>
        <div class="row justify-between">
          <span>Blocked on manual Account creation</span>
          <q-badge color="negative">{{ summary.blockedOnNewAccount }}</q-badge>
        </div>
      </q-card-section>

      <q-card-actions align="right">
        <q-btn
          color="primary"
          label="Download CSV"
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
  const { data } = await api.get<ExportSummary>('/export/summary');
  summary.value = data;
}

function download() {
  window.location.href = '/api/export';
}

onMounted(load);
</script>

<template>
  <q-page :class="[$q.screen.lt.sm ? 'q-pa-sm' : 'q-pa-lg', 'flex', 'flex-center']">
    <q-card style="width: 480px; max-width: 100%">
      <q-card-section>
        <div class="text-h5">Export to Zoho</div>
        <div class="text-body2 text-grey-8 q-mt-xs">
          Downloads a CSV of every approved lead that hasn't been exported yet. A lead with no
          Zoho account is included and flagged as a new account to create.
        </div>
      </q-card-section>

      <q-card-section v-if="!summary" class="q-pt-none text-caption text-grey-8">Loading…</q-card-section>

      <q-card-section v-else class="q-pt-none">
        <div class="ex-row">
          <span>Ready to export (existing Zoho Account)</span>
          <q-badge color="positive" :label="summary.readyToExport" />
        </div>
        <div class="ex-row">
          <span>Ready to export (new Account, flagged)</span>
          <q-badge color="info" :label="summary.newAccountsToExport" />
        </div>
        <div class="ex-row">
          <span>
            Still needs review
            <!-- These are exactly the leads that will NOT be in the file, so the
                 way to change that is one tap away instead of a nav-tab hunt. -->
            <router-link v-if="summary.needsReview > 0" to="/review" class="ex-link">Review them</router-link>
          </span>
          <q-badge color="warning" :label="summary.needsReview" />
        </div>
      </q-card-section>

      <!-- Two-phase export (audit Q2): the server reserves the leads when the file
           is generated and only marks them synced once we confirm. The page used
           to confirm the instant it clicked the download link, with no idea
           whether the file was actually saved — a blocked or dropped download
           marked every lead synced and lost them. Now the rep confirms, and can
           download the same file again from memory until they do. (An abandoned
           batch is released server-side after 30 minutes, so a fresh export
           would find nothing to send in the meantime.) -->
      <q-card-section v-if="pending" class="q-pt-none">
        <q-banner rounded class="bg-blue-1 text-blue-10 ex-pending" role="status">
          <div class="text-weight-medium">Did the file download?</div>
          <div class="text-body2 q-mt-xs">
            Check your Downloads for <span class="text-weight-medium">ckh-connect-leads.csv</span>.
            Confirm below and these {{ pending.count }} leads are marked as exported, so they won't
            be in the next file.
          </div>
        </q-banner>
        <div class="row q-gutter-sm q-mt-sm">
          <q-btn unelevated no-caps color="primary" label="Yes, it downloaded" class="col-12 col-sm-auto ex-btn" :loading="confirming" @click="confirmExport" />
          <q-btn outline no-caps color="primary" icon="download" label="Download again" class="col-12 col-sm-auto ex-btn" :disable="confirming" @click="saveBlob(pending.blob)" />
        </div>
      </q-card-section>

      <template v-else>
        <q-card-section v-if="summary && exportCount === 0" class="q-pt-none text-body2 text-grey-8">
          Nothing to export yet. Approve leads in Review and they'll show up here.
        </q-card-section>
        <q-card-actions align="right">
          <q-btn
            color="primary"
            no-caps
            unelevated
            icon="download"
            :label="exportCount > 0 ? `Export ${exportCount} ${exportCount === 1 ? 'lead' : 'leads'}` : 'Export to Zoho'"
            class="ex-btn"
            :class="{ 'full-width': $q.screen.lt.sm }"
            :loading="exporting"
            :disable="!summary || exportCount === 0"
            @click="download"
          />
        </q-card-actions>
      </template>
    </q-card>
  </q-page>
</template>

<script setup lang="ts">
import { Notify } from 'quasar';
import { ref, computed, onMounted } from 'vue';
import { api } from '@/boot/axios';
import { anchorDownload } from '@/utils/saveImage';

interface ExportSummary {
  readyToExport: number;
  needsReview: number;
  newAccountsToExport: number;
}

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

<style scoped>
.ex-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 40px;
}
.ex-link {
  margin-left: 8px;
  font-size: 14px;
  color: var(--q-primary);
}
.ex-btn { min-height: 44px; }
</style>

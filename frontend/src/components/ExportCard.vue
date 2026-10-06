<template>
  <q-card style="width: 480px; max-width: 100%">
    <q-card-section>
      <div class="text-h5">Export to Zoho</div>
      <div class="text-body2 text-grey-8 q-mt-xs">
        Downloads a CSV of every confirmed lead that hasn't been exported yet. A lead with no
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
          Not confirmed yet
          <!-- These are exactly the leads that will NOT be in the file, so the
               way to change that is one tap away instead of a nav-tab hunt. -->
          <router-link v-if="summary.needsReview > 0" to="/contacts" class="ex-link">See them</router-link>
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
        <q-btn unelevated no-caps color="primary" label="Yes, it downloaded" class="col-12 col-sm-auto ex-btn" :loading="confirming" @click="$emit('confirm')" />
        <q-btn outline no-caps color="primary" icon="download" label="Download again" class="col-12 col-sm-auto ex-btn" :disable="confirming" @click="$emit('downloadAgain')" />
      </div>
    </q-card-section>

    <template v-else>
      <q-card-section v-if="summary && exportCount === 0" class="q-pt-none text-body2 text-grey-8">
        Nothing to export yet. Confirm leads in Contacts and they'll show up here.
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
          @click="$emit('download')"
        />
      </q-card-actions>
    </template>
  </q-card>
</template>

<script setup lang="ts">
// The "Export to Zoho" card as pure display: the counts, the export button and the
// "Did the file download?" confirmation. ExportPage owns the requests and the
// two-phase export; the onboarding tour draws this same card with sample counts.
export interface ExportSummary {
  readyToExport: number;
  needsReview: number;
  newAccountsToExport: number;
}

defineProps<{
  summary: ExportSummary | null;
  pending: { count: number } | null;
  exportCount: number;
  exporting: boolean;
  confirming: boolean;
}>();
defineEmits<{ download: []; confirm: []; downloadAgain: [] }>();
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

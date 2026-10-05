<template>
  <!-- ExportPage for the tour: markup, wording and styles copied, with sample
       counts. PROTOTYPE: for the build the page gets a presentational part both
       render. -->
  <div class="tex flex flex-center" :class="isPhone ? 'q-pa-sm' : 'q-pa-lg'">
    <q-card style="width: 480px; max-width: 100%">
      <q-card-section>
        <div class="text-h5">Export to Zoho</div>
        <div class="text-body2 text-grey-8 q-mt-xs">
          Downloads a CSV of every approved lead that hasn't been exported yet. A lead with no
          Zoho account is included and flagged as a new account to create.
        </div>
      </q-card-section>
      <q-card-section class="q-pt-none">
        <div class="ex-row"><span>Ready to export (existing Zoho Account)</span><q-badge color="positive" :label="done ? 0 : 2" /></div>
        <div class="ex-row"><span>Ready to export (new Account, flagged)</span><q-badge color="info" :label="done ? 0 : 6" /></div>
        <div class="ex-row"><span>Still needs review <a class="ex-link">Review them</a></span><q-badge color="warning" :label="3" /></div>
      </q-card-section>

      <q-card-section v-if="phase === 'pending'" class="q-pt-none">
        <q-banner rounded class="bg-blue-1 text-blue-10">
          <div class="text-weight-medium">Did the file download?</div>
          <div class="text-body2 q-mt-xs">
            Check your Downloads for <span class="text-weight-medium">ckh-connect-leads.csv</span>.
            Confirm below and these 8 leads are marked as exported, so they won't
            be in the next file.
          </div>
        </q-banner>
        <div class="row q-gutter-sm q-mt-sm">
          <q-btn unelevated no-caps color="primary" label="Yes, it downloaded" class="col-12 col-sm-auto ex-btn" data-tt="ex-confirm" />
          <q-btn outline no-caps color="primary" icon="download" label="Download again" class="col-12 col-sm-auto ex-btn" />
        </div>
      </q-card-section>
      <template v-else>
        <q-card-section v-if="done" class="q-pt-none text-body2 text-grey-8">
          Nothing to export yet. Approve leads in Review and they'll show up here.
        </q-card-section>
        <q-card-actions align="right">
          <q-btn
            color="primary" no-caps unelevated icon="download" class="ex-btn" data-tt="ex-button"
            :label="done ? 'Export to Zoho' : 'Export 8 leads'" :class="{ 'full-width': isPhone }"
          />
        </q-card-actions>
      </template>
    </q-card>
    <div v-if="done" class="tex-toast">Exported 8 leads. They're marked as synced.</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useQuasar } from 'quasar';

const props = defineProps<{ phase: 'ready' | 'pending' | 'done' }>();
const $q = useQuasar();
const isPhone = computed(() => $q.screen.lt.sm);
const done = computed(() => props.phase === 'done');
</script>

<style scoped>
.tex { height: 100%; position: relative; }
/* From ExportPage.vue */
.ex-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 40px; }
.ex-link { margin-left: 8px; font-size: 14px; color: var(--q-primary); text-decoration: underline; }
.ex-btn { min-height: 44px; }
/* Quasar's positive Notify, drawn in place. */
.tex-toast { position: absolute; left: 50%; bottom: 24px; transform: translateX(-50%); background: #21BA45; color: #fff; padding: 12px 18px; border-radius: 4px; font-size: 14px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25); white-space: nowrap; }
</style>

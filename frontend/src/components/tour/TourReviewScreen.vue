<template>
  <!-- Review's page as the rep sees it, for the tour: ReviewSmart's header
       (markup and styles copied; PROTOTYPE, for the build it becomes one
       component both render) around the app's own ReviewLeadList and
       ReviewLeadEditor. Everything it shows comes in as props; every tap goes
       out as an event for the scene to apply to its sample data. -->
  <div class="tsr-root">
    <div class="tsr-scroll">
      <div class="rs-page">
        <header class="rs-head">
          <div class="rs-tabs">
            <button type="button" class="rs-tab is-on">To review<span class="rs-count">{{ toReview.length }}</span></button>
            <button type="button" class="rs-tab">Approved<span class="rs-count">{{ approvedCount }}</span></button>
            <button type="button" class="rs-tab">Rejected<span class="rs-count">0</span></button>
          </div>
          <div class="rs-status-row">
            <button type="button" class="rs-cell"><span class="rs-cell-n"><span class="rs-sum-dot rs-dot-ready" />{{ readyN }}</span><span class="rs-cell-l">ready</span></button>
            <button type="button" class="rs-cell"><span class="rs-cell-n"><span class="rs-sum-dot rs-dot-info" />{{ toReview.length - readyN }}</span><span class="rs-cell-l">incomplete</span></button>
            <button type="button" class="rs-cell" disabled><span class="rs-cell-n"><span class="rs-sum-dot rs-dot-proc" />0</span><span class="rs-cell-l">processing</span></button>
            <a class="rs-cell rs-cell-import" data-tt="import">
              <span class="rs-cell-n"><q-icon name="note_add" size="22px" /></span>
              <span class="rs-cell-l">Import</span>
            </a>
          </div>
          <div class="rs-tools">
            <q-input model-value="" dense outlined class="rs-search" :placeholder="isPhone ? 'Search' : 'Search name, school, email, phone'">
              <template #prepend><q-icon name="search" /></template>
            </q-input>
            <q-btn flat no-caps dense color="grey-9" icon="sort" :label="isPhone ? undefined : 'Newest first'" class="rs-sort" />
            <button v-if="!manager" type="button" class="rs-scope"><q-icon name="event" size="22px" /></button>
          </div>
          <div class="rs-filters">
            <template v-if="manager">
              <q-select model-value="All reps" :options="['All reps']" dense outlined label="Rep" class="rs-select" />
              <q-select model-value="All" :options="['All']" dense outlined label="Sync status" class="rs-select" />
            </template>
            <q-select model-value="All sources" :options="['All sources']" dense outlined label="Source" class="rs-select rs-source" />
          </div>
        </header>

        <div class="rs-split" :class="{ 'is-split': !isPhone }">
          <div class="rs-left">
            <section class="rs-section">
              <div class="rs-sec-head">
                <div class="rs-sec-title">
                  <div class="rs-sec-name">{{ manager ? 'All conferences' : TOUR_CONFERENCE }}</div>
                  <div class="rs-sec-sub">{{ manager ? '' : 'This event · ' }}{{ toReview.length }} {{ toReview.length === 1 ? 'lead' : 'leads' }}</div>
                </div>
                <q-btn v-if="readyN > 0" unelevated no-caps dense color="positive" :label="`Approve all ${readyN}`" class="rs-ready-btn" />
              </div>
              <ReviewLeadList
                :leads="toReview"
                tab="needs_review"
                :active-id="isPhone ? null : (activeId ?? null)"
                :compact="!isPhone"
                :busy="noBusy"
                :show-event="manager"
                :show-rep="manager"
                @open="(id) => $emit('open', id)"
                @followed-up="(id, v) => $emit('update', { id, payload: { followedUp: v } })"
              />
            </section>
          </div>
          <aside v-if="!isPhone" class="rs-pane tsr-pane">
            <ReviewLeadEditor
              v-if="active"
              :key="active.id"
              :contact="active"
              :is-sales="!manager"
              :busy="false"
              :position="position"
              @approve="(p) => $emit('approve', p)"
              @update="(p) => $emit('update', p)"
            />
          </aside>
        </div>
      </div>
    </div>
    <template v-if="isPhone">
      <div class="tsr-scrim" :class="{ 'is-on': sheetOpen }" />
      <div class="tsr-sheet" :class="{ 'is-on': sheetOpen }">
        <ReviewLeadEditor
          v-if="active"
          :key="active.id"
          :contact="active"
          :is-sales="!manager"
          :busy="false"
          :position="position"
          closable
          @approve="(p) => $emit('approve', p)"
          @update="(p) => $emit('update', p)"
          @close="$emit('close')"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useQuasar } from 'quasar';
import ReviewLeadList from '@/components/smart/ReviewLeadList.vue';
import ReviewLeadEditor from '@/components/smart/ReviewLeadEditor.vue';
import { TOUR_CONFERENCE } from './tourSampleData';
import { isReady } from '@/utils/reviewSmart';
import type { ContactListItem, UpdateContactPayload } from '@/types/review';

const props = defineProps<{
  manager: boolean;
  leads: ContactListItem[];
  activeId?: string | null;
  sheetOpen?: boolean;
  approvedBase?: number;
}>();
defineEmits<{
  open: [id: string];
  approve: [p: { id: string; edits?: UpdateContactPayload | undefined }];
  update: [p: { id: string; payload: UpdateContactPayload }];
  close: [];
}>();

const $q = useQuasar();
const isPhone = computed(() => $q.screen.lt.sm);
const noBusy = new Set<string>();

const toReview = computed(() => props.leads.filter((l) => l.reviewStatus === 'needs_review'));
const approvedCount = computed(() => (props.approvedBase ?? 12) + props.leads.filter((l) => l.reviewStatus === 'approved').length);
const readyN = computed(() => toReview.value.filter(isReady).length);
const active = computed(() => props.leads.find((l) => l.id === props.activeId) ?? null);
const position = computed(() => {
  const i = toReview.value.findIndex((l) => l.id === props.activeId);
  return i < 0 ? null : { index: i + 1, total: toReview.value.length };
});
</script>

<style scoped>
.tsr-root, .tsr-scroll { height: 100%; overflow: hidden; }
/* In the app the pane is sticky and the page scrolls under it; the tour's
   page doesn't scroll, so the pane is sized to end at the bottom of the
   screen, where its Approve button can be seen. */
.tsr-pane { position: static; height: 508px; }
.tsr-scrim { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.4); opacity: 0; transition: opacity 0.3s; z-index: 20; }
.tsr-scrim.is-on { opacity: 1; }
.tsr-sheet {
  position: absolute; left: 0; right: 0; bottom: 0; height: 92%;
  background: #fff; border-radius: 16px 16px 0 0; overflow: hidden; z-index: 21;
  transform: translateY(100%); transition: transform 0.35s ease;
  display: flex; flex-direction: column;
}
.tsr-sheet.is-on { transform: none; }
.tsr-sheet > * { flex: 1; min-height: 0; }

/* From ReviewSmart.vue (scoped there, so copied for the prototype). */
.rs-page { padding: 12px 16px 32px; max-width: 1480px; margin: 0 auto; }
.rs-head { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.rs-tabs { display: flex; border-bottom: 1px solid rgba(0, 0, 0, 0.12); margin: 0 -4px; }
.rs-tab { flex: 1; min-height: 44px; padding: 0 4px; border: 0; border-bottom: 2px solid transparent; margin-bottom: -1px; background: transparent; color: #4A5B6B; font: inherit; font-size: 15px; font-weight: 500; display: inline-flex; align-items: center; justify-content: center; gap: 6px; white-space: nowrap; }
.rs-tab.is-on { color: var(--q-primary); border-bottom-color: var(--q-primary); }
.rs-count { min-width: 22px; padding: 0 7px; border-radius: 11px; background: rgba(0, 0, 0, 0.07); font-size: 12px; line-height: 22px; }
.rs-tab.is-on .rs-count { background: #E3F1FA; color: #0067AC; }
.rs-tools { display: flex; align-items: center; gap: 4px; }
.rs-search { flex: 1; min-width: 0; }
.rs-sort { min-height: 40px; }
.rs-scope { flex: none; width: 40px; height: 40px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid #B9C3CE; border-radius: 8px; background: #fff; color: #5B6B7B; }
.rs-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.rs-select { min-width: 170px; }
.rs-split { display: block; }
.rs-split.is-split { display: grid; grid-template-columns: minmax(340px, 440px) minmax(0, 1fr); gap: 16px; align-items: start; }
.rs-pane { background: #fff; border: 1px solid rgba(0, 0, 0, 0.08); border-radius: 14px; overflow: hidden; }
.rs-sec-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-height: 48px; padding: 0 2px 6px; }
.rs-sec-head > .rs-sec-title { flex: 1 1 10rem; min-width: 0; }
.rs-sec-title { display: flex; flex-direction: column; min-width: 0; text-align: left; }
.rs-sec-name { font-size: 16px; font-weight: 500; line-height: 1.3; overflow-wrap: anywhere; }
.rs-sec-sub { font-size: 13px; color: #5B6670; }
.rs-ready-btn { min-height: 40px; padding: 0 12px; flex: none; }
.rs-status-row { display: flex; gap: 6px; align-items: stretch; }
.rs-cell { flex: 1 1 0; min-width: 0; min-height: 46px; padding: 3px 2px; display: flex; flex-direction: column; align-items: center; justify-content: center; border-radius: 12px; background: #fff; border: 1px solid rgba(0, 0, 0, 0.1); font: inherit; color: #2F3A44; white-space: nowrap; text-decoration: none; }
.rs-cell-n { display: inline-flex; align-items: center; gap: 5px; font-size: 16px; font-weight: 500; line-height: 1.1; }
.rs-cell-l { font-size: 11px; line-height: 1.2; color: #4A5B6B; }
.rs-cell:disabled { opacity: 0.5; }
.rs-cell-import { margin-left: auto; flex: 0 0 auto; min-width: 64px; padding: 3px 8px; border-color: #1D5C93; color: #1D5C93; }
.rs-cell-import .rs-cell-l { color: #1D5C93; }
.rs-sum-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.rs-dot-ready { background: #1E8E3E; }
.rs-dot-info { background: #E07B00; }
.rs-dot-proc { background: #0067AC; }
@media (min-width: 600px) {
  .rs-tabs { max-width: 520px; }
  .rs-status-row { max-width: 440px; }
}
@media (max-width: 599px) {
  .rs-page { padding: 10px 12px 28px; }
  .rs-filters { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .rs-filters .rs-select { min-width: 0; }
  .rs-filters .rs-source { grid-column: 1 / -1; }
}
</style>

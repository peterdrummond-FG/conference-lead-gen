<template>
  <!-- Contacts' page as the rep sees it, for the tour: ContactsPage's header
       (markup and styles copied; PROTOTYPE, for the build it becomes one
       component both render) around the app's own ContactList and
       ContactEditor. Everything it shows comes in as props; every tap goes
       out as an event for the scene to apply to its sample data. -->
  <div class="tsr-root">
    <div class="tsr-scroll">
      <div class="rs-page">
        <!-- The app's own header (tabs, ready / incomplete / processing, search, filters),
             with sample numbers and nothing wired to anything. -->
        <ContactsHeader
          v-model:tab="tab"
          :tab-defs="TAB_DEFS" :counts="{ needs_review: toReview.length, approved: approvedCount, rejected: 0 }"
          :summary="counts" :readiness-filter="null" :is-sales="!manager"
          :sort-options="SORT_OPTIONS" :sort-by-tab="DEFAULT_SORT"
          :event-filter-options="NO_OPTIONS" :rep-filter-options="REP_OPTIONS"
          :synced-filter-options="NO_OPTIONS" :source-options="SOURCE_OPTIONS"
        />

        <!-- Managers only, like the real page: scans nobody could place under a
             conference wait here for Solutions Success. -->
        <UnassignedScansList
          v-if="manager && scansWaiting"
          :count="unassigned.length" :items="unassigned" :expanded="!!scansExpanded" @toggle="$emit('toggleScans')"
        />

        <div class="rs-split" :class="{ 'is-split': !isPhone }">
          <div class="rs-left">
            <section class="rs-section">
              <div class="rs-sec-head">
                <div class="rs-sec-title">
                  <div class="rs-sec-name">{{ manager ? 'All conferences' : TOUR_CONFERENCE }}</div>
                  <div class="rs-sec-sub">{{ manager ? '' : 'This event · ' }}{{ toReview.length }} {{ toReview.length === 1 ? 'lead' : 'leads' }}</div>
                </div>
                <q-btn v-if="readyN > 0" unelevated no-caps dense color="positive" :label="`Confirm all ${readyN}`" class="rs-ready-btn" />
              </div>
              <ContactList
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
            <ContactEditor
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
        <ContactEditor
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
import { computed, ref } from 'vue';
import { useQuasar } from 'quasar';
import ContactList from '@/components/contacts/ContactList.vue';
import ContactEditor from '@/components/contacts/ContactEditor.vue';
import UnassignedScansList from '@/components/UnassignedScansList.vue';
import { TOUR_CONFERENCE, tourUnassigned } from './tourSampleData';
import ContactsHeader from '@/components/ContactsHeader.vue';
import { DEFAULT_SORT, SORT_OPTIONS, sourceFilterOptions, summaryCounts, type ReviewStatus } from '@/utils/contactsList';
import type { ContactListItem, UpdateContactPayload } from '@/types/review';

const props = defineProps<{
  manager: boolean;
  leads: ContactListItem[];
  activeId?: string | null;
  sheetOpen?: boolean;
  approvedBase?: number;
  scansWaiting?: boolean;
  scansExpanded?: boolean;
}>();
defineEmits<{
  open: [id: string];
  approve: [p: { id: string; edits?: UpdateContactPayload | undefined }];
  update: [p: { id: string; payload: UpdateContactPayload }];
  close: [];
  toggleScans: [];
}>();

const $q = useQuasar();
const isPhone = computed(() => $q.screen.lt.sm);
const noBusy = new Set<string>();
const tab = ref<ReviewStatus>('needs_review');
const TAB_DEFS: { value: ReviewStatus; label: string }[] = [
  { value: 'needs_review', label: 'To review' },
  { value: 'approved', label: 'Confirmed' },
  { value: 'rejected', label: 'Rejected' },
];
const NO_OPTIONS = [{ label: 'All', value: null as string | null }];
const REP_OPTIONS = [{ label: 'All reps', value: null as string | null }];
const SOURCE_OPTIONS = sourceFilterOptions([]);
const unassigned = tourUnassigned();

const toReview = computed(() => props.leads.filter((l) => l.reviewStatus === 'needs_review'));
// A first-time rep has confirmed nothing yet; a scene that stands for a manager's
// busier account passes approvedBase.
const approvedCount = computed(() => (props.approvedBase ?? 0) + props.leads.filter((l) => l.reviewStatus === 'approved').length);
const counts = computed(() => summaryCounts(toReview.value));
const readyN = computed(() => counts.value.ready);
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
   screen, where its Confirm button can be seen. */
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

/* From ContactsPage.vue (scoped there, so copied for the prototype). */
.rs-page { padding: 12px 16px 32px; max-width: 1480px; margin: 0 auto; }
.rs-split { display: block; }
.rs-split.is-split { display: grid; grid-template-columns: minmax(340px, 440px) minmax(0, 1fr); gap: 16px; align-items: start; }
.rs-pane { background: #fff; border: 1px solid rgba(0, 0, 0, 0.08); border-radius: 14px; overflow: hidden; }
.rs-sec-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-height: 48px; padding: 0 2px 6px; }
.rs-sec-head > .rs-sec-title { flex: 1 1 10rem; min-width: 0; }
.rs-sec-title { display: flex; flex-direction: column; min-width: 0; text-align: left; }
.rs-sec-name { font-size: 16px; font-weight: 500; line-height: 1.3; overflow-wrap: anywhere; }
.rs-sec-sub { font-size: 13px; color: #5B6670; }
.rs-ready-btn { min-height: 40px; padding: 0 12px; flex: none; }
@media (max-width: 599px) {
  .rs-page { padding: 10px 12px 28px; }
}
</style>

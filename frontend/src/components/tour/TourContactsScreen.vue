<template>
  <!-- Contacts' page as the rep sees it, for the tour: the app's own header, status
       bar, list, confirm-all button, filter panel and editor (the same components
       ContactsPage renders), with sample data. Everything it shows comes in as props;
       every tap goes out as an event for the scene to apply to its sample data. The
       status bar's segment, the Filter panel's open state and its settings are local:
       nothing about them is a fact about the account. -->
  <div class="tsr-root">
    <div class="tsr-scroll">
      <div class="rs-page">
        <div class="rs-split" :class="{ 'is-split': !isPhone }">
          <div class="rs-left">
            <ContactsHeader
              v-model:segment="segment"
              :counts="counts"
              :filter-count="0"
              :conference-line="manager ? 'All conferences' : TOUR_CONFERENCE"
              @open-filter="openFilter"
            />

            <!-- Managers only, like the real page: scans nobody could place under a
                 conference wait here for Solutions Success. -->
            <UnassignedScansList
              v-if="manager && scansWaiting"
              :count="unassigned.length" :items="unassigned" :expanded="!!scansExpanded" @toggle="$emit('toggleScans')"
            />

            <ContactsConfirmAll v-if="segment === 'ready' && readyN > 0" :count="readyN" @click="$emit('confirmAll', readyIds(deck))" />

            <section class="rs-section">
              <ContactList
                :leads="deck"
                :active-id="isPhone ? null : (activeId ?? null)"
                :compact="!isPhone"
                :busy="noBusy"
                :show-event="manager"
                :show-rep="manager"
                :animate="!!sliding"
                @open="(id) => $emit('open', id)"
                @followed-up="(id, v) => $emit('followedUp', id, v)"
              />
            </section>
          </div>
          <aside v-if="!isPhone" class="rs-pane tsr-pane">
            <ContactEditor
              v-if="active"
              demo
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
      <div class="tsr-scrim" :class="{ 'is-on': sheetOpen || filterOpen }" />
      <div class="tsr-sheet" :class="{ 'is-on': sheetOpen }">
        <ContactEditor
          v-if="active"
          demo
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

    <!-- The Filter panel is the app's own, drawn inside the device (the real page puts
         it in a dialog or a menu, which would escape the phone frame). -->
    <div class="tsr-filter" :class="[isPhone ? 'tsr-filter-sheet' : 'tsr-filter-menu', { 'is-on': filterOpen }]">
      <ContactsFilterPanel
        ref="panelRef"
        v-model="filters"
        :desktop="!isPhone"
        :is-sales="!manager"
        :home="home"
        :event-options="eventOptions"
        :source-options="sourceOptions"
        :rep-options="repOptions"
        :rejected-count="0"
        :shown-count="deck.length"
        :focus-section="filterFocus"
        @close="closeFilter"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, shallowRef } from 'vue';
import { useQuasar } from 'quasar';
import ContactList from '@/components/contacts/ContactList.vue';
import ContactEditor from '@/components/contacts/ContactEditor.vue';
import UnassignedScansList from '@/components/UnassignedScansList.vue';
import ContactsHeader from '@/components/ContactsHeader.vue';
import ContactsFilterPanel from '@/components/ContactsFilterPanel.vue';
import ContactsConfirmAll from '@/components/ContactsConfirmAll.vue';
import { TOUR_CONFERENCE, tourUnassigned } from './tourSampleData';
import {
  DEFAULT_FILTERS, DEFAULT_SORT, buildRank, inSegment, orderDeck, readyIds, sourceFilterOptions, statusCounts,
  type ContactFilters, type HomeConference, type StatusSegment,
} from '@/utils/contactsList';
import type { ContactListItem, UpdateContactPayload } from '@/types/review';

const props = defineProps<{
  manager: boolean;
  leads: ContactListItem[];
  activeId?: string | null;
  sheetOpen?: boolean;
  approvedBase?: number;
  scansWaiting?: boolean;
  scansExpanded?: boolean;
  // Confirmed one at a time and still in place (ContactsPage's `held`): they slide down
  // to the confirmed group when the scene settles them.
  held?: string[];
  // True only while that slide runs (ContactList's `animate`).
  sliding?: boolean;
}>();
defineEmits<{
  open: [id: string];
  approve: [p: { id: string; edits?: UpdateContactPayload | undefined }];
  update: [p: { id: string; payload: UpdateContactPayload }];
  followedUp: [id: string, value: boolean];
  confirmAll: [ids: string[]];
  close: [];
  toggleScans: [];
}>();

const $q = useQuasar();
const isPhone = computed(() => $q.screen.lt.sm);
const noBusy = new Set<string>();
const segment = ref<StatusSegment>('all');
const unassigned = tourUnassigned();

// A first-time rep has confirmed nothing yet; a scene that stands for a manager's
// busier account passes approvedBase.
const counts = computed(() => {
  const n = statusCounts(props.leads);
  const base = props.approvedBase ?? 0;
  return { ...n, confirmed: n.confirmed + base, all: n.all + base };
});
const readyN = computed(() => counts.value.ready);

// The same ordering the real page uses (orderDeck): unconfirmed first, newest first,
// then confirmed, with a held contact kept where it stands. The rank is built once from
// the contacts the scene starts with; later arrivals are "unseen" and go to the top,
// newest first, exactly as a new contact does on the real page.
const rank = shallowRef(buildRank(
  { needs_review: props.leads.filter((l) => l.reviewStatus === 'needs_review'), approved: props.leads.filter((l) => l.reviewStatus === 'approved'), rejected: [] },
  { needs_review: DEFAULT_SORT.needs_review, approved: DEFAULT_SORT.approved, rejected: DEFAULT_SORT.rejected },
));
const deck = computed(() => {
  const held = new Set(props.held ?? []);
  const picked = props.leads.filter((l) => inSegment(l, segment.value) || held.has(l.id));
  return orderDeck(picked.filter((l) => l.reviewStatus === 'needs_review'), picked.filter((l) => l.reviewStatus === 'approved'), rank.value, held);
});
const active = computed(() => props.leads.find((l) => l.id === props.activeId) ?? null);
const position = computed(() => {
  const i = deck.value.findIndex((l) => l.id === props.activeId);
  return i < 0 ? null : { index: i + 1, total: deck.value.length };
});

// ── Filter ──
const filters = ref<ContactFilters>({ ...DEFAULT_FILTERS });
const filterOpen = ref(false);
const filterFocus = ref<'conference' | null>(null);
const panelRef = ref<InstanceType<typeof ContactsFilterPanel> | null>(null);
const home: HomeConference = { id: 'tour-event', name: TOUR_CONFERENCE, kind: 'current' };
const eventOptions = [{ value: 'tour-event', label: TOUR_CONFERENCE }, { value: 'tour-earlier', label: 'TASSP Winter Leadership Conference' }];
const sourceOptions = computed(() => sourceFilterOptions(props.leads));
const repOptions = [{ label: 'All reps', value: null as string | null }];

async function openFilter(section: 'conference' | null) {
  filterFocus.value = section;
  filterOpen.value = true;
  await nextTick();
  // After the panel has slid in, like the real one (ContactsFilter's @show).
  setTimeout(() => void panelRef.value?.scrollToFocus(), 450);
}
function closeFilter() {
  filterOpen.value = false;
  setTimeout(() => panelRef.value?.resetScroll(), 450);
}
</script>

<style scoped>
.tsr-root, .tsr-scroll { height: 100%; overflow: hidden; }
/* In the app the pane is sticky and the page scrolls under it. The tour's page
   scrolls too now (its script brings a card or the status bar into view), so the pane
   stays put the same way, sized to end at the bottom of the screen, where its Confirm
   button can be seen. */
.tsr-pane { position: sticky; top: 0; height: 508px; }
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
.tsr-root { position: relative; }

/* The Filter panel inside the device: a bottom sheet on a phone, a dropdown by the
   Filter button on a laptop. Hidden by moving it away, not display:none, so its
   scrolling still has a layout to scroll in. */
.tsr-filter { position: absolute; z-index: 22; background: #fff; transition: transform 0.35s ease, opacity 0.25s; display: flex; flex-direction: column; }
.tsr-filter > * { flex: 1; min-height: 0; }
.tsr-filter-sheet { left: 0; right: 0; bottom: 0; height: 88%; border-radius: 16px 16px 0 0; overflow: hidden; transform: translateY(105%); }
.tsr-filter-sheet.is-on { transform: none; }
.tsr-filter-sheet :deep(.cf-sheet) { max-height: none; height: 100%; box-shadow: none; }
.tsr-filter-menu { top: 64px; left: 150px; width: 360px; max-height: 430px; border-radius: 8px; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25); opacity: 0; pointer-events: none; transform: translateY(-6px); overflow: hidden; }
.tsr-filter-menu.is-on { opacity: 1; transform: none; pointer-events: auto; }
.tsr-filter-menu :deep(.cf-menu) { max-height: 430px; }

/* From ContactsPage.vue (scoped there, so copied for the prototype). */
.rs-page { padding: 12px 16px 32px; max-width: 1480px; margin: 0 auto; }
.rs-split { display: block; }
.rs-split.is-split { display: grid; grid-template-columns: minmax(340px, 440px) minmax(0, 1fr); gap: 16px; align-items: start; }
.rs-pane { background: #fff; border: 1px solid rgba(0, 0, 0, 0.08); border-radius: 14px; overflow: hidden; }
@media (max-width: 599px) {
  .rs-page { padding: 10px 12px 28px; }
}
</style>

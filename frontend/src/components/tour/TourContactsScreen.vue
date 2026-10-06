<template>
  <!-- Contacts' page as the rep sees it, for the tour: ContactsPage's header
       (markup and styles copied; PROTOTYPE, for the build it becomes one
       component both render) around the app's own ContactList and
       ContactEditor. Everything it shows comes in as props; every tap goes
       out as an event for the scene to apply to its sample data. -->
  <div class="tsr-root">
    <div class="tsr-scroll">
      <div class="rs-page">
        <!-- The app's own header (search, Filter, Import, the status bar and the
             conference line), with sample numbers and nothing wired to anything.
             TOUR PASS PENDING: the scenes' words and taps still describe the old tabs. -->
        <ContactsHeader v-model:segment="segment" :counts="counts" :conference-line="manager ? 'All conferences' : TOUR_CONFERENCE" />

        <!-- Managers only, like the real page: scans nobody could place under a
             conference wait here for Solutions Success. -->
        <UnassignedScansList
          v-if="manager && scansWaiting"
          :count="unassigned.length" :items="unassigned" :expanded="!!scansExpanded" @toggle="$emit('toggleScans')"
        />

        <div class="rs-split" :class="{ 'is-split': !isPhone }">
          <div class="rs-left">
            <section class="rs-section">
              <ContactList
                :leads="leads"
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
import { statusCounts, type StatusSegment } from '@/utils/contactsList';
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
const segment = ref<StatusSegment>('all');
const unassigned = tourUnassigned();

// A first-time rep has confirmed nothing yet; a scene that stands for a manager's
// busier account passes approvedBase.
const counts = computed(() => {
  const n = statusCounts(props.leads);
  const base = props.approvedBase ?? 0;
  return { ...n, confirmed: n.confirmed + base, all: n.all + base };
});
const active = computed(() => props.leads.find((l) => l.id === props.activeId) ?? null);
const position = computed(() => {
  const i = props.leads.findIndex((l) => l.id === props.activeId);
  return i < 0 ? null : { index: i + 1, total: props.leads.length };
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
@media (max-width: 599px) {
  .rs-page { padding: 10px 12px 28px; }
}
</style>

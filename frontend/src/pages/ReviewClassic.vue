<template>
  <q-page class="q-pa-md">
    <!-- One wrapping flex bar on a desktop (title + tabs left, filters and
         actions right). On a phone the filters drop into a 2-column grid and
         the two actions share a full-width row — the old q-gutter-md row let
         each select keep a 160-200px min-width, so every control landed on
         its own line and the first card started below the fold. -->
    <div class="rv-bar q-mb-md">
      <div class="rv-heading">
        <div class="text-h5">Review</div>
        <div v-if="filteredContacts.length" class="text-caption text-grey">{{ filteredContacts.length }} contact{{ filteredContacts.length === 1 ? '' : 's' }}</div>
      </div>
      <q-tabs v-model="tab" dense class="rv-tabs">
        <q-tab name="needs_review" label="Needs Review" />
        <q-tab name="approved" label="Approved" />
        <q-tab name="rejected" label="Rejected" />
      </q-tabs>

      <div class="rv-filters">
        <!-- Options are built from whichever conferences are actually present
             in the loaded list, not every event ever created — filtering to a
             conference with nothing pending here would just show an empty
             list with no way to tell why. -->
        <q-select
          v-if="eventFilterOptions.length > 2"
          v-model="eventFilter"
          :options="eventFilterOptions"
          option-label="label"
          dense
          outlined
          emit-value
          map-options
          label="Conference"
        />

        <q-select
          v-if="tab === 'approved'"
          v-model="followedUpFilter"
          :options="followedUpFilterOptions"
          option-label="label"
          dense
          outlined
          emit-value
          map-options
          label="Follow-up status"
        />

        <!-- A signed-in rep (or an admin previewing one) only ever sees their
             own leads — nothing to pick. Admin/Solutions Success see
             everyone and can slice by rep + sync status. -->
        <template v-if="!isSales">
          <q-select
            v-model="repFilter"
            :options="repFilterOptions"
            option-label="label"
            dense
            outlined
            emit-value
            map-options
            label="Rep"
          />
          <q-select
            v-model="syncedFilter"
            :options="syncedFilterOptions"
            option-label="label"
            dense
            outlined
            emit-value
            map-options
            label="Sync status"
          />
        </template>
      </div>

      <div class="rv-actions">
        <q-btn
          color="primary"
          outline
          no-caps
          icon="add"
          label="Contacts from note"
          to="/notes"
        >
          <q-tooltip>Paste typed notes and pull the contacts out of them</q-tooltip>
        </q-btn>

        <q-btn
          v-if="tab === 'rejected'"
          color="negative"
          no-caps
          unelevated
          label="Bulk delete selected"
          :disable="selectedIds.length === 0"
          @click="confirmBulkDelete"
        />
        <q-btn
          v-else
          color="positive"
          no-caps
          unelevated
          label="Bulk approve selected"
          :disable="selectedIds.length === 0"
          @click="confirmBulkApprove"
        />
        <ReviewViewMenu />
      </div>
    </div>

    <div v-if="isSales" class="row items-center q-gutter-md q-mb-md">
      <q-tabs v-model="salesScope" dense no-caps class="scope-tabs">
        <q-tab name="current" label="Current Event" />
        <q-tab name="past" label="Past Events" />
      </q-tabs>

      <q-select
        v-if="salesScope === 'past'"
        v-model="syncedFilter"
        :options="syncedFilterOptions"
        option-label="label"
        dense
        outlined
        emit-value
        map-options
        style="min-width: 160px"
        label="Sync status"
      />

      <!-- Self-service event linking from where a rep is already working
           (Setup's Step 1 is the guided way to join; this is the quick
           link/unlink, and the only place to unlink). Hidden while an admin
           is previewing someone else's view -- the Admin page's per-rep
           "Working at" picker is the control for setting someone else's. -->
      <template v-if="salesScope === 'current' && !sessionStore.viewingAs">
        <div class="text-caption text-grey">
          {{ sessionStore.user?.currentEventName ? `Working: ${sessionStore.user.currentEventName}` : 'Not linked to an event' }}
        </div>
        <q-btn
          v-if="eventStore.activeEvent"
          flat dense no-caps color="primary"
          :label="isLinkedToActiveEvent ? 'Unlink' : `Link to ${eventStore.activeEvent.name}`"
          @click="toggleMyCurrentEvent"
        />
      </template>
    </div>

    <UnresolvedIntakePanel :view-as-rep-id="sessionStore.viewingAs?.role === 'sales' ? sessionStore.viewingAs.id : null" />

    <div v-if="loading" class="text-center q-pa-lg">
      <q-spinner size="40px" />
    </div>

    <div v-else-if="filteredContacts.length === 0" class="text-center text-grey q-pa-lg">
      Nothing here.
    </div>

    <div v-else>
      <!-- Neither CSS Grid nor Flexbox can pack items of different heights
           without gaps — both size a shared row/line to its tallest
           member, so a collapsed card sharing one with the tall expanded
           card gets stranded above dead space (tried both, twice — see
           useMasonryGrid.ts for the full history). Every child here is
           absolutely positioned by that composable instead, measured and
           placed into whichever column has the least height so far. -->
      <div class="contacts-grid" ref="gridEl" :style="{ height: containerHeight + 'px' }">
        <div
          v-for="item in masonryItems"
          :key="item.id"
          :ref="(el) => setCardEl(item.id, el)"
          :style="styleFor(item.id)"
        >
          <ReviewContactCard
            :contact="contactsById.get(item.id)!"
            :expanded="item.id === expandedId"
            :selected="selectedMap[item.id] ?? false"
            @update:expanded="(v: boolean) => { expandedId = v ? item.id : null; }"
            @update:selected="(v: boolean) => (selectedMap[item.id] = v)"
            @approve="approve"
            @reject="reject"
            @update="update"
            @retry-match="retryMatch"
            @duplicates-resolved="load"
          />
        </div>
      </div>

      <div v-if="pageCount > 1" class="row justify-center q-mt-md">
        <q-pagination v-model="page" :max="pageCount" :max-pages="7" boundary-numbers />
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { Dialog, Notify } from 'quasar';
import { api } from '@/boot/axios';
import ReviewContactCard from '@/components/ReviewContactCard.vue';
import UnresolvedIntakePanel from '@/components/UnresolvedIntakePanel.vue';
import ReviewViewMenu from '@/components/ReviewViewMenu.vue';
import { useMasonryGrid, type MasonryItem } from '@/composables/useMasonryGrid';
import { useSessionStore } from '@/stores/session-store';
import { useEventStore } from '@/stores/event-store';
import type { ContactListItem, Profile, UpdateContactPayload } from '@/types/review';

// Every contact was previously rendered at once — with a few hundred rows
// (each carrying a multi-megabyte card photo) that made for an enormous
// page, and pushed later cards' images so far down the DOM that browser
// screenshot/paint tooling started blanking out around them. Paginating
// keeps the live DOM small enough for lazy image loading to behave.
const PER_PAGE = 20;

const sessionStore = useSessionStore();
const eventStore = useEventStore();

const tab = ref('needs_review');
const contacts = ref<ContactListItem[]>([]);
const loading = ref(false);
const selectedMap = reactive<Record<string, boolean>>({});
const page = ref(1);
// At most one contact expanded at a time — masonryItems below gives it
// span: 2, everything else span: 1.
const expandedId = ref<string | null>(null);
const gridEl = ref<HTMLElement | null>(null);
const profiles = ref<Profile[]>([]);
const repFilter = ref<string | null>(null);
const syncedFilterOptions = [
  { label: 'All', value: null },
  { label: 'Not yet synced', value: 'false' },
  { label: 'Already synced', value: 'true' },
];
const syncedFilter = ref<string | null>(null);
const salesScope = ref<'current' | 'past'>('current');
const eventFilter = ref<string | null>(null);
const followedUpFilterOptions = [
  { label: 'All', value: null },
  { label: 'Not yet followed up', value: 'false' },
  { label: 'Already followed up', value: 'true' },
];
const followedUpFilter = ref<string | null>(null);

// Whichever role Review is actually scoped to — the real logged-in user's,
// or (admin only) whoever they're previewing via the user switcher.
const isSales = computed(() => sessionStore.effectiveRole === 'sales');

const isLinkedToActiveEvent = computed(() => (
  !!eventStore.activeEvent && sessionStore.user?.currentEventId === eventStore.activeEvent.id
));

const repFilterOptions = computed(() => [
  { label: 'All reps', value: null },
  ...profiles.value.filter((p) => p.role === 'sales').map((p) => ({ label: p.name, value: p.id })),
]);

// Only what's on screen counts. selectedMap is keyed by every loaded contact
// and survives a page change or a Conference / Follow-up filter change, so
// counting all of it let "Bulk approve" (and "Bulk delete") act on cards the
// rep could no longer see, with only the dialog's count to hint at it.
const selectedIds = computed(() => pagedContacts.value.filter((c) => selectedMap[c.id]).map((c) => c.id));

// Built from whichever conferences are actually present in the currently
// loaded contacts, not the full events table — see the template comment.
const eventFilterOptions = computed(() => {
  const seen = new Map<string, string>();
  for (const c of contacts.value) {
    if (!seen.has(c.eventId)) seen.set(c.eventId, c.eventName);
  }
  return [
    { label: 'All conferences', value: null as string | null },
    ...Array.from(seen.entries()).map(([value, label]) => ({ label, value })),
  ];
});

const filteredContacts = computed(() => {
  let list = eventFilter.value ? contacts.value.filter((c) => c.eventId === eventFilter.value) : contacts.value;
  // Only meaningful on the Approved tab — this is where a rep works through
  // who they still need to call, not a general-purpose filter.
  if (tab.value === 'approved' && followedUpFilter.value) {
    const wantFollowedUp = followedUpFilter.value === 'true';
    list = list.filter((c) => c.followedUp === wantFollowedUp);
  }
  return list;
});

const pageCount = computed(() => Math.max(1, Math.ceil(filteredContacts.value.length / PER_PAGE)));
const pagedContacts = computed(() => filteredContacts.value.slice((page.value - 1) * PER_PAGE, page.value * PER_PAGE));

const contactsById = computed(() => new Map(pagedContacts.value.map((c) => [c.id, c])));
const masonryItems = computed<MasonryItem[]>(() => (
  pagedContacts.value.map((c) => ({ id: c.id, span: c.id === expandedId.value ? 2 : 1 }))
));
const { styleFor, containerHeight, setCardEl } = useMasonryGrid(
  () => gridEl.value,
  () => masonryItems.value,
  { minColWidth: 320, gap: 16 },
);

async function load() {
  loading.value = true;
  try {
    const params: Record<string, string> = { reviewStatus: tab.value };
    if (sessionStore.viewingAs?.role === 'sales') params.viewAsRepId = sessionStore.viewingAs.id;

    if (isSales.value) {
      params.scope = salesScope.value;
      if (salesScope.value === 'past' && syncedFilter.value) params.synced = syncedFilter.value;
    } else {
      if (repFilter.value) params.repId = repFilter.value;
      if (syncedFilter.value) params.synced = syncedFilter.value;
    }

    const { data } = await api.get<ContactListItem[]>('/contacts-list', { params });
    contacts.value = data;
    for (const key of Object.keys(selectedMap)) delete selectedMap[key];
    for (const c of data) selectedMap[c.id] = false;
    expandedId.value = null;
    if (page.value > pageCount.value) page.value = pageCount.value;
  } finally {
    loading.value = false;
  }
}

// After a status change, the contact only needs to disappear from the
// current list when its new status no longer matches the active tab —
// otherwise (e.g. re-approving while already on the Approved tab) it just
// stays put with its updated fields, same card, no reshuffle.
function applyStatusChange(id: string, reviewStatus: string) {
  if (reviewStatus === tab.value) {
    const contact = contacts.value.find((c) => c.id === id);
    if (contact) contact.reviewStatus = reviewStatus;
    return;
  }
  contacts.value = contacts.value.filter((c) => c.id !== id);
  delete selectedMap[id];
  if (page.value > pageCount.value) page.value = pageCount.value;
}

// pendingEdits: unsaved field edits from the open card. They used to be
// dropped here — Approve sent only reviewStatus — so a typo fixed but not
// Saved exported uncorrected. One PATCH, so the edit and the approval land
// (or fail) together.
async function approve(id: string, pendingEdits?: UpdateContactPayload) {
  await api.patch(`/contacts-patch`, { ...pendingEdits, reviewStatus: 'approved' }, { params: { id } });
  applyStatusChange(id, 'approved');
}

async function reject(id: string) {
  await api.patch(`/contacts-patch`, { reviewStatus: 'rejected' }, { params: { id } });
  applyStatusChange(id, 'rejected');
}

async function update(id: string, payload: UpdateContactPayload) {
  await api.patch(`/contacts-patch`, payload, { params: { id } });
  const contact = contacts.value.find((c) => c.id === id);
  if (contact) Object.assign(contact, payload);
}

async function retryMatch(id: string) {
  // Matching runs async on the server via a queue — there's nothing new to
  // show immediately, so there's nothing here worth reloading the list for.
  await api.post(`/contacts-retry-match`, undefined, { params: { id } });
}

function confirmBulkApprove() {
  const count = selectedIds.value.length;
  Dialog.create({
    title: 'Approve selected contacts?',
    message: `Approve ${count} selected contact${count === 1 ? '' : 's'}? They'll be included in the next CSV export.`,
    cancel: true,
    persistent: true,
    ok: { label: 'Approve', color: 'positive' },
  }).onOk(bulkApprove);
}

// contacts-bulk-approve answers 200 with { approved, skipped } even when it
// skipped some (a contact still matching, or one that's gone). The response
// used to be discarded, so selecting 10 and getting 7 approved looked like
// complete success and the other 3 just sat there unexplained.
async function bulkApprove() {
  const { data } = await api.post<{ approved: string[]; skipped: { id: string; reason: string }[] }>(
    '/contacts-bulk-approve',
    { ids: selectedIds.value },
  );
  await load();

  const approvedCount = data.approved.length;
  const skippedCount = data.skipped.length;
  if (skippedCount === 0) {
    Notify.create({ type: 'positive', message: `Approved ${approvedCount} contact${approvedCount === 1 ? '' : 's'}.` });
    return;
  }
  const stillMatching = data.skipped.filter((s) => s.reason === 'still pending').length;
  const parts: string[] = [];
  if (stillMatching) parts.push(`${stillMatching} still matching`);
  if (skippedCount - stillMatching) parts.push(`${skippedCount - stillMatching} not found`);
  Notify.create({
    type: 'warning',
    timeout: 8000,
    message: `Approved ${approvedCount}, skipped ${skippedCount} (${parts.join(', ')}). Skipped contacts stay in Needs Review.`,
  });
}

function confirmBulkDelete() {
  const count = selectedIds.value.length;
  Dialog.create({
    title: 'Delete rejected contacts?',
    message: `This permanently deletes ${count} rejected contact${count === 1 ? '' : 's'}. This can't be undone.`,
    cancel: true,
    persistent: true,
    ok: { label: 'Delete', color: 'negative' },
  }).onOk(bulkDelete);
}

async function bulkDelete() {
  await api.post('/contacts-bulk-delete', { ids: selectedIds.value });
  await load();
}

async function toggleMyCurrentEvent() {
  const eventId = isLinkedToActiveEvent.value ? null : (eventStore.activeEvent?.id ?? null);
  await api.post('/profiles-set-current-event', { eventId });
  await sessionStore.fetchMe();
  await load();
  Notify.create({ type: 'positive', message: eventId ? 'Linked to this event.' : 'Unlinked.' });
}

watch(tab, () => {
  page.value = 1;
  void load();
});
watch([repFilter, syncedFilter, salesScope], () => {
  page.value = 1;
  void load();
});
// Conference filter slices the already-loaded list client-side (its options
// come from that same list), so it only needs to reset pagination, not
// trigger a server round-trip.
watch(eventFilter, () => {
  page.value = 1;
});
watch(followedUpFilter, () => {
  page.value = 1;
});
// Changing pages closes whatever's expanded — otherwise its own slot would
// keep showing a contact that's no longer part of the visible page.
watch(page, () => {
  expandedId.value = null;
});

onMounted(async () => {
  const loads: Promise<unknown>[] = [load()];
  if (!isSales.value) {
    loads.push(api.get<Profile[]>('/profiles-list').then(({ data }) => { profiles.value = data; }));
  }
  await Promise.all(loads);
});
</script>

<style scoped>
/* Children are absolutely positioned by useMasonryGrid.ts (each measured
   and placed into whichever column has the least height so far) — CSS
   Grid and Flexbox were both tried and both size a shared row/line to its
   tallest member, stranding short cards above dead space next to the
   expanded one. position: relative here is what makes the children's
   position: absolute coordinates relative to this container rather than
   the page. */
.contacts-grid {
  position: relative;
}

/* Cards reposition (top/left/width, set inline by useMasonryGrid) after
   every approve/reject/expand/collapse — animating that move instead of
   snapping it keeps a reviewer from losing their place mid-triage. */
.contacts-grid > div {
  transition: top 0.25s ease, left 0.25s ease, width 0.25s ease;
}

@media (prefers-reduced-motion: reduce) {
  .contacts-grid > div {
    transition: none;
  }
}

.rv-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 16px;
}
.rv-heading {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.rv-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-left: auto;
}
.rv-filters .q-select {
  min-width: 170px;
}
.rv-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

@media (max-width: 599px) {
  .rv-bar { gap: 8px 12px; }
  .rv-tabs { order: 2; width: 100%; }
  .rv-heading { order: 1; width: 100%; }
  .rv-filters {
    order: 3;
    display: grid;
    grid-template-columns: 1fr 1fr;
    width: 100%;
    margin-left: 0;
    gap: 8px;
  }
  .rv-filters .q-select { min-width: 0; }
  .rv-actions { order: 4; width: 100%; }
  .rv-actions .q-btn { flex: 1; min-height: 44px; }
  /* The view menu is an icon, not a full-width action. */
  .rv-actions .q-btn[aria-label='Review options'] { flex: none; min-width: 44px; }
}

.scope-tabs {
  background: #EEF3F8;
  border-radius: 12px;
  padding: 4px;
  min-height: auto;
}

.scope-tabs :deep(.q-tab) {
  border-radius: 8px;
  min-height: 32px;
  color: #5b7185;
  font-weight: 500;
  padding: 0 14px;
}

.scope-tabs :deep(.q-tab--active) {
  background: white;
  color: var(--q-primary);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}
</style>

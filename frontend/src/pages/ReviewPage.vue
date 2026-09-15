<template>
  <q-page class="q-pa-md">
    <div class="row items-center q-mb-md q-gutter-md">
      <div class="text-h5">Review</div>
      <q-tabs v-model="tab" dense class="col-auto">
        <q-tab name="needs_review" label="Needs Review" />
        <q-tab name="approved" label="Approved" />
        <q-tab name="rejected" label="Rejected" />
      </q-tabs>
      <div v-if="contacts.length" class="text-caption text-grey">{{ contacts.length }} contact{{ contacts.length === 1 ? '' : 's' }}</div>
      <q-space />

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
        style="min-width: 200px"
        label="Conference"
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
          style="min-width: 180px"
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
          style="min-width: 160px"
          label="Sync status"
        />
      </template>

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
        label="Bulk delete selected"
        :disable="selectedIds.length === 0"
        @click="confirmBulkDelete"
      />
      <q-btn
        v-else
        color="positive"
        label="Bulk approve selected"
        :disable="selectedIds.length === 0"
        @click="bulkApprove"
      />
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

      <!-- Self-service event linking — a rep has no Setup access, so this
           is the only place they can set their own current event. Hidden
           while an admin is previewing someone else's view (that's what
           Setup's own per-rep control is for). -->
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

    <div v-if="loading" class="text-center q-pa-lg">
      <q-spinner size="40px" />
    </div>

    <div v-else-if="filteredContacts.length === 0" class="text-center text-grey q-pa-lg">
      Nothing here.
    </div>

    <div v-else>
      <!-- Expanded card is a flex item alongside the collapsed ones, not a
           separate CSS grid track — a grid row's height is set by its
           tallest member, so sharing a grid row stretched every short
           neighbor over dead space below it. Flexbox rows don't stretch to
           match siblings (align-items: flex-start), so the collapsed cards
           can wrap into the space beside the expanded one instead of
           leaving it empty. -->
      <div class="contacts-grid">
        <ReviewContactCard
          v-if="expandedContact"
          :key="expandedContact.id"
          :contact="expandedContact"
          :expanded="true"
          :selected="selectedMap[expandedContact.id] ?? false"
          class="expanded-card"
          @update:expanded="(v: boolean) => { if (!v) expandedId = null; }"
          @update:selected="(v: boolean) => (selectedMap[expandedContact!.id] = v)"
          @approve="approve"
          @reject="reject"
          @update="update"
          @retry-match="retryMatch"
          @duplicates-resolved="load"
        />
        <ReviewContactCard
          v-for="contact in gridContacts"
          :key="contact.id"
          :contact="contact"
          :expanded="false"
          :selected="selectedMap[contact.id] ?? false"
          class="collapsed-card"
          @update:expanded="(v: boolean) => { if (v) expandedId = contact.id; }"
          @update:selected="(v: boolean) => (selectedMap[contact.id] = v)"
          @approve="approve"
          @reject="reject"
          @update="update"
          @retry-match="retryMatch"
          @duplicates-resolved="load"
        />
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
// At most one contact expanded at a time — the layout only has one
// enlarged flex-basis slot (see .expanded-card below).
const expandedId = ref<string | null>(null);
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

const selectedIds = computed(() => Object.keys(selectedMap).filter((id) => selectedMap[id]));

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

const filteredContacts = computed(() => (
  eventFilter.value ? contacts.value.filter((c) => c.eventId === eventFilter.value) : contacts.value
));

const pageCount = computed(() => Math.max(1, Math.ceil(filteredContacts.value.length / PER_PAGE)));
const pagedContacts = computed(() => filteredContacts.value.slice((page.value - 1) * PER_PAGE, page.value * PER_PAGE));

// Looked up in the full list, not just pagedContacts, so it stays rendered
// even if a reload happens to shift it off the current page.
const expandedContact = computed(() => contacts.value.find((c) => c.id === expandedId.value) ?? null);
// The expanded contact (if on this page) is rendered separately above, in
// its own non-grid slot — see the template comment.
const gridContacts = computed(() => pagedContacts.value.filter((c) => c.id !== expandedId.value));

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

async function approve(id: string) {
  await api.patch(`/contacts-patch`, { reviewStatus: 'approved' }, { params: { id } });
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

async function bulkApprove() {
  await api.post('/contacts-bulk-approve', { ids: selectedIds.value });
  await load();
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
/* Flexbox, not CSS grid — a grid row's track height is set by its tallest
   member, so the expanded card (tall) sharing a row with collapsed ones
   (short) stretched the whole row and stranded the short cards above dead
   space. Flex rows don't stretch siblings to match height (align-items:
   flex-start), so collapsed cards wrap into the space beside the expanded
   one instead of leaving it empty. */
.contacts-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: flex-start;
}

/* Roughly half the page width, per how big an expanded card should feel —
   comfortable for the edit form without taking over the whole row like the
   old full-width version did. */
.expanded-card {
  flex: 0 1 50%;
  min-width: 360px;
}

/* Grow to fill remaining row space (mirrors the old grid's
   minmax(320px, 1fr) auto-fill columns) while wrapping once a row fills up. */
.collapsed-card {
  flex: 1 1 320px;
  max-width: 100%;
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

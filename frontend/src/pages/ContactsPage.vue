<template>
  <q-page class="rs-page">
    <div v-if="!loaded" class="text-center q-pa-lg"><q-spinner size="40px" color="primary" /></div>

    <div v-else class="rs-split" :class="{ 'is-split': isDesktop }">
      <div class="rs-left">
        <!-- On a laptop this row sits at the top of the list column, with the list
             and its editor pane side by side below. -->
        <ContactsHeader
          v-model:segment="segment"
          v-model:search="search"
          :counts="counts"
          :filter-count="filterCount"
          :conference-line="conferenceText"
          :rejected="showRejected"
          :rejected-count="rejectedMatching.length"
          @open-filter="openFilter"
          @back-to-contacts="filters = { ...filters, show: 'contacts' }"
        />

        <!-- Scans nobody could place under a conference. Real role, not effectiveRole,
             and never while previewing someone: it holds other people's submissions,
             including ones with no rep, so a rep (or an admin looking as one) must not
             see it. -->
        <UnassignedScansBanner v-if="canSeeUnassigned" />
        <UnresolvedIntakePanel :view-as-rep-id="sessionStore.viewingAs?.role === 'sales' ? sessionStore.viewingAs.id : null" />

        <div v-if="showRejected && visible.length" class="rs-bulk">
          <q-checkbox :model-value="allSelected" label="Select all" @update:model-value="toggleSelectAll" />
          <q-btn unelevated no-caps color="negative" icon="delete" :label="`Delete ${selectedVisibleIds.length} selected`" :disable="selectedVisibleIds.length === 0" class="rs-bulk-btn" @click="confirmBulkDelete" />
        </div>

        <!-- With Ready selected, everything listed is ready, so one button confirms
             the lot (the same dialog and request as ever). It acts only on what is
             on screen. -->
        <ContactsConfirmAll v-if="showConfirmAll" :count="readyCount" @click="confirmApproveReady" />

        <!-- A rep who picked Earlier or All conferences: one section per conference,
             so a big history stays tidy. -->
        <template v-if="grouped">
          <section v-for="(g, i) in groups" :key="g.eventId" class="rs-section">
            <div class="rs-sec-head">
              <button type="button" class="rs-sec-toggle" :aria-expanded="isGroupOpen(g.eventId, i)" @click="toggleGroup(g.eventId, i)">
                <q-icon :name="isGroupOpen(g.eventId, i) ? 'expand_more' : 'chevron_right'" size="22px" />
                <span class="rs-sec-title">
                  <span class="rs-sec-name">{{ g.eventName }}</span>
                  <span class="rs-sec-sub">{{ g.leads.length }} {{ g.leads.length === 1 ? 'contact' : 'contacts' }}</span>
                </span>
              </button>
            </div>
            <ContactList
              v-if="isGroupOpen(g.eventId, i)"
              :leads="g.leads"
              :active-id="isDesktop ? (activeLead?.id ?? null) : null"
              :compact="isDesktop"
              :busy="busy"
              :selectable="showRejected"
              :selected-ids="deleteSel"
              :animate="sliding"
              v-bind="rowHandlers"
            />
          </section>
        </template>

        <!-- Everyone else: one flat list. A manager's and a search's cards name their
             conference themselves. -->
        <ContactList
          v-else-if="visible.length"
          :leads="visible"
          :active-id="isDesktop ? (activeLead?.id ?? null) : null"
          :compact="isDesktop"
          :busy="busy"
          :show-event="showEventOnCards"
          :show-rep="!isSales"
          :selectable="showRejected"
          :selected-ids="deleteSel"
          :animate="sliding"
          v-bind="rowHandlers"
        />

        <!-- Empty states say why it's empty and what to do. -->
        <div v-if="!visible.length" class="rs-empty">
          <q-icon :name="emptyState.icon" size="44px" :color="emptyState.color" />
          <div class="rs-empty-title">{{ emptyState.title }}</div>
          <div class="rs-empty-body">{{ emptyState.body }}</div>
          <q-btn v-if="emptyState.action" unelevated no-caps color="primary" :label="emptyState.action.label" class="q-mt-md" @click="emptyState.action.run" />
        </div>
      </div>

      <aside v-if="isDesktop" class="rs-pane" aria-label="Contact details">
        <ContactEditor
          v-if="activeLead"
          ref="editorRef"
          :key="activeLead.id"
          :contact="activeLead"
          :is-sales="isSales"
          :busy="busy.has(activeLead.id)"
          :position="position"
          show-keys
          @approve="onApprove"
          @reject="onReject"
          @restore="onRestore"
          @update="onUpdate"
          @retry-match="retryMatch"
          @duplicates-resolved="load({ keepOrder: true })"
          @prev="step(-1)"
          @next="step(1)"
        />
        <div v-else class="rs-pane-empty">Select a contact.</div>
      </aside>
      <!-- Inside the loaded block, after the header: the laptop's dropdown finds the Filter
           button (#cf-filter-btn) when it mounts, so it must mount after the header does. -->
      <ContactsFilter
        v-model="filters"
        v-model:open="filterOpen"
        :desktop="isDesktop"
        :is-sales="isSales"
        :home="home"
        :event-options="eventOptions"
        :source-options="sourceOptions"
        :rep-options="repFilterOptions"
        :rejected-count="rejectedMatching.length"
        :shown-count="visible.length"
        :focus-section="filterFocus"
      />
    </div>

    <AddNoteDialog v-model="noteDialogOpen" :name="noteTarget ? fullName(noteTarget) : ''" @save="onSaveNote" />

    <!-- Phone / tablet: the same editor as a bottom sheet. -->
    <q-dialog v-if="!isDesktop" :model-value="sheetOpen" position="bottom" persistent full-width @escape-key="closeSheet">
      <q-card v-if="activeLead" class="rs-sheet">
        <ContactEditor
          ref="editorRef"
          :key="activeLead.id"
          :contact="activeLead"
          :is-sales="isSales"
          :busy="busy.has(activeLead.id)"
          :position="position"
          closable
          @approve="onApprove"
          @reject="onReject"
          @restore="onRestore"
          @update="onUpdate"
          @retry-match="retryMatch"
          @duplicates-resolved="load({ keepOrder: true })"
          @close="closeSheet"
          @prev="step(-1)"
          @next="step(1)"
        />
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import { ref, reactive, shallowRef, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { useQuasar, Dialog } from 'quasar';
import { api } from '@/boot/axios';
import UnresolvedIntakePanel from '@/components/UnresolvedIntakePanel.vue';
import UnassignedScansBanner from '@/components/UnassignedScansBanner.vue';
import ContactsHeader from '@/components/ContactsHeader.vue';
import ContactsFilter from '@/components/ContactsFilter.vue';
import ContactsConfirmAll from '@/components/ContactsConfirmAll.vue';
import ContactList from '@/components/contacts/ContactList.vue';
import ContactEditor from '@/components/contacts/ContactEditor.vue';
import AddNoteDialog from '@/components/contacts/AddNoteDialog.vue';
import { useContacts, type DisplayPatch } from '@/composables/useContacts';
import { useSessionStore } from '@/stores/session-store';
import type { ContactListItem, Profile, UpdateContactPayload } from '@/types/review';
import {
  DEFAULT_FILTERS, DEFAULT_SORT, activeFilterCount, appendNote, buildRank, conferenceLine, conferenceOptions, eventRecency, filterByFollowUp,
  filterBySource, fullName, groupByEvent, groupedByConference, homeConference, inConferenceView, inSegment, isProcessing, orderByRank,
  orderDeck, readyIds, searchLeads, sourceFilterOptions, statusCounts,
  type ConferenceView, type ContactFilters, type LeadRank, type StatusSegment,
} from '@/utils/contactsList';

const $q = useQuasar();
const router = useRouter();
const sessionStore = useSessionStore();
const { buckets, loaded, busy, serverFilters, load: loadLeads, find, approve, reject, restore, update, retryMatch, bulkApprove, bulkDelete } = useContacts();

const isSales = computed(() => sessionStore.effectiveRole === 'sales');
const canSeeUnassigned = computed(() => !sessionStore.viewingAs && ['admin', 'solutionsSuccess'].includes(sessionStore.user?.role ?? ''));
// Quasar's md breakpoint (1024px) and up: room for the list and the editor
// side by side, and the Filter panel as a dropdown. Below it the editor and the
// Filter panel are bottom sheets.
const isDesktop = computed(() => $q.screen.gt.sm);

// ── What the person has asked for ────────────────────────────────────────

const search = ref<string | null>('');
const searchText = computed(() => (search.value ?? '').trim());
// The status bar's selection: one at a time, tap again to clear (the header does).
const segment = ref<StatusSegment>('all');
// Everything in the Filter panel (utils: ContactFilters).
const filters = ref<ContactFilters>({ ...DEFAULT_FILTERS });
const filterOpen = ref(false);
const filterFocus = ref<'conference' | null>(null);
const profiles = ref<Profile[]>([]);

const showRejected = computed(() => filters.value.show === 'rejected');
const filterCount = computed(() => activeFilterCount(filters.value, isSales.value));
function openFilter(section: 'conference' | null) {
  filterFocus.value = section;
  filterOpen.value = true;
}

// The lead the rep just edited stays listed even if the edit stops it matching the
// search or the status bar (it became Ready while "Needs info" was on): otherwise it
// vanishes mid-edit and the pane quietly switches to another lead. It is dropped as
// soon as the rep opens a different lead, closes the sheet, or changes the search /
// filter, so it never lingers.
const pinnedId = ref<string | null>(null);
const selectedId = ref<string | null>(null); // desktop
const sheetId = ref<string | null>(null); // phone

// A contact confirmed one at a time is HELD: it turns confirmed where it stands (green
// edge, "Confirmed", no ✓ ✕) and is not re-sorted. It slides down to the confirmed
// group only when the person goes on to another contact (settleOthers), because moving
// the row they just tapped is the 2026-10-01 incident again. See "The deck" in
// utils/contactsList.ts. A reactive Set: the list recomputes when it changes.
const held = reactive(new Set<string>());
function settleOthers(keepId: string | null) {
  const settling = [...held].filter((id) => id !== keepId);
  if (!settling.length) return;
  // The slide runs for this re-render only; anything else that moves rows (a resize,
  // the processing poll, a filter change) stays still. Set in the same tick as the
  // delete, so the list sees both in one render.
  startSliding();
  for (const id of settling) held.delete(id);
}
const sliding = ref(false);
let slideTimer: ReturnType<typeof setTimeout> | null = null;
function startSliding() {
  sliding.value = true;
  if (slideTimer !== null) clearTimeout(slideTimer);
  slideTimer = setTimeout(() => { sliding.value = false; slideTimer = null; }, 600);
}

// The order the lists are shown in, fixed when it is computed rather than recomputed
// from each lead's current flags (see "Frozen order" in contactsList.ts): saving a
// lead must not send it to the bottom of the list. It is rebuilt on a (re)load and when
// the rep changes the sort; a quiet background refresh keeps it, so leads don't
// reshuffle under someone typing. The sort applies to the unconfirmed group; the
// confirmed group keeps its own (follow up first, then newest).
const rank = shallowRef<LeadRank>(new Map());
function reorder() {
  rank.value = buildRank(buckets, { needs_review: filters.value.sort, approved: DEFAULT_SORT.approved, rejected: DEFAULT_SORT.rejected });
}
async function load(opts: { keepOrder?: boolean } = {}) {
  await loadLeads({ quiet: Boolean(opts.keepOrder) });
  if (!opts.keepOrder) reorder();
}

// ── Which conference ─────────────────────────────────────────────────────

const allLeads = computed(() => [...buckets.needs_review, ...buckets.approved, ...buckets.rejected]);
// The rep's own conference: the signed-in rep's, or the previewed rep's.
const currentEvent = computed(() => {
  const who = sessionStore.viewingAs ? sessionStore.preview : sessionStore.user;
  return { id: who?.currentEventId ?? null, name: who?.currentEventName ?? null };
});
const home = computed(() => homeConference(allLeads.value, currentEvent.value));
const view = computed<ConferenceView>(() => ({
  isSales: isSales.value,
  scope: filters.value.scope,
  eventId: filters.value.eventId,
  home: home.value,
  searching: searchText.value !== '',
}));
const grouped = computed(() => groupedByConference(view.value));
const eventOptions = computed(() => conferenceOptions(allLeads.value));
const conferenceText = computed(() => conferenceLine(view.value, eventOptions.value.find((o) => o.value === filters.value.eventId)?.label ?? null));
// Cards name their conference where the list does not already: a manager's list, and
// a search (which crosses conferences).
const showEventOnCards = computed(() => !isSales.value || searchText.value !== '');

const sourceOptions = computed(() => sourceFilterOptions(allLeads.value));
const repFilterOptions = computed(() => [
  { label: 'All reps', value: null as string | null },
  ...profiles.value.filter((p) => p.role === 'sales').map((p) => ({ label: p.name, value: p.id as string | null })),
]);

// ── The lists ────────────────────────────────────────────────────────────

function narrow(list: ContactListItem[]) {
  return filterBySource(list.filter((c) => inConferenceView(c, view.value)), filters.value.source);
}

// Everything the person has asked for except the status bar's selection: conference,
// followed up, source and search. The segment counts come from here, so they describe
// the list rather than the filtered view, and a number is what the list shows.
const matching = computed(() => searchLeads(filterByFollowUp(narrow([...buckets.needs_review, ...buckets.approved]), filters.value.follow), searchText.value));
const counts = computed(() => statusCounts(matching.value));

// One list: unconfirmed first, then confirmed. A held or just-edited lead stays in it
// even when it no longer matches the status bar or the filters.
const deck = computed(() => {
  const keep = new Set(held);
  if (pinnedId.value) keep.add(pinnedId.value);
  const picked = matching.value.filter((c) => inSegment(c, segment.value) || keep.has(c.id));
  if (keep.size) {
    const have = new Set(picked.map((c) => c.id));
    for (const c of [...buckets.needs_review, ...buckets.approved]) if (keep.has(c.id) && !have.has(c.id)) picked.push(c);
  }
  return orderDeck(
    picked.filter((c) => c.reviewStatus === 'needs_review'),
    picked.filter((c) => c.reviewStatus === 'approved'),
    rank.value,
    held,
  );
});

// Rejected contacts are hidden; Filter -> Show: Rejected is the only way to them.
const rejectedMatching = computed(() => searchLeads(narrow(buckets.rejected), searchText.value));
const rejectedLeads = computed(() => orderByRank(rejectedMatching.value, 'rejected', rank.value));

const visible = computed(() => (showRejected.value ? rejectedLeads.value : deck.value));

// Event order comes from every status, so the sections keep their order as the
// person moves between views.
const recency = computed(() => eventRecency(allLeads.value));
const groups = computed(() => (grouped.value ? groupByEvent(visible.value, recency.value) : []));

// The first conference is open, the rest folded until asked for; picking a status
// opens them all, so "Confirm all" and the list never disagree about what is on screen.
const groupOpen = reactive<Record<string, boolean>>({});
function isGroupOpen(eventId: string, index: number) {
  return groupOpen[eventId] ?? (index === 0 || segment.value !== 'all');
}
function toggleGroup(eventId: string, index: number) {
  groupOpen[eventId] = !isGroupOpen(eventId, index);
}

// Every lead currently on screen, in order: what J / K, next / previous and "select
// all" walk. A lead inside a folded section isn't in it.
const flatLeads = computed<ContactListItem[]>(() => (
  grouped.value ? groups.value.flatMap((g, i) => (isGroupOpen(g.eventId, i) ? g.leads : [])) : visible.value
));

const readyCount = computed(() => readyIds(flatLeads.value).length);
const showConfirmAll = computed(() => !showRejected.value && segment.value === 'ready' && readyCount.value > 0);

// ── Empty states ─────────────────────────────────────────────────────────

const narrowed = computed(() => (
  searchText.value !== '' || segment.value !== 'all' || filters.value.follow !== 'any' || filters.value.source !== null
  || (!isSales.value && (filters.value.eventId !== null || filters.value.repId !== null || filters.value.synced !== null))
));
function clearAll() {
  search.value = '';
  segment.value = 'all';
  filters.value = { ...DEFAULT_FILTERS, show: filters.value.show };
}

const emptyState = computed<{ icon: string; color: string; title: string; body: string; action?: { label: string; run: () => void } }>(() => {
  if (narrowed.value) {
    return {
      icon: 'search_off', color: 'grey-6', title: 'No contacts match',
      body: 'Nothing fits your search, filters or status. Clear them to see everything.',
      action: { label: 'Clear search and filters', run: clearAll },
    };
  }
  if (showRejected.value) {
    return { icon: 'inbox', color: 'grey-6', title: 'Nothing rejected', body: 'Rejected contacts show up here until you restore or delete them.' };
  }
  if (allLeads.value.length === 0) {
    if (isSales.value && !currentEvent.value.id) {
      return {
        icon: 'event', color: 'primary', title: 'Choose a conference to get started',
        body: 'Contacts you capture at your conference show up here. Choose one in Setup.',
        // Previewing someone else: Setup would open the admin's own, not theirs.
        ...(sessionStore.viewingAs ? {} : { action: { label: 'Go to Setup', run: () => void router.push('/setup') } }),
      };
    }
    return { icon: 'inbox', color: 'grey-6', title: 'No contacts yet', body: 'Cards, notes and form entries show up here as they come in.' };
  }
  if (isSales.value && filters.value.scope !== 'all') {
    return {
      icon: 'inbox', color: 'grey-6', title: 'No contacts here yet', body: 'Cards, notes and form entries show up here as they come in.',
      action: { label: 'Show all conferences', run: () => { filters.value = { ...filters.value, scope: 'all' }; } },
    };
  }
  return { icon: 'inbox', color: 'grey-6', title: 'No contacts yet', body: 'Cards, notes and form entries show up here as they come in.' };
});

// ── The open lead (desktop pane / phone sheet) ───────────────────────────

const editorRef = ref<InstanceType<typeof ContactEditor> | null>(null);

const activeLead = computed<ContactListItem | null>(() => {
  if (!isDesktop.value) return sheetId.value ? find(sheetId.value) ?? null : null;
  // Desktop always has one selected: whatever was picked if it's still on
  // screen, otherwise the first lead, so the pane is never a dead end.
  return flatLeads.value.find((c) => c.id === selectedId.value) ?? flatLeads.value[0] ?? null;
});
const sheetOpen = computed(() => !isDesktop.value && !!activeLead.value);

const position = computed(() => {
  const idx = flatLeads.value.findIndex((c) => c.id === activeLead.value?.id);
  return idx >= 0 ? { index: idx + 1, total: flatLeads.value.length } : null;
});

// Selecting a contact is what settles a confirmed one (see `held`): every held
// contact except this one slides down to the confirmed group.
function setActive(id: string | null) {
  if (pinnedId.value !== id) pinnedId.value = null;
  if (id !== null) settleOthers(id);
  if (isDesktop.value) selectedId.value = id;
  else sheetId.value = id;
}

// Leaving a lead with unsaved edits asks first; the editor holds the draft,
// so without this a tap on another row silently threw the typing away.
function confirmDiscard(): Promise<boolean> {
  if (!editorRef.value?.isDirty) return Promise.resolve(true);
  return new Promise((resolve) => {
    Dialog.create({
      title: 'Discard unsaved changes?',
      message: "You edited this contact but haven't saved. Confirm saves them; otherwise they'll be lost.",
      persistent: true,
      cancel: { label: 'Keep editing', flat: true },
      ok: { label: 'Discard', color: 'negative', flat: true },
    }).onOk(() => resolve(true)).onCancel(() => resolve(false)).onDismiss(() => resolve(false));
  });
}

async function openLead(id: string) {
  if (activeLead.value && activeLead.value.id !== id && !(await confirmDiscard())) return;
  setActive(id);
}
async function closeSheet() {
  if (!(await confirmDiscard())) return;
  sheetId.value = null;
  pinnedId.value = null;
}
async function step(delta: number) {
  const idx = flatLeads.value.findIndex((c) => c.id === activeLead.value?.id);
  const next = flatLeads.value[idx + delta];
  if (idx < 0 || !next) return;
  await openLead(next.id);
}

// When the open lead is confirmed / rejected / restored, move on to the next lead in
// the same state (the next unconfirmed one after a Confirm, not a confirmed one at the
// bottom) so a run of decisions is one tap each. Worked out BEFORE the request, since
// the lead leaves its place when it succeeds. Moving on is selecting another contact,
// so it settles a confirmed one (setActive).
async function thenAdvance(id: string, run: () => Promise<boolean>) {
  const wasOpen = activeLead.value?.id === id;
  let nextId: string | null = null;
  if (wasOpen) {
    const state = find(id)?.reviewStatus;
    const idx = flatLeads.value.findIndex((c) => c.id === id);
    const alike = (c: ContactListItem) => c.id !== id && c.reviewStatus === state;
    nextId = flatLeads.value.slice(idx + 1).find(alike)?.id ?? flatLeads.value.slice(0, Math.max(idx, 0)).reverse().find(alike)?.id ?? null;
  }
  const ok = await run();
  if (ok && wasOpen) setActive(nextId);
}

// One lead confirmed on its own: held in place until the person goes on to another.
// Held BEFORE the request, since the lead's status changes the moment it lands and
// the list must already be holding it by then.
async function confirmOne(id: string, edits?: UpdateContactPayload, display?: DisplayPatch) {
  settleOthers(id);
  held.add(id);
  const ok = await approve(id, edits, display);
  if (!ok) held.delete(id);
  return ok;
}
async function rejectOne(id: string) {
  settleOthers(id);
  return reject(id);
}
async function restoreOne(id: string) {
  settleOthers(id);
  return restore(id);
}

const onApprove = (p: { id: string; edits?: UpdateContactPayload | undefined; display?: DisplayPatch | undefined }) => thenAdvance(p.id, () => confirmOne(p.id, p.edits, p.display));
const onReject = (id: string) => thenAdvance(id, () => rejectOne(id));
const onRestore = (id: string) => thenAdvance(id, () => restoreOne(id));
// Pinned BEFORE the request: the edit changes the lead in place as soon as it
// lands, and the list must already be holding it by then.
const onUpdate = (p: { id: string; payload: UpdateContactPayload; display?: DisplayPatch | undefined; message?: string | undefined }) => {
  pinnedId.value = p.id;
  return update(p.id, p.payload, p.display, p.message);
};

// Row-level events, shared by every list on the page. Each one is an interaction
// with that contact, so it settles any confirmed contact above it.
const rowHandlers = {
  onOpen: (id: string) => void openLead(id),
  onApprove: (id: string) => void thenAdvance(id, () => confirmOne(id)),
  onReject: (id: string) => void thenAdvance(id, () => rejectOne(id)),
  onRestore: (id: string) => void thenAdvance(id, () => restoreOne(id)),
  // Pinned like an edit: ticking Followed up under "Not yet" must not make the row
  // vanish from under the finger.
  onFollowedUp: (id: string, value: boolean) => { settleOthers(id); pinnedId.value = id; void update(id, { followedUp: value }); },
  onAddNote: (id: string) => { settleOthers(id); noteTargetId.value = id; noteDialogOpen.value = true; },
  onSelect: (id: string, value: boolean) => { if (value) deleteSel.add(id); else deleteSel.delete(id); },
};

// ── Add note ─────────────────────────────────────────────────────────────

const noteDialogOpen = ref(false);
const noteTargetId = ref<string | null>(null);
const noteTarget = computed(() => (noteTargetId.value ? find(noteTargetId.value) ?? null : null));

// If that lead is open in the editor, the note goes through the editor so it
// builds on any text the rep is midway through typing there. Saving straight
// from the saved value would let the editor's older draft overwrite it later.
function onSaveNote(text: string) {
  const id = noteTargetId.value;
  const lead = id ? find(id) : undefined;
  if (!id || !lead) return;
  if (activeLead.value?.id === id && editorRef.value) {
    editorRef.value.appendNote(text);
    return;
  }
  void update(id, { interactionNotes: appendNote(lead.interactionNotes, text) });
}

// ── Bulk actions ─────────────────────────────────────────────────────────

function confirmApproveReady() {
  const ids = readyIds(flatLeads.value);
  if (!ids.length) return;
  Dialog.create({
    title: `Confirm ${ids.length} contact${ids.length === 1 ? '' : 's'} that ${ids.length === 1 ? 'is' : 'are'} ready to confirm?`,
    message: `${conferenceText.value}: they'll be included in the next CSV export. Contacts that still need something aren't included.`,
    cancel: true,
    persistent: true,
    ok: { label: 'Confirm', color: 'positive' },
  }).onOk(async () => {
    try {
      await bulkApprove(ids);
      // A bulk confirm settles right away: nothing is held, the new confirmed
      // contacts go to the top of the confirmed group.
      held.clear();
    } catch {
      // The axios interceptor already reported it.
    }
  });
}

// Selection is counted only over what's on screen — Classic's selection
// survived page and filter changes and let a bulk action reach rows the rep
// couldn't see.
const deleteSel = reactive(new Set<string>());
const selectedVisibleIds = computed(() => flatLeads.value.filter((c) => deleteSel.has(c.id)).map((c) => c.id));
const allSelected = computed(() => flatLeads.value.length > 0 && selectedVisibleIds.value.length === flatLeads.value.length);
function toggleSelectAll(value: boolean) {
  for (const c of flatLeads.value) {
    if (value) deleteSel.add(c.id);
    else deleteSel.delete(c.id);
  }
}
function confirmBulkDelete() {
  const ids = selectedVisibleIds.value;
  if (!ids.length) return;
  Dialog.create({
    title: 'Delete rejected contacts?',
    message: `This permanently deletes ${ids.length} rejected contact${ids.length === 1 ? '' : 's'}. This can't be undone.`,
    cancel: true,
    persistent: true,
    ok: { label: 'Delete', color: 'negative' },
  }).onOk(async () => {
    try {
      await bulkDelete(ids);
      deleteSel.clear();
    } catch {
      // The axios interceptor already reported it.
    }
  });
}

// ── Keyboard (desktop) ───────────────────────────────────────────────────

// J / K move, C confirms, R rejects — only when nothing is being typed into
// and no dialog or menu is open, and C / R go through the same path as the
// buttons (pending / duplicate checks included). C and R act only on an
// unconfirmed contact.
function onKeydown(e: KeyboardEvent) {
  if (!isDesktop.value || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
  if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (document.querySelector('.q-dialog, .q-menu')) return;
  const key = e.key.toLowerCase();
  const unconfirmed = activeLead.value?.reviewStatus === 'needs_review';
  if (key === 'j') void step(1);
  else if (key === 'k') void step(-1);
  else if (key === 'c' && unconfirmed) editorRef.value?.approveClick();
  else if (key === 'r' && unconfirmed) editorRef.value?.rejectClick();
  else return;
  e.preventDefault();
}

// ── Reloads ──────────────────────────────────────────────────────────────

// Changing what is asked for is a fresh look at the list: a held contact settles and
// the pinned lead lets go.
watch([segment, searchText, () => filters.value.follow, () => filters.value.source, () => filters.value.scope, () => filters.value.eventId], () => {
  held.clear();
  pinnedId.value = null;
});
watch(() => filters.value.sort, reorder);
// Rejected is a different list: the open lead may not be in it, and a selection in
// one is not wanted in the other. The same for another conference.
watch([showRejected, () => filters.value.scope, () => filters.value.eventId], () => {
  sheetId.value = null;
  selectedId.value = null;
  pinnedId.value = null;
  held.clear();
  deleteSel.clear();
});
watch(() => [filters.value.repId, filters.value.synced], () => {
  serverFilters.repId = filters.value.repId;
  serverFilters.synced = filters.value.synced;
  void load();
});
// An admin switching who they're previewing changes what the list means.
watch(() => sessionStore.viewingAs?.id, () => {
  sheetId.value = null;
  selectedId.value = null;
  held.clear();
  void load();
});
// Crossing the desktop breakpoint (rotating a tablet) swaps pane for sheet;
// carry the open lead across rather than dropping it.
watch(isDesktop, (desktop) => {
  if (desktop) selectedId.value = sheetId.value ?? selectedId.value;
  else sheetId.value = null;
});

onMounted(async () => {
  window.addEventListener('keydown', onKeydown);
  const jobs: Promise<unknown>[] = [load()];
  if (!isSales.value) jobs.push(api.get<Profile[]>('/profiles-list').then(({ data }) => { profiles.value = data; }));
  await Promise.all(jobs);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  if (slideTimer !== null) clearTimeout(slideTimer);
});

// Leads still in the pipeline have no Confirm / Reject until they finish, and
// nothing else would tell this page they had: the list is only fetched on load.
// So while any lead is processing, look again every few seconds (quietly, no
// spinner) so the buttons appear by themselves. Stops the moment none is, and
// pauses in a background tab. Skipped mid-action so a refresh can't land between
// an optimistic approve and its response.
const POLL_MS = 8000;
const anyProcessing = computed(() => buckets.needs_review.some(isProcessing));
let pollTimer: ReturnType<typeof setInterval> | null = null;
function pollTick() {
  if (document.hidden || busy.size > 0) return;
  void load({ keepOrder: true });
}
watch(anyProcessing, (on) => {
  if (on && pollTimer === null) pollTimer = setInterval(pollTick, POLL_MS);
  else if (!on && pollTimer !== null) { clearInterval(pollTimer); pollTimer = null; }
}, { immediate: true });
function onVisible() { if (!document.hidden && anyProcessing.value && busy.size === 0) void load({ keepOrder: true }); }
document.addEventListener('visibilitychange', onVisible);
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisible);
  if (pollTimer !== null) clearInterval(pollTimer);
});
</script>

<style scoped>
.rs-page { padding: 12px 16px 32px; max-width: 1480px; margin: 0 auto; }

/* ── Split (desktop) ── */
.rs-split { display: block; }
.rs-split.is-split {
  display: grid;
  grid-template-columns: minmax(340px, 440px) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
/* The pane stays in view while the list scrolls. 72px clears the app header. */
.rs-pane {
  position: sticky;
  /* --preview-bar-h: the "Viewing as" bar MainLayout adds under the header. */
  top: calc(72px + var(--preview-bar-h, 0px));
  height: calc(100vh - 88px - var(--preview-bar-h, 0px));
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 14px;
  overflow: hidden;
}
.rs-pane-empty { display: flex; align-items: center; justify-content: center; height: 100%; color: #6B7680; }

.rs-sheet { height: 92vh; height: 92dvh; max-height: 92dvh; border-radius: 16px 16px 0 0; overflow: hidden; }

/* ── Sections (a rep's earlier conferences) ── */
.rs-section + .rs-section { margin-top: 12px; }
.rs-sec-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-height: 48px; padding: 0 2px 6px; }
.rs-sec-title { display: flex; flex-direction: column; min-width: 0; text-align: left; }
.rs-sec-name { font-size: 16px; font-weight: 500; line-height: 1.3; overflow-wrap: anywhere; }
.rs-sec-sub { font-size: 13px; color: #5B6670; }
.rs-sec-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1 1 10rem;
  min-width: 0;
  min-height: 44px;
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.rs-sec-toggle:focus-visible { outline: 2px solid #0067AC; outline-offset: 2px; border-radius: 6px; }

.rs-bulk { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.rs-bulk-btn { min-height: 44px; }

.rs-empty { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 40px 16px; }
.rs-empty-title { margin-top: 8px; font-size: 18px; font-weight: 500; }
.rs-empty-body { margin-top: 4px; max-width: 360px; color: #5B6670; font-size: 14px; }

@media (max-width: 599px) {
  .rs-page { padding: 10px 12px 28px; }
}
</style>

<template>
  <q-page class="rs-page">
    <header class="rs-head">
      <div class="rs-title-row">
        <h1 class="rs-title">Review</h1>
        <div class="rs-head-actions">
          <q-btn v-if="$q.screen.gt.xs" outline no-caps color="primary" icon="add" label="Contacts from note" to="/notes" data-tour="review-note-button">
            <q-tooltip>Paste typed notes and pull the contacts out of them</q-tooltip>
          </q-btn>
          <!-- Labelled on a phone too: a bare + gave no hint it opens the note-paste
               page, and this button is the only way to reach that page. -->
          <q-btn v-else flat dense no-caps color="primary" icon="note_add" label="From a note" to="/notes" class="rs-note-link" data-tour="review-note-button" />
          <ReviewViewMenu />
        </div>
      </div>

      <div class="rs-tabs" role="tablist" aria-label="Review status" data-tour="review-tabs">
        <button
          v-for="t in tabDefs"
          :key="t.value"
          type="button"
          role="tab"
          class="rs-tab"
          :class="{ 'is-on': tab === t.value }"
          :aria-selected="tab === t.value"
          @click="tab = t.value"
        >
          {{ t.label }}<span class="rs-count">{{ counts[t.value] }}</span>
        </button>
      </div>

      <div class="rs-tools">
        <q-input
          v-model="search"
          dense
          outlined
          clearable
          debounce="150"
          class="rs-search"
          placeholder="Search name, school, email, phone"
          aria-label="Search leads"
          enterkeyhint="search"
        >
          <template #prepend><q-icon name="search" /></template>
        </q-input>

        <q-btn flat no-caps dense color="grey-9" icon="sort" :label="$q.screen.gt.xs ? sortLabel : undefined" class="rs-sort" aria-label="Sort">
          <q-menu auto-close anchor="bottom right" self="top right">
            <q-list dense style="min-width: 200px">
              <q-item v-for="o in SORT_OPTIONS[tab]" :key="o.value" clickable @click="sortByTab[tab] = o.value">
                <q-item-section avatar style="min-width: 32px"><q-icon v-if="sortByTab[tab] === o.value" name="check" color="primary" size="18px" /></q-item-section>
                <q-item-section>{{ o.label }}</q-item-section>
              </q-item>
            </q-list>
          </q-menu>
        </q-btn>
      </div>

      <div v-if="tab === 'approved' || !isSales" class="rs-filters">
        <q-btn-toggle
          v-if="tab === 'approved'"
          v-model="followFilter"
          dense
          no-caps
          unelevated
          toggle-color="primary"
          color="white"
          text-color="grey-9"
          class="rs-follow-toggle"
          :options="[
            { label: 'All', value: 'all' },
            { label: 'To follow up', value: 'todo' },
            { label: 'Followed up', value: 'done' },
          ]"
        />
        <!-- Admin and Solutions Success see every rep's leads across every
             conference, so they slice; a rep only ever sees their own. -->
        <template v-if="!isSales">
          <q-select v-if="eventFilterOptions.length > 2" v-model="eventFilter" :options="eventFilterOptions" option-label="label" dense outlined emit-value map-options label="Conference" class="rs-select" />
          <q-select v-model="repFilter" :options="repFilterOptions" option-label="label" dense outlined emit-value map-options label="Rep" class="rs-select" />
          <q-select v-model="syncedFilter" :options="syncedFilterOptions" option-label="label" dense outlined emit-value map-options label="Sync status" class="rs-select" />
        </template>
      </div>
    </header>

    <UnresolvedIntakePanel :view-as-rep-id="sessionStore.viewingAs?.role === 'sales' ? sessionStore.viewingAs.id : null" />

    <div v-if="!loaded" class="text-center q-pa-lg"><q-spinner size="40px" color="primary" /></div>

    <div v-else class="rs-split" :class="{ 'is-split': isDesktop }">
      <div class="rs-left">
        <div v-if="tab === 'rejected' && flatLeads.length" class="rs-bulk">
          <q-checkbox :model-value="allSelected" label="Select all" @update:model-value="toggleSelectAll" />
          <q-btn unelevated no-caps color="negative" :label="`Delete ${selectedVisibleIds.length} selected`" :disable="selectedVisibleIds.length === 0" class="rs-bulk-btn" @click="confirmBulkDelete" />
        </div>

        <!-- What the three states of a lead are, before any card is read. Counted by
             the same rules as each card's chip and button (summaryCounts), so it can
             never disagree with them. Read-only on purpose. -->
        <div v-if="tab === 'needs_review' && summary.ready + summary.needsInfo + summary.processing > 0" class="rs-summary" role="status" aria-label="Lead status summary">
          <span class="rs-sum-pill"><span class="rs-sum-dot rs-dot-ready" />{{ summary.ready }} {{ READY_LABEL.toLowerCase() }}</span>
          <span class="rs-sum-pill"><span class="rs-sum-dot rs-dot-info" />{{ summary.needsInfo }} needs info</span>
          <span class="rs-sum-pill"><span class="rs-sum-dot rs-dot-proc" />{{ summary.processing }} processing</span>
        </div>

        <!-- A rep: their current conference first, then each past one. -->
        <template v-if="isSales">
          <section class="rs-section">
            <div class="rs-sec-head">
              <div class="rs-sec-title">
                <div class="rs-sec-name">{{ currentTitle }}</div>
                <div class="rs-sec-sub">Current event<template v-if="currentLeads.length"> · {{ currentLeads.length }} {{ currentLeads.length === 1 ? 'lead' : 'leads' }}</template></div>
              </div>
              <q-btn v-if="tab === 'needs_review' && readyCount(currentLeads) > 0" unelevated no-caps dense color="positive" :label="`Approve all ${readyCount(currentLeads)}`" class="rs-ready-btn" @click="confirmApproveReady(currentLeads, currentTitle)" />
              <div class="rs-sec-actions">
                <!-- Linking lives here, with the event it changes, rather than
                     as a loose control in the page header. Hidden while an
                     admin previews a rep — Admin's per-rep picker sets that. -->
                <q-btn v-if="!sessionStore.viewingAs && !isLinked && eventStore.activeEvent" flat no-caps dense color="primary" :label="`Link to ${eventStore.activeEvent.name}`" class="rs-link-btn" @click="setMyEvent(eventStore.activeEvent.id)" />
                <q-btn v-if="!sessionStore.viewingAs && isLinked" flat round dense icon="more_vert" color="grey-8" aria-label="Event options">
                  <q-menu auto-close anchor="bottom right" self="top right">
                    <q-list dense>
                      <q-item clickable @click="setMyEvent(null)"><q-item-section>Unlink from this event</q-item-section></q-item>
                    </q-list>
                  </q-menu>
                </q-btn>
              </div>
            </div>

            <ReviewLeadList
              v-if="currentLeads.length"
              :leads="currentLeads"
              :tab="tab"
              :active-id="isDesktop ? (activeLead?.id ?? null) : null"
              :compact="isDesktop"
              :busy="busy"
              :selectable="tab === 'rejected'"
              :selected-ids="deleteSel"
              v-bind="rowHandlers"
            />
            <div v-else-if="tabLeads.length" class="rs-note">{{ emptyForCurrent }}</div>
          </section>

          <div v-if="pastGroups.length" class="rs-past">
            <h2 class="rs-past-title">Past events</h2>
            <section v-for="(g, i) in pastGroups" :key="g.eventId" class="rs-section">
              <div class="rs-sec-head">
                <button type="button" class="rs-sec-toggle" :aria-expanded="isPastOpen(g.eventId, i)" @click="togglePast(g.eventId, i)">
                  <q-icon :name="isPastOpen(g.eventId, i) ? 'expand_more' : 'chevron_right'" size="22px" />
                  <span class="rs-sec-title">
                    <span class="rs-sec-name">{{ g.eventName }}</span>
                    <span class="rs-sec-sub">{{ g.leads.length }} {{ g.leads.length === 1 ? 'lead' : 'leads' }}</span>
                  </span>
                </button>
                <q-btn v-if="tab === 'needs_review' && readyCount(g.leads) > 0" unelevated no-caps dense color="positive" :label="`Approve all ${readyCount(g.leads)}`" class="rs-ready-btn" @click="confirmApproveReady(g.leads, g.eventName)" />
              </div>
              <ReviewLeadList
                v-if="isPastOpen(g.eventId, i)"
                :leads="g.leads"
                :tab="tab"
                :active-id="isDesktop ? (activeLead?.id ?? null) : null"
                :compact="isDesktop"
                :busy="busy"
                :selectable="tab === 'rejected'"
                :selected-ids="deleteSel"
                v-bind="rowHandlers"
              />
            </section>
          </div>
        </template>

        <!-- Admin / Solutions Success: one flat list across everyone. -->
        <template v-else>
          <div v-if="tabLeads.length" class="rs-list-head">
            <div class="rs-sec-sub">{{ tabLeads.length }} {{ tabLeads.length === 1 ? 'lead' : 'leads' }}</div>
            <q-btn v-if="tab === 'needs_review' && readyCount(tabLeads) > 0" unelevated no-caps dense color="positive" :label="`Approve all ${readyCount(tabLeads)}`" class="rs-ready-btn" @click="confirmApproveReady(tabLeads, 'All visible contacts')" />
          </div>
          <ReviewLeadList
            v-if="tabLeads.length"
            :leads="tabLeads"
            :tab="tab"
            :active-id="isDesktop ? (activeLead?.id ?? null) : null"
            :compact="isDesktop"
            :busy="busy"
            show-event
            show-rep
            :selectable="tab === 'rejected'"
            :selected-ids="deleteSel"
            v-bind="rowHandlers"
          />
        </template>

        <!-- Empty states say why it's empty and what to do — and "all caught
             up" only when the queue really is clear, not when the rep simply
             hasn't captured anything yet. -->
        <div v-if="!tabLeads.length" class="rs-empty">
          <q-icon :name="emptyState.icon" size="44px" :color="emptyState.color" />
          <div class="rs-empty-title">{{ emptyState.title }}</div>
          <div class="rs-empty-body">{{ emptyState.body }}</div>
          <q-btn v-if="emptyState.action" unelevated no-caps color="primary" :label="emptyState.action.label" class="q-mt-md" @click="emptyState.action.run" />
        </div>
      </div>

      <aside v-if="isDesktop" class="rs-pane" aria-label="Lead details">
        <ReviewLeadEditor
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
          @duplicates-resolved="load"
          @prev="step(-1)"
          @next="step(1)"
        />
        <div v-else class="rs-pane-empty">Select a lead to review.</div>
      </aside>
    </div>

    <AddNoteDialog v-model="noteDialogOpen" :name="noteTarget ? fullName(noteTarget) : ''" @save="onSaveNote" />

    <!-- Phone / tablet: the same editor as a bottom sheet. -->
    <q-dialog v-if="!isDesktop" :model-value="sheetOpen" position="bottom" persistent full-width @escape-key="closeSheet">
      <q-card v-if="activeLead" class="rs-sheet">
        <ReviewLeadEditor
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
          @duplicates-resolved="load"
          @close="closeSheet"
          @prev="step(-1)"
          @next="step(1)"
        />
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useQuasar, Dialog, Notify } from 'quasar';
import { api } from '@/boot/axios';
import ReviewViewMenu from '@/components/ReviewViewMenu.vue';
import UnresolvedIntakePanel from '@/components/UnresolvedIntakePanel.vue';
import ReviewLeadList from '@/components/smart/ReviewLeadList.vue';
import ReviewLeadEditor from '@/components/smart/ReviewLeadEditor.vue';
import AddNoteDialog from '@/components/smart/AddNoteDialog.vue';
import { useSmartReview, type DisplayPatch } from '@/composables/useSmartReview';
import { useSessionStore } from '@/stores/session-store';
import { useEventStore } from '@/stores/event-store';
import type { ContactListItem, Profile, UpdateContactPayload } from '@/types/review';
import {
  DEFAULT_SORT, REVIEW_STATUSES, SORT_OPTIONS, appendNote, eventRecency, fullName, groupByEvent, isProcessing, READY_LABEL, readyIds, searchLeads, sortLeads, summaryCounts,
  type ReviewStatus, type SortKey,
} from '@/utils/reviewSmart';

const $q = useQuasar();
const sessionStore = useSessionStore();
const eventStore = useEventStore();
const { buckets, currentIds, loaded, busy, serverFilters, load, find, approve, reject, restore, update, retryMatch, bulkApprove, bulkDelete } = useSmartReview();

const isSales = computed(() => sessionStore.effectiveRole === 'sales');
// Quasar's md breakpoint (1024px) and up: room for the list and the editor
// side by side. Below it the editor is a bottom sheet.
const isDesktop = computed(() => $q.screen.gt.sm);

const tabDefs: { value: ReviewStatus; label: string }[] = [
  { value: 'needs_review', label: 'To review' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];
const tab = ref<ReviewStatus>('needs_review');
const search = ref<string | null>('');
const sortByTab = reactive<Record<ReviewStatus, SortKey>>({ ...DEFAULT_SORT });
const followFilter = ref<'all' | 'todo' | 'done'>('all');
const eventFilter = ref<string | null>(null);
const repFilter = ref<string | null>(null);
const syncedFilter = ref<string | null>(null);
const profiles = ref<Profile[]>([]);

const sortLabel = computed(() => SORT_OPTIONS[tab.value].find((o) => o.value === sortByTab[tab.value])?.label ?? 'Sort');
const searchText = computed(() => (search.value ?? '').trim());

const syncedFilterOptions = [
  { label: 'All', value: null },
  { label: 'Not yet synced', value: 'false' },
  { label: 'Already synced', value: 'true' },
];
const repFilterOptions = computed(() => [
  { label: 'All reps', value: null as string | null },
  ...profiles.value.filter((p) => p.role === 'sales').map((p) => ({ label: p.name, value: p.id as string | null })),
]);
const eventFilterOptions = computed(() => {
  const seen = new Map<string, string>();
  for (const status of REVIEW_STATUSES) for (const c of buckets[status]) if (!seen.has(c.eventId)) seen.set(c.eventId, c.eventName);
  return [
    { label: 'All conferences', value: null as string | null },
    ...Array.from(seen.entries()).map(([value, label]) => ({ label, value })),
  ];
});

// ── Lists ────────────────────────────────────────────────────────────────

function byConference(list: ContactListItem[]) {
  return eventFilter.value ? list.filter((c) => c.eventId === eventFilter.value) : list;
}

const counts = computed(() => ({
  needs_review: byConference(buckets.needs_review).length,
  approved: byConference(buckets.approved).length,
  rejected: byConference(buckets.rejected).length,
}));
const totalLeads = computed(() => counts.value.needs_review + counts.value.approved + counts.value.rejected);

const tabLeads = computed(() => {
  let list = byConference(buckets[tab.value]);
  if (tab.value === 'approved' && followFilter.value !== 'all') {
    const wantDone = followFilter.value === 'done';
    list = list.filter((c) => c.followedUp === wantDone);
  }
  return sortLeads(searchLeads(list, searchText.value), sortByTab[tab.value]);
});

// Event order comes from every status, not the visible tab, so the sections
// keep their order as the rep flips between tabs.
const recency = computed(() => eventRecency(REVIEW_STATUSES.flatMap((s) => buckets[s])));
const currentLeads = computed(() => (isSales.value ? tabLeads.value.filter((c) => currentIds.value.has(c.id)) : []));
const pastGroups = computed(() => (isSales.value ? groupByEvent(tabLeads.value.filter((c) => !currentIds.value.has(c.id)), recency.value) : []));

// Newest past event opens by default; the rest stay folded until asked for.
// A search opens everything, so a match can't hide inside a closed section.
const pastOpen = reactive<Record<string, boolean>>({});
function isPastOpen(eventId: string, index: number) {
  if (searchText.value) return true;
  return pastOpen[eventId] ?? index === 0;
}
function togglePast(eventId: string, index: number) {
  pastOpen[eventId] = !isPastOpen(eventId, index);
}

// Every lead currently on screen, in order — what J / K, next / previous and
// "select all" walk. A lead inside a folded section isn't in it.
const flatLeads = computed<ContactListItem[]>(() => (
  isSales.value
    ? [...currentLeads.value, ...pastGroups.value.flatMap((g, i) => (isPastOpen(g.eventId, i) ? g.leads : []))]
    : tabLeads.value
));

const readyCount = (list: ContactListItem[]) => readyIds(list).length;
const summary = computed(() => summaryCounts(tabLeads.value));

// ── The rep's current event ──────────────────────────────────────────────

const isLinked = computed(() => (
  sessionStore.viewingAs ? !!sessionStore.viewingAs.currentEventId : !!sessionStore.user?.currentEventId
));
const currentTitle = computed(() => {
  // Previewing: their own conference's name (me?viewAsId). Reading it off the
  // first lead left a rep with no leads yet titled just "Current event".
  if (sessionStore.viewingAs) {
    return sessionStore.preview?.currentEventName ?? currentLeads.value[0]?.eventName ?? (isLinked.value ? 'Current event' : 'Not linked to a conference');
  }
  return sessionStore.user?.currentEventName ?? 'Not linked to a conference';
});
const emptyForCurrent = computed(() => {
  if (!isLinked.value) return 'Not linked to a conference. Link one to start capturing leads.';
  if (tab.value === 'needs_review') return "You're all caught up for this event.";
  return tab.value === 'approved' ? 'Nothing approved for this event yet.' : 'Nothing rejected for this event.';
});

async function setMyEvent(eventId: string | null) {
  try {
    await api.post('/profiles-set-current-event', { eventId });
    await sessionStore.fetchMe();
    await load();
    Notify.create({ type: 'positive', message: eventId ? 'Linked to this event.' : 'Unlinked.' });
  } catch {
    // The axios interceptor already reported it.
  }
}

// ── Empty states ─────────────────────────────────────────────────────────

const emptyState = computed<{ icon: string; color: string; title: string; body: string; action?: { label: string; run: () => void } }>(() => {
  if (searchText.value || followFilter.value !== 'all') {
    return {
      icon: 'search_off', color: 'grey-6', title: 'No leads match',
      body: 'Nothing in this tab fits your search or filter.',
      action: { label: 'Clear search and filter', run: () => { search.value = ''; followFilter.value = 'all'; } },
    };
  }
  if (totalLeads.value === 0) {
    if (isSales.value && !isLinked.value) {
      return eventStore.activeEvent && !sessionStore.viewingAs
        ? { icon: 'event', color: 'primary', title: 'Join a conference to get started', body: 'Leads you capture at your conference show up here.', action: { label: `Link to ${eventStore.activeEvent.name}`, run: () => void setMyEvent(eventStore.activeEvent!.id) } }
        : { icon: 'event', color: 'primary', title: 'Join a conference to get started', body: 'Leads you capture at your conference show up here. Pick one in Setup.' };
    }
    return { icon: 'inbox', color: 'grey-6', title: 'No leads yet', body: 'Cards, notes, and form entries show up here as they come in.' };
  }
  if (tab.value === 'needs_review') {
    return {
      icon: 'task_alt', color: 'positive', title: "You're all caught up", body: 'Nothing is waiting for review.',
      ...(counts.value.approved ? { action: { label: `See approved (${counts.value.approved})`, run: () => { tab.value = 'approved'; } } } : {}),
    };
  }
  if (tab.value === 'approved') {
    return { icon: 'inbox', color: 'grey-6', title: 'Nothing approved yet', body: 'Approve leads in To review and they show up here for follow-up.' };
  }
  return { icon: 'inbox', color: 'grey-6', title: 'Nothing rejected', body: 'Rejected leads land here until you restore or delete them.' };
});

// ── The open lead (desktop pane / phone sheet) ───────────────────────────

const selectedId = ref<string | null>(null); // desktop
const sheetId = ref<string | null>(null); // phone
const editorRef = ref<InstanceType<typeof ReviewLeadEditor> | null>(null);

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

function setActive(id: string | null) {
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
      message: "You edited this contact but haven't saved. Approve saves them; otherwise they'll be lost.",
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
}
async function step(delta: number) {
  const idx = flatLeads.value.findIndex((c) => c.id === activeLead.value?.id);
  const next = flatLeads.value[idx + delta];
  if (idx < 0 || !next) return;
  await openLead(next.id);
}

// When the open lead is approved / rejected / restored, move on to its
// neighbour so a run of decisions is one tap each. Worked out BEFORE the
// request, since the lead leaves the list when it succeeds.
async function thenAdvance(id: string, run: () => Promise<boolean>) {
  const wasOpen = activeLead.value?.id === id;
  let nextId: string | null = null;
  if (wasOpen) {
    const idx = flatLeads.value.findIndex((c) => c.id === id);
    nextId = flatLeads.value[idx + 1]?.id ?? flatLeads.value[idx - 1]?.id ?? null;
  }
  const ok = await run();
  if (ok && wasOpen) setActive(nextId);
}

const onApprove = (p: { id: string; edits?: UpdateContactPayload | undefined; display?: DisplayPatch | undefined }) => thenAdvance(p.id, () => approve(p.id, p.edits, p.display));
const onReject = (id: string) => thenAdvance(id, () => reject(id));
const onRestore = (id: string) => thenAdvance(id, () => restore(id));
const onUpdate = (p: { id: string; payload: UpdateContactPayload; display?: DisplayPatch | undefined }) => update(p.id, p.payload, p.display);

// Row-level events, shared by every list on the page.
const rowHandlers = {
  onOpen: (id: string) => void openLead(id),
  onApprove: (id: string) => void thenAdvance(id, () => approve(id)),
  onReject: (id: string) => void thenAdvance(id, () => reject(id)),
  onRestore: (id: string) => void thenAdvance(id, () => restore(id)),
  onFollowedUp: (id: string, value: boolean) => void update(id, { followedUp: value }),
  onAddNote: (id: string) => { noteTargetId.value = id; noteDialogOpen.value = true; },
  onIntent: (id: string, value: 'hot' | 'warm' | 'cold' | null) => void update(id, { contactIntent: value }),
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

function confirmApproveReady(list: ContactListItem[], label: string) {
  const ids = readyIds(list);
  if (!ids.length) return;
  Dialog.create({
    title: `Approve ${ids.length} contact${ids.length === 1 ? '' : 's'} that ${ids.length === 1 ? 'is' : 'are'} ready to approve?`,
    message: `${label}: they'll be included in the next CSV export. Leads that still need something aren't included.`,
    cancel: true,
    persistent: true,
    ok: { label: 'Approve', color: 'positive' },
  }).onOk(async () => {
    try {
      await bulkApprove(ids);
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

// J / K move, A approves, R rejects — only when nothing is being typed into
// and no dialog or menu is open, and A / R go through the same path as the
// buttons (pending / duplicate checks included).
function onKeydown(e: KeyboardEvent) {
  if (!isDesktop.value || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
  if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (document.querySelector('.q-dialog, .q-menu')) return;
  const key = e.key.toLowerCase();
  if (key === 'j') void step(1);
  else if (key === 'k') void step(-1);
  else if (key === 'a' && tab.value === 'needs_review') editorRef.value?.approveClick();
  else if (key === 'r' && tab.value === 'needs_review') editorRef.value?.rejectClick();
  else return;
  e.preventDefault();
}

// ── Reloads ──────────────────────────────────────────────────────────────

watch(tab, () => {
  sheetId.value = null;
  deleteSel.clear();
});
watch([repFilter, syncedFilter], () => {
  serverFilters.repId = repFilter.value;
  serverFilters.synced = syncedFilter.value;
  void load();
});
// An admin switching who they're previewing changes what the list means.
watch(() => sessionStore.viewingAs?.id, () => {
  sheetId.value = null;
  selectedId.value = null;
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
  // The Link button needs the active event, and a fresh load of /review
  // hasn't fetched it.
  if (!eventStore.loaded) jobs.push(eventStore.fetchActive().catch(() => undefined));
  await Promise.all(jobs);
});
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));

// Leads still in the pipeline have no Approve / Reject until they finish, and
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
  void load();
}
watch(anyProcessing, (on) => {
  if (on && pollTimer === null) pollTimer = setInterval(pollTick, POLL_MS);
  else if (!on && pollTimer !== null) { clearInterval(pollTimer); pollTimer = null; }
}, { immediate: true });
function onVisible() { if (!document.hidden && anyProcessing.value && busy.size === 0) void load(); }
document.addEventListener('visibilitychange', onVisible);
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisible);
  if (pollTimer !== null) clearInterval(pollTimer);
});
</script>

<style scoped>
.rs-page { padding: 12px 16px 32px; max-width: 1480px; margin: 0 auto; }

.rs-head { display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; }
.rs-title-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.rs-title { margin: 0; font-size: 24px; font-weight: 500; line-height: 1.2; }
.rs-head-actions { display: flex; align-items: center; gap: 4px; }

/* Segmented status control with live counts. Each segment is 44px tall. */
.rs-tabs { display: flex; gap: 2px; padding: 4px; background: #EAEFF4; border-radius: 12px; }
.rs-tab {
  flex: 1;
  min-height: 44px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: #4A5B6B;
  font: inherit;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.rs-tab:focus-visible { outline: 2px solid #0067AC; outline-offset: 2px; }
.rs-tab.is-on { background: #fff; color: var(--q-primary); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1); }
.rs-count {
  min-width: 22px;
  padding: 0 7px;
  border-radius: 11px;
  background: rgba(0, 0, 0, 0.07);
  font-size: 12px;
  line-height: 22px;
}
.rs-tab.is-on .rs-count { background: #E3F1FA; color: #0067AC; }

.rs-tools { display: flex; align-items: center; gap: 8px; }
.rs-search { flex: 1; min-width: 0; }
.rs-sort { min-height: 40px; }
.rs-note-link { min-height: 44px; }

.rs-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.rs-follow-toggle { border: 1px solid rgba(0, 0, 0, 0.18); border-radius: 8px; }
.rs-follow-toggle :deep(.q-btn) { min-height: 40px; }
.rs-select { min-width: 170px; }

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

/* ── Sections ── */
.rs-section + .rs-section { margin-top: 12px; }
/* Wraps, and the title has a floor: "Link to <long conference name>" is a
   no-shrink sibling, and with a zero-basis title it squeezed "Not linked to a
   conference" to one character wide, printed a letter per line. Now the
   button drops to its own line when it doesn't fit. */
.rs-sec-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-height: 48px; padding: 0 2px 6px; }
.rs-sec-head > .rs-sec-title, .rs-sec-head > .rs-sec-toggle { flex: 1 1 10rem; min-width: 0; }
.rs-sec-title { display: flex; flex-direction: column; min-width: 0; text-align: left; }
.rs-sec-name { font-size: 16px; font-weight: 500; line-height: 1.3; overflow-wrap: anywhere; }
.rs-sec-sub { font-size: 13px; color: #5B6670; }
.rs-sec-actions { display: flex; align-items: center; gap: 4px; flex: none; }
.rs-sec-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
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
.rs-ready-btn { min-height: 40px; padding: 0 12px; flex: none; }
.rs-link-btn { min-height: 40px; max-width: 100%; }
.rs-link-btn :deep(.q-btn__content) { white-space: normal; text-align: left; }
.rs-sec-actions { max-width: 100%; }
.rs-summary { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.rs-sum-pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; background: #fff; border: 1px solid rgba(0, 0, 0, 0.1); font-size: 13px; color: #2F3A44; white-space: nowrap; }
.rs-sum-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.rs-dot-ready { background: #1E8E3E; }
.rs-dot-info { background: #E07B00; }
.rs-dot-proc { background: #0067AC; }
.rs-past { margin-top: 20px; }
.rs-past-title { margin: 0 0 4px; font-size: 13px; font-weight: 500; letter-spacing: 0.02em; text-transform: uppercase; color: #5B6670; }
.rs-note { padding: 12px 4px; color: #5B6670; font-size: 14px; }
.rs-list-head { display: flex; align-items: center; justify-content: space-between; min-height: 44px; padding: 0 2px 6px; }
.rs-bulk { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.rs-bulk-btn { min-height: 44px; }

.rs-empty { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 40px 16px; }
.rs-empty-title { margin-top: 8px; font-size: 18px; font-weight: 500; }
.rs-empty-body { margin-top: 4px; max-width: 360px; color: #5B6670; font-size: 14px; }

@media (max-width: 599px) {
  .rs-page { padding: 10px 12px 28px; }

  /* Filters sit two to a row instead of one full-width select per row; the
     follow-up toggle and Conference select take a whole row. */
  .rs-filters { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .rs-filters .rs-select { min-width: 0; }
  .rs-follow-toggle { grid-column: 1 / -1; width: 100%; }
  .rs-follow-toggle :deep(.q-btn) { flex: 1; }
  .rs-filters .rs-select:first-of-type:nth-last-of-type(3) { grid-column: 1 / -1; }

  /* Section title and its menu share the first line; "Approve N ready" gets a
     full-width line of its own instead of squeezing the title into three. */
  .rs-sec-head { flex-wrap: wrap; row-gap: 4px; }
  .rs-sec-head > .rs-sec-actions { order: 2; }
  .rs-sec-head > .rs-ready-btn { order: 3; flex: 1 0 100%; min-height: 44px; }
}

@media (prefers-reduced-motion: reduce) {
  .rs-tab { transition: none; }
}
</style>

<template>
  <header class="rs-head">
    <h1 class="sr-only">Review</h1>

    <!-- Underline tabs: the status control used to be a 52px grey tray, which
         with the title row above it pushed the first lead off a phone screen.
         The nav bar already says "Review", so the page has no title row. -->
    <div class="rs-tabs" role="tablist" aria-label="Review status">
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

    <!-- What the three states of a lead are, before any card is read, and a way
         to look at just one of them. Counted by the same rules as each card's
         chip and button (leadBucket), over the whole tab, so a count never
         shrinks just because you are filtering by it. Tap again to show
         everything. Each cell stacks its number over its word, so it is only as
         wide as its longest word ("processing") and Import fits on the same
         row at 320px. A lead-count row with the words beside the numbers
         ("10 ready") did not, and clipped. Import is here because it is the
         other thing you do with contacts from this page. -->
    <div class="rs-status-row" role="group" aria-label="Filter leads by status, and import contacts">
      <template v-if="tab === 'needs_review' && summary.ready + summary.needsInfo + summary.processing > 0">
        <button
          v-for="p in pills"
          :key="p.key"
          type="button"
          class="rs-cell"
          :class="{ 'is-on': readinessFilter === p.key }"
          :aria-pressed="readinessFilter === p.key"
          :aria-label="`${summary[p.key]} ${p.label}`"
          :disabled="summary[p.key] === 0 && readinessFilter !== p.key"
          @click="$emit('toggleReadiness', p.key)"
        >
          <span class="rs-cell-n"><span class="rs-sum-dot" :class="p.dot" />{{ summary[p.key] }}</span>
          <span class="rs-cell-l">{{ p.label }}</span>
        </button>
      </template>
      <router-link to="/notes" class="rs-cell rs-cell-import" aria-label="Import contacts">
        <span class="rs-cell-n"><q-icon name="note_add" size="22px" /></span>
        <span class="rs-cell-l">Import</span>
        <q-tooltip>Paste typed notes and pull the contacts out of them</q-tooltip>
      </router-link>
    </div>

    <div class="rs-tools">
      <q-input
        v-model="search"
        dense
        outlined
        clearable
        debounce="150"
        class="rs-search"
        :placeholder="$q.screen.gt.xs ? 'Search name, school, email, phone' : 'Search'"
        aria-label="Search leads"
        enterkeyhint="search"
      >
        <template #prepend><q-icon name="search" /></template>
      </q-input>

      <q-btn flat no-caps dense color="grey-9" icon="sort" :label="$q.screen.gt.xs ? sortLabel : undefined" class="rs-sort" aria-label="Sort">
        <q-menu auto-close anchor="bottom right" self="top right">
          <q-list dense style="min-width: 200px">
            <q-item v-for="o in sortOptions[tab]" :key="o.value" clickable @click="$emit('sort', tab, o.value)">
              <q-item-section avatar style="min-width: 32px"><q-icon v-if="sortByTab[tab] === o.value" name="check" color="primary" size="18px" /></q-item-section>
              <q-item-section>{{ o.label }}</q-item-section>
            </q-item>
          </q-list>
        </q-menu>
      </q-btn>

      <!-- A rep's leads are this conference's, or everything before it folded
           away under its own conference. One icon that changes with the view
           (calendar: this event; history, filled: past events), so the default
           looks quiet and being somewhere else is obvious. Admin and Solutions
           Success see one flat list across everyone, so they have no such split. -->
      <button
        v-if="isSales"
        type="button"
        class="rs-scope"
        :class="{ 'is-past': scopeView === 'past' }"
        :aria-label="scopeView === 'current' ? 'Showing this event. Show past events' : 'Showing past events. Show this event'"
        @click="scopeView = scopeView === 'current' ? 'past' : 'current'"
      >
        <q-icon :name="scopeView === 'current' ? 'event' : 'history'" size="22px" />
        <q-tooltip>{{ scopeView === 'current' ? 'Show past events' : 'Show this event' }}</q-tooltip>
      </button>
    </div>

    <!-- Source is for everyone on To review and Confirmed; the rep, conference
         and sync filters are only for the people who see every rep's leads.
         A rep's Rejected tab has nothing to slice, so it keeps no filter row. -->
    <div v-if="tab !== 'rejected' || !isSales" class="rs-filters">
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
      <q-select v-model="sourceFilter" :options="sourceOptions" option-label="label" dense outlined emit-value map-options label="Source" class="rs-select rs-source" aria-label="Filter by source" />
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { LeadBucket, ReviewStatus, SortKey, SourceKey } from '@/utils/reviewSmart';

// Review's header (status tabs, the ready / incomplete / processing pills with
// Import, search and sort, the filters) as pure display. ReviewSmart owns the data
// and every filter's state and hands them in; the onboarding tour renders this same
// component with sample counts. The filters are v-models so each one still writes
// straight into the page's own ref, as before this was split out.
const tab = defineModel<ReviewStatus>('tab', { required: true });
const search = defineModel<string | null>('search', { default: '' });
const followFilter = defineModel<'all' | 'todo' | 'done'>('followFilter', { default: 'all' });
const eventFilter = defineModel<string | null>('eventFilter', { default: null });
const repFilter = defineModel<string | null>('repFilter', { default: null });
const syncedFilter = defineModel<string | null>('syncedFilter', { default: null });
const sourceFilter = defineModel<SourceKey | null>('sourceFilter', { default: null });
const scopeView = defineModel<'current' | 'past'>('scopeView', { default: 'current' });

type Option<V> = { label: string; value: V };
const props = defineProps<{
  tabDefs: { value: ReviewStatus; label: string }[];
  counts: Record<ReviewStatus, number>;
  summary: Record<LeadBucket, number>;
  readinessFilter: LeadBucket | null;
  isSales: boolean;
  sortOptions: Record<ReviewStatus, { value: SortKey; label: string }[]>;
  sortByTab: Record<ReviewStatus, SortKey>;
  eventFilterOptions: Option<string | null>[];
  repFilterOptions: Option<string | null>[];
  syncedFilterOptions: Option<string | null>[];
  sourceOptions: Option<SourceKey | null>[];
}>();
defineEmits<{ toggleReadiness: [key: LeadBucket]; sort: [tab: ReviewStatus, value: SortKey] }>();

// The words are one word each on purpose (see the status row in the template).
// "Ready" here is the same state as the card's "Ready to confirm" chip.
const pills: { key: LeadBucket; label: string; dot: string }[] = [
  { key: 'ready', label: 'ready', dot: 'rs-dot-ready' },
  { key: 'needsInfo', label: 'incomplete', dot: 'rs-dot-info' },
  { key: 'processing', label: 'processing', dot: 'rs-dot-proc' },
];

const sortLabel = computed(() => props.sortOptions[tab.value]?.find((o) => o.value === props.sortByTab[tab.value])?.label ?? 'Sort');
</script>

<style scoped>
.rs-head { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

/* Underline tabs with live counts. The nav bar already says "Review", so the
   page has no title row; the tray this used to sit in is gone too. 44px tall. */
.rs-tabs { display: flex; border-bottom: 1px solid rgba(0, 0, 0, 0.12); margin: 0 -4px; }
.rs-tab {
  flex: 1;
  min-height: 44px;
  padding: 0 4px;
  border: 0;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  background: transparent;
  color: #4A5B6B;
  font: inherit;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  white-space: nowrap;
}
.rs-tab:focus-visible { outline: 2px solid #0067AC; outline-offset: -2px; }
.rs-tab.is-on { color: var(--q-primary); border-bottom-color: var(--q-primary); }
.rs-count {
  min-width: 22px;
  padding: 0 7px;
  border-radius: 11px;
  background: rgba(0, 0, 0, 0.07);
  font-size: 12px;
  line-height: 22px;
}
.rs-tab.is-on .rs-count { background: #E3F1FA; color: #0067AC; }

/* Search, sort and the this-event / past-events icon. */
.rs-tools { display: flex; align-items: center; gap: 4px; }
.rs-search { flex: 1; min-width: 0; }
.rs-sort { min-height: 40px; }
.rs-scope {
  flex: none;
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #B9C3CE;
  border-radius: 8px;
  background: #fff;
  color: #5B6B7B;
  cursor: pointer;
}
.rs-scope:focus-visible { outline: 2px solid #0067AC; outline-offset: 2px; }
/* Filled when you are looking somewhere other than the default. */
.rs-scope.is-past { background: #1D5C93; border-color: #1D5C93; color: #fff; }

.rs-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.rs-follow-toggle { border: 1px solid rgba(0, 0, 0, 0.18); border-radius: 8px; }
.rs-follow-toggle :deep(.q-btn) { min-height: 40px; }
.rs-select { min-width: 170px; }

/* One row: ready / incomplete / processing filters and Import. Each cell stacks
   its number over its word, so it is as wide as "processing" and no wider, which
   is what lets four of them fit at 320px. min-width: 0 and no wrapping on the
   words are what keep it from overflowing. 46px tall, so a comfortable tap. */
.rs-status-row { display: flex; gap: 6px; align-items: stretch; }
.rs-cell {
  flex: 1 1 0;
  min-width: 0;
  min-height: 46px;
  padding: 3px 2px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.1);
  font: inherit;
  color: #2F3A44;
  white-space: nowrap;
  cursor: pointer;
  text-decoration: none;
}
.rs-cell:focus-visible { outline: 2px solid #0067AC; outline-offset: 2px; }
.rs-cell-n { display: inline-flex; align-items: center; gap: 5px; font-size: 16px; font-weight: 500; line-height: 1.1; }
.rs-cell-l { font-size: 11px; line-height: 1.2; color: #4A5B6B; }
.rs-cell.is-on { background: #E3F1FA; border-color: #0067AC; }
.rs-cell.is-on .rs-cell-l { color: #0067AC; }
.rs-cell:disabled { opacity: 0.5; cursor: default; }
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
  /* Filters sit two to a row instead of one full-width select per row; the
     follow-up toggle and Conference select take a whole row. */
  .rs-filters { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .rs-filters .rs-select { min-width: 0; }
  .rs-follow-toggle { grid-column: 1 / -1; width: 100%; }
  .rs-follow-toggle :deep(.q-btn) { flex: 1; }
  .rs-filters .rs-select:first-of-type:nth-last-of-type(4) { grid-column: 1 / -1; }
  .rs-filters .rs-source { grid-column: 1 / -1; }
}

@media (prefers-reduced-motion: reduce) {
  .rs-tab { transition: none; }
}
</style>

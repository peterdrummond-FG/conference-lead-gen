<template>
  <header class="rs-head">
    <h1 class="sr-only">Contacts</h1>

    <!-- One line at 320px: search takes what is left, Filter and Import keep their
         size. Import drops to its icon under 375px (the aria-label keeps its name).
         The sort button and the this-event / past-events toggle live in Filter now. -->
    <div class="rs-top">
      <q-input
        v-model="search"
        dense
        outlined
        clearable
        debounce="150"
        class="rs-search"
        placeholder="Search contacts"
        aria-label="Search contacts"
        enterkeyhint="search"
      >
        <template #prepend><q-icon name="search" size="20px" /></template>
      </q-input>

      <button id="cf-filter-btn" type="button" class="rs-tbtn" :aria-label="filterCount ? `Filter, ${filterCount} on` : 'Filter'" @click="$emit('openFilter', null)">
        <q-icon name="tune" size="20px" />
        <span>Filter</span>
        <span v-if="filterCount" class="rs-badge">{{ filterCount }}</span>
      </button>

      <router-link to="/notes" class="rs-tbtn rs-import" aria-label="Import contacts">
        <q-icon name="note_add" size="20px" />
        <span class="rs-import-label">Import</span>
        <q-tooltip>Paste typed notes and pull the contacts out of them</q-tooltip>
      </router-link>
    </div>

    <!-- Rejected contacts are hidden from the list; this is the way in and out. -->
    <div v-if="rejected" class="rs-rejbar">
      <span class="rs-rejbar-text">Showing rejected contacts ({{ rejectedCount }})</span>
      <button type="button" class="rs-rejbar-back" @click="$emit('backToContacts')">Back to contacts</button>
    </div>

    <template v-else>
      <!-- ONE joined control: All, then a segment per status. Always drawn, even when
           every count is 0 (zero segments go grey but stay), so the page never loses
           its controls and leaves Import floating alone: that was the bug when the
           old pills vanished with no contacts. Each segment is a filter; tap the
           selected one again to go back to All. The counts follow the conference,
           search, source and followed-up filters (statusCounts in utils), so a number
           is what the list under it shows. Number over word so five fit at 320px with
           nothing under 12px. -->
      <div class="rs-seg" role="group" aria-label="Filter contacts by status">
        <button
          v-for="s in STATUS_SEGMENTS"
          :key="s.key"
          type="button"
          class="rs-sgm"
          :class="[`rs-sgm-${s.key}`, { 'is-on': segment === s.key, 'is-zero': counts[s.key] === 0 }]"
          :aria-pressed="segment === s.key"
          :aria-label="`${counts[s.key]} ${s.label}`"
          :disabled="s.key !== 'all' && counts[s.key] === 0 && segment !== s.key"
          @click="pick(s.key)"
        >
          <span class="rs-sgm-n"><span v-if="s.key !== 'all'" class="rs-sgm-dot" />{{ counts[s.key] }}</span>
          <span class="rs-sgm-w">{{ s.label }}</span>
        </button>
      </div>

      <!-- Which conference the list is showing; tapping it opens Filter at Conference. -->
      <button type="button" class="rs-cline" :aria-label="`${conferenceLine}. Change conference`" @click="$emit('openFilter', 'conference')">
        <q-icon name="event" size="20px" class="rs-cline-ic" />
        <span class="rs-cline-t">{{ conferenceLine }}</span>
        <q-icon name="expand_more" size="22px" />
      </button>
    </template>
  </header>
</template>

<script setup lang="ts">
import { STATUS_SEGMENTS, type StatusSegment } from '@/utils/contactsList';

// Contacts' header (search, Filter, Import, the status bar and the conference line)
// as pure display. ContactsPage owns the data and every filter's state and hands them
// in; the onboarding tour renders this same component with sample counts.
const segment = defineModel<StatusSegment>('segment', { required: true });
const search = defineModel<string | null>('search', { default: '' });

withDefaults(defineProps<{
  counts: Record<StatusSegment, number>;
  // How many Filter settings differ from the defaults (the badge).
  filterCount?: number;
  conferenceLine: string;
  // The Rejected view: a slim bar replaces the status bar and the conference line.
  rejected?: boolean;
  rejectedCount?: number;
}>(), { filterCount: 0, rejected: false, rejectedCount: 0 });

defineEmits<{ openFilter: [section: 'conference' | null]; backToContacts: [] }>();

function pick(key: StatusSegment) {
  segment.value = segment.value === key ? 'all' : key;
}
</script>

<style scoped>
.rs-head { display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; }
.sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

/* ── Top row ── */
.rs-top { display: flex; align-items: center; gap: 8px; }
.rs-search { flex: 1; min-width: 0; }
.rs-search :deep(.q-field__control) { height: 44px; border-radius: 10px; }
.rs-search :deep(.q-field__marginal) { height: 44px; }
/* 14px like the buttons beside it, so "Search contacts" is not cut off at 375px. */
.rs-search :deep(.q-field__native), .rs-search :deep(.q-field__input) { font-size: 14px; }
.rs-search :deep(.q-field__control) { padding: 0 8px; }
.rs-search :deep(.q-field__prepend) { padding-right: 4px; }
.rs-search :deep(.q-field__append) { padding-left: 0; }
.rs-tbtn {
  position: relative;
  flex: none;
  height: 44px;
  min-width: 44px;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.2);
  border-radius: 10px;
  color: #0067AC;
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  text-decoration: none;
  cursor: pointer;
}
.rs-tbtn:focus-visible { outline: 2px solid #0067AC; outline-offset: 2px; }
/* A badge on the corner rather than in the flow: it must not take width from the
   search field, whose placeholder is already tight at 375px. */
.rs-badge {
  position: absolute;
  top: -7px;
  right: -7px;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border-radius: 10px;
  background: #0067AC;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  line-height: 20px;
  text-align: center;
}
/* Import is icon-only on the narrowest phones; its aria-label still names it. */
@media (max-width: 374px) {
  .rs-import-label { display: none; }
  .rs-import { padding: 0; width: 44px; }
}

/* ── Rejected bar ── */
.rs-rejbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 44px;
  padding: 4px 12px;
  border-radius: 10px;
  background: #FBEAEA;
  color: #8E2B2B;
  font-size: 14px;
}
.rs-rejbar-text { font-weight: 500; min-width: 0; }
.rs-rejbar-back { flex: none; min-height: 44px; padding: 0 4px; border: 0; background: transparent; color: #0067AC; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
.rs-rejbar-back:focus-visible { outline: 2px solid #0067AC; outline-offset: 2px; border-radius: 4px; }

/* ── The status bar (C2, the segmented scoreboard) ── */
.rs-seg {
  display: flex;
  height: 56px;
  border: 1px solid rgba(0, 0, 0, 0.2);
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
}
.rs-sgm {
  --c: #9AA5AE;
  --tint: #E3F1FA;
  --ink: #0B4F82;
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  padding: 0 2px;
  border: 0;
  border-left: 1px solid rgba(0, 0, 0, 0.08);
  background: none;
  font: inherit;
  color: #2F3A44;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  line-height: 1.15;
  cursor: pointer;
}
.rs-sgm:first-child { border-left: 0; }
.rs-sgm-all { --c: #0067AC; }
.rs-sgm-ready { --c: #1E8E3E; --tint: #E6F4EA; --ink: #14532D; }
.rs-sgm-needsInfo { --c: #E07B00; --tint: #FDEEE3; --ink: #7A3B00; }
.rs-sgm-processing { --c: #0067AC; --tint: #E3F1FA; --ink: #0B4F82; }
.rs-sgm-confirmed { --c: #7CC49A; --tint: #E6F4EA; --ink: #14532D; }
.rs-sgm-n { display: inline-flex; align-items: center; gap: 4px; font-size: 17px; font-weight: 600; line-height: 24px; }
.rs-sgm-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c); flex: none; }
.rs-sgm-w { font-size: 12px; color: #5B6670; white-space: nowrap; }
/* The selected segment fills with its tint and gets a 3px bar in its own colour. */
.rs-sgm::before { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: var(--c); opacity: 0; }
.rs-sgm.is-on { background: var(--tint); }
.rs-sgm.is-on::before { opacity: 1; }
.rs-sgm.is-on .rs-sgm-w { color: var(--ink); font-weight: 600; }
/* Zero goes grey but stays. */
.rs-sgm.is-zero .rs-sgm-n, .rs-sgm.is-zero .rs-sgm-w { color: #7A858E; }
.rs-sgm.is-zero .rs-sgm-dot { background: #B6BEC6; }
.rs-sgm:disabled { cursor: default; }
.rs-sgm:hover:not(.is-on):not(:disabled) { background: #F1F4F6; }
.rs-sgm:focus-visible { outline: 2px solid #0067AC; outline-offset: -2px; }

/* ── Conference line ── */
.rs-cline {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 44px;
  padding-block: 4px;
  padding: 0 2px;
  border: 0;
  background: none;
  color: #5B6670;
  font: inherit;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}
.rs-cline:focus-visible { outline: 2px solid #0067AC; outline-offset: 2px; border-radius: 6px; }
.rs-cline-ic { color: #0067AC; flex: none; }
/* Two lines before it truncates: "Your most recent conference: <name>" is long. */
.rs-cline-t { flex: 1; min-width: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.25; }
</style>

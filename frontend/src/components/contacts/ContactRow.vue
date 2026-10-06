<template>
  <div class="lr" :class="[`st-${status}`, { 'is-active': active, 'is-busy': busy, 'is-card': phone }]" :data-lead-id="contact.id" @click="onCardClick">
    <q-checkbox
      v-if="selectable"
      :model-value="selected"
      class="lr-check"
      :aria-label="`Select ${name}`"
      @update:model-value="(v: boolean) => $emit('update:selected', v)"
    />

    <div class="lr-body">
      <!-- The identity block is the one big tap target that opens the lead.
           Phone / email links and the action buttons are siblings, not
           children, so a tap on a link never also opens the editor and no
           interactive element sits inside another. -->
      <button type="button" class="lr-open" :aria-current="active ? 'true' : undefined" @click="$emit('open')">
        <span class="lr-line1">
          <span class="lr-name">{{ name }}</span>
          <!-- Says "this opens". Phone only: the desktop list sits beside its pane. -->
          <q-icon v-if="phone" name="chevron_right" size="24px" class="lr-chev" aria-hidden="true" />
        </span>
        <span v-if="orgLine(contact)" class="lr-org">{{ orgLine(contact) }}</span>
        <span v-if="showEvent || showRep" class="lr-meta">{{ [showEvent ? contact.eventName : null, showRep ? contact.repName : null].filter(Boolean).join(' · ') }}</span>
        <span v-if="contact.interactionNotes" class="lr-note" :class="{ 'lr-note-2': confirmed }">{{ contact.interactionNotes }}</span>
        <span class="lr-chips">
          <!-- A confirmed lead sits in the same list as the unconfirmed ones, so the card
               has to say so in words, not only in its (softer green) edge. -->
          <LeadChip v-if="confirmed" tone="green"><q-icon name="check" size="14px" />Confirmed</LeadChip>
          <template v-if="unconfirmed">
            <LeadChip v-if="flags.length === 0" tone="green"><q-icon name="check" size="14px" />{{ READY_LABEL }}</LeadChip>
            <LeadChip v-for="f in shownFlags" :key="f.key" :tone="f.tone">{{ f.label }}</LeadChip>
          </template>
          <LeadChip :tone="sourceTone(contact)">{{ sourceLabel(contact) }}</LeadChip>
          <LeadChip v-if="badge" :tone="badge.tone">{{ badge.label }}</LeadChip>
          <LeadChip v-if="contact.syncedAt" tone="grey">Sent to Zoho</LeadChip>
        </span>
      </button>

      <div class="lr-contact">
        <a v-if="contact.phone" :href="`tel:${contact.phone}`" class="lr-link lr-link-phone"><q-icon name="phone" size="16px" /><span class="lr-link-text">{{ contact.phone }}</span></a>
        <a v-if="contact.email" :href="`mailto:${contact.email}`" class="lr-link lr-link-email"><q-icon name="mail_outline" size="16px" /><span class="lr-link-text">{{ contact.email }}</span></a>
        <!-- The "No email or phone" flag already says it when both are missing. -->
        <span v-if="!contact.phone && contact.email" class="lr-none">No phone</span>
        <span v-if="!contact.email && contact.phone" class="lr-none">No email</span>
      </div>

      <!-- One action bar, not two stacked rows: Followed up and Add note on the
           left, the decision (or restore) on the right. It wraps
           rather than overflows if a phone is too narrow for all of it. The
           follow-up and note controls save straight away, so they stay on the
           compact desktop rows too; Confirm / Reject live in the pane there. -->
      <div v-if="showBar" class="lr-bar">
        <div v-if="!rejected" class="lr-bar-left">
          <q-checkbox
            :model-value="contact.followedUp"
            label="Followed up"
            class="lr-follow"
            :disable="busy"
            @update:model-value="(v: boolean) => $emit('followedUp', v)"
          />
          <!-- Adding a note lives in the open lead on a phone; the row keeps only
               what saves in one tap. -->
          <q-btn
            v-if="!phone"
            flat
            no-caps
            dense
            color="primary"
            icon="note_add"
            label="Add note"
            aria-label="Add note"
            class="lr-note-btn"
            :disable="busy"
            @click="$emit('addNote')"
          >
            <q-tooltip anchor="top middle" self="bottom middle" max-width="240px">Adds a dated note. Notes are included in the Zoho import.</q-tooltip>
          </q-btn>
        </div>

        <div class="lr-bar-right">
          <template v-if="unconfirmed && !compact">
            <!-- Still in the pipeline: nothing to decide yet, so a bar stands where the
                 buttons will be. The list reloads itself, which swaps them in. -->
            <ProcessingBar v-if="processing" class="lr-proc" />
            <!-- Phone: two round icons, no words. The ✓ is the same lead as the
                 "Ready to confirm" chip above it, so the chip explains the tick. -->
            <template v-else-if="phone && ready">
              <q-btn round outline color="negative" icon="close" aria-label="Reject" class="lr-icon-btn" :disable="busy" @click="$emit('reject')" />
              <q-btn round unelevated color="positive" icon="check" aria-label="Confirm" title="Confirm" class="lr-icon-btn" :loading="busy" @click="$emit('approve')" />
            </template>
            <!-- Phone, not ready: no decision to make yet, so a cue for the fix. The card
                 (and this button, for keyboard and screen-reader users) opens the lead. -->
            <button v-else-if="phone" type="button" class="lr-cue" @click="$emit('open')">{{ cue }}</button>
            <template v-else>
              <q-btn flat no-caps color="negative" icon="close" label="Reject" aria-label="Reject" class="lr-btn" :disable="busy" @click="$emit('reject')" />
              <q-btn
                v-if="ready"
                unelevated
                no-caps
                color="positive"
                icon="check"
                label="Confirm"
                class="lr-btn lr-btn-main"
                :loading="busy"
                @click="$emit('approve')"
              />
              <q-btn v-else outline no-caps color="primary" label="Open" class="lr-btn lr-btn-main" @click="$emit('open')" />
            </template>
          </template>

          <q-btn v-else-if="rejected && !compact" outline no-caps color="primary" icon="undo" label="Restore" class="lr-btn lr-btn-main" :disable="busy" @click="$emit('restore')" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useQuasar } from 'quasar';
import LeadChip from '@/components/contacts/LeadChip.vue';
import ProcessingBar from '@/components/contacts/ProcessingBar.vue';
import type { ContactListItem } from '@/types/review';
import { accountBadge, fullName, isProcessing, isReady, leadCue, leadFlags, orgLine, READY_LABEL, rowStatus, sourceLabel, sourceTone } from '@/utils/contactsList';

const props = defineProps<{
  contact: ContactListItem;
  active?: boolean;
  // Desktop split pane: the pane owns Confirm / Reject, so the list row stays
  // a compact summary (Followed up still saves straight from here).
  compact?: boolean;
  showEvent?: boolean;
  showRep?: boolean;
  selectable?: boolean;
  selected?: boolean;
  busy?: boolean;
}>();

const emit = defineEmits<{
  open: [];
  approve: [];
  reject: [];
  restore: [];
  followedUp: [value: boolean];
  addNote: [];
  'update:selected': [value: boolean];
}>();

const $q = useQuasar();
// Phone widths drop the button labels to icons so the action bar fits one line.
const phone = computed(() => $q.screen.lt.sm);
// Nothing to show on a compact rejected row (its Restore lives in the pane).
const showBar = computed(() => !rejected.value || !props.compact);
// The list is one deck of every status, so each row reads its own: unconfirmed (the
// old To review), confirmed, or rejected (only in the Rejected view). `status` is
// finer (ready / needs info / processing) and names the edge colour.
const status = computed(() => rowStatus(props.contact));
const unconfirmed = computed(() => props.contact.reviewStatus === 'needs_review');
const confirmed = computed(() => props.contact.reviewStatus === 'approved');
const rejected = computed(() => props.contact.reviewStatus === 'rejected');

// On a phone the whole card opens the lead, not just the name. The identity block
// stays the one real <button> (keyboard, screen readers); this only widens the
// tap. Anything interactive inside the card (phone / email links, the checkbox,
// the ✓ / ✕) handles its own tap and must not also open the lead.
function onCardClick(e: MouseEvent) {
  if (!phone.value || props.selectable) return;
  const el = e.target as HTMLElement | null;
  if (el?.closest('a, button, input, label, .q-checkbox, .q-btn')) return;
  emit('open');
}

const name = computed(() => fullName(props.contact));
const flags = computed(() => leadFlags(props.contact));
const ready = computed(() => isReady(props.contact));
// Mid-pipeline: no Reject here (the editor explains why), only the Open button.
const processing = computed(() => isProcessing(props.contact));
const cue = computed(() => leadCue(props.contact) ?? 'Open');
// "Pick a Zoho match" is already the account badge — don't say it twice.
const shownFlags = computed(() => flags.value.filter((f) => !(f.key === 'unclear' && badge.value)));
const badge = computed(() => accountBadge(props.contact));

</script>

<style scoped>
.lr {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 4px;
  padding: 10px 12px 10px 12px;
  background: #fff;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}
/* The left edge ALWAYS means status, never "this one is open": green ready, orange
   needs info, blue processing, soft green confirmed, grey rejected. The open lead
   is a background tint and an outline instead (it used to be this edge, in blue,
   which would now read as "processing"). */
.lr::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  background: var(--edge, transparent);
  pointer-events: none;
}
.lr.st-ready { --edge: #1E8E3E; }
.lr.st-needsInfo { --edge: #E07B00; }
.lr.st-processing { --edge: #0067AC; }
.lr.st-confirmed { --edge: #7CC49A; }
.lr.st-rejected { --edge: #B6BEC6; }
.lr.is-active {
  background: #F1F8FD;
  outline: 2px solid var(--q-primary);
  outline-offset: -2px;
}
.lr.is-busy { opacity: 0.6; }

.lr-check { margin-top: 2px; }
.lr-body { flex: 1; min-width: 0; padding-left: 4px; }

.lr-open {
  display: block;
  width: 100%;
  padding: 2px 0;
  border: 0;
  background: transparent;
  font: inherit;
  text-align: left;
  color: inherit;
  cursor: pointer;
}
.lr-open:focus-visible { outline: 2px solid #0067AC; outline-offset: 2px; border-radius: 4px; }
.lr-open > span { display: block; }

.lr-line1 { display: flex !important; align-items: center; gap: 8px; }
.lr-name { font-size: 16px; font-weight: 500; line-height: 1.3; overflow-wrap: anywhere; }
.lr-org {
  font-size: 14px;
  color: #3D4750;
  margin-top: 1px;
  overflow-wrap: anywhere;
  display: -webkit-box !important;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.lr-meta { font-size: 12px; color: #5B6670; margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lr-note {
  margin-top: 4px;
  font-size: 13px;
  color: #3D4750;
  font-style: italic;
  display: -webkit-box !important;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.lr-note-2 { -webkit-line-clamp: 2; }
.lr-chips { display: flex !important; flex-wrap: wrap; gap: 4px; margin-top: 6px; }

/* Phone and email each stay on one line — the email truncates with an
   ellipsis rather than wrapping to three lines or pushing the page wider. */
.lr-contact { display: flex; align-items: center; gap: 0 14px; margin-top: 2px; font-size: 14px; min-width: 0; }
.lr-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  min-width: 0;
  color: #0067AC;
  text-decoration: none;
}
.lr-link:hover { text-decoration: underline; }
.lr-link-phone { flex: none; }
.lr-link-email { flex: 1 1 0; }
.lr-link-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lr-none { min-height: 32px; display: inline-flex; align-items: center; color: #6B7680; }
@media (pointer: coarse) {
  .lr-link, .lr-none { min-height: 40px; }
}

.lr-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0 8px; margin-top: 4px; }
.lr-bar-left { display: flex; align-items: center; gap: 4px; min-width: 0; }
.lr-bar-right { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.lr-follow { min-height: 44px; }
.lr-note-btn { min-height: 44px; padding: 0 8px; }
.lr-btn { min-height: 44px; }
.lr-btn-main { min-width: 96px; }
.lr-icon-btn { width: 40px; height: 40px; min-height: 40px; }
.lr-proc { flex: 1; min-width: 96px; max-width: 180px; }
.lr-cue { border: 0; background: transparent; color: #0067AC; font: inherit; font-size: 14px; font-weight: 500; min-height: 44px; padding: 0 4px; cursor: pointer; }
.lr-cue:focus-visible { outline: 2px solid #0067AC; outline-offset: 2px; border-radius: 4px; }
.lr-chev { margin-left: auto; flex: none; color: #8A949E; }
</style>

<style scoped>
/* Phone: each lead is its own card, so it reads as a thing you can open rather
   than a line in a list. The footer is a thin rule above the row's controls. */
@media (max-width: 599px) {
  .lr.is-card {
    margin: 0 0 8px;
    padding: 12px;
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    cursor: pointer;
    -webkit-tap-highlight-color: rgba(0, 103, 172, 0.08);
  }
  .lr.is-card.is-active { background: #F1F8FD; }
  .lr.is-card .lr-bar {
    margin-top: 8px;
    padding-top: 6px;
    border-top: 1px solid rgba(0, 0, 0, 0.08);
    flex-wrap: nowrap;
  }
  .lr.is-card .lr-bar-right { gap: 8px; }
}
</style>

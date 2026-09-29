<template>
  <div class="lr" :class="{ 'is-active': active, 'is-busy': busy }" :data-lead-id="contact.id">
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
          <LeadChip v-if="contact.contactIntent && tab !== 'approved'" :tone="intentTone(contact.contactIntent)">{{ intentLabel }}</LeadChip>
        </span>
        <span v-if="orgLine(contact)" class="lr-org">{{ orgLine(contact) }}</span>
        <span v-if="showEvent || showRep" class="lr-meta">{{ [showEvent ? contact.eventName : null, showRep ? contact.repName : null].filter(Boolean).join(' · ') }}</span>
        <span v-if="contact.interactionNotes" class="lr-note" :class="{ 'lr-note-2': tab === 'approved' }">{{ contact.interactionNotes }}</span>
        <span class="lr-chips">
          <template v-if="tab === 'needs_review'">
            <LeadChip v-if="flags.length === 0" tone="green"><q-icon name="check" size="14px" />Ready</LeadChip>
            <LeadChip v-for="f in shownFlags" :key="f.key" :tone="f.tone">{{ f.label }}</LeadChip>
          </template>
          <LeadChip v-if="badge" :tone="badge.tone">{{ badge.label }}</LeadChip>
          <LeadChip v-if="contact.syncedAt" tone="grey">Sent to Zoho</LeadChip>
        </span>
      </button>

      <div class="lr-contact">
        <a v-if="contact.phone" :href="`tel:${contact.phone}`" class="lr-link"><q-icon name="phone" size="16px" />{{ contact.phone }}</a>
        <span v-else-if="contact.email" class="lr-none">No phone</span>
        <a v-if="contact.email" :href="`mailto:${contact.email}`" class="lr-link lr-link-email"><q-icon name="mail_outline" size="16px" />{{ contact.email }}</a>
        <span v-else-if="contact.phone" class="lr-none">No email</span>
      </div>

      <!-- A rep who was quick on the follow-up can mark it here without
           opening the lead. Shown on the compact desktop rows too: it saves
           straight away, so it doesn't need the pane. -->
      <div v-if="tab === 'needs_review'" class="lr-actions lr-actions-follow">
        <q-checkbox
          :model-value="contact.followedUp"
          label="Followed up"
          class="lr-follow"
          :disable="busy"
          @update:model-value="(v: boolean) => $emit('followedUp', v)"
        />
        <q-btn flat no-caps dense color="primary" icon="note_add" label="Add note" class="lr-note-btn" :disable="busy" @click="$emit('addNote')">
          <q-tooltip anchor="top middle" self="bottom middle" max-width="240px">Adds a dated note. Notes are included in the Zoho import.</q-tooltip>
        </q-btn>
      </div>

      <div v-if="tab === 'needs_review' && !compact" class="lr-actions">
        <q-btn flat no-caps color="negative" icon="close" label="Reject" class="lr-btn" :disable="busy" @click="$emit('reject')" />
        <q-btn
          v-if="ready"
          unelevated
          no-caps
          color="positive"
          icon="check"
          label="Approve"
          class="lr-btn lr-btn-main"
          :loading="busy"
          @click="$emit('approve')"
        />
        <q-btn v-else outline no-caps color="primary" label="Review" class="lr-btn lr-btn-main" @click="$emit('open')" />
      </div>

      <div v-if="tab === 'approved'" class="lr-actions lr-actions-follow">
        <q-checkbox
          :model-value="contact.followedUp"
          label="Followed up"
          class="lr-follow"
          :disable="busy"
          @update:model-value="(v: boolean) => $emit('followedUp', v)"
        />
        <q-btn flat no-caps dense color="primary" icon="note_add" label="Add note" class="lr-note-btn" :disable="busy" @click="$emit('addNote')">
          <q-tooltip anchor="top middle" self="bottom middle" max-width="240px">Adds a dated note. Notes are included in the Zoho import.</q-tooltip>
        </q-btn>
        <q-btn flat no-caps dense class="lr-heat" :class="contact.contactIntent ? `heat-${contact.contactIntent}` : ''" :disable="busy" :aria-label="`Heat: ${intentLabel || 'not set'}`">
          <q-icon name="local_fire_department" size="18px" class="q-mr-xs" />{{ intentLabel || 'Set heat' }}
          <q-menu auto-close anchor="bottom right" self="top right">
            <q-list dense style="min-width: 140px">
              <q-item v-for="opt in heatOptions" :key="opt.value" clickable :active="contact.contactIntent === opt.value" @click="$emit('intent', opt.value)">
                <q-item-section>{{ opt.label }}</q-item-section>
              </q-item>
              <q-separator v-if="contact.contactIntent" />
              <q-item v-if="contact.contactIntent" clickable @click="$emit('intent', null)">
                <q-item-section class="text-grey-8">Clear</q-item-section>
              </q-item>
            </q-list>
          </q-menu>
        </q-btn>
      </div>

      <div v-if="tab === 'rejected' && !compact" class="lr-actions">
        <q-btn outline no-caps color="primary" icon="undo" label="Restore" class="lr-btn lr-btn-main" :disable="busy" @click="$emit('restore')" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import LeadChip from '@/components/smart/LeadChip.vue';
import type { ContactListItem } from '@/types/review';
import { accountBadge, fullName, intentTone, isReady, leadFlags, orgLine, type ReviewStatus } from '@/utils/reviewSmart';

const props = defineProps<{
  contact: ContactListItem;
  tab: ReviewStatus;
  active?: boolean;
  // Desktop split pane: the pane owns Approve / Reject, so the list row stays
  // a compact summary (Followed up and heat still save straight from here).
  compact?: boolean;
  showEvent?: boolean;
  showRep?: boolean;
  selectable?: boolean;
  selected?: boolean;
  busy?: boolean;
}>();

defineEmits<{
  open: [];
  approve: [];
  reject: [];
  restore: [];
  followedUp: [value: boolean];
  addNote: [];
  intent: [value: 'hot' | 'warm' | 'cold' | null];
  'update:selected': [value: boolean];
}>();

const name = computed(() => fullName(props.contact));
const flags = computed(() => leadFlags(props.contact));
const ready = computed(() => isReady(props.contact));
// "Pick a Zoho match" is already the account badge — don't say it twice.
const shownFlags = computed(() => flags.value.filter((f) => !(f.key === 'unclear' && badge.value)));
const badge = computed(() => accountBadge(props.contact));
const intentLabel = computed(() => (props.contact.contactIntent ? props.contact.contactIntent.charAt(0).toUpperCase() + props.contact.contactIntent.slice(1) : ''));

const heatOptions: { value: 'hot' | 'warm' | 'cold'; label: string }[] = [
  { value: 'hot', label: 'Hot' },
  { value: 'warm', label: 'Warm' },
  { value: 'cold', label: 'Cold' },
];
</script>

<style scoped>
.lr {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  padding: 10px 12px 10px 8px;
  background: #fff;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  border-left: 3px solid transparent;
}
.lr.is-active {
  background: #F1F8FD;
  border-left-color: var(--q-primary);
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
.lr-org { font-size: 14px; color: #3D4750; margin-top: 1px; overflow-wrap: anywhere; }
.lr-meta { font-size: 12px; color: #5B6670; margin-top: 1px; }
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

.lr-contact { display: flex; flex-wrap: wrap; gap: 0 14px; margin-top: 2px; font-size: 14px; }
.lr-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  color: #0067AC;
  text-decoration: none;
  overflow-wrap: anywhere;
}
.lr-link:hover { text-decoration: underline; }
.lr-none { min-height: 32px; display: inline-flex; align-items: center; color: #6B7680; }
@media (pointer: coarse) {
  .lr-link, .lr-none { min-height: 44px; }
}

.lr-actions { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.lr-btn { min-height: 44px; }
.lr-btn-main { flex: 1; }
.lr-actions-follow { flex-wrap: wrap; gap: 0 8px; }
.lr-note-btn { min-height: 44px; padding: 0 8px; }
.lr-heat { margin-left: auto; }
.lr-follow { min-height: 44px; }
.lr-heat { min-height: 44px; padding: 0 10px; color: #4A555F; }
.lr-heat.heat-hot { color: #B23B3B; background: #FBEAEA; }
.lr-heat.heat-warm { color: #9A4D00; background: #FDEEE3; }
.lr-heat.heat-cold { color: #0067AC; background: #E3F1FA; }
</style>

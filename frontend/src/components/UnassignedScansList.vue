<template>
  <!-- The amber "N scans need a conference" banner, as pure display: what the rows
       say and the buttons they offer, with every action handed back to whoever
       renders it. UnassignedScansBanner (Review) loads the real queue and files or
       discards; the onboarding tour renders the same thing with sample rows and no
       requests. Warning colour and a count on purpose: there is no email or text
       about these, so this banner is the only thing that says a real person's
       details are waiting. -->
  <q-banner dense class="usb q-mb-md" role="region" aria-label="Scans waiting for a conference">
    <div class="row items-center no-wrap q-gutter-sm">
      <q-icon name="warning" color="orange-9" size="20px" />
      <span class="text-weight-medium usb-title">{{ bannerText(count) }}</span>
      <q-space />
      <q-btn flat dense no-caps size="sm" color="primary" :label="expanded ? 'Hide' : 'Show'" :aria-expanded="expanded" @click="$emit('toggle')" />
    </div>

    <div v-if="expanded" class="q-mt-sm">
      <div class="text-caption q-mb-sm usb-help">
        Someone scanned a QR code but no live conference was chosen. Pick one to file them as a lead.
      </div>
      <div v-for="s in items" :key="s.id" class="usb-item">
        <div class="usb-name">
          {{ s.firstName }} {{ s.lastName }}
          <q-chip dense square size="sm" class="usb-chip">{{ waitingText(s.createdAt) }}</q-chip>
        </div>
        <div class="usb-contact">{{ [s.email, s.phone].filter(Boolean).join(' · ') }}</div>
        <div class="usb-why">{{ reasonText({ ...s, eventHintName: s.eventHintName ? cleanConferenceName(s.eventHintName) : null }) }}</div>
        <div class="usb-rep">{{ s.repName ? `Rep: ${s.repName}` : 'No rep' }}</div>
        <div class="row q-gutter-xs q-mt-xs">
          <q-btn dense unelevated no-caps size="sm" color="primary" label="Choose conference" @click="$emit('choose', s)" />
          <q-btn dense flat no-caps size="sm" color="negative" label="Discard" :loading="!!discarding?.[s.id]" @click="$emit('discard', s)" />
        </div>
      </div>
      <div v-if="count > items.length" class="text-caption usb-help">
        Showing the newest {{ items.length }} of {{ count }}. Filing these brings the rest up.
      </div>
    </div>
  </q-banner>
</template>

<script setup lang="ts">
import type { UnassignedSubmission } from '@/types/review';
import { cleanConferenceName } from '@/utils/conferenceName';
import { bannerText, reasonText, waitingText } from '@/utils/unassignedScans';

defineProps<{
  count: number;
  items: UnassignedSubmission[];
  expanded: boolean;
  discarding?: Record<string, boolean>;
}>();
defineEmits<{ toggle: []; choose: [s: UnassignedSubmission]; discard: [s: UnassignedSubmission] }>();
</script>

<style scoped>
.usb {
  border-radius: 8px;
  background: #FFF3E0;
  border: 1px solid #FFCC80;
  color: #8A4B00;
}
.usb-title { min-width: 0; overflow-wrap: anywhere; }
.usb-help { color: #6B4A1F; }
.usb-item {
  margin-bottom: 6px;
  padding: 8px 10px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 8px;
  color: #1B2630;
}
.usb-name { font-weight: 500; overflow-wrap: anywhere; }
.usb-chip { background: #FFE0B2; color: #8A4B00; margin-left: 4px; }
.usb-contact { font-size: 12px; color: #55616B; overflow-wrap: anywhere; }
.usb-why { margin-top: 4px; font-size: 13px; overflow-wrap: anywhere; }
.usb-rep { font-size: 12px; color: #55616B; }
.usb-dialog { width: 360px; max-width: calc(100vw - 32px); }
</style>

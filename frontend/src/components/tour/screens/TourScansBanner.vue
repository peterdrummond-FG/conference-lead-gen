<template>
  <!-- The amber "N scans need a conference" banner Review shows admin and
       Solutions Success, drawn for the tour: markup, styles and wording copied
       from components/UnassignedScansBanner.vue (PROTOTYPE: for the build the
       real one gets a presentational part both render). Static sample rows, no
       requests. The words come from the same utils/unassignedScans.ts the real
       banner uses, so they can't drift. -->
  <q-banner dense class="usb q-mb-md" data-tt="scans-waiting" role="region" aria-label="Scans waiting for a conference">
    <div class="row items-center no-wrap q-gutter-sm">
      <q-icon name="warning" color="orange-9" size="20px" />
      <span class="text-weight-medium usb-title">{{ bannerText(ROWS.length) }}</span>
      <q-space />
      <q-btn flat dense no-caps size="sm" color="primary" :label="expanded ? 'Hide' : 'Show'" data-tt="scans-toggle" @click="$emit('toggle')" />
    </div>
    <div v-if="expanded" class="q-mt-sm">
      <div class="text-caption q-mb-sm usb-help">Someone scanned a QR code but no live conference was chosen. Pick one to file them as a lead.</div>
      <div v-for="(s, i) in ROWS" :key="s.name" class="usb-item" :data-tt="i === 0 ? 'scan-row' : undefined">
        <div class="usb-name">{{ s.name }} <q-chip dense square size="sm" class="usb-chip">{{ s.waiting }}</q-chip></div>
        <div class="usb-contact">{{ s.contact }}</div>
        <div class="usb-why">{{ s.why }}</div>
        <div class="usb-rep">{{ s.rep }}</div>
        <div class="row q-gutter-xs q-mt-xs">
          <q-btn dense unelevated no-caps size="sm" color="primary" label="Choose conference" :data-tt="i === 0 ? 'scan-choose' : undefined" />
          <q-btn dense flat no-caps size="sm" color="negative" label="Discard" />
        </div>
      </div>
    </div>
  </q-banner>
</template>

<script setup lang="ts">
import { bannerText, reasonText, waitingText } from '@/utils/unassignedScans';

defineProps<{ expanded: boolean }>();
defineEmits<{ toggle: [] }>();

const HOUR = 3_600_000;
const ROWS = [
  {
    name: 'Casey Morgan',
    contact: 'casey.morgan@example.org · (555) 010-2233',
    why: reasonText({ reason: 'rep_no_conference', repName: 'Jamie Cole', eventHintName: null }),
    rep: 'Rep: Jamie Cole',
    waiting: waitingText(new Date(Date.now() - 2 * HOUR).toISOString()),
  },
  {
    name: 'Dana Whitfield',
    contact: 'dana.whitfield@example.org',
    why: reasonText({ reason: 'event_ended', repName: 'Chris Park', eventHintName: 'TASSP Summer' }),
    rep: 'Rep: Chris Park',
    waiting: waitingText(new Date(Date.now() - 26 * HOUR).toISOString()),
  },
];
</script>

<style scoped>
.usb { border-radius: 8px; background: #FFF3E0; border: 1px solid #FFCC80; color: #8A4B00; }
.usb-title { min-width: 0; overflow-wrap: anywhere; }
.usb-help { color: #6B4A1F; }
.usb-item { margin-bottom: 6px; padding: 8px 10px; background: #fff; border: 1px solid rgba(0, 0, 0, 0.12); border-radius: 8px; color: #1B2630; }
.usb-name { font-weight: 500; overflow-wrap: anywhere; }
.usb-chip { background: #FFE0B2; color: #8A4B00; margin-left: 4px; }
.usb-contact { font-size: 12px; color: #55616B; overflow-wrap: anywhere; }
.usb-why { margin-top: 4px; font-size: 13px; overflow-wrap: anywhere; }
.usb-rep { font-size: 12px; color: #55616B; }
</style>

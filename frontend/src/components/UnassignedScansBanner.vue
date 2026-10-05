<template>
  <!-- Public scans contacts-create couldn't place under a conference, held for
       Solutions Success instead of lost. Warning colour and a count on purpose:
       there is no email or text about these, so this banner is the only thing that
       says a real person's details are waiting. Renders nothing when the queue is
       empty (the common case), and the parent only mounts it for admin and
       Solutions Success, never for a rep or while previewing one. -->
  <q-banner v-if="count > 0" dense class="usb q-mb-md" role="region" aria-label="Scans waiting for a conference">
    <div class="row items-center no-wrap q-gutter-sm">
      <q-icon name="warning" color="orange-9" size="20px" />
      <span class="text-weight-medium usb-title">{{ bannerText(count) }}</span>
      <q-space />
      <q-btn flat dense no-caps size="sm" color="primary" :label="expanded ? 'Hide' : 'Show'" :aria-expanded="expanded" @click="expanded = !expanded" />
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
          <q-btn dense unelevated no-caps size="sm" color="primary" label="Choose conference" @click="openDialog(s)" />
          <q-btn dense flat no-caps size="sm" color="negative" label="Discard" :loading="discarding[s.id]" @click="confirmDiscard(s)" />
        </div>
      </div>
      <div v-if="count > items.length" class="text-caption usb-help">
        Showing the newest {{ items.length }} of {{ count }}. Filing these brings the rest up.
      </div>
    </div>

    <q-dialog v-model="dialogOpen">
      <q-card class="usb-dialog">
        <q-card-section>
          <div class="text-subtitle1">File {{ target?.firstName }} {{ target?.lastName }} as a lead</div>
          <div class="text-caption text-grey-8">{{ [target?.email, target?.phone].filter(Boolean).join(' · ') }}</div>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <q-select
            v-model="eventId"
            :options="eventOptions"
            option-label="label"
            option-value="id"
            emit-value
            map-options
            filled
            dense
            label="Conference (live only)"
            :loading="optionsLoading"
            :hint="!optionsLoading && !eventOptions.length ? 'No live conferences. Activate one in Admin first.' : undefined"
          />
          <q-select
            v-model="repId"
            :options="repOptions"
            option-label="label"
            option-value="id"
            emit-value
            map-options
            clearable
            filled
            dense
            class="q-mt-sm"
            label="Rep to credit"
            hint="Optional. The lead shows up in this rep's Review."
            :loading="optionsLoading"
          />
          <div class="text-caption text-grey-8 q-mt-sm">It gets checked against Zoho like any other lead.</div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps label="Cancel" v-close-popup />
          <q-btn unelevated no-caps color="primary" label="File lead" :disable="!eventId" :loading="saving" @click="file" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-banner>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Dialog, Notify } from 'quasar';
import { api } from '@/boot/axios';
import type { Profile, UnassignedSubmission } from '@/types/review';
import { cleanConferenceName } from '@/utils/conferenceName';
import { bannerText, reasonText, waitingText } from '@/utils/unassignedScans';

const items = ref<UnassignedSubmission[]>([]);
const count = ref(0);
const expanded = ref(false);
const discarding = ref<Record<string, boolean>>({});

const dialogOpen = ref(false);
const target = ref<UnassignedSubmission | null>(null);
const eventId = ref<string | null>(null);
const repId = ref<string | null>(null);
const eventOptions = ref<{ id: string; label: string }[]>([]);
const repOptions = ref<{ id: string; label: string }[]>([]);
const optionsLoading = ref(false);
const saving = ref(false);

async function load() {
  const { data } = await api.get<{ count: number; items: UnassignedSubmission[] }>('/unassigned-list');
  items.value = data.items;
  count.value = data.count;
}

// Fresh every time the dialog opens: a conference may have been activated or
// ended since the page loaded, and unassigned-assign re-checks it anyway.
async function openDialog(s: UnassignedSubmission) {
  target.value = s;
  eventId.value = null;
  repId.value = s.repId;
  dialogOpen.value = true;
  optionsLoading.value = true;
  try {
    const [events, profiles] = await Promise.all([
      api.get<{ id: string; name: string; state: string }[]>('/events-list-active'),
      api.get<Profile[]>('/profiles-list'),
    ]);
    eventOptions.value = events.data.map((e) => ({ id: e.id, label: `${cleanConferenceName(e.name)} (${e.state})` }));
    repOptions.value = profiles.data.filter((p) => p.role === 'sales').map((p) => ({ id: p.id, label: p.name }));
  } finally {
    optionsLoading.value = false;
  }
}

async function file() {
  if (!target.value || !eventId.value) return;
  saving.value = true;
  try {
    await api.post('/unassigned-assign', { eventId: eventId.value, repId: repId.value }, { params: { id: target.value.id } });
    dialogOpen.value = false;
    Notify.create({ type: 'positive', message: 'Filed as a lead.' });
    await load();
  } catch {
    // The axios interceptor already showed why (for example "Someone has already
    // filed this scan"); refresh so a stale row stops offering a dead action.
    await load().catch(() => undefined);
  } finally {
    saving.value = false;
  }
}

function confirmDiscard(s: UnassignedSubmission) {
  Dialog.create({
    title: 'Discard this scan?',
    message: `${s.firstName} ${s.lastName}'s details won't become a lead.`,
    cancel: true,
    persistent: true,
    ok: { label: 'Discard', color: 'negative' },
  }).onOk(async () => {
    discarding.value = { ...discarding.value, [s.id]: true };
    try {
      await api.post('/unassigned-discard', undefined, { params: { id: s.id } });
      await load();
    } catch {
      await load().catch(() => undefined);
    } finally {
      discarding.value = { ...discarding.value, [s.id]: false };
    }
  });
}

defineExpose({ load });
onMounted(() => load().catch(() => undefined));
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

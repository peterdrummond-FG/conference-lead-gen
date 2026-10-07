<template>
  <!-- The queue of public scans contacts-create couldn't place under a conference,
       held for Solutions Success instead of lost. Renders nothing when the queue
       is empty (the common case), and the parent only mounts it for admin and
       Solutions Success, never for a rep or while previewing one. The words and
       layout are UnassignedScansList, which the onboarding tour draws too. -->
  <UnassignedScansList
    v-if="count > 0"
    :count="count" :items="items" :expanded="expanded" :discarding="discarding"
    @toggle="expanded = !expanded" @choose="openDialog" @discard="confirmDiscard"
  />
  <q-dialog v-model="dialogOpen">
      <q-card class="usb-dialog">
        <q-card-section>
          <div class="text-subtitle1">File {{ target?.firstName }} {{ target?.lastName }} as a contact</div>
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
            hint="Optional. The contact shows up in this rep's Contacts."
            :loading="optionsLoading"
          />
          <div class="text-caption text-grey-8 q-mt-sm">It gets checked against Zoho like any other contact.</div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps label="Cancel" v-close-popup />
          <q-btn unelevated no-caps color="primary" label="File contact" :disable="!eventId" :loading="saving" @click="file" />
        </q-card-actions>
      </q-card>
    </q-dialog>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Dialog, Notify } from 'quasar';
import { api } from '@/boot/axios';
import type { Profile, UnassignedSubmission } from '@/types/review';
import { cleanConferenceName } from '@/utils/conferenceName';
import UnassignedScansList from '@/components/UnassignedScansList.vue';

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
    Notify.create({ type: 'positive', message: 'Filed as a contact.' });
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
    message: `${s.firstName} ${s.lastName}'s details won't become a contact.`,
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
.usb-dialog { width: 360px; max-width: calc(100vw - 32px); }
</style>

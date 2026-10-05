<template>
  <q-card>
    <q-card-section>
      <div class="admin-head">
        <div class="text-h6">Conferences</div>
        <q-btn color="primary" no-caps icon="add" label="Activate a conference" class="admin-btn" @click="$emit('activate')" />
      </div>
      <div class="text-caption text-grey-8 q-mt-xs">
        A conference stays live until you end it. Reps join a live one from their Setup page.
      </div>
    </q-card-section>

    <q-card-section v-if="!eventsLoaded" class="q-pt-none text-caption text-grey-8">Loading…</q-card-section>
    <q-card-section v-else-if="!eventRows.length" class="q-pt-none text-body2">
      No conferences yet. Activate one to get going.
    </q-card-section>
    <q-list v-else separator>
      <q-separator />
      <q-item v-for="event in eventRows" :key="event.id" class="q-py-md">
        <q-item-section>
          <q-item-label>
            {{ event.name }}
            <q-badge
              class="q-ml-xs"
              :color="event.status === 'active' ? 'positive' : 'grey-6'"
              :label="event.status === 'active' ? 'Live' : 'Ended'"
            />
          </q-item-label>
          <q-item-label caption>
            {{ event.state }} · started {{ formatRelativeTime(event.activatedAt) }}
            <template v-if="event.status === 'active' && repCount(event.id)">
              · {{ repCount(event.id) }} {{ repCount(event.id) === 1 ? 'rep' : 'reps' }}
            </template>
          </q-item-label>
          <q-item-label v-if="event.status === 'active' && !repCount(event.id)" caption class="text-orange-9">
            <q-icon name="warning" size="14px" /> No reps yet
          </q-item-label>
        </q-item-section>
        <q-item-section v-if="event.status === 'active'" side>
          <q-btn
            outline no-caps color="negative" label="End" class="admin-btn"
            :aria-label="`End ${event.name}`"
            :loading="completingEvent === event.id"
            @click="$emit('end', event)"
          />
        </q-item-section>
      </q-item>
    </q-list>
  </q-card>
</template>

<script setup lang="ts">
// The Admin page's Conferences card as pure display: the live and ended
// conferences, how many reps are at each, and the End button. AdminPage owns the
// requests and the confirmation dialogs; the onboarding tour draws this same card
// with sample conferences.
export interface AdminEventRow {
  id: string;
  name: string;
  state: string;
  activatedAt: string;
  status: 'active' | 'completed';
}

defineProps<{
  eventsLoaded: boolean;
  eventRows: AdminEventRow[];
  // How many reps are working at this conference right now.
  repCount: (eventId: string) => number;
  completingEvent: string | null;
}>();
defineEmits<{ activate: []; end: [event: AdminEventRow] }>();

// Rough enough to disambiguate same-named test/duplicate conferences -- not a
// general-purpose formatter.
function formatRelativeTime(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
</script>

<style scoped>
/* Title and its button share a line when they fit and wrap when they don't: the
   no-wrap row clipped "Conferences" down to "Conference" on a phone. */
.admin-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
}
.admin-btn { min-height: 44px; }
</style>

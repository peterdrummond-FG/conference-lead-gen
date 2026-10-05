<template>
  <q-card>
    <q-card-section>
      <div class="admin-head">
        <div class="text-h6">Team</div>
        <q-btn color="primary" no-caps icon="add" label="Add person" class="admin-btn" @click="$emit('add')" />
      </div>
      <div class="text-caption text-grey-8 q-mt-xs">
        {{ isAdmin ? 'Solutions Success and Sales accounts.' : 'Sales accounts.' }}
        A rep can only be at one conference at a time. A scan for a rep who isn't at one waits in Review for you to file it.
      </div>
    </q-card-section>

    <q-card-section v-if="!profilesLoaded" class="q-pt-none text-caption text-grey-8">Loading…</q-card-section>
    <q-card-section v-else-if="!profiles.length" class="q-pt-none text-body2">No accounts yet.</q-card-section>
    <q-list v-else separator>
      <q-separator />
      <q-item v-for="p in profiles" :key="p.id" class="q-py-md">
        <q-item-section>
          <q-item-label>
            {{ p.name }}
            <q-badge class="q-ml-xs" color="grey-7" :label="roleLabel(p.role)" />
          </q-item-label>
          <q-item-label caption>
            {{ p.email }}<template v-if="p.phoneNumber"> · {{ p.phoneNumber }}</template>
            <span v-else class="text-orange-9"> · no phone number</span>
          </q-item-label>

          <!-- Only sales reps have a QR (repSlug) and only their
               current_event_id decides where a scan lands, so this is the
               one control that fixes a rep who forgot to join. -->
          <q-select
            v-if="p.role === 'sales'"
            :model-value="p.currentEventId"
            :options="workingAtOptions"
            emit-value
            map-options
            dense
            outlined
            class="q-mt-sm"
            style="width: 100%; max-width: 320px"
            label="Working at"
            :loading="assigningRep === p.id"
            @update:model-value="(v: string | null) => $emit('assign', p, v)"
          />
          <q-item-label
            v-if="p.role === 'sales' && !p.currentEventId && hasActiveEvents"
            caption class="text-orange-9 q-mt-xs"
          >
            <q-icon name="warning" size="14px" /> Not at a conference, so their scans wait in Review
          </q-item-label>

          <!-- Labelled rather than an icon in the corner: this is how an
               admin gets a rep their slide to send, and an unlabelled QR
               glyph beside edit/delete wasn't findable. -->
          <div v-if="p.role === 'sales' && p.repSlug" class="q-mt-sm">
            <qr-save-buttons :rep="{ name: p.name, repSlug: p.repSlug }" class="admin-link" />
          </div>
        </q-item-section>

        <q-item-section side top>
          <div class="row no-wrap">
            <q-btn flat round padding="10px" icon="edit" color="grey-8" aria-label="Edit" @click="$emit('edit', p)">
              <q-tooltip>Edit name or phone</q-tooltip>
            </q-btn>
            <q-btn
              v-if="p.id !== currentUserId"
              flat round padding="10px" icon="delete" color="grey-8" aria-label="Delete"
              @click="$emit('remove', p)"
            />
          </div>
        </q-item-section>
      </q-item>
    </q-list>
  </q-card>
</template>

<script setup lang="ts">
import QrSaveButtons from '@/components/QrSaveButtons.vue';
import type { Profile, Role } from '@/types/review';

// The Admin page's Team card as pure display: who is on the team, which
// conference each rep is working at (the one control that fixes a rep who forgot to
// join), the QR slides, and edit / delete. AdminPage owns the requests and dialogs;
// the onboarding tour draws this same card with sample people.
defineProps<{
  isAdmin: boolean;
  profilesLoaded: boolean;
  profiles: Profile[];
  // "Working at" choices: "Not at a conference", then each live conference.
  workingAtOptions: { label: string; value: string | null }[];
  hasActiveEvents: boolean;
  assigningRep: string | null;
  currentUserId: string | null;
}>();
defineEmits<{
  add: [];
  assign: [p: Profile, eventId: string | null];
  edit: [p: Profile];
  remove: [p: Profile];
}>();

function roleLabel(role: Role) {
  if (role === 'admin') return 'Admin';
  if (role === 'solutionsSuccess') return 'Solutions Success';
  return 'Sales';
}
</script>

<style scoped>
.admin-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
}
.admin-btn { min-height: 44px; }
.admin-link { min-height: 40px; }
</style>

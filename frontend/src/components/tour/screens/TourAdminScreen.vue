<template>
  <!-- The Admin page inside the tour: the app's own Conferences and Team cards with
       sample conferences and people. Admin lists Solutions Success and Sales accounts;
       Solutions Success sees Sales accounts only. Nothing is saved. -->
  <div class="tad" :class="isPhone ? 'q-pa-sm' : 'q-pa-lg'">
    <div style="width: 640px; max-width: 100%; margin: 0 auto" class="q-gutter-md">
      <div>
        <div class="text-h5">Admin</div>
        <div class="text-body2 text-grey-8 q-mt-xs">Activate and end conferences, and manage who's on your team.</div>
      </div>
      <AdminConferencesCard
        :events-loaded="true" :event-rows="EVENTS" :rep-count="repCount" :completing-event="null"
      />
      <AdminTeamCard
        :is-admin="isAdmin" :profiles-loaded="true" :profiles="people"
        :working-at-options="WORKING_AT" :has-active-events="true" :assigning-rep="null" current-user-id="tour-self"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue';
import { useQuasar } from 'quasar';
import AdminConferencesCard, { type AdminEventRow } from '@/components/AdminConferencesCard.vue';
import AdminTeamCard from '@/components/AdminTeamCard.vue';
import type { Profile } from '@/types/review';
import { TOUR_ROLE } from './../tourRole';
import { TOUR_CONFERENCE } from '../tourText.ts';

const $q = useQuasar();
const isPhone = computed(() => $q.screen.lt.sm);
const role = inject(TOUR_ROLE, computed(() => 'solutionsSuccess' as const));
const isAdmin = computed(() => role.value === 'admin');

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const EVENTS: AdminEventRow[] = [
  { id: 'e1', name: TOUR_CONFERENCE, state: 'Texas', activatedAt: ago(2), status: 'active' },
  { id: 'e2', name: 'Region 4 Leadership Summit', state: 'Texas', activatedAt: ago(5), status: 'active' },
  { id: 'e3', name: 'MoASSP Fall Conference', state: 'Missouri', activatedAt: ago(19), status: 'completed' },
];
const WORKING_AT = [
  { label: 'Not at a conference', value: null as string | null },
  { label: TOUR_CONFERENCE, value: 'e1' as string | null },
  { label: 'Region 4 Leadership Summit', value: 'e2' as string | null },
];
// Jamie and Chris are the sample reps. An admin also sees the Solutions Success
// accounts (and their own row); Solutions Success sees Sales accounts only.
const SALES: Profile[] = [
  { id: 'tour-rep-jamie', name: 'Jamie Cole', role: 'sales', email: 'jamie.cole@example.org', phoneNumber: '+19365550110', currentEventId: 'e1', repSlug: 'tour-sample' },
  { id: 'tour-rep-chris', name: 'Chris Park', role: 'sales', email: 'chris.park@example.org', phoneNumber: '+19365550123', currentEventId: 'e2', repSlug: 'tour-sample' },
];
const SUCCESS: Profile[] = [
  { id: 'tour-self', name: 'Alex Morgan', role: 'admin', email: 'alex.morgan@example.org', phoneNumber: '+19365550100', currentEventId: null, repSlug: null },
  { id: 'tour-ss', name: 'Sam Rivera', role: 'solutionsSuccess', email: 'sam.rivera@example.org', phoneNumber: '+19365550101', currentEventId: null, repSlug: null },
];
const people = computed(() => (isAdmin.value ? [...SUCCESS, ...SALES] : SALES));
function repCount(eventId: string) {
  return SALES.filter((p) => p.currentEventId === eventId).length;
}
</script>

<style scoped>
.tad { height: 100%; overflow: hidden; }
</style>

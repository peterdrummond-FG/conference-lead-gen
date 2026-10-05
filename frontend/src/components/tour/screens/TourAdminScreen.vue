<template>
  <!-- AdminPage for the tour: markup and styles copied, sample conferences and
       people, and the app's own QrSaveButtons. PROTOTYPE: for the build the
       page gets a presentational part both render. -->
  <div class="tad" :class="isPhone ? 'q-pa-sm' : 'q-pa-lg'">
    <div style="width: 640px; max-width: 100%; margin: 0 auto" class="q-gutter-md">
      <div>
        <div class="text-h5">Admin</div>
        <div class="text-body2 text-grey-8 q-mt-xs">Activate and end conferences, and manage who's on your team.</div>
      </div>

      <q-card>
        <q-card-section>
          <div class="admin-head">
            <div class="text-h6">Conferences</div>
            <q-btn color="primary" no-caps icon="add" label="Activate a conference" class="admin-btn" data-tt="activate" />
          </div>
          <div class="text-caption text-grey-8 q-mt-xs">A conference stays live until you end it. Reps join a live one from their Setup page.</div>
        </q-card-section>
        <q-list separator>
          <q-separator />
          <q-item v-for="e in EVENTS" :key="e.name" class="q-py-md">
            <q-item-section>
              <q-item-label>
                {{ e.name }}
                <q-badge class="q-ml-xs" :color="e.live ? 'positive' : 'grey-6'" :label="e.live ? 'Live' : 'Ended'" />
              </q-item-label>
              <q-item-label caption>{{ e.state }} · started {{ e.started }}<template v-if="e.reps"> · {{ e.reps }} {{ e.reps === 1 ? 'rep' : 'reps' }}</template></q-item-label>
              <div v-if="e.live"><q-btn flat dense no-caps color="primary" class="q-px-none admin-link" label="Show conference code" /></div>
            </q-item-section>
            <q-item-section v-if="e.live" side>
              <q-btn outline no-caps color="negative" label="End" class="admin-btn" :data-tt="e.first ? 'end' : undefined" />
            </q-item-section>
          </q-item>
        </q-list>
      </q-card>

      <q-card data-tt="team">
        <q-card-section>
          <div class="admin-head">
            <div class="text-h6">Team</div>
            <q-btn color="primary" no-caps icon="add" label="Add person" class="admin-btn" data-tt="add-person" />
          </div>
          <div class="text-caption text-grey-8 q-mt-xs">
            Sales accounts. A rep can only be at one conference at a time, and their QR code only works while they're at one.
          </div>
        </q-card-section>
        <q-list separator>
          <q-separator />
          <q-item v-for="p in PEOPLE" :key="p.name" class="q-py-md">
            <q-item-section>
              <q-item-label>{{ p.name }} <q-badge class="q-ml-xs" color="grey-7" label="Sales" /></q-item-label>
              <q-item-label caption>{{ p.email }} · {{ p.phone }}</q-item-label>
              <q-select
                :model-value="p.at" :options="WORKING_AT" emit-value map-options dense outlined
                class="q-mt-sm" style="width: 100%; max-width: 320px" label="Working at"
                :data-tt="p.first ? 'working-at' : undefined"
              />
              <div class="q-mt-sm" :data-tt="p.first ? 'qr-save' : undefined">
                <QrSaveButtons :rep="{ name: p.name, repSlug: 'tour-sample' }" class="admin-link" />
              </div>
            </q-item-section>
            <q-item-section side top>
              <div class="row no-wrap">
                <q-btn flat round padding="10px" icon="edit" color="grey-8" />
                <q-btn flat round padding="10px" icon="delete" color="grey-8" />
              </div>
            </q-item-section>
          </q-item>
        </q-list>
      </q-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useQuasar } from 'quasar';
import QrSaveButtons from '@/components/QrSaveButtons.vue';
import { TOUR_CONFERENCE } from '../tourSampleData';

const $q = useQuasar();
const isPhone = computed(() => $q.screen.lt.sm);

const EVENTS = [
  { name: TOUR_CONFERENCE, state: 'Texas', started: '2d ago', reps: 2, live: true, first: true },
  { name: 'Region 4 Leadership Summit', state: 'Texas', started: '5d ago', reps: 1, live: true },
  { name: 'MoASSP Fall Conference', state: 'Missouri', started: '19d ago', reps: 0, live: false },
];
const WORKING_AT = [
  { label: TOUR_CONFERENCE, value: 'e1' },
  { label: 'Region 4 Leadership Summit', value: 'e2' },
];
const PEOPLE = [
  { name: 'Jamie Cole', email: 'jamie.cole@example.org', phone: '+19365550110', at: 'e1', first: true },
  { name: 'Chris Park', email: 'chris.park@example.org', phone: '+19365550123', at: 'e2' },
];
</script>

<style scoped>
.tad { height: 100%; overflow: hidden; }
/* From AdminPage.vue */
.admin-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; }
.admin-btn { min-height: 44px; }
.admin-link { min-height: 40px; }
</style>

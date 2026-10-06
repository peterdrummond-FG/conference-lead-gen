<template>
  <!-- DEVELOPMENT ONLY (see router/routes.ts): the onboarding on its own page, with
       no account, for review at phone and laptop sizes and for headless checks.
       Every lead and person in it is sample data, and nothing is sent to the
       server: the log below says what the real app would record. Add ?fast to
       play every script with its waits cut (see TourStage). -->
  <div class="tpp">
    <div class="tpp-bar">
      <q-btn-toggle
        v-model="role" dense no-caps unelevated toggle-color="primary" color="white" text-color="grey-9"
        :options="[{ label: 'Rep', value: 'sales' }, { label: 'Solutions Success', value: 'solutionsSuccess' }, { label: 'Admin', value: 'admin' }]"
      />
      <q-select
        v-model="start" :options="startOptions" emit-value map-options dense outlined options-dense
        class="tpp-start" label="Start at"
      />
      <q-toggle v-model="hasPhone" dense size="sm" label="Phone on account" class="tpp-toggle" />
      <q-toggle v-model="phoneConnected" dense size="sm" label="Phone linked (SETUP done)" class="tpp-toggle" />
    </div>
    <div class="tpp-stage">
      <!-- Stands in for the app behind the welcome. -->
      <div class="tpp-app">
        <div v-if="ended" class="tpp-ended">
          <div class="text-subtitle1 text-weight-medium">{{ ended }}</div>
          <div v-if="log.length" class="tpp-log">
            <div v-for="(l, i) in log" :key="i">{{ l }}</div>
          </div>
          <div class="row q-gutter-sm justify-center q-mt-md">
            <q-btn outline no-caps color="primary" label="Start again" @click="restart" />
            <q-btn v-if="resumeFrom" unelevated no-caps color="primary" label="Show the reminder (1 hour later)" @click="reminder = true" />
          </div>
        </div>
      </div>

      <TourReminder v-if="reminder" :steps="remainder" :path="endedPath" @watch="watchRemainder" @later="record('reminder-shown'); reminder = false" />
      <OnboardingFlow
        v-else-if="!ended && !startScene"
        :key="flowKey" :role="role" :has-phone="hasPhone" :phone-connected="phoneConnected"
        :mode="flowMode" :start="startPhase" :resume-from="flowResume"
        @seen="record('seen')"
        @ended="(e) => { record(`ended path=${e.path} resumeFrom=${e.resumeFrom}`); resumeFrom = e.resumeFrom; endedPath = e.path }"
        @complete="record('complete'); resumeFrom = null"
        @close="finishedWith('Closed. The app carries on where it was.')"
        @finish="(go) => finishedWith(`Goes to ${go === 'setup' ? 'Setup' : 'Review'}.`)"
      />
      <TourPlayer
        v-else-if="!ended && startScene"
        :key="flowKey" :role="role" :has-phone="hasPhone" :start="startScene - 1"
        @skip="finishedWith('Skipped.')" @done="record('complete'); finishedWith('Finished the tour.')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import OnboardingFlow from '@/components/tour/OnboardingFlow.vue';
import TourPlayer from '@/components/tour/TourPlayer.vue';
import TourReminder from '@/components/tour/TourReminder.vue';
import { playlist } from '@/components/tour/tourFlow';
import { fullSteps, isManager, remainderSteps, type FlowPhase } from '@/utils/onboardingFlow';
import type { Role } from '@/types/review';

// Development only: ?role=admin|solutionsSuccess, ?phone=0, ?linked=1 preset the toggles, so a
// headless check can open exactly one combination without clicking.
const query = new URLSearchParams(window.location.search);
const role = ref<Role>((['admin', 'solutionsSuccess'].includes(query.get('role') ?? '') ? query.get('role') : 'sales') as Role);
const manager = computed(() => isManager(role.value));
const hasPhone = ref(query.get('phone') !== '0');
const phoneConnected = ref(query.get('linked') === '1');
const start = ref<string>('splash');
const flowKey = ref(0);
const ended = ref<string | null>(null);
const reminder = ref(false);
const resumeFrom = ref<string | null>(null);
// How they left, which decides the reminder's wording (what `me.onboarding.path` holds).
const endedPath = ref<'quick' | 'tour' | null>(null);
const log = ref<string[]>([]);

const startOptions = computed(() => [
  { label: 'Splash', value: 'splash' },
  { label: 'Quick start 1', value: 'quick1' },
  { label: 'Quick start 2', value: 'quick2' },
  ...playlist(role.value, hasPhone.value, fullSteps(manager.value)).map((s, i) => ({ label: `Tour ${i + 1}: ${s.title}`, value: `scene${i + 1}` })),
  { label: 'Your turn', value: 'finish' },
  { label: 'Remainder after the quick start', value: 'remainder-quick' },
  { label: 'Reminder after the quick start', value: 'reminder-quick' },
]);
const startScene = computed(() => (start.value.startsWith('scene') ? Number(start.value.slice(5)) : 0));
const flowMode = computed(() => (start.value === 'remainder-quick' ? 'remainder' : 'first'));
const flowResume = computed(() => (start.value === 'remainder-quick' ? 'send-import' : null));
const startPhase = computed<FlowPhase>(() => (start.value === 'remainder-quick' ? 'tour' : (['splash', 'quick1', 'quick2', 'finish'].includes(start.value) ? (start.value as FlowPhase) : 'splash')));
const remainder = computed(() => remainderSteps(manager.value, resumeFrom.value ?? 'send-import'));

watch([role, start, hasPhone, phoneConnected], () => {
  restart();
  if (start.value === 'reminder-quick') { resumeFrom.value = 'send-import'; endedPath.value = 'quick'; ended.value = 'The reminder an hour after the quick start.'; reminder.value = true; }
});

function restart() {
  ended.value = null;
  reminder.value = false;
  log.value = [];
  resumeFrom.value = null;
  endedPath.value = null;
  flowKey.value++;
}
function record(what: string) { log.value = [...log.value, `records: ${what}`]; }
function finishedWith(text: string) { ended.value = text; }
function watchRemainder() {
  record('reminder-shown');
  reminder.value = false;
  ended.value = null;
  start.value = 'remainder-quick';
  flowKey.value++;
}
</script>

<style scoped>
.tpp { position: fixed; inset: 0; display: flex; flex-direction: column; background: #E9EEF3; }
.tpp-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 6px 10px; background: #fff; border-bottom: 1px solid #DDE4EB; position: relative; z-index: 7000; }
.tpp-start { min-width: 150px; flex: 1; max-width: 280px; }
.tpp-toggle { font-size: 13px; }
.tpp-stage { flex: 1; position: relative; min-height: 0; }
.tpp-app { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 24px; background: #F5F7FA; text-align: center; }
.tpp-ended { max-width: 460px; }
.tpp-log { margin-top: 10px; font-size: 13px; color: #55616B; text-align: left; }
</style>

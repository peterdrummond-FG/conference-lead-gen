<template>
  <!-- PROTOTYPE, development only (see router/routes.ts): the new welcome on
       its own page, with no account, for review at phone and laptop sizes.
       Every lead and person in it is sample data. -->
  <div class="tpp">
    <div class="tpp-bar">
      <q-btn-toggle
        v-model="role" dense no-caps unelevated toggle-color="primary" color="white" text-color="grey-9"
        :options="[{ label: 'Rep', value: 'rep' }, { label: 'Manager', value: 'manager' }]"
      />
      <q-select
        v-model="start" :options="startOptions" emit-value map-options dense outlined options-dense
        class="tpp-start" label="Start at"
      />
      <q-toggle v-model="hasPhone" dense size="sm" label="Phone on account" class="tpp-toggle" />
    </div>
    <div class="tpp-stage">
      <!-- Stands in for the app behind the welcome. -->
      <div class="tpp-app">
        <div v-if="ended" class="tpp-ended">
          <div class="text-subtitle1 text-weight-medium">{{ endText }}</div>
          <div class="row q-gutter-sm justify-center q-mt-md">
            <q-btn outline no-caps color="primary" label="Start again" @click="restart" />
            <q-btn v-if="ended !== 'finished'" unelevated no-caps color="primary" label="Show the reminder (1 hour later)" @click="reminder = true" />
          </div>
        </div>
      </div>

      <OnboardingFlow
        v-if="!ended && !reminder && !startScene"
        :key="flowKey" :manager="manager" :has-phone="hasPhone" :start="startPhase"
        @close="onClose"
      />
      <TourPlayer
        v-else-if="!ended && !reminder && startScene"
        :key="flowKey" :manager="manager" :start="startScene - 1"
        @skip="onClose('skipped')" @done="onClose('finished')"
      />
      <TourReminder v-if="reminder" @watch="reminder = false; ended = null; start = 'tour'; flowKey++" @later="reminder = false" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { Notify } from 'quasar';
import OnboardingFlow from '@/components/tour/OnboardingFlow.vue';
import TourPlayer from '@/components/tour/TourPlayer.vue';
import TourReminder from '@/components/tour/TourReminder.vue';
import { scenesFor, ONBOARDING_COPY, type OnboardingEnd } from '@/components/tour/tourFlow';

const role = ref<'rep' | 'manager'>('rep');
const manager = computed(() => role.value === 'manager');
const hasPhone = ref(true);
const start = ref<string>('splash');
const flowKey = ref(0);
const ended = ref<OnboardingEnd | null>(null);
const reminder = ref(false);

const startOptions = computed(() => [
  { label: 'Splash', value: 'splash' },
  { label: 'Quick start 1', value: 'quick1' },
  { label: 'Quick start 2', value: 'quick2' },
  ...scenesFor(manager.value).map((s, i) => ({ label: `Tour ${i + 1}: ${s.title}`, value: `scene${i + 1}` })),
  { label: 'Your turn', value: 'finish' },
]);
const startScene = computed(() => (start.value.startsWith('scene') ? Number(start.value.slice(5)) : 0));
const startPhase = computed(() => (start.value === 'tour' || startScene.value ? 'tour' : (start.value as 'splash' | 'quick1' | 'quick2' | 'finish')));

watch([role, start, hasPhone], () => restart());

function restart() {
  ended.value = null;
  reminder.value = false;
  flowKey.value++;
}

const endText = computed(() => ({
  quick: 'Closed the quick start. The app opens on Setup; the reminder comes next time.',
  'quick-texted': 'Tapped Text the code SETUP. Messages opens, and the app goes to Setup; the reminder comes next time.',
  skipped: 'Skipped the tour. The app carries on where it was; the reminder comes next time.',
  finished: 'Finished the tour. The app goes to Setup. No reminder.',
})[ended.value ?? 'finished']);

function onClose(end: OnboardingEnd) {
  ended.value = end;
  if (end === 'skipped') Notify.create({ message: ONBOARDING_COPY.skipped, icon: 'help_outline', color: 'grey-9', position: 'bottom', timeout: 5000 });
}
</script>

<style scoped>
.tpp { position: fixed; inset: 0; display: flex; flex-direction: column; background: #E9EEF3; }
.tpp-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 6px 10px; background: #fff; border-bottom: 1px solid #DDE4EB; position: relative; z-index: 7000; }
.tpp-start { min-width: 150px; flex: 1; max-width: 280px; }
.tpp-toggle { font-size: 13px; }
.tpp-stage { flex: 1; position: relative; min-height: 0; }
.tpp-app { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 24px; background: #F5F7FA; text-align: center; }
.tpp-ended { max-width: 420px; }
</style>

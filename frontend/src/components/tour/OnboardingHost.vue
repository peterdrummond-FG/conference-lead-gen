<template>
  <!-- Draws the first-time onboarding over the app and records what happens,
       for MainLayout. Everything it shows is the same OnboardingFlow /tour-preview
       plays; this only connects it to the account (what to record) and the router
       (where to go next). Fixed above Quasar's toasts (9500): a toast landing on
       the Next button would leave someone unable to move on. -->
  <teleport to="body">
    <div v-if="tour.phase !== 'idle' && user" class="oh-root">
      <TourReminder v-if="tour.phase === 'reminder'" :steps="remainder" @watch="onWatch" @later="onLater" />
      <OnboardingFlow
        v-else
        :key="tour.runKey"
        :role="user.role"
        :has-phone="hasPhone"
        :phone-connected="user.phoneConnected ?? false"
        :mode="tour.mode ?? 'first'"
        :start="tour.phase"
        :resume-from="tour.resumeFrom"
        :start-index="tour.stepIndex"
        @seen="session.recordOnboarding({ event: 'seen' })"
        @ended="(e) => session.recordOnboarding(e)"
        @complete="session.recordOnboarding({ event: 'complete' })"
        @progress="(p) => tour.progress(p)"
        @close="tour.reset()"
        @finish="onFinish"
      />
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import OnboardingFlow from './OnboardingFlow.vue';
import TourReminder from './TourReminder.vue';
import { useSessionStore } from '@/stores/session-store';
import { useTourStore } from '@/stores/tour-store';
import { isManager, remainderSteps } from '@/utils/onboardingFlow';

const session = useSessionStore();
const tour = useTourStore();
const router = useRouter();

const user = computed(() => session.user);
// An older `me` has no hasPhone; fall back to the number itself.
const hasPhone = computed(() => user.value?.hasPhone ?? !!user.value?.phoneNumber);
const remainder = computed(() => remainderSteps(isManager(user.value?.role ?? 'sales'), tour.resumeFrom));

// Either button uses the reminder up: it is shown once.
function onWatch() {
  if (!user.value) return;
  void session.recordOnboarding({ event: 'reminder-shown' });
  tour.playRemainder(user.value.id, tour.resumeFrom);
}
function onLater() {
  void session.recordOnboarding({ event: 'reminder-shown' });
  tour.reset();
}

// The last button goes to the page that matches where they are: Setup to text
// SETUP, or Review once the phone is linked.
function onFinish(go: 'setup' | 'review') {
  tour.reset();
  void router.push(go === 'setup' ? '/setup' : '/review');
}
</script>

<style scoped>
.oh-root { position: fixed; inset: 0; z-index: 9600; }
</style>

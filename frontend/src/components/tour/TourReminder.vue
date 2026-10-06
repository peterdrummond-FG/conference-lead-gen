<template>
  <!-- Shown once, the next time someone who chose "Just get me texting" or
       skipped the tour opens the app an hour or more later. The words come from
       what is actually left (reminderCopy), so it never offers a scene they have
       already seen, and its wording follows how they left (a quick-start rep is
       offered the tour, not told to finish one they never began). Either button
       uses it up; after that the ? in the top bar is the way back. -->
  <div class="trm" :class="isPhone ? 'is-phone' : 'is-wide'">
    <div class="trm-card" role="dialog" aria-labelledby="trm-title">
      <h3 id="trm-title" class="trm-title">{{ copy.title }}</h3>
      <p class="trm-body">{{ copy.body }}</p>
      <div class="trm-actions">
        <q-btn flat no-caps color="primary" :label="C.reminder.later" @click="$emit('later')" />
        <q-btn unelevated no-caps color="primary" icon="play_arrow" :label="C.reminder.watch" @click="$emit('watch')" />
      </div>
      <!-- "Not now" uses the reminder up and it is shown once, so say where the tour lives. -->
      <p class="trm-fine">{{ C.reminder.fine }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useQuasar } from 'quasar';
import { ONBOARDING_COPY as C } from './tourFlow';
import { reminderCopy, type OnboardingState, type Step } from '@/utils/onboardingFlow';

const props = defineProps<{ steps: Step[]; path: OnboardingState['path'] }>();
defineEmits<{ watch: []; later: [] }>();
const $q = useQuasar();
const isPhone = computed(() => $q.screen.lt.sm);
const copy = computed(() => reminderCopy(props.steps, props.path));
</script>

<style scoped>
.trm { position: absolute; inset: 0; z-index: 6000; background: rgba(15, 25, 35, 0.45); display: flex; }
.trm.is-phone { align-items: flex-end; padding: 10px; }
.trm.is-wide { align-items: center; justify-content: center; }
.trm-card { width: 100%; max-width: 440px; background: #fff; border-radius: 18px; padding: 20px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3); display: flex; flex-direction: column; gap: 10px; }
.trm-title { margin: 0; font-size: 20px; font-weight: 700; }
.trm-body { margin: 0; font-size: 15px; line-height: 1.45; color: #1D2733; }
.trm-fine { margin: 0; font-size: 13px; line-height: 1.4; color: #5B6573; }
.trm-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
.trm-actions .q-btn { min-height: 48px; font-size: 16px; padding: 0 16px; }
</style>

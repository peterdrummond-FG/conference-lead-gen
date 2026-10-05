<template>
  <!-- The tour: one scene per screen, each playing in the WATCH stage, the words
       underneath, and only Back, Next and Skip to press. What it plays is `steps`:
       the whole tour, or just the rest for the reminder. The progress bar counts
       only those. -->
  <OnboardingFrame
    tall
    :steps="items.length"
    :current="index"
    skip="Skip"
    :title="item.title"
    :body="item.body"
    :note="item.note"
    @skip="$emit('skip', item.step)"
  >
    <TourStage :key="item.step.id" :scene="item.component" :manager="manager" :role="role" :import-only="item.step.importOnly" />
    <template #actions>
      <q-btn v-if="index > 0" flat no-caps color="primary" label="Back" @click="go(index - 1)" />
      <q-space />
      <q-btn unelevated no-caps color="primary" label="Next" class="tp-next" @click="next" />
    </template>
  </OnboardingFrame>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import OnboardingFrame from './OnboardingFrame.vue';
import TourStage from './TourStage.vue';
import { playlist } from './tourFlow';
import { isManager, type Step } from '@/utils/onboardingFlow';
import type { Role } from '@/types/review';

const props = defineProps<{ role: Role; hasPhone?: boolean; steps?: Step[]; start?: number }>();
const emit = defineEmits<{ skip: [step: Step]; done: []; step: [index: number] }>();

const manager = computed(() => isManager(props.role));
const items = computed(() => playlist(props.role, props.hasPhone ?? true, props.steps));
const index = ref(Math.min(props.start ?? 0, items.value.length - 1));
const item = computed(() => items.value[Math.min(index.value, items.value.length - 1)]!);

function go(i: number) {
  index.value = i;
  emit('step', i);
}

// The last Next goes to "Your turn", not straight back to the app: the tour
// is for watching, and that screen is the hand-off to doing.
function next() {
  if (index.value < items.value.length - 1) go(index.value + 1);
  else emit('done');
}
</script>

<style scoped>
.tp-next { min-width: 140px; }
</style>

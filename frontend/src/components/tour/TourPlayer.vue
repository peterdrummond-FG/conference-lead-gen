<template>
  <!-- The full tour: one scene per screen, each playing in the WATCH stage,
       the words underneath, and only Back, Next and Skip to press. -->
  <OnboardingFrame
    tall
    :steps="scenes.length"
    :current="index"
    skip="Skip"
    :title="scene.title"
    :body="scene.body"
    :note="scene.note"
    @skip="$emit('skip')"
  >
    <TourStage :key="scene.id" :scene="scene.component" :manager="manager" />
    <template #actions>
      <q-btn v-if="index > 0" flat no-caps color="primary" label="Back" @click="index--" />
      <q-space />
      <q-btn unelevated no-caps color="primary" label="Next" class="tp-next" @click="next" />
    </template>
  </OnboardingFrame>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import OnboardingFrame from './OnboardingFrame.vue';
import TourStage from './TourStage.vue';
import { scenesFor } from './tourFlow';

const props = defineProps<{ manager: boolean; start?: number }>();
const emit = defineEmits<{ skip: []; done: [] }>();

const scenes = computed(() => scenesFor(props.manager));
const index = ref(props.start ?? 0);
const scene = computed(() => scenes.value[Math.min(index.value, scenes.value.length - 1)]!);

// The last Next goes to "Your turn", not straight back to the app: the tour
// is for watching, and that screen is the hand-off to doing.
function next() {
  if (index.value < scenes.value.length - 1) index.value++;
  else emit('done');
}
</script>

<style scoped>
.tp-next { min-width: 140px; }
</style>

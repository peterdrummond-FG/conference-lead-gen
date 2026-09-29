<template>
  <!-- The words and buttons of one step. Spotlight steps float it beside the
       thing they point at; illustrated steps pin it under their picture. Either
       way it is the same card, so Skip, Back and Next never behave differently. -->
  <div ref="root" class="tc" :class="{ 'tc-flat': flat }" data-tour-card>
    <div class="tc-top">
      <span class="tc-chapter">{{ step.chapter }}</span>
      <span class="tc-count">Step {{ index + 1 }} of {{ total }}</span>
    </div>
    <q-linear-progress :value="(index + 1) / total" rounded size="4px" color="primary" track-color="blue-1" class="tc-progress" />

    <h2 id="tour-title" class="tc-title">{{ step.title }}</h2>
    <p id="tour-body" class="tc-body">
      <template v-for="(part, i) in bodyParts" :key="i">
        <strong v-if="part.bold">{{ part.text }}</strong>
        <template v-else>{{ part.text }}</template>
      </template>
    </p>
    <p v-if="step.note" class="tc-note">{{ step.note }}</p>
    <p v-if="fallback" class="tc-note tc-fallback">{{ fallback }}</p>

    <div class="tc-actions">
      <q-btn flat no-caps dense color="grey-8" label="Skip for now" class="tc-btn" @click="$emit('skip')" />
      <q-space />
      <q-btn v-if="index > 0" flat no-caps color="primary" label="Back" class="tc-btn" @click="$emit('back')" />
      <q-btn ref="nextBtn" unelevated no-caps color="primary" :label="isLast ? 'Done' : 'Next'" class="tc-btn tc-next" data-tour-next @click="$emit('next')" />
    </div>
    <div v-if="step.skipTo" class="tc-skipto">
      <q-btn flat no-caps dense color="primary" :label="step.skipTo.label" class="tc-btn" @click="$emit('skipTo', step.skipTo.id)" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { TourStep } from '@/utils/onboardingTour';
import { TWILIO_NUMBER_DISPLAY } from '@/utils/smsNumber';

const props = defineProps<{
  step: TourStep;
  index: number;
  total: number;
  isLast: boolean;
  flat?: boolean;
  // Shown when a spotlight couldn't find what it points at.
  fallback?: string | undefined;
}>();

defineEmits<{ skip: []; back: []; next: []; skipTo: [id: string] }>();

const root = ref<HTMLElement | null>(null);
const nextBtn = ref<{ $el: HTMLElement } | null>(null);

// `**bold**` and `{number}` are the only markup the copy has.
const bodyParts = computed(() => props.step.body
  .replace(/\{number\}/g, TWILIO_NUMBER_DISPLAY)
  .split('**')
  .map((text, i) => ({ text, bold: i % 2 === 1 }))
  .filter((p) => p.text));

// Keyboard and screen-reader users land on Next as each step appears.
onMounted(() => { nextBtn.value?.$el?.focus?.({ preventScroll: true }); });

defineExpose({ root });
</script>

<style scoped>
.tc { padding: 16px 16px 12px; background: #fff; }
.tc-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.tc-chapter { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: #004F85; }
.tc-count { font-size: 12px; color: #5B6670; white-space: nowrap; }
.tc-progress { margin-bottom: 10px; }
.tc-title { margin: 0; font-size: 19px; font-weight: 600; line-height: 1.25; color: #1B2630; }
.tc-body { margin: 6px 0 0; font-size: 15px; line-height: 1.5; color: #2F3A44; }
/* Bold runs are the things to act on (SETUP, the number to text). Never split
   one across two lines: "+1 (936) 218-" / "1311" is not something to read aloud
   or type. */
.tc-body :deep(strong), .tc-body strong { white-space: nowrap; }
.tc-note { margin: 8px 0 0; font-size: 13px; line-height: 1.45; color: #55616B; }
.tc-fallback { font-style: italic; }
.tc-actions { display: flex; align-items: center; gap: 4px; margin-top: 14px; }
.tc-skipto { display: flex; justify-content: center; margin-top: 2px; }
.tc-btn { min-height: 44px; }
.tc-next { padding: 0 20px; }
</style>

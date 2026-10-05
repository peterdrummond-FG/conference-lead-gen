<template>
  <!-- The whole first-time welcome. One choice up front:
         "Just get me texting" -> two screens, ending at the SETUP text
         "Show me how it works" -> the animated tour, ending at "Your turn"
       Either way the person ends up on Setup, ready to do it themselves. -->
  <OnboardingFrame v-if="phase === 'splash'">
    <div class="ob-splash">
      <img :src="logo" alt="CKH Connect" class="ob-logo" />
      <h1 class="ob-h1">{{ C.splash.title }}</h1>
      <p class="ob-lead">{{ C.splash.body }}</p>
      <button type="button" class="ob-opt is-primary" @click="choose('quick1')">
        <span class="ob-opt-ic"><q-icon name="sms" size="26px" /></span>
        <span class="ob-opt-txt"><span class="ob-opt-t">{{ C.splash.quick.label }}</span><span class="ob-opt-s">{{ C.splash.quick.sub }}</span></span>
        <q-icon name="chevron_right" size="26px" class="ob-opt-chev" />
      </button>
      <button type="button" class="ob-opt" @click="choose('tour')">
        <span class="ob-opt-ic"><q-icon name="play_arrow" size="26px" /></span>
        <span class="ob-opt-txt"><span class="ob-opt-t">{{ C.splash.tour.label }}</span><span class="ob-opt-s">{{ isManagerRole ? C.splash.tour.subManagers : C.splash.tour.sub }}</span></span>
        <q-icon name="chevron_right" size="26px" class="ob-opt-chev" />
      </button>
      <q-space />
      <p class="ob-fine">{{ C.splash.fine }}</p>
    </div>
  </OnboardingFrame>

  <OnboardingFrame
    v-else-if="phase === 'quick1'"
    stage back :steps="2" :current="0"
    :title="C.quickText.title" :body="C.quickText.body" :note="C.quickText.note"
    @back="setPhase('splash')"
  >
    <TourStage :scene="TourSceneQuickText" :manager="isManagerRole" :role="role" />
    <template #actions>
      <q-space />
      <q-btn unelevated no-caps color="primary" label="Next" class="ob-next" @click="setPhase('quick2')" />
    </template>
  </OnboardingFrame>

  <OnboardingFrame v-else-if="phase === 'quick2'" back skip="Close" :steps="2" :current="1" @back="setPhase('quick1')" @skip="endQuick(null)">
    <div class="ob-link">
      <h2 class="ob-h2">{{ C.quickLink.title }}</h2>
      <!-- eslint-disable-next-line vue/no-v-html -- only **bold**, from tourFlow.ts -->
      <p class="ob-lead" v-html="renderCopy(hasPhone ? C.quickLink.body : C.quickLink.noPhoneBody)" />
      <TextSetupAction :has-phone="hasPhone" @texted="endQuick('setup')" />
      <q-space />
      <!-- eslint-disable-next-line vue/no-v-html -- same -->
      <p class="ob-fine" v-html="renderCopy(C.quickLink.footer)" />
    </div>
    <template v-if="!isMobile || !hasPhone" #actions>
      <q-space />
      <q-btn unelevated no-caps color="primary" label="Go to Setup" @click="endQuick('setup')" />
    </template>
  </OnboardingFrame>

  <TourPlayer
    v-else-if="phase === 'tour'"
    :key="tourKey"
    :role="role" :has-phone="hasPhone" :steps="steps" :start="startIndex"
    @step="(i: number) => (stepIndex = i)"
    @skip="onSkip"
    @done="onDone"
  />

  <OnboardingFrame v-else>
    <div class="ob-finish">
      <div class="ob-check"><q-icon name="check" size="40px" /></div>
      <h1 class="ob-h1">{{ finish.title }}</h1>
      <!-- eslint-disable-next-line vue/no-v-html -- only **bold**, from tourFlow.ts -->
      <p class="ob-lead" v-html="renderCopy(finish.body)" />
    </div>
    <template #actions>
      <q-btn flat no-caps color="primary" :label="C.finish.again" @click="watchAgain" />
      <q-space />
      <q-btn unelevated no-caps color="primary" :label="finish.go" class="ob-next" @click="$emit('finish', phoneConnected ? 'review' : 'setup')" />
    </template>
  </OnboardingFrame>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { Platform } from 'quasar';
import OnboardingFrame from './OnboardingFrame.vue';
import TourStage from './TourStage.vue';
import TourPlayer from './TourPlayer.vue';
import TourSceneQuickText from './scenes/TourSceneQuickText.vue';
import TextSetupAction from '@/components/TextSetupAction.vue';
import { ONBOARDING_COPY as C, renderCopy } from './tourFlow';
import { fullSteps, isManager, quickEnd, remainderSteps, tourSkip, type Ended, type FlowPhase, type Step } from '@/utils/onboardingFlow';
import type { Role } from '@/types/review';
import logo from '@/assets/brand/ckh-logo.png';

// The whole first-time welcome. One choice up front:
//   "Just get me texting"  -> two screens, ending at the SETUP text
//   "Show me how it works" -> the animated tour, ending at "Your turn"
// It decides nothing about the account itself: it says what happened (seen /
// ended / complete / finish) and whoever hosts it (MainLayout, or /tour-preview)
// records it and goes to the right page. `mode` is how it was opened:
//   first      from the splash        leaving is recorded
//   remainder  the reminder's button  plays only what is left; a skip records nothing
//   replay     the ? button           the whole tour; a skip records nothing
const props = defineProps<{
  role: Role;
  // me.hasPhone: the account has a mobile number.
  hasPhone: boolean;
  // me.phoneConnected: the phone has already texted SETUP for their conference,
  // so "Your turn" says "You're all set" instead of "text SETUP".
  phoneConnected?: boolean;
  mode?: 'first' | 'remainder' | 'replay';
  start?: FlowPhase;
  // Where a remainder starts (a scene id), and where a refreshed tab resumes.
  resumeFrom?: string | null;
  startIndex?: number;
}>();

const emit = defineEmits<{
  seen: [];
  ended: [e: Ended];
  complete: [];
  // Leave without recording anything (a replay or a remainder skipped).
  close: [];
  // The last button: go to the page that matches where they are.
  finish: [go: 'setup' | 'review'];
  progress: [p: { phase: FlowPhase; index: number }];
}>();

const mode = computed(() => props.mode ?? 'first');
const isManagerRole = computed(() => isManager(props.role));
const phase = ref<FlowPhase>(props.start ?? (mode.value === 'first' ? 'splash' : 'tour'));
const stepIndex = ref(props.startIndex ?? 0);
const tourKey = ref(0);
const isMobile = Platform.is.mobile === true;

// What the tour plays: the rest for a reminder, the whole thing otherwise.
const steps = ref<Step[]>(mode.value === 'remainder' ? remainderSteps(isManagerRole.value, props.resumeFrom ?? null) : fullSteps(isManagerRole.value));
const startIndex = computed(() => stepIndex.value);

const finish = computed(() => (props.phoneConnected ? C.finish.connected : C.finish));

function setPhase(p: FlowPhase) {
  phase.value = p;
  emit('progress', { phase: p, index: stepIndex.value });
}

// A choice on the splash is what counts as having seen it: closing the tab
// without choosing shows it again next time.
function choose(p: 'quick1' | 'tour') {
  emit('seen');
  setPhase(p);
}

// Leaving the quick start (Close, or Text SETUP). The texting half and Text
// SETUP count as seen, so what's left starts at Import.
function endQuick(go: 'setup' | null) {
  emit('ended', quickEnd());
  if (go) emit('finish', go);
  else emit('close');
}

function onSkip(step: Step) {
  const e = tourSkip(mode.value, step);
  if (e) emit('ended', e);
  emit('close');
}

// Reaching the last screen means the tour is finished: recorded here, so
// closing the tab on "Your turn" doesn't leave a reminder for something seen.
function onDone() {
  emit('complete');
  setPhase('finish');
}

function watchAgain() {
  steps.value = fullSteps(isManagerRole.value);
  stepIndex.value = 0;
  tourKey.value++;
  setPhase('tour');
}
</script>

<style scoped>
.ob-splash, .ob-link, .ob-finish { flex: 1; display: flex; flex-direction: column; gap: 14px; padding: 18px 10px 4px; }
.ob-logo { width: 170px; height: auto; }
.ob-h1 { margin: 6px 0 0; font-size: 26px; font-weight: 700; line-height: 1.2; text-wrap: balance; }
.ob-h2 { margin: 0; font-size: 22px; font-weight: 700; line-height: 1.25; }
.ob-lead { margin: 0; font-size: 16px; line-height: 1.45; color: #1D2733; }
.ob-fine { margin: 0; font-size: 13px; line-height: 1.4; color: #5D6B7A; }

/* The two choices: the same size, so neither reads as the wrong one. The quick
   one is first and tinted because most reps want it. */
.ob-opt { display: flex; align-items: center; gap: 14px; width: 100%; padding: 16px 12px 16px 16px; border: 1.5px solid #D5DEE7; border-radius: 16px; background: #fff; text-align: left; font: inherit; color: inherit; cursor: pointer; }
.ob-opt.is-primary { border-color: var(--q-primary); background: #EEF6FC; }
.ob-opt:focus-visible { outline: 2px solid var(--q-primary); outline-offset: 2px; }
.ob-opt-ic { flex: none; width: 48px; height: 48px; border-radius: 14px; display: grid; place-items: center; background: var(--q-primary); color: #fff; }
.ob-opt:not(.is-primary) .ob-opt-ic { background: #E6EEF5; color: var(--q-primary); }
.ob-opt-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ob-opt-t { font-size: 18px; font-weight: 700; }
.ob-opt-s { font-size: 14px; color: #5D6B7A; }
.ob-opt-chev { color: #8A99A8; }

.ob-check { width: 72px; height: 72px; border-radius: 50%; display: grid; place-items: center; background: #E7F5EE; color: #1E8E5A; margin-top: 30px; }
.ob-next { min-width: 140px; }
</style>

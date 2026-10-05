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
      <button type="button" class="ob-opt is-primary" @click="phase = 'quick1'">
        <span class="ob-opt-ic"><q-icon name="sms" size="26px" /></span>
        <span class="ob-opt-txt"><span class="ob-opt-t">{{ C.splash.quick.label }}</span><span class="ob-opt-s">{{ C.splash.quick.sub }}</span></span>
        <q-icon name="chevron_right" size="26px" class="ob-opt-chev" />
      </button>
      <button type="button" class="ob-opt" @click="phase = 'tour'">
        <span class="ob-opt-ic"><q-icon name="play_arrow" size="26px" /></span>
        <span class="ob-opt-txt"><span class="ob-opt-t">{{ C.splash.tour.label }}</span><span class="ob-opt-s">{{ manager ? C.splash.tour.subManagers : C.splash.tour.sub }}</span></span>
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
    @back="phase = 'splash'"
  >
    <TourStage :scene="TourSceneQuickText" :manager="manager" />
    <template #actions>
      <q-space />
      <q-btn unelevated no-caps color="primary" label="Next" class="ob-next" @click="phase = 'quick2'" />
    </template>
  </OnboardingFrame>

  <OnboardingFrame v-else-if="phase === 'quick2'" back skip="Close" :steps="2" :current="1" @back="phase = 'quick1'" @skip="$emit('close', 'quick')">
    <div class="ob-link">
      <h2 class="ob-h2">{{ C.quickLink.title }}</h2>
      <!-- eslint-disable-next-line vue/no-v-html -- only **bold**, from tourFlow.ts -->
      <p class="ob-lead" v-html="renderCopy(hasPhone ? C.quickLink.body : C.quickLink.noPhoneBody)" />
      <TextSetupAction :has-phone="hasPhone" @texted="$emit('close', 'quick-texted')" />
      <q-space />
      <!-- eslint-disable-next-line vue/no-v-html -- same -->
      <p class="ob-fine" v-html="renderCopy(C.quickLink.footer)" />
    </div>
    <template v-if="!isMobile || !hasPhone" #actions>
      <q-space />
      <q-btn unelevated no-caps color="primary" label="Go to Setup" @click="$emit('close', 'quick-texted')" />
    </template>
  </OnboardingFrame>

  <TourPlayer v-else-if="phase === 'tour'" :manager="manager" :has-phone="hasPhone" @skip="$emit('close', 'skipped')" @done="phase = 'finish'" />

  <OnboardingFrame v-else>
    <div class="ob-finish">
      <div class="ob-check"><q-icon name="check" size="40px" /></div>
      <h1 class="ob-h1">{{ finish.title }}</h1>
      <!-- eslint-disable-next-line vue/no-v-html -- only **bold**, from tourFlow.ts -->
      <p class="ob-lead" v-html="renderCopy(finish.body)" />
    </div>
    <template #actions>
      <q-btn flat no-caps color="primary" :label="C.finish.again" @click="phase = 'tour'" />
      <q-space />
      <q-btn unelevated no-caps color="primary" :label="finish.go" class="ob-next" @click="$emit('close', 'finished')" />
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
import { ONBOARDING_COPY as C, renderCopy, type OnboardingEnd } from './tourFlow';
import logo from '@/assets/brand/ckh-logo.png';


// hasPhone: the account has a mobile number (me.hasPhone in the real build).
// phoneConnected: the phone is already linked to a conference by SETUP (me's sms
// status), so "Your turn" says "You're all set" instead of "text SETUP".
const props = defineProps<{ manager: boolean; hasPhone: boolean; phoneConnected?: boolean; start?: 'splash' | 'quick1' | 'quick2' | 'tour' | 'finish' }>();
defineEmits<{ close: [end: OnboardingEnd] }>();

const phase = ref(props.start ?? 'splash');
const finish = computed(() => (props.phoneConnected ? C.finish.connected : C.finish));
const isMobile = Platform.is.mobile === true;
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
